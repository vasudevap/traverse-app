import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    SET LOCAL ROLE traverse_ddl;
    CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION traverse_ddl;
    ALTER SCHEMA pgboss OWNER TO traverse_ddl;
    REVOKE ALL ON SCHEMA pgboss FROM PUBLIC;
    GRANT USAGE ON SCHEMA pgboss TO traverse_runtime;
    ALTER DEFAULT PRIVILEGES FOR ROLE traverse_ddl IN SCHEMA pgboss
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO traverse_runtime;
    ALTER DEFAULT PRIVILEGES FOR ROLE traverse_ddl IN SCHEMA pgboss
      GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO traverse_runtime;
    ALTER DEFAULT PRIVILEGES FOR ROLE traverse_ddl IN SCHEMA pgboss
      GRANT EXECUTE ON FUNCTIONS TO traverse_runtime;
  `.execute(database);
}

async function down(): Promise<void> {
  // Queue tables are managed by pg-boss and may contain auditable operational history.
  // This migration deliberately does not drop its schema during a Kysely rollback.
}

export const pgBossAccessMigration: Migration = { down, up };
