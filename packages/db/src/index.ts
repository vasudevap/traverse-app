/** Shared database, migration, RLS, and field-encryption foundations. */
export const DB_PACKAGE = '@traverse/db';

export { sql } from 'kysely';

export {
  DatabaseAuthSessionStore,
  type AuthenticatedSession,
  type AuthSessionStore,
  type AuthSubject,
  type RotateSessionInput,
} from './auth-sessions.js';
export { createDatabase, type DatabaseConfig, type TraverseDatabaseClient } from './database.js';
export { databaseConnectionString } from './database-secret.js';
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
  AUTH_SESSION_MIGRATION_NAME,
  COACH_SIGNUP_FLOW_B_MIGRATION_NAME,
  COACH_SETUP_MIGRATION_NAME,
  CLIENT_ONBOARDING_MIGRATION_NAME,
  COACHING_LOOP_MIGRATION_NAME,
  DATA_PORTABILITY_MIGRATION_NAME,
  MIGRATION_NAME,
  PGBOSS_ACCESS_MIGRATION_NAME,
  STAGE2_CORE_DOMAIN_MIGRATION_NAME,
  migrateToEmpty,
  migrateToLatest,
} from './migrations.js';
export {
  assertRlsContract,
  auditRlsContract,
  type RlsAuditOptions,
  type SqlClient,
} from './rls-audit.js';
export type { ActorRole, AuthTokenPurpose, Database, JsonValue, PracticeRole } from './schema.js';
export { withTenantContext, type TenantContext, type TenantTransaction } from './tenant-context.js';
