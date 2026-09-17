import type { FastifyInstance } from 'fastify';
import type { TasksRepo } from '../repos/tasks.js';
import type { MetricsRepo } from '../repos/metrics.js';

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

  app.get('/api/health', async () => {
    return { ok: true, ts: new Date().toISOString() };
  });
}
