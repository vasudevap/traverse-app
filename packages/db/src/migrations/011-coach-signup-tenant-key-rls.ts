import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

async function up(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);
  await sql`
    CREATE POLICY tenant_keys_signup_insert ON app.tenant_keys
      FOR INSERT
      WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'coach'
      );

    CREATE OR REPLACE FUNCTION app.insert_tenant_key(
      target_tenant_id uuid,
      target_wrapped_data_key bytea,
      target_kms_key_id text,
      target_key_version integer
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      IF target_tenant_id IS DISTINCT FROM app.current_tenant_id()
        OR app.current_actor_role() <> 'coach' THEN
        RAISE EXCEPTION 'tenant key creation requires the active coach tenant context';
      END IF;

      INSERT INTO app.tenant_keys
        (tenant_id, wrapped_data_key, kms_key_id, key_version)
      VALUES
        (target_tenant_id, target_wrapped_data_key, target_kms_key_id, target_key_version);
    END
    $function$;
  `.execute(database);
}

async function down(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);
  await sql`DROP POLICY tenant_keys_signup_insert ON app.tenant_keys`.execute(database);
}

export const coachSignupTenantKeyRlsMigration: Migration = { down, up };
