import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { entities } from '../entities';
import { loadEnv } from './env';
import { InitialSchema1720000000000 } from '../migrations/1720000000000-initial-schema';
import { TokenVersion1720000001000 } from '../migrations/1720000001000-token-version';
import { AccountSecurity1720000002000 } from '../migrations/1720000002000-account-security';
import { EmbeddingProvider1720000003000 } from '../migrations/1720000003000-embedding-provider';
import { ChunkUniqueness1720000004000 } from '../migrations/1720000004000-chunk-uniqueness';

/**
 * Connection options for both the Nest app and the standalone
 * `dist/scripts/migrate.js`.
 *
 * The credentials come from `loadEnv()` rather than from `process.env` with
 * inline fallbacks. That matters most for the migrate path: the container runs
 * it *before* `main.js`, so it was the one entrypoint that touched production
 * secrets without ever calling `loadEnv()` — and therefore without the
 * production fail-fast. A deployment missing `POSTGRES_PASSWORD` silently fell
 * back to the shipped demo value here. Going through `loadEnv()` also moves
 * every misconfiguration to the earliest possible point: the migration step,
 * not the first request.
 */
export function buildDataSourceOptions(): DataSourceOptions {
  const { db } = loadEnv();
  return {
    type: 'postgres',
    host: db.host,
    port: db.port,
    username: db.user,
    password: db.password,
    database: db.database,
    entities,
    migrations: [
      InitialSchema1720000000000,
      TokenVersion1720000001000,
      AccountSecurity1720000002000,
      EmbeddingProvider1720000003000,
      ChunkUniqueness1720000004000,
    ],
    synchronize: false,
    logging: process.env.TYPEORM_LOGGING === 'true',
  };
}

export const AppDataSource = new DataSource(buildDataSourceOptions());
