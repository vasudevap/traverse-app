/** Shared database, migration, RLS, and field-encryption foundations. */
export const DB_PACKAGE = '@traverse/db';

export { createDatabase, type DatabaseConfig, type TraverseDatabaseClient } from './database.js';
export {
  decryptField,
  decryptString,
  destroyPlaintextKey,
  encryptField,
  encryptString,
  type EncryptedFieldContext,
} from './encryption.js';
export {
  generateTenantDataKey,
  unwrapTenantDataKey,
  type GeneratedTenantDataKey,
  type KmsCommandClient,
  type UnwrappedTenantDataKey,
} from './kms-key-provider.js';
export {
  CORE_TENANT_TABLES,
  MIGRATION_NAME,
  PGBOSS_ACCESS_MIGRATION_NAME,
  migrateToEmpty,
  migrateToLatest,
} from './migrations.js';
export {
  assertRlsContract,
  auditRlsContract,
  type RlsAuditOptions,
  type SqlClient,
} from './rls-audit.js';
export type { ActorRole, AuthTokenPurpose, Database, PracticeRole } from './schema.js';
export { withTenantContext, type TenantContext, type TenantTransaction } from './tenant-context.js';
