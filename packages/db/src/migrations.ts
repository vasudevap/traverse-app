import type { Kysely } from 'kysely';
import {
  Migrator,
  NO_MIGRATIONS,
  type MigrationProvider,
  type MigrationResult,
  type MigrationResultSet,
} from 'kysely/migration';
import { coreTenantModelMigration } from './migrations/001-core-tenant-model.js';
import { pgBossAccessMigration } from './migrations/002-pgboss-access.js';

export const MIGRATION_NAME = '20260714_001_core_tenant_model';
export const PGBOSS_ACCESS_MIGRATION_NAME = '20260715_002_pgboss_access';
export const CORE_TENANT_TABLES = ['tenant_keys', 'coaches', 'coaching_relationships'] as const;

const provider: MigrationProvider = {
  async getMigrations() {
    return {
      [MIGRATION_NAME]: coreTenantModelMigration,
      [PGBOSS_ACCESS_MIGRATION_NAME]: pgBossAccessMigration,
    };
  },
};

function migrator<DB>(database: Kysely<DB>): Migrator {
  return new Migrator({
    db: database,
    migrationTableSchema: 'app',
    provider,
  });
}

function assertResult(operation: string, result: MigrationResultSet): MigrationResult[] {
  if (result.error !== undefined) {
    throw new Error(`${operation} failed.`, { cause: result.error });
  }
  return result.results ?? [];
}

export async function migrateToLatest<DB>(database: Kysely<DB>): Promise<MigrationResult[]> {
  return assertResult('Database migration', await migrator(database).migrateToLatest());
}

export async function migrateToEmpty<DB>(database: Kysely<DB>): Promise<MigrationResult[]> {
  return assertResult('Database rollback', await migrator(database).migrateTo(NO_MIGRATIONS));
}
