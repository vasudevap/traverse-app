import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

async function up(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);

  await sql`
    CREATE POLICY intake_forms_client_select ON app.intake_forms
      FOR SELECT USING (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND EXISTS (
          SELECT 1
          FROM app.coaching_relationships AS relationship
          WHERE relationship.tenant_id = intake_forms.tenant_id
            AND relationship.intake_form_id = intake_forms.id
            AND relationship.client_id = app.current_client_id()
            AND relationship.archived_at IS NULL
        )
      )
  `.execute(database);
}

async function down(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);
  await sql`
    DROP POLICY intake_forms_client_select ON app.intake_forms
  `.execute(database);
}

export const clientIntakeFormReadMigration: Migration = { down, up };
