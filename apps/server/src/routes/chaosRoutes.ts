import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ChaosSupervisor } from '../chaos/chaosSupervisor.js';
import type { TasksRepo } from '../repos/tasks.js';
import type { WorkersRepo } from '../repos/workers.js';
import { config } from '../config.js';

function forbidden(reply: FastifyReply) {
  return reply.code(403).send({ error: 'chaos disabled (CHAOS_ENABLED=false)' });
}

export async function chaosRoutes(
  app: FastifyInstance,
  opts: { chaos: ChaosSupervisor | null; tasks: TasksRepo; workers: WorkersRepo },
): Promise<void> {
  const { chaos, tasks, workers } = opts;

  // Workspace hygiene: remove offline workers that hold no active tasks.
  app.post('/api/admin/chaos/clear-offline-workers', async (_req, reply) => {
    const removed = await workers.deleteOffline();
    return reply.send({ ok: true, removed, count: removed.length });
  });

  // Judge-console: manually move a running task from worker A to worker B.
  app.post('/api/admin/chaos/tasks/:id/reassign', async (req, reply) => {
    const b = (req.body ?? {}) as { fromWorkerId?: unknown; toWorkerId?: unknown };
    if (typeof b.fromWorkerId !== 'string' || typeof b.toWorkerId !== 'string') {
      return reply.code(400).send({ error: 'fromWorkerId and toWorkerId required' });
    }
    const { id } = req.params as { id: string };
    const task = await tasks.reassign(id, b.fromWorkerId, b.toWorkerId);
    if (!task) {
      return reply
        .code(409)
        .send({ error: 'task not running on fromWorkerId (already moved, completed, or finished)' });
    }
    return task;
  });

  app.post('/api/admin/chaos/spawn-worker', async (_req, reply) => {
    if (!chaos) return forbidden(reply);
    return reply.code(201).send(await chaos.spawnWorker());
  });

  app.post('/api/admin/chaos/kill-worker/:name', async (req, reply) => {
    if (!chaos) return forbidden(reply);
    const { name } = req.params as { name: string };
    const ok = await chaos.killWorker(name);
    if (!ok) return reply.code(404).send({ error: 'no such managed worker' });
    return { ok: true, name };
  });

  app.post('/api/admin/chaos/pause-heartbeats/:name', async (req, reply) => {
    if (!chaos) return forbidden(reply);
    const { name } = req.params as { name: string };
    const ok = chaos.pauseHeartbeats(name);
    if (!ok) return reply.code(404).send({ error: 'no such managed worker' });
    return { ok: true, name, paused: true };
  });

  app.post('/api/admin/chaos/resume-heartbeats/:name', async (req, reply) => {
    if (!chaos) return forbidden(reply);
    const { name } = req.params as { name: string };
    const ok = chaos.resumeHeartbeats(name);
    if (!ok) return reply.code(404).send({ error: 'no such managed worker' });
    return { ok: true, name, paused: false };
  });

  app.post('/api/admin/chaos/seed-tasks', async (req, reply) => {
    if (!chaos) return forbidden(reply);
    const b = (req.body ?? {}) as { count?: unknown; seed?: unknown; crashCount?: unknown };
    const count =
      typeof b.count === 'number' && Number.isInteger(b.count) && b.count > 0 && b.count <= 500
        ? b.count
        : 20;
    const seed = typeof b.seed === 'number' ? b.seed : 42;
    const crashCount = typeof b.crashCount === 'number' && b.crashCount >= 0 ? b.crashCount : undefined;
    return reply.send(await chaos.seedTasks(count, seed, crashCount));
  });

  app.post('/api/admin/chaos/reset', async (_req, reply) => {
    if (!chaos) return forbidden(reply);
    await chaos.reset();
    return { ok: true };
  });

  app.get('/api/admin/chaos/workers', async (_req, reply) => {
    if (!chaos) return forbidden(reply);
    return { managed: chaos.managedNames, paused: [...chaos.isPausedSet] };
  });
}
