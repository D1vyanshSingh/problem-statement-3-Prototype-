import type { Pool } from 'pg';
import type { EventBus } from '../events/bus.js';
import type { EventsRepo } from './events.js';
import type { CreateTaskInput, Task, TaskStatus } from '@relay/core';
import { nowIso } from '../util.js';

interface TaskRow {
  id: string;
  type: string;
  status: TaskStatus;
  priority: number;
  payload: unknown;
  result: unknown;
  assigned_worker_id: string | null;
  lease_token: string | null;
  attempt: number;
  max_attempts: number;
  run_at: Date;
  lease_expires_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export const COLS =
  'id, type, status, priority, payload, result, assigned_worker_id, lease_token, attempt, max_attempts, run_at, lease_expires_at, started_at, finished_at, last_error, created_at, updated_at';

/** RETURNING list qualified for UPDATE ... FROM (avoids ambiguous `id`). */
const QCOLS = COLS.split(', ')
  .map((c) => `t.${c}`)
  .join(', ');

export function mapTask(r: TaskRow): Task {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    priority: r.priority,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    result: (r.result ?? undefined) as Record<string, unknown> | undefined,
    assignedWorkerId: r.assigned_worker_id,
    leaseToken: r.lease_token,
    attempt: r.attempt,
    maxAttempts: r.max_attempts,
    runAt: r.run_at.toISOString(),
    leaseExpiresAt: r.lease_expires_at ? r.lease_expires_at.toISOString() : null,
    startedAt: r.started_at ? r.started_at.toISOString() : null,
    finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
    lastError: r.last_error,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export class TasksRepo {
  constructor(
    private readonly pool: Pool,
    private readonly bus: EventBus,
    private readonly events: EventsRepo,
    private readonly cfg: {
      retryBackoffBaseMs: number;
      retryBackoffCapMs: number;
      leaseTimeoutMs: number;
      maxAttemptsDefault: number;
    },
  ) {}

  backoffMs(attempt: number): number {
    const raw = this.cfg.retryBackoffBaseMs * 2 ** (attempt - 1);
    return Math.min(raw, this.cfg.retryBackoffCapMs);
  }

  async create(input: CreateTaskInput): Promise<Task> {
    const id = crypto.randomUUID();
    const status: TaskStatus = input.scheduledAt ? 'scheduled' : 'pending';
    const { rows } = await this.pool.query<TaskRow>(
      `INSERT INTO tasks (id, type, status, payload, max_attempts, run_at, priority)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7) RETURNING ${COLS}`,
      [
        id,
        input.type,
        status,
        JSON.stringify(input.payload ?? {}),
        input.maxAttempts ?? this.cfg.maxAttemptsDefault,
        input.scheduledAt ?? new Date(),
        input.priority ?? 0,
      ],
    );
    const created = rows[0];
    if (!created) throw new Error('task insert returned no row');
    return this.after('CREATED', mapTask(created), {
      scheduledAt: input.scheduledAt?.toISOString() ?? null,
    });
  }

  /** Atomic batch claim: SKIP LOCKED subquery + guarded UPDATE (plan §A).
   *  A task reserved for another worker is invisible here; the server delivers
   *  reserved tasks explicitly via reassign(). */
  async claim(workerId: string, batch: number): Promise<Task[]> {
    const { rows } = await this.pool.query<TaskRow>(
      `UPDATE tasks t SET
         status='running',
         assigned_worker_id=$1,
         reserved_for=NULL,
         lease_token=gen_random_uuid()::text,
         attempt=t.attempt+1,
         lease_expires_at=now()+make_interval(secs=>$2),
         started_at=COALESCE(t.started_at, now()),
         updated_at=now()
       FROM (
         SELECT id FROM tasks
         WHERE status IN ('pending','retrying') AND run_at <= now()
           AND (reserved_for IS NULL OR reserved_for = $1)
         ORDER BY priority DESC, run_at ASC
         FOR UPDATE SKIP LOCKED LIMIT $3
       ) picked
       WHERE t.id = picked.id
       RETURNING ${QCOLS}`,
      [workerId, this.cfg.leaseTimeoutMs / 1000, Math.max(1, batch)],
    );
    const claimed = rows.map(mapTask);
    for (const t of claimed) {
      await this.after('LEASED', t, { workerId, attempt: t.attempt });
    }
    return claimed;
  }

  async getById(id: string): Promise<Task | null> {
    const { rows } = await this.pool.query<TaskRow>(`SELECT ${COLS} FROM tasks WHERE id = $1`, [
      id,
    ]);
    const row = rows[0];
    return row ? mapTask(row) : null;
  }

  async list(opts: { status?: string; workerId?: string; limit?: number } = {}): Promise<Task[]> {
    const conds: string[] = [];
    const args: unknown[] = [];
    if (opts.status) {
      args.push(opts.status);
      conds.push(`status = $${args.length}`);
    }
    if (opts.workerId) {
      args.push(opts.workerId);
      conds.push(`assigned_worker_id = $${args.length}`);
    }
    args.push(Math.min(Math.max(opts.limit ?? 100, 1), 1000));
    const limitIdx = args.length;
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await this.pool.query<TaskRow>(
      `SELECT ${COLS} FROM tasks ${where} ORDER BY created_at DESC LIMIT $${limitIdx}`,
      args,
    );
    return rows.map(mapTask);
  }

  async countByStatus(): Promise<Record<TaskStatus, number>> {
    const { rows } = await this.pool.query<{ status: TaskStatus; n: string }>(
      'SELECT status, count(*)::text AS n FROM tasks GROUP BY status',
    );
    const out: Record<TaskStatus, number> = {
      scheduled: 0,
      pending: 0,
      running: 0,
      retrying: 0,
      completed: 0,
      dead_letter: 0,
    };
    for (const r of rows) if (r.status in out) out[r.status] = Number(r.n);
    return out;
  }

  /** Promote due scheduled tasks. Returns number promoted. */
  async promoteScheduled(nowMs: number): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE tasks SET status='pending', updated_at=now()
       WHERE status='scheduled' AND run_at <= $1`,
      [new Date(nowMs)],
    );
    return rowCount ?? 0;
  }

  /** Manual reprocess from DLQ (or any terminal task): attempt counter resets. */
  async recoverExpired(): Promise<Task[]> {
    const { rows } = await this.pool.query<TaskRow>(
      `UPDATE tasks SET
         status='pending',
         assigned_worker_id=NULL,
         reserved_for=NULL,
         lease_token=NULL,
         lease_expires_at=NULL,
         updated_at=now()
       WHERE status IN ('running','retrying') AND lease_expires_at < now()
       RETURNING ${COLS}`,
    );
    const recovered = rows.map(mapTask);
    for (const t of recovered) {
      await this.after('RECOVERED', t, { reason: 'lease_expired' });
    }
    return recovered;
  }

  /** Heartbeat lease extension, fully fenced by (worker, task, token). */
  async extendLease(
    taskId: string,
    workerId: string,
    leaseToken: string,
    leaseTimeoutMs = this.cfg.leaseTimeoutMs,
  ): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE tasks SET lease_expires_at = now()+make_interval(secs=>$2), updated_at=now()
       WHERE id=$1 AND assigned_worker_id=$3 AND lease_token=$4 AND status='running'`,
      [taskId, leaseTimeoutMs / 1000, workerId, leaseToken],
    );
    return (rowCount ?? 0) > 0;
  }

  async complete(
    taskId: string,
    workerId: string,
    leaseToken: string,
    result?: Record<string, unknown>,
  ): Promise<Task | null> {
    const { rows } = await this.pool.query<TaskRow>(
      `UPDATE tasks SET status='completed', result=$2::jsonb, finished_at=now(),
         lease_token=NULL, lease_expires_at=NULL, updated_at=now()
       WHERE id=$1 AND assigned_worker_id=$3 AND lease_token=$4 AND status='running'
       RETURNING ${COLS}`,
      [taskId, JSON.stringify(result ?? {}), workerId, leaseToken],
    );
    const row = rows[0];
    if (!row) return null;
    return this.after('COMPLETED', mapTask(row), { workerId });
  }

  async fail(
    taskId: string,
    workerId: string,
    leaseToken: string,
    error: string,
  ): Promise<Task | null> {
    const cur = await this.getById(taskId);
    if (!cur || cur.assignedWorkerId !== workerId || cur.leaseToken !== leaseToken) return null;
    const exhausted = cur.attempt >= cur.maxAttempts;
    if (exhausted) {
      const { rows } = await this.pool.query<TaskRow>(
        `UPDATE tasks SET status='dead_letter', last_error=$2, finished_at=now(),
           lease_token=NULL, lease_expires_at=NULL, reserved_for=NULL, updated_at=now()
         WHERE id=$1 AND assigned_worker_id=$3 AND lease_token=$4 AND status='running'
         RETURNING ${COLS}`,
        [taskId, error, workerId, leaseToken],
      );
      const row = rows[0];
      if (!row) return null;
      return this.after('DEAD_LETTER', mapTask(row), {
        workerId,
        error,
        attempt: cur.attempt,
      });
    }
    const runAt = new Date(Date.now() + this.backoffMs(cur.attempt));
    const { rows } = await this.pool.query<TaskRow>(
      `UPDATE tasks SET status='retrying', last_error=$2, run_at=$5,
         lease_token=NULL, lease_expires_at=NULL, reserved_for=NULL, updated_at=now()
       WHERE id=$1 AND assigned_worker_id=$3 AND lease_token=$4 AND status='running'
       RETURNING ${COLS}`,
      [taskId, error, workerId, leaseToken, runAt],
    );
    const retryRow = rows[0];
    if (!retryRow) return null;
    return this.after('RETRY_QUEUED', mapTask(retryRow), {
      workerId,
      error,
      attempt: cur.attempt,
      nextAttemptAt: runAt.toISOString(),
    });
  }

  /** Judge-console reassignment: move a running task from worker A to worker B
   *  mid-task. Worker A keeps its dead lease token and is fenced out of
   *  complete/fail; worker B gets a fresh lease under its own id.
   *  Returns null when the task isn't running or the task's current worker
   *  doesn't match `fromWorkerId` (or that worker is unknown). */
  async reassign(taskId: string, fromWorkerId: string, toWorkerId: string): Promise<Task | null> {
    const cur = await this.getById(taskId);
    if (!cur || cur.status !== 'running') return null;
    if (cur.assignedWorkerId !== fromWorkerId) return null;
    const { rows } = await this.pool.query<TaskRow>(
      `UPDATE tasks SET
         assigned_worker_id=$2,
         reserved_for=NULL,
         lease_token=gen_random_uuid()::text,
         attempt=attempt+1,
         lease_expires_at=now()+make_interval(secs=>$3),
         updated_at=now()
       WHERE id=$1 AND status='running'
       RETURNING ${COLS}`,
      [taskId, toWorkerId, this.cfg.leaseTimeoutMs / 1000],
    );
    const row = rows[0];
    if (!row) return null;
    const task = mapTask(row);
    await this.after('RECOVERED', task, { reason: 'manual_reassign', from: fromWorkerId, to: toWorkerId });
    return task;
  }

  /** Manual reprocess from DLQ (or any terminal task): attempt counter resets. */
  async retryNow(taskId: string): Promise<Task | null> {
    const { rows } = await this.pool.query<TaskRow>(
      `UPDATE tasks SET status='pending', attempt=0, run_at=now(),
         assigned_worker_id=NULL, lease_token=NULL, lease_expires_at=NULL,
         reserved_for=NULL,
         last_error=NULL, finished_at=NULL, started_at=NULL, updated_at=now()
       WHERE id=$1 AND status='dead_letter'
       RETURNING ${COLS}`,
      [taskId],
    );
    const row = rows[0];
    if (!row) return null;
    return this.after('RETRY_NOW', mapTask(row), { manual: true });
  }

  private async after(type: string, task: Task, detail: Record<string, unknown>): Promise<Task> {
    await this.events.pub(type, { taskId: task.id, detail });
    this.bus.emit({ type: 'task.updated', task, at: nowIso() });
    return task;
  }
}
