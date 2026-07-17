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
import { authSessionRoundtripMigration } from './migrations/003-auth-session-roundtrip.js';
import { stage2CoreDomainMigration } from './migrations/004-stage2-core-domain.js';
import { coachSignupFlowBMigration } from './migrations/005-coach-signup-flow-b.js';
import { coachSetupMigration } from './migrations/006-coach-setup.js';
import { clientOnboardingMigration } from './migrations/007-client-onboarding.js';
import { coachingLoopMigration } from './migrations/008-coaching-loop.js';

export const MIGRATION_NAME = '20260714_001_core_tenant_model';
export const PGBOSS_ACCESS_MIGRATION_NAME = '20260715_002_pgboss_access';
export const AUTH_SESSION_MIGRATION_NAME = '20260715_003_auth_session_roundtrip';
export const STAGE2_CORE_DOMAIN_MIGRATION_NAME = '20260717_004_stage2_core_domain';
export const COACH_SIGNUP_FLOW_B_MIGRATION_NAME = '20260717_005_coach_signup_flow_b';
export const COACH_SETUP_MIGRATION_NAME = '20260717_006_coach_setup';
export const CLIENT_ONBOARDING_MIGRATION_NAME = '20260717_007_client_onboarding';
export const COACHING_LOOP_MIGRATION_NAME = '20260717_008_coaching_loop';
export const CORE_TENANT_TABLES = [
  'appointment_types',
  'appointments',
  'availability_windows',
  'booking_holds',
  'client_invites',
  'coach_billing_customers',
  'coach_subscriptions',
  'coaches',
  'coaching_relationships',
  'contract_instances',
  'contract_signatures',
  'contract_templates',
  'event_log',
  'exports',
  'group_memberships',
  'groups',
  'imports',
  'intake_forms',
  'intake_responses',
  'tasks',
  'tenant_keys',
] as const;

const provider: MigrationProvider = {
  async getMigrations() {
    return {
      [MIGRATION_NAME]: coreTenantModelMigration,
      [PGBOSS_ACCESS_MIGRATION_NAME]: pgBossAccessMigration,
      [AUTH_SESSION_MIGRATION_NAME]: authSessionRoundtripMigration,
      [STAGE2_CORE_DOMAIN_MIGRATION_NAME]: stage2CoreDomainMigration,
      [COACH_SIGNUP_FLOW_B_MIGRATION_NAME]: coachSignupFlowBMigration,
      [COACH_SETUP_MIGRATION_NAME]: coachSetupMigration,
      [CLIENT_ONBOARDING_MIGRATION_NAME]: clientOnboardingMigration,
      [COACHING_LOOP_MIGRATION_NAME]: coachingLoopMigration,
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
