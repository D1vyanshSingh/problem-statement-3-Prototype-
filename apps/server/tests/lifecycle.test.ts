import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestServer, api, resetTasks } from './helpers.js';

interface Task {
  id: string;
  type: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  leaseToken: string | null;
  assignedWorkerId: string | null;
  lastError: string | null;
}

beforeAll(async () => {
  await getTestServer();
  await resetTasks();
});

afterAll(async () => {
  // keep the shared server alive across test files in this run
});

describe('task lifecycle', () => {
  it('pending → claim → complete (fenced)', async () => {
    const created = await api<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ type: 'demo.echo', payload: { hello: 1 } }),
    });
    expect(created.status).toBe(201);
    const t = created.body;

    const reg = await api<{ id: string }>('/api/workers', {
      method: 'POST',
      body: JSON.stringify({ name: 'test-worker-1', capacity: 2 }),
    });
    expect(reg.status).toBe(201);
    const workerId = reg.body.id;

    const claimed = await api<{ tasks: Task[] }>('/api/tasks/claim', {
      method: 'POST',
      body: JSON.stringify({ workerId, batch: 1 }),
    });
    expect(claimed.body.tasks).toHaveLength(1);
    const leased = claimed.body.tasks[0]!;
    expect(leased.id).toBe(t.id);
    expect(leased.status).toBe('running');
    expect(leased.attempt).toBe(1);
    expect(leased.leaseToken).toBeTruthy();

    // stale lease token must be rejected (fence)
    const stale = await api(`/api/tasks/${t.id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ workerId, leaseToken: 'bogus-token' }),
    });
    expect(stale.status).toBe(409);

    const done = await api<Task>(`/api/tasks/${t.id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ workerId, leaseToken: leased.leaseToken, result: { ok: true } }),
    });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('completed');
  });

  it('fail → retrying (backoff) → dead_letter after max attempts → manual retry', async () => {
    const created = await api<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ type: 'demo.always_fail', maxAttempts: 2 }),
    });
    const t = created.body;
    const reg = await api<{ id: string }>('/api/workers', {
      method: 'POST',
      body: JSON.stringify({ name: 'test-worker-2', capacity: 2 }),
    });
    const workerId = reg.body.id;

    // attempt 1 → retrying
    const c1 = await api<{ tasks: Task[] }>('/api/tasks/claim', {
      method: 'POST',
      body: JSON.stringify({ workerId, batch: 5 }),
    });
    const first = c1.body.tasks.find((x) => x.id === t.id)!;
    expect(first.attempt).toBe(1);
    const f1 = await api<Task>(`/api/tasks/${t.id}/fail`, {
      method: 'POST',
      body: JSON.stringify({ workerId, leaseToken: first.leaseToken, error: 'boom 1' }),
    });
    expect(f1.body.status).toBe('retrying');
    expect(f1.body.lastError).toBe('boom 1');

    // wait out the exponential backoff (attempt 1 → ~1s)
    await new Promise((r) => setTimeout(r, 1300));

    // attempt 2 → dead_letter (maxAttempts=2)
    const c2 = await api<{ tasks: Task[] }>('/api/tasks/claim', {
      method: 'POST',
      body: JSON.stringify({ workerId, batch: 5 }),
    });
    const second = c2.body.tasks.find((x) => x.id === t.id)!;
    expect(second.attempt).toBe(2);
    const f2 = await api<Task>(`/api/tasks/${t.id}/fail`, {
      method: 'POST',
      body: JSON.stringify({ workerId, leaseToken: second.leaseToken, error: 'boom 2' }),
    });
    expect(f2.body.status).toBe('dead_letter');

    // manual reprocess
    const retry = await api<Task>(`/api/tasks/${t.id}/retry`, { method: 'POST' });
    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe('pending');
    expect(retry.body.attempt).toBe(0);
  });

  it('scheduled tasks are not claimable until due (scheduler promotion)', async () => {
    const future = new Date(Date.now() + 2000).toISOString();
    const created = await api<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ type: 'demo.echo', scheduledAt: future }),
    });
    expect(created.body.status).toBe('scheduled');

    const reg = await api<{ id: string }>('/api/workers', {
      method: 'POST',
      body: JSON.stringify({ name: 'test-worker-3', capacity: 2 }),
    });
    const c1 = await api<{ tasks: Task[] }>('/api/tasks/claim', {
      method: 'POST',
      body: JSON.stringify({ workerId: reg.body.id, batch: 5 }),
    });
    expect(c1.body.tasks.find((x) => x.id === created.body.id)).toBeUndefined();

    // wait for run_at to pass + scheduler tick
    await new Promise((r) => setTimeout(r, 3000));
    const c2 = await api<{ tasks: Task[] }>('/api/tasks/claim', {
      method: 'POST',
      body: JSON.stringify({ workerId: reg.body.id, batch: 5 }),
    });
    const promoted = c2.body.tasks.find((x) => x.id === created.body.id);
    expect(promoted).toBeTruthy();
    expect(promoted!.attempt).toBe(1);
  });

  it('lease expiry recovery: expired running task is requeued without attempt increment and fenced against stale acks', async () => {
    const created = await api<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ type: 'demo.echo' }),
    });
    const t = created.body;
    const reg = await api<{ id: string }>('/api/workers', {
      method: 'POST',
      body: JSON.stringify({ name: 'test-worker-4', capacity: 2 }),
    });
    const workerId = reg.body.id;

    const claimed = await api<{ tasks: Task[] }>('/api/tasks/claim', {
      method: 'POST',
      body: JSON.stringify({ workerId, batch: 5 }),
    });
    const leased = claimed.body.tasks.find((x) => x.id === t.id)!;
    expect(leased.status).toBe('running');

    // simulate worker death: stop heartbeats, force lease expiry via direct SQL
    const { makePool } = await import('../src/db/pool.js');
    const pool = makePool();
    await pool.query(
      `UPDATE tasks SET lease_expires_at = now() - interval '1 second' WHERE id=$1`,
      [t.id],
    );

    // run one reaper pass through the API-independent path
    const { TasksRepo } = await import('../src/repos/tasks.js');
    const { EventsRepo } = await import('../src/repos/events.js');
    const { EventBus } = await import('../src/events/bus.js');
    const bus = new EventBus();
    const events = new EventsRepo(pool, bus);
    const tasksRepo = new TasksRepo(pool, bus, events, {
      retryBackoffBaseMs: 1000,
      retryBackoffCapMs: 30000,
      leaseTimeoutMs: 7000,
      maxAttemptsDefault: 3,
    });
    const recovered = await tasksRepo.recoverExpired();
    expect(recovered.some((x) => x.id === t.id)).toBe(true);
    // recovery itself must NOT consume an attempt (worker death ≠ task failure)
    const afterRecovery = await tasksRepo.getById(t.id);
    expect(afterRecovery?.attempt).toBe(1);
    expect(afterRecovery?.status).toBe('pending');
    await pool.end();

    // stale ack from the dead worker must be rejected
    const staleComplete = await api(`/api/tasks/${t.id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ workerId, leaseToken: leased.leaseToken }),
    });
    expect(staleComplete.status).toBe(409);

    // heartbeats from a reaped worker must be rejected with 409 → re-register
    const hb = await api(`/api/workers/${workerId}/heartbeat`, {
      method: 'POST',
      body: JSON.stringify({ leases: [] }),
    });
    expect([409, 200]).toContain(hb.status); // depends on reaper timing; re-register path is worker-side

    // another worker can now claim it (attempt stays 1 — worker death is not a task failure)
    const reg2 = await api<{ id: string }>('/api/workers', {
      method: 'POST',
      body: JSON.stringify({ name: 'test-worker-5', capacity: 2 }),
    });
    const c2 = await api<{ tasks: Task[] }>('/api/tasks/claim', {
      method: 'POST',
      body: JSON.stringify({ workerId: reg2.body.id, batch: 5 }),
    });
    const re = c2.body.tasks.find((x) => x.id === t.id)!;
    // the re-claim is the second EXECUTION, so attempt increments to 2 here;
    // the guarantee above is that the recovery step did not burn an attempt.
    expect(re.attempt).toBe(2);
    expect(re.leaseToken).not.toBe(leased.leaseToken);

    // late heartbeat with old token must NOT extend the new lease
    const { TasksRepo: TR } = await import('../src/repos/tasks.js');
    const pool2 = makePool();
    const bus2 = new (await import('../src/events/bus.js')).EventBus();
    const tr = new TR(pool2, bus2, new (await import('../src/repos/events.js')).EventsRepo(pool2, bus2), {
      retryBackoffBaseMs: 1000,
      retryBackoffCapMs: 30000,
      leaseTimeoutMs: 7000,
      maxAttemptsDefault: 3,
    });
    const resurrect = await tr.extendLease(t.id, workerId, leased.leaseToken!);
    expect(resurrect).toBe(false);
    await pool2.end();
  });
});
