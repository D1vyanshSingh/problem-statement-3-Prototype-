import { Pool } from 'pg';
import { config } from '../config.js';

export function makePool(): Pool {
  const connectionString =
    config.databaseUrl ||
    `postgres://postgres:postgres@127.0.0.1:${config.embeddedPgPort}/postgres`;
  return new Pool({
    connectionString,
    max: 12,
    idleTimeoutMillis: 30_000,
    application_name: 'vitals-server',
  });
}
