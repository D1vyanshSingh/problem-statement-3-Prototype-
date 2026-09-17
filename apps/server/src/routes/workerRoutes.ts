import type { FastifyInstance, FastifyReply } from 'fastify';
import type { WorkersRepo } from '../repos/workers.js';
import type { TasksRepo } from '../repos/tasks.js';
import type { ChaosSupervisor } from '../chaos/chaosSupervisor.js';

function bad(reply: FastifyReply, msg: string) {
  return reply.code(400).send({ error: msg });
}

export async function workerRoutes(
  app: FastifyInstance,
  opts: {
    workers: WorkersRepo;
    tasks: TasksRepo;
    chaos: ChaosSupervisor | null;
  },
): Promise<void> {
  const { workers, tasks, chaos } = opts;

  app.post('/api/workers', async (req, reply) => {
    const b = (req.body ?? {}) as { name?: unknown; capacity?: unknown; metadata?: unknown };
    if (typeof b.name !== 'string' || b.name.length === 0 || b.name.length > 100) {
      return bad(reply, 'name (string) is required');
    }
    let capacity = 4;
    if (b.capacity !== undefined) {
      if (typeof b.capacity !== 'number' || !Number.isInteger(b.capacity) || b.capacity < 1 || b.capacity > 64) {
        return bad(reply, 'capacity must be an integer 1..64');
      }
      capacity = b.capacity;
    }
    const metadata =
      typeof b.metadata === 'object' && b.metadata !== null
        ? (b.metadata as Record<string, unknown>)
        : {};
    const w = await workers.register(b.name, capacity, metadata);
    return reply.code(201).send(w);
  });

  app.post('/api/workers/:id/heartbeat', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { leases?: unknown };
    const leases = Array.isArray(b.leases)
      ? b.leases.filter(
          (l): l is { taskId: string; leaseToken: string } =>
            typeof (l as { taskId?: unknown })?.taskId === 'string' &&
            typeof (l as { leaseToken?: unknown })?.leaseToken === 'string',
        )
      : [];
    const w = await workers.heartbeat(id);
    if (!w) return reply.code(409).send({ error: 'unknown worker - re-register required' });
    const paused = chaos ? chaos.isPaused(w.name) : false;
    const revoked: string[] = [];
    for (const l of leases) {
      const ok = await tasks.extendLease(l.taskId, w.id, l.leaseToken);
      if (!ok) revoked.push(l.taskId);
    }
    return reply.send({ worker: w, paused, revoked, serverTime: new Date().toISOString() });
  });

  app.post('/api/workers/:id/shutdown', async (req, reply) => {
    const { id } = req.params as { id: string };
    const w = await workers.get(id);
    if (!w) return reply.code(404).send({ error: 'worker not found' });
    await workers.releaseRunningTasks(id);
    await workers.setStatus(id, 'offline');
    return { ok: true, released: true };
  });

  app.get('/api/workers', async () => {
    return workers.list();
  });

  app.get('/api/workers/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const w = await workers.get(id);
    if (!w) return reply.code(404).send({ error: 'worker not found' });
    const running = await tasks.list({ workerId: id, status: 'running', limit: 50 });
    const retrying = await tasks.list({ workerId: id, status: 'retrying', limit: 50 });
    return { worker: w, running, retrying };
  });
}
