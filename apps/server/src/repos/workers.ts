import type { Pool } from 'pg';
import type { EventBus } from '../events/bus.js';
import type { EventsRepo } from './events.js';
import type { Worker, WorkerStatus } from '@relay/core';
import { nowIso } from '../util.js';

interface WorkerRow {
  id: string;
  name: string;
  status: WorkerStatus;
  capacity: number;
  last_heartbeat_at: Date;
  registered_at: Date;
  offline_at: Date | null;
  metadata: Record<string, unknown>;
}

const COLS =
  'id, name, status, capacity, last_heartbeat_at, registered_at, offline_at, metadata';

function mapWorker(r: WorkerRow): Worker {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    capacity: r.capacity,
    lastHeartbeatAt: r.last_heartbeat_at.toISOString(),
    registeredAt: r.registered_at.toISOString(),
    offlineAt: r.offline_at ? r.offline_at.toISOString() : null,
    metadata: r.metadata ?? {},
  };
}

export class WorkersRepo {
  constructor(
    private readonly pool: Pool,
    private readonly bus: EventBus,
    private readonly events: EventsRepo,
    private readonly heartbeatTimeoutMs: number,
  ) {}

  async register(name: string, capacity: number, metadata: Record<string, unknown>): Promise<Worker> {
    const { rows } = await this.pool.query<WorkerRow>(
      `INSERT INTO workers (id, name, status, capacity, metadata)
       VALUES ($1, $2, 'online', $3, $4::jsonb)
       ON CONFLICT (name) DO UPDATE
         SET status='online', capacity=EXCLUDED.capacity,
             last_heartbeat_at=now(), offline_at=NULL, metadata=EXCLUDED.metadata
       RETURNING ${COLS}`,
      [crypto.randomUUID(), name, capacity, JSON.stringify(metadata ?? {})],
    );
    const row = rows[0];
    if (!row) throw new Error('worker upsert returned no row');
    const w = mapWorker(row);
    await this.events.pub('WORKER_REGISTERED', {
      workerId: w.id,
      detail: { name: w.name, capacity: w.capacity },
    });
    this.bus.emit({ type: 'worker.updated', worker: w, at: nowIso() });
    return w;
  }

  async get(id: string): Promise<Worker | null> {
    const { rows } = await this.pool.query<WorkerRow>(`SELECT ${COLS} FROM workers WHERE id=$1`, [
      id,
    ]);
    return rows[0] ? mapWorker(rows[0]) : null;
  }

  async getByName(name: string): Promise<Worker | null> {
    const { rows } = await this.pool.query<WorkerRow>(`SELECT ${COLS} FROM workers WHERE name=$1`, [
      name,
    ]);
    return rows[0] ? mapWorker(rows[0]) : null;
  }

  async list(): Promise<Worker[]> {
    const { rows } = await this.pool.query<WorkerRow>(
      `SELECT ${COLS} FROM workers ORDER BY name ASC`,
    );
    return rows.map(mapWorker);
  }

  /** Returns refreshed worker, or null if the worker must re-register (was reaped). */
  async heartbeat(id: string): Promise<Worker | null> {
    const { rows } = await this.pool.query<WorkerRow>(
      `UPDATE workers SET last_heartbeat_at=now(), status='online', offline_at=NULL
       WHERE id=$1 AND status='online'
       RETURNING ${COLS}`,
      [id],
    );
    if (rows[0]) {
      const w = mapWorker(rows[0]);
      this.bus.emit({ type: 'worker.updated', worker: w, at: nowIso() });
      return w;
    }
    return null;
  }

  async setStatus(id: string, status: WorkerStatus): Promise<void> {
    await this.pool.query(
      `UPDATE workers SET status=$2, offline_at=CASE WHEN $2='offline' THEN now() ELSE offline_at END,
         last_heartbeat_at=CASE WHEN $2='online' THEN now() ELSE last_heartbeat_at END
       WHERE id=$1`,
      [id, status],
    );
  }

  async markTimedOut(): Promise<Worker[]> {
    const { rows } = await this.pool.query<WorkerRow>(
      `UPDATE workers SET status='offline', offline_at=now()
       WHERE status='online' AND last_heartbeat_at < now() - make_interval(secs=>$1)
       RETURNING ${COLS}`,
      [this.heartbeatTimeoutMs / 1000],
    );
    const out = rows.map(mapWorker);
    for (const w of out) {
      await this.events.pub('WORKER_TIMEOUT', {
        workerId: w.id,
        detail: { name: w.name, lastHeartbeatAt: w.lastHeartbeatAt },
      });
      this.bus.emit({ type: 'worker.updated', worker: w, at: nowIso() });
    }
    return out;
  }

  async releaseRunningTasks(workerId: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE tasks SET status='pending', assigned_worker_id=NULL, lease_token=NULL,
         lease_expires_at=NULL, updated_at=now()
       WHERE assigned_worker_id=$1 AND status IN ('running','retrying')`,
      [workerId],
    );
    return rowCount ?? 0;
  }

  async runningCount(workerId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tasks
       WHERE assigned_worker_id=$1 AND status IN ('running','retrying')`,
      [workerId],
    );
    return Number(rows[0]?.n ?? 0);
  }
}
