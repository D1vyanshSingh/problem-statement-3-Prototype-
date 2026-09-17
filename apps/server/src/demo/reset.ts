import { config } from '../config.js';
import { logger, sleep } from '../util.js';
import { startServer, waitUntilHealthy } from '../server.js';

const log = logger.child({ mod: 'reset' });

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${config.port}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function main(): Promise<void> {
  const running = await startServer({ spawnInitialWorkers: false });
  await waitUntilHealthy(running.port);
  await api('/api/admin/chaos/reset', { method: 'POST' });
  log.info('system reset');
  for (let i = 0; i < 2; i++) await api('/api/admin/chaos/spawn-worker', { method: 'POST' });
  await sleep(1500);
  log.info('two fresh workers spawned — ready for the demo');
  process.exit(0);
}

main().catch((err) => {
  log.error({ err }, 'reset failed');
  process.exit(1);
});
