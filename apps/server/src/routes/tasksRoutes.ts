import type { FastifyInstance, FastifyReply } from 'fastify';
import type { TasksRepo } from '../repos/tasks.js';
import type { EventsRepo } from '../repos/events.js';

interface TaskCreateBody {
  type?: unknown;
  payload?: unknown;
  maxAttempts?: unknown;
  scheduledAt?: unknown;
  priority?: unknown;
}

function bad(reply: FastifyReply, msg: string) {
  return reply.code(400).send({ error: msg });
}

export async function taskRoutes(
  app: FastifyInstance,
  opts: { tasks: TasksRepo; events: EventsRepo },
): Promise<void> {
  const { tasks, events } = opts;

  app.post('/api/tasks', async (req, reply) => {
    const b = (req.body ?? {}) as TaskCreateBody;
    if (typeof b.type !== 'string' || b.type.length === 0 || b.type.length > 200) {
      return bad(reply, 'type (string) is required');
    }
    if (
      b.payload !== undefined &&
      (typeof b.payload !== 'object' || b.payload === null || Array.isArray(b.payload))
    ) {
      return bad(reply, 'payload must be an object');
    }
    let maxAttempts: number | undefined;
    if (b.maxAttempts !== undefined) {
      if (
        typeof b.maxAttempts !== 'number' ||
        !Number.isInteger(b.maxAttempts) ||
        b.maxAttempts < 1 ||
        b.maxAttempts > 50
      ) {
        return bad(reply, 'maxAttempts must be an integer 1..50');
      }
      maxAttempts = b.maxAttempts;
    }
    let scheduledAt: Date | undefined;
    if (b.scheduledAt !== undefined) {
      if (typeof b.scheduledAt !== 'string') return bad(reply, 'scheduledAt must be an ISO date string');
      const t = new Date(b.scheduledAt);
      if (Number.isNaN(t.getTime())) return bad(reply, 'scheduledAt must be an ISO date');
      scheduledAt = t;
    }
    let priority = 0;
    if (b.priority !== undefined) {
      if (typeof b.priority !== 'number' || !Number.isInteger(b.priority)) {
        return bad(reply, 'priority must be an integer');
      }
      priority = b.priority;
    }
    const task = await tasks.create({
      type: b.type,
      payload: (b.payload ?? {}) as Record<string, unknown>,
      maxAttempts,
      scheduledAt,
      priority,
    });
    return reply.code(201).send(task);
  });

  app.get('/api/tasks', async (req) => {
    const q = req.query as { status?: string; workerId?: string; limit?: string };
    return tasks.list({
      status: q.status,
      workerId: q.workerId,
      limit: q.limit ? parseInt(q.limit, 10) : 100,
    });
  });

  app.get('/api/tasks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = await tasks.getById(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    return { task, events: events.tail(200).filter((e) => e.taskId === task.id) };
  });

  app.post('/api/tasks/:id/retry', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = await tasks.retryNow(id);
    if (!task) return reply.code(409).send({ error: 'task not in dead_letter state' });
    return task;
  });

  app.post('/api/tasks/claim', async (req, reply) => {
    const b = (req.body ?? {}) as { workerId?: unknown; batch?: unknown };
    if (typeof b.workerId !== 'string') return bad(reply, 'workerId required');
    const batch = typeof b.batch === 'number' ? Math.min(Math.max(Math.trunc(b.batch), 1), 10) : 1;
    const claimed = await tasks.claim(b.workerId, batch);
    return reply.send({ tasks: claimed });
  });

  app.post('/api/tasks/:id/complete', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { workerId?: unknown; leaseToken?: unknown; result?: unknown };
    if (typeof b.workerId !== 'string' || typeof b.leaseToken !== 'string') {
      return bad(reply, 'workerId and leaseToken required');
    }
    const task = await tasks.complete(
      id,
      b.workerId,
      b.leaseToken,
      (b.result ?? undefined) as Record<string, unknown> | undefined,
    );
    if (!task) return reply.code(409).send({ error: 'fence rejected: task moved on' });
    return task;
  });

  app.post('/api/tasks/:id/fail', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { workerId?: unknown; leaseToken?: unknown; error?: unknown };
    if (typeof b.workerId !== 'string' || typeof b.leaseToken !== 'string') {
      return bad(reply, 'workerId and leaseToken required');
    }
    const task = await tasks.fail(id, b.workerId, b.leaseToken, String(b.error ?? 'unknown error'));
    if (!task) return reply.code(409).send({ error: 'fence rejected: task moved on' });
    return task;
  });
}
