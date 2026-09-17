import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// apps/server/src -> apps/server -> repo root
export const repoRoot = path.resolve(__dirname, '..', '..', '..');

export const config = {
  repoRoot,
  port: num(process.env.PORT, 8080) || 8080,
  host: process.env.HOST ?? '0.0.0.0',
  logLevel: process.env.LOG_LEVEL ?? 'info',

  databaseUrl: process.env.DATABASE_URL ?? '',
  useEmbedded: !process.env.DATABASE_URL,

  embeddedPgDataDir: process.env.EMBEDDED_PG_DIR ?? path.join(repoRoot, '.data', 'pg'),
  embeddedPgPort: num(process.env.EMBEDDED_PG_PORT, 54329),

  // Failure-detection tuning (see plan §B). Defaults land kill->recovery in ~7-8s.
  heartbeatIntervalMs: num(process.env.HEARTBEAT_INTERVAL_MS, 1500),
  heartbeatTimeoutMs: num(process.env.HEARTBEAT_TIMEOUT_MS, 5000),
  leaseTimeoutMs: num(process.env.LEASE_TIMEOUT_MS, 7000),
  reaperIntervalMs: num(process.env.REAPER_INTERVAL_MS, 1000),
  schedulerIntervalMs: num(process.env.SCHEDULER_INTERVAL_MS, 500),

  claimPollMs: num(process.env.CLAIM_POLL_MS, 400),
  retryBackoffBaseMs: num(process.env.RETRY_BACKOFF_BASE_MS, 1000),
  retryBackoffCapMs: num(process.env.RETRY_BACKOFF_CAP_MS, 30_000),
  maxAttemptsDefault: num(process.env.MAX_ATTEMPTS_DEFAULT, 3),
  workerPollMs: num(process.env.WORKER_POLL_MS, 400),

  metricsIntervalMs: num(process.env.METRICS_INTERVAL_MS, 2000),
  eventsRetention: num(process.env.EVENTS_RETENTION, 2000),

  chaosEnabled: bool(process.env.CHAOS_ENABLED, true),
  dashboardDistDir: process.env.DASHBOARD_DIST_DIR ?? '',
} as const;

export type Config = typeof config;

// helpers kept below the object so `as const` inference stays simple
function num(v: string | undefined, d: number): number {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}
function bool(v: string | undefined, d: boolean): boolean {
  return v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}
