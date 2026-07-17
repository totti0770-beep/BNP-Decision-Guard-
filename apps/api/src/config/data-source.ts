import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { entities } from '../entities';
import { InitialSchema1720000000000 } from '../migrations/1720000000000-initial-schema';
import { TokenVersion1720000001000 } from '../migrations/1720000001000-token-version';
import { AccountSecurity1720000002000 } from '../migrations/1720000002000-account-security';
import { EmbeddingProvider1720000003000 } from '../migrations/1720000003000-embedding-provider';

export function buildDataSourceOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    username: process.env.POSTGRES_USER ?? 'bnp',
    password: process.env.POSTGRES_PASSWORD ?? 'bnp_secret',
    database: process.env.POSTGRES_DB ?? 'bnp_decision_guard',
    entities,
    migrations: [
      InitialSchema1720000000000,
      TokenVersion1720000001000,
      AccountSecurity1720000002000,
      EmbeddingProvider1720000003000,
    ],
    synchronize: false,
    logging: process.env.TYPEORM_LOGGING === 'true',
  };
}

export const AppDataSource = new DataSource(buildDataSourceOptions());
