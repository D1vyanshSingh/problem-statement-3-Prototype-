import type { FastifyInstance } from 'fastify';
import type { TasksRepo } from '../repos/tasks.js';
import type { MetricsRepo } from '../repos/metrics.js';
import type { Task } from '@vitals/core';

export async function systemRoutes(
  app: FastifyInstance,
  opts: { tasks: TasksRepo; metrics: MetricsRepo },
): Promise<void> {
  const { tasks, metrics } = opts;

  app.get('/api/queue', async () => {
    const [queue, oldest] = await Promise.all([
      metrics.queueSnapshot(),
      tasks.countByStatus(),
    ]);
    return { ...queue, byStatus: { ...queue.byStatus, ...oldest } };
  });

  app.get('/api/metrics', async () => {
    return metrics.metrics();
  });

  app.get('/api/metrics/completed-by-worker', async () => {
    return metrics.completedByWorker();
  });

  app.get('/api/health', async () => {
    return { ok: true, ts: new Date().toISOString() };
  });

  /**
   * Downloadable plain-text DLQ incident report.
   * Covers every dead-lettered task: identity, failure reason, attempt history,
   * plus system-wide totals for context. Content-Disposition: attachment.
   */
  app.get('/api/reports/dlq', async (_req, reply) => {
    const [dlqTasks, m] = await Promise.all([
      tasks.list({ status: 'dead_letter', limit: 1000 }),
      metrics.metrics(),
    ]);

    const now = new Date();
    const lines: string[] = [];
    const rule = '='.repeat(72);

    lines.push(rule);
    lines.push('VITALS — DEAD-LETTER QUEUE INCIDENT REPORT');
    lines.push(`Generated: ${now.toISOString()}`);
    lines.push(rule);
    lines.push('');
    lines.push('SYSTEM SUMMARY');
    lines.push(`  Workers online ............ ${m.workers.online}`);
    lines.push(`  Workers offline ........... ${m.workers.offline}`);
    lines.push(`  Tasks completed ........... ${m.completedTotal}`);
    lines.push(`  Tasks failed (DLQ total) .. ${m.failedTotal}`);
    lines.push(`  Retries issued ............ ${m.retriedTotal}`);
    lines.push(`  Lease recoveries .......... ${m.recoveredTotal}`);
    lines.push(`  Throughput (last 60s) ..... ${m.throughputPerMin}/min`);
    lines.push('');
    lines.push(`DLQ CONTENTS: ${dlqTasks.length} task(s)`);
    lines.push('-'.repeat(72));

    if (dlqTasks.length === 0) {
      lines.push('  (empty — no dead-lettered tasks)');
    }

    for (const [i, t] of dlqTasks.entries()) {
      lines.push('');
      lines.push(`[${i + 1}] TASK ${t.id}`);
      lines.push(`    Type ............ ${t.type}`);
      lines.push(`    Status .......... ${t.status}`);
      lines.push(`    Attempts ........ ${t.attempt} of ${t.maxAttempts} (exhausted)`);
      lines.push(`    Priority ........ ${t.priority}`);
      lines.push(`    Created ......... ${t.createdAt}`);
      lines.push(`    Last attempt .... ${t.updatedAt}`);
      lines.push(`    Finished ........ ${t.finishedAt ?? '—'}`);
      lines.push(`    Last worker ..... ${t.assignedWorkerId ?? '—'}`);
      lines.push(`    Error ........... ${t.lastError ?? 'unknown error'}`);
      if (t.result && Object.keys(t.result).length > 0) {
        lines.push(`    Result .......... ${JSON.stringify(t.result)}`);
      }
      lines.push(`    Payload ......... ${JSON.stringify(t.payload)}`);
    }

    lines.push('');
    lines.push(rule);
    lines.push('Reprocess any task:  POST /api/tasks/:id/retry');
    lines.push(`${rule}`);

    const body = lines.join('\r\n') + '\r\n';
    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    reply
      .header('content-type', 'text/plain; charset=utf-8')
      .header('content-disposition', `attachment; filename="vitals-dlq-report-${stamp}.txt"`);
    return body;
  });
}
