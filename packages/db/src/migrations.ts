import type { Kysely } from 'kysely';
import {
  Migrator,
  NO_MIGRATIONS,
  type MigrationProvider,
  type MigrationResult,
  type MigrationResultSet,
} from 'kysely/migration';
import { coreTenantModelMigration } from './migrations/001-core-tenant-model.js';

export const MIGRATION_NAME = '20260714_001_core_tenant_model';
export const CORE_TENANT_TABLES = ['tenant_keys', 'coaches', 'coaching_relationships'] as const;

const provider: MigrationProvider = {
  async getMigrations() {
    return { [MIGRATION_NAME]: coreTenantModelMigration };
  },
};

function migrator(database: Kysely<unknown>): Migrator {
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

export async function migrateToLatest(database: Kysely<unknown>): Promise<MigrationResult[]> {
  return assertResult('Database migration', await migrator(database).migrateToLatest());
}

export async function migrateToEmpty(database: Kysely<unknown>): Promise<MigrationResult[]> {
  return assertResult('Database rollback', await migrator(database).migrateTo(NO_MIGRATIONS));
}
