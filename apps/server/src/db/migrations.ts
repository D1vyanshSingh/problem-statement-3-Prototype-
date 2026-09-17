import { Pool } from 'pg';
import { logger } from '../util.js';

const log = logger.child({ mod: 'migrate' });
const MIGRATIONS: readonly string[] = [m001()];

export async function migrate(pool: Pool): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await c.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    for (const [i, sql] of MIGRATIONS.entries()) {
      const name = `m${String(i + 1).padStart(3, '_schema')}`;
      if (applied.has(name)) continue;
      try {
        await c.query('BEGIN');
        await c.query(sql);
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await c.query('COMMIT');
        log.info({ name }, 'applied migration');
      } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        throw err;
      }
    }
  } finally {
    c.release();
  }
}

function m001(): string {
  return `
CREATE TABLE IF NOT EXISTS tasks (
  id                uuid PRIMARY KEY,
  type              text NOT NULL,
  status            text NOT NULL,
  priority          int  NOT NULL DEFAULT 0,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  result            jsonb,
  assigned_worker_id uuid,
  lease_token       text,
  attempt           int  NOT NULL DEFAULT 0,
  max_attempts      int  NOT NULL DEFAULT 3,
  run_at            timestamptz NOT NULL DEFAULT now(),
  lease_expires_at  timestamptz,
  started_at        timestamptz,
  finished_at       timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_queue_idx ON tasks (run_at, priority)
  WHERE status IN ('pending','retrying');
CREATE INDEX IF NOT EXISTS tasks_worker_running_idx ON tasks (assigned_worker_id)
  WHERE status IN ('running','retrying');
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status);

CREATE TABLE IF NOT EXISTS workers (
  id                 uuid PRIMARY KEY,
  name               text NOT NULL,
  status             text NOT NULL DEFAULT 'online',
  capacity           int  NOT NULL DEFAULT 4,
  last_heartbeat_at  timestamptz NOT NULL DEFAULT now(),
  registered_at      timestamptz NOT NULL DEFAULT now(),
  offline_at         timestamptz,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS workers_name_idx ON workers (name);

CREATE TABLE IF NOT EXISTS task_events (
  id         bigserial PRIMARY KEY,
  task_id    uuid,
  worker_id  uuid,
  type       text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_events_task_idx ON task_events (task_id, id);
CREATE INDEX IF NOT EXISTS task_events_recent_idx ON task_events (id DESC);

CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL);
`;
}
