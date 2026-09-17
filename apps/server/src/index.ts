import { config } from './config.js';
import { logger } from './util.js';
import { startServer, waitUntilHealthy } from './server.js';

const log = logger.child({ mod: 'main' });

async function main(): Promise<void> {
  const spawnInitialWorkers = !process.argv.includes('--no-workers');
  const running = await startServer({ spawnInitialWorkers });
  await waitUntilHealthy(running.port);
  log.info(`relay ready: http://127.0.0.1:${running.port}`);

  const shutdown = async (sig: string) => {
    log.info({ sig }, 'shutting down');
    try {
      await running.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  // Note: SIGKILL cannot be handled; the embedded postgres child is orphaned and
  // will be adopted by the next boot (see embeddedPg.ts adopt-or-boot).
}

main().catch((err) => {
  log.error({ err }, 'fatal startup error');
  process.exit(1);
});
