import { Kysely, PostgresDialect } from 'kysely';
import { Pool, type PoolConfig } from 'pg';
import type { Database } from './schema.js';

export interface DatabaseConfig {
  connectionString: string;
  maxConnections?: number;
  ssl?: PoolConfig['ssl'];
}

export type TraverseDatabaseClient = Kysely<Database>;

export function createDatabase(config: DatabaseConfig): TraverseDatabaseClient {
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections ?? 10,
    ssl: config.ssl,
  });

  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}
