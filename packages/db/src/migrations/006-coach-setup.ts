import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

async function up(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);

  await sql`
    ALTER TABLE app.tenants
      ADD COLUMN setup_progress jsonb NOT NULL DEFAULT '{"branding":"pending","payments":"pending","onboardingDefaults":"pending","policies":"pending","preview":"pending"}'::jsonb,
      ADD CONSTRAINT tenants_setup_progress_object
        CHECK (jsonb_typeof(setup_progress) = 'object');

    GRANT UPDATE (specialties, profile_photo_ref) ON app.coaches TO traverse_runtime;
  `.execute(database);
}

async function down(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);

  await sql`
    REVOKE UPDATE (specialties, profile_photo_ref) ON app.coaches FROM traverse_runtime;

    ALTER TABLE app.tenants
      DROP CONSTRAINT tenants_setup_progress_object,
      DROP COLUMN setup_progress;
  `.execute(database);
}

export const coachSetupMigration: Migration = { down, up };
