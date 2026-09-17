import { Pool } from 'pg';
import { config } from '../config.js';

export function makePool(): Pool {
  const connectionString =
    config.databaseUrl ||
    `postgres://postgres:postgres@127.0.0.1:${config.embeddedPgPort}/postgres`;
  // Hosted Postgres (Render/Neon/Heroku) requires TLS; local embedded does not.
  const host = new URL(connectionString).hostname;
  const external = !['localhost', '127.0.0.1', '::1'].includes(host);
  return new Pool({
    connectionString,
    max: 12,
    idleTimeoutMillis: 30_000,
    application_name: 'vitals-server',
    ssl: external ? { rejectUnauthorized: false } : undefined,
  });
}
