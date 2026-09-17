import { config } from '../config.js';
import { logger, sleep } from '../util.js';
import { startServer, waitUntilHealthy } from '../server.js';

const log = logger.child({ mod: 'scenario' });

interface ApiTask {
  id: string;
  status: string;
  type: string;
  attempt: number;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${config.port}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function getTask(id: string): Promise<ApiTask> {
  const d = await api<{ task: ApiTask }>(`/api/tasks/${id}`);
  return d.task;
}

async function main(): Promise<void> {
  const running = await startServer({ spawnInitialWorkers: false });
  await waitUntilHealthy(running.port);
  log.info('server up');

  void running;

  // --- spawn 3 workers (capacity 2 each): one dies holding the crash task,
  // two remain to drain the queue — no cascade starvation.
  for (let i = 0; i < 3; i++) await api('/api/admin/chaos/spawn-worker', { method: 'POST' });
  await sleep(2000);

  // --- deterministic mix (seed=42), exactly ONE crash task so exactly one
  // worker dies — the story is a single node failure, not a fleet-wide cascade.
  const seed = await api<{ scheduled: number; mix: Record<string, number> }>(
    '/api/admin/chaos/seed-tasks',
    { method: 'POST', body: JSON.stringify({ count: 24, seed: 42, crashCount: 1 }) },
  );
  log.info({ mix: seed.mix }, 'seeded');

  // --- pick all crash tasks; the FIRST one to reach RUNNING(a=1) is the victim's
  const list = await api<ApiTask[]>('/api/tasks?type=&limit=200');
  const crashIds = list.filter((t) => t.type === 'demo.crash').map((t) => t.id);
  if (crashIds.length === 0) {
    log.error('no crash task in seed mix - aborting');
    process.exit(1);
  }

  const t0 = Date.now();
  let victimCrashId: string | null = null;
  let recoveredAt: number | null = null;
  let completedAt: number | null = null;

  log.info({ crashTasks: crashIds.length }, 'watching crash tasks: RUNNING(a1) -> PENDING(recovered) -> RUNNING(a2) -> COMPLETED');

  const deadline = t0 + 60_000;
  let sawReassignment = false;
  while (Date.now() < deadline && completedAt === null) {
    await sleep(100);
    const statuses = await Promise.all(crashIds.map((id) => getTask(id)));
    for (const t of statuses) {
      if (t.status === 'running' && t.attempt === 1 && victimCrashId === null) {
        victimCrashId = t.id;
        log.info({ crashTask: t.id }, 'phase WORKER FAILURE: crash task running on doomed worker');
      }
      if (t.id !== victimCrashId) continue;
      // Stateless phase detection: attempt>=2 can ONLY follow a lease-expiry
      // recovery for the crash task (the first execution dies mid-run), so we
      // never depend on catching the (possibly sub-100ms) PENDING window.
      if (recoveredAt === null && (t.status === 'pending' || t.attempt >= 2)) {
        recoveredAt = Date.now() - t0;
        log.info({ recoveryMs: recoveredAt }, 'phase DETECTION+RECOVERY: lease expired, task requeued');
      }
      if (!sawReassignment && t.status === 'running' && t.attempt >= 2) {
        sawReassignment = true;
        log.info('phase REASSIGNMENT: a healthy worker claimed the recovered task');
      }
      if (t.status === 'completed' && t.attempt >= 2) {
        completedAt = Date.now() - t0;
      }
    }
  }

  if (victimCrashId === null || recoveredAt === null || completedAt === null) {
    log.error(
      { victimCrashId, recoveredAt, completedAt },
      'scenario failed: recovery chain did not complete in 60s',
    );
    process.exit(1);
  }

  const final = await getTask(victimCrashId);
  log.info({ recoveryMs: recoveredAt, totalMs: completedAt, status: final.status }, 'final state');

  if (final.status !== 'completed') {
    log.error('scenario failed: crash task not completed');
    process.exit(1);
  }
  log.info(`PASS: kill→recovery→reassignment→completion in ${completedAt}ms (recovery after ${recoveredAt}ms)`);
  process.exit(0);
}

main().catch((err) => {
  log.error({ err }, 'scenario crashed');
  process.exit(1);
});
