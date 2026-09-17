import type { Pool } from 'pg';
import type { MetricsSnapshot, QueueSnapshot } from './tasksMetrics.js';

export class MetricsRepo {
  constructor(private readonly pool: Pool) {}

  /** Completed-task count per worker — the load-balancing proof. */
  async completedByWorker(): Promise<Record<string, number>> {
    const { rows } = await this.pool.query<{ assigned_worker_id: string | null; n: string }>(
      `SELECT assigned_worker_id, count(*)::text AS n
       FROM tasks WHERE status='completed' AND assigned_worker_id IS NOT NULL
       GROUP BY assigned_worker_id`,
    );
    const out: Record<string, number> = {};
    for (const r of rows) if (r.assigned_worker_id) out[r.assigned_worker_id] = Number(r.n);
    return out;
  }

  async queueSnapshot(): Promise<QueueSnapshot> {
    const byStatus = await this.countByStatus();
    const oldest = await this.pool.query<{ age: string | null }>(
      `SELECT extract(epoch FROM now() - min(run_at))::text AS age
       FROM tasks WHERE status IN ('pending','retrying')`,
    );
    const running = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tasks WHERE status='running'`,
    );
    const runningByWorker = await this.pool.query<{ assigned_worker_id: string | null; n: string }>(
      `SELECT assigned_worker_id, count(*)::text AS n
       FROM tasks WHERE status IN ('running','retrying') AND assigned_worker_id IS NOT NULL
       GROUP BY assigned_worker_id`,
    );
    const perWorker: Record<string, number> = {};
    for (const r of runningByWorker.rows) if (r.assigned_worker_id) perWorker[r.assigned_worker_id] = Number(r.n);
    return {
      byStatus,
      oldestPendingSeconds: oldest.rows[0]?.age ? Number(oldest.rows[0].age) : null,
      running: Number(running.rows[0]?.n ?? 0),
      runningByWorker: perWorker,
    };
  }

  async metrics(): Promise<MetricsSnapshot> {
    const byStatus = await this.countByStatus();
    const { rows: totals } = await this.pool.query<{
      completed: string;
      failed: string;
      retried: string;
      recovered: string;
      dead: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE type='COMPLETED')::text AS completed,
         count(*) FILTER (WHERE type='DEAD_LETTER')::text AS failed,
         count(*) FILTER (WHERE type='RETRY_QUEUED')::text AS retried,
         count(*) FILTER (WHERE type='RECOVERED')::text AS recovered,
         count(*) FILTER (WHERE type='DEAD_LETTER')::text AS dead
       FROM task_events`,
    );
    const { rows: workersAgg } = await this.pool.query<{ status: string; n: string }>(
      'SELECT status, count(*)::text AS n FROM workers GROUP BY status',
    );
    let online = 0;
    let offline = 0;
    for (const r of workersAgg) {
      if (r.status === 'online') online = Number(r.n);
      if (r.status === 'offline') offline = Number(r.n);
    }
    const { rows: rate } = await this.pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM task_events
       WHERE type='COMPLETED' AND created_at > now() - interval '60 seconds'`,
    );
    const totalsRow = totals[0];
    const completedTotal = Number(totalsRow?.completed ?? 0);
    const failedTotal = Number(totalsRow?.failed ?? 0);
    return {
      ts: new Date().toISOString(),
      byStatus,
      workers: { online, offline },
      completedTotal,
      failedTotal,
      retriedTotal: Number(totalsRow?.retried ?? 0),
      recoveredTotal: Number(totalsRow?.recovered ?? 0),
      dlqSize: byStatus.dead_letter ?? 0,
      throughputPerMin: Number(rate[0]?.c ?? 0),
      successRatePct:
        completedTotal + failedTotal > 0
          ? Math.round((completedTotal / (completedTotal + failedTotal)) * 1000) / 10
          : null,
    };
  }

  private async countByStatus(): Promise<Record<string, number>> {
    const { rows } = await this.pool.query<{ status: string; n: string }>(
      'SELECT status, count(*)::text AS n FROM tasks GROUP BY status',
    );
    const out: Record<string, number> = {
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
}
