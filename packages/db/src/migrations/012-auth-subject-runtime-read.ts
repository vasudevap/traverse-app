import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

async function up(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);
  await sql`GRANT SELECT ON app.auth_subjects TO traverse_runtime`.execute(database);
}

async function down(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);
  await sql`REVOKE SELECT ON app.auth_subjects FROM traverse_runtime`.execute(database);
}

export const authSubjectRuntimeReadMigration: Migration = { down, up };
