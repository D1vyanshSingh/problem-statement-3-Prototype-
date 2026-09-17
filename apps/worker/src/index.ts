import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { WorkerNode } from './worker.js';
import { logger } from './util.js';
const log = logger.child({ mod: 'main' });

/** Resolve packaged tsx from the pnpm store if --import tsx is unavailable. */
export function tsxImportArgs(): string[] {
  try {
    const require = createRequire(import.meta.url);
    const tsxDist = require.resolve('tsx/dist/cli.mjs', {
      paths: [fileURLToPath(new URL('../..', import.meta.url))],
    });
    return [
      '--import',
      `data:text/javascript,import { register } from "${tsxDist.replaceAll('\\', '/')}"; register();`,
    ];
  } catch {
    return ['--import', 'tsx'];
  }
}

async function main(): Promise<void> {
  const worker = new WorkerNode();
  await worker.start();
  log.info(`worker ${worker.name} running`);

  const shutdown = async (sig: string) => {
    log.info({ sig }, 'worker shutting down');
    await worker.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file:///${process.argv[1]}` ||
  process.argv[1]?.replaceAll('\\', '/').endsWith('apps/worker/src/index.ts');

if (invokedDirectly || process.env.RELAY_WORKER_CHILD === '1') {
  main().catch((err) => {
    log.error({ err }, 'fatal worker error');
    process.exit(1);
  });
}
