import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

async function up(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);

  await sql`
    ALTER TABLE app.auth_tokens
      ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD CONSTRAINT auth_tokens_metadata_object CHECK (jsonb_typeof(metadata) = 'object');

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
      INSERT INTO app.tenant_keys
        (tenant_id, wrapped_data_key, kms_key_id, key_version)
      VALUES
        (target_tenant_id, target_wrapped_data_key, target_kms_key_id, target_key_version);
    END
    $function$;
    REVOKE ALL ON FUNCTION app.insert_tenant_key(uuid, bytea, text, integer) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION app.insert_tenant_key(uuid, bytea, text, integer) TO traverse_runtime;

    CREATE TABLE app.stripe_webhook_events (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      flow text NOT NULL,
      stripe_event_id text NOT NULL UNIQUE,
      event_type text NOT NULL,
      payload jsonb NOT NULL,
      processed_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT stripe_webhook_events_flow_valid CHECK (flow IN ('flow_b')),
      CONSTRAINT stripe_webhook_events_event_id_not_blank CHECK (btrim(stripe_event_id) <> ''),
      CONSTRAINT stripe_webhook_events_event_type_not_blank CHECK (btrim(event_type) <> ''),
      CONSTRAINT stripe_webhook_events_payload_object CHECK (jsonb_typeof(payload) = 'object')
    );
    CREATE INDEX stripe_webhook_events_flow_type_idx
      ON app.stripe_webhook_events (flow, event_type, processed_at DESC);

    REVOKE ALL ON app.stripe_webhook_events FROM PUBLIC;
    GRANT SELECT, INSERT ON app.stripe_webhook_events TO traverse_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE ON app.stripe_webhook_events FROM traverse_runtime;
  `.execute(database);
}

async function down(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);
  await sql`
    DROP TABLE app.stripe_webhook_events;
    DROP FUNCTION app.insert_tenant_key(uuid, bytea, text, integer);

    ALTER TABLE app.auth_tokens
      DROP CONSTRAINT auth_tokens_metadata_object,
      DROP COLUMN metadata;
  `.execute(database);
}

export const coachSignupFlowBMigration: Migration = { down, up };
