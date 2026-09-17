import { config } from '../src/config.js';
import { startServer, waitUntilHealthy, type RunningServer } from '../src/server.js';

let running: RunningServer | null = null;
let booting: Promise<RunningServer> | null = null;

async function healthySomewhere(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${config.port}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function getTestServer(): Promise<RunningServer> {
  if (running) return running;
  if (await healthySomewhere()) {
    // A server from a previous test file (same fork process) is still up.
    running = { port: config.port, close: async () => {} };
    return running;
  }
  if (!booting) {
    booting = (async () => {
      const s = await startServer({ spawnInitialWorkers: false });
      await waitUntilHealthy(s.port);
      running = s;
      return s;
    })();
  }
  return booting;
}

export async function stopTestServer(): Promise<void> {
  if (running) {
    await running.close();
    running = null;
    booting = null;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`http://127.0.0.1:${config.port}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

/** Clean queue between test files so claim ordering is deterministic. */
export async function resetTasks(): Promise<void> {
  const { makePool } = await import('../src/db/pool.js');
  const pool = makePool();
  await pool.query('TRUNCATE task_events, tasks');
  await pool.end();
}
