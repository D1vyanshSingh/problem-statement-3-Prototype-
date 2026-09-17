import type { Pool } from 'pg';
import type { EventBus } from '../events/bus.js';
import type { TaskEvent } from '@vitals/core';
import { RingBuffer } from '../util.js';

export class EventsRepo {
  private readonly cache: RingBuffer<TaskEvent>;
  private loaded = false;

  constructor(
    private readonly pool: Pool,
    private readonly bus: EventBus,
  ) {
    this.cache = new RingBuffer(2000);
  }

  async warm(): Promise<void> {
    if (this.loaded) return;
    const { rows } = await this.pool.query<TaskEventRow>(
      'SELECT id, task_id, worker_id, type, detail, created_at FROM task_events ORDER BY id DESC LIMIT 2000',
    );
    for (const r of rows.reverse()) this.cache.push(toEvent(r));
    this.loaded = true;
  }

  async pub(
    type: string,
    opts: { taskId?: string | null; workerId?: string | null; detail?: Record<string, unknown> } = {},
  ): Promise<TaskEvent> {
    const { rows } = await this.pool.query<TaskEventRow>(
      `INSERT INTO task_events (task_id, worker_id, type, detail)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, task_id, worker_id, type, detail, created_at`,
      [opts.taskId ?? null, opts.workerId ?? null, type, JSON.stringify(opts.detail ?? {})],
    );
    const first = rows[0];
    if (!first) throw new Error('event insert returned no row');
    const ev = toEvent(first);
    this.cache.push(ev);
    this.bus.emit({ type: 'task.event', event: ev, at: ev.createdAt });
    return ev;
  }

  tail(n: number): TaskEvent[] {
    return this.cache.tail(n);
  }
}

interface TaskEventRow {
  id: string;
  task_id: string | null;
  worker_id: string | null;
  type: string;
  detail: Record<string, unknown>;
  created_at: Date;
}

function toEvent(r: TaskEventRow): TaskEvent {
  return {
    id: Number(r.id),
    taskId: r.task_id,
    workerId: r.worker_id,
    type: r.type,
    detail: r.detail ?? {},
    createdAt: r.created_at.toISOString(),
  };
}
