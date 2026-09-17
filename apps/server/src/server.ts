import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import path from 'node:path';
import fs from 'node:fs';
import { Pool } from 'pg';
import type { WebSocket } from 'ws';
import { config } from './config.js';
import { logger, sleep } from './util.js';
import { ensurePostgres, waitForPostgres, ensureRelayDatabase } from './embeddedPg.js';
import { makePool } from './db/pool.js';
import { migrate } from './db/migrations.js';
import { EventBus, type LiveSnapshot } from './events/bus.js';
import { WsHub } from './events/hub.js';
import { EventsRepo } from './repos/events.js';
import { TasksRepo } from './repos/tasks.js';
import { WorkersRepo } from './repos/workers.js';
import { MetricsRepo } from './repos/metrics.js';
import { Scheduler } from './scheduler/scheduler.js';
import { Reaper } from './scheduler/reaper.js';
import { startMetricsLoop } from './scheduler/loops.js';
import { ChaosSupervisor } from './chaos/chaosSupervisor.js';
import { taskRoutes } from './routes/tasksRoutes.js';
import { workerRoutes } from './routes/workerRoutes.js';
import { systemRoutes } from './routes/systemRoutes.js';
import { chaosRoutes } from './routes/chaosRoutes.js';

const log = logger.child({ mod: 'server' });

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

export async function startServer(opts: { spawnInitialWorkers?: boolean } = {}): Promise<RunningServer> {
  await ensurePostgres();
  await waitForPostgres();

  const pool = makePool();
  await ensureRelayDatabase();
  await migrate(pool);

  const bus = new EventBus();
  const events = new EventsRepo(pool, bus);
  await events.warm();

  const tasks = new TasksRepo(pool, bus, events, {
    retryBackoffBaseMs: config.retryBackoffBaseMs,
    retryBackoffCapMs: config.retryBackoffCapMs,
    leaseTimeoutMs: config.leaseTimeoutMs,
    maxAttemptsDefault: config.maxAttemptsDefault,
  });
  const workers = new WorkersRepo(pool, bus, events, config.heartbeatTimeoutMs);
  const metrics = new MetricsRepo(pool);
  const scheduler = new Scheduler(tasks, bus, config.schedulerIntervalMs);
  const reaper = new Reaper(tasks, workers, bus, config.reaperIntervalMs);
  const chaos = config.chaosEnabled
    ? new ChaosSupervisor(tasks, workers, pool)
    : null;
  (globalThis as Record<string, unknown>).__relayChaos = chaos;

  const app = Fastify({ logger: false });
  app.addContentTypeParser(
    ['application/json', 'text/json'],
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        done(null, body === '' || body == null ? {} : JSON.parse(String(body)));
      } catch (err) {
        (done as (e: Error) => void)(err as Error);
      }
    },
  );
  await app.register(fastifyWebsocket);
  try {
    const dist = config.dashboardDistDir || path.join(config.repoRoot, 'apps', 'dashboard', 'dist');
    if (fs.existsSync(dist)) {
      await app.register(fastifyStatic, { root: dist, prefix: '/' });
    }
  } catch {
    /* dashboard not built; API-only mode */
  }

  await app.register(taskRoutes, { tasks, events });
  await app.register(workerRoutes, { workers, tasks, chaos });
  await app.register(systemRoutes, { tasks, metrics });
  if (chaos) await app.register(chaosRoutes, { chaos, tasks });

  let recentTasksCache: Awaited<ReturnType<TasksRepo['list']>> = [];
  let workersCache: Awaited<ReturnType<WorkersRepo['list']>> = [];
  let queueCache: Awaited<ReturnType<MetricsRepo['queueSnapshot']>> | null = null;
  let metricsCache: Awaited<ReturnType<MetricsRepo['metrics']>> | null = null;

  const wsHub = new WsHub(bus, () => ({
    tasks: recentTasksCache,
    workers: workersCache,
    queue: queueCache ?? { byStatus: {}, oldestPendingSeconds: null, running: 0, runningByWorker: {} },
    metrics: metricsCache ?? {
      ts: '',
      byStatus: {},
      workers: { online: 0, offline: 0 },
      completedTotal: 0,
      failedTotal: 0,
      retriedTotal: 0,
      recoveredTotal: 0,
      dlqSize: 0,
      throughputPerMin: 0,
      successRatePct: null,
    },
    events: events.tail(200),
  }));

  const refresh = async () => {
    const [t, w, q, m] = await Promise.all([
      tasks.list({ limit: 200 }),
      workers.list(),
      metrics.queueSnapshot(),
      metrics.metrics(),
    ]);
    recentTasksCache = t;
    workersCache = w;
    queueCache = q;
    metricsCache = m;
  };
  const stopMetrics = startMetricsLoop(metrics, bus, config.metricsIntervalMs);
  app.get('/ws', { websocket: true }, (conn: WebSocket) => {
    wsHub.attach(conn);
  });

  // SPA fallback: deep links like /demo or /tasks serve the dashboard shell
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
      return reply.sendFile('index.html');
    }
    reply.code(404).send({ error: 'not found' });
  });

  await app.listen({ port: config.port, host: config.host });
  log.info(`relay API listening on http://127.0.0.1:${config.port}`);

  const refreshTimer = setInterval(() => {
    refresh().catch((err) => log.warn({ err }, 'snapshot refresh failed'));
  }, 1000);
  refreshTimer.unref();

  // Boot recovery: immediately run one reaper pass to pick up expired leases
  // from before a server crash/restart (plan §E).
  await reaper.tick();
  scheduler.start();
  reaper.start();
  await refresh();

  if (chaos && opts.spawnInitialWorkers) {
    for (let i = 0; i < 2; i++) await chaos.spawnWorker();
  }

  return {
    port: config.port,
    close: async () => {
      stopMetrics();
      clearInterval(refreshTimer);
      scheduler.stop();
      reaper.stop();
      await app.close();
      await pool.end();
    },
  };
}

export async function waitUntilHealthy(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`server did not become healthy within ${timeoutMs}ms`);
}
