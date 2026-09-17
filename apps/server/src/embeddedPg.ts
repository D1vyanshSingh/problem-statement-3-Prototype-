import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { Client } from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import { config } from './config.js';
import { logger } from './util.js';

const log = logger.child({ mod: 'pg' });

function tcpAlive(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (v: boolean) => {
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(1200);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * ADOPT-OR-BOOT (plan §E): if something already answers on the embedded port,
 * reuse it; otherwise initialize/start our own. Never wipes existing data.
 */
export async function ensurePostgres(): Promise<void> {
  if (config.databaseUrl) return;
  const port = config.embeddedPgPort;
  if (await tcpAlive(port)) {
    log.info({ port }, 'reusing existing postgres instance on port');
    return;
  }
  const dir = config.embeddedPgDataDir;
  fs.mkdirSync(dir, { recursive: true });
  const pidFile = path.join(dir, 'postmaster.pid');
  if (fs.existsSync(pidFile)) {
    // Safe: the port is provably dead, so this PID file is stale.
    log.warn('stale postmaster.pid found (port dead) - removing');
    fs.rmSync(pidFile);
  }
  const alreadyInitialized = fs.existsSync(path.join(dir, 'PG_VERSION'));
  log.info({ dir, port, alreadyInitialized }, 'booting embedded postgres');
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
  });
  if (!alreadyInitialized) {
    await pg.initialise();
  }
  await pg.start();
  // Keep the handle referenced so the child stays alive for the process lifetime.
  (globalThis as Record<string, unknown>).__vitalsPg = pg;
}

export async function waitForPostgres(): Promise<void> {
  const url =
    config.databaseUrl ||
    `postgres://postgres:postgres@127.0.0.1:${config.embeddedPgPort}/postgres`;
  const host = new URL(url).hostname;
  const external = !['localhost', '127.0.0.1', '::1'].includes(host);
  const deadline = Date.now() + 20_000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    const c = new Client({ connectionString: url, ssl: external ? { rejectUnauthorized: false } : undefined });
    try {
      await c.connect();
      await c.end();
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400));
    } finally {
      c.end().catch(() => {});
    }
  }
  throw new Error(`postgres not reachable after 20s: ${String(lastErr)}`);
}

const dbNeedsCreation = (e: unknown): boolean => {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes('3D000');
};

/** CREATE DATABASE is not idempotent — guard with an existence check (plan §E). */
export async function ensureVitalsDatabase(): Promise<void> {
  const url =
    config.databaseUrl ||
    `postgres://postgres:postgres@127.0.0.1:${config.embeddedPgPort}/postgres`;
  const host = new URL(url).hostname;
  const external = !['localhost', '127.0.0.1', '::1'].includes(host);
  const ssl = external ? { rejectUnauthorized: false } : undefined;
  try {
    const c = new Client({ connectionString: url, ssl });
    await c.connect();
    await c.end();
    return; // target db reachable — nothing to create
  } catch (e) {
    if (!dbNeedsCreation(e)) throw e;
  }
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString(), ssl });
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE vitals');
    log.info('created database vitals');
  } finally {
    await admin.end();
  }
}
