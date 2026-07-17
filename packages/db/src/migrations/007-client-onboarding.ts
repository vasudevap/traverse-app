import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

async function up(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);

  await sql`
    ALTER TABLE app.client_invites
      ADD COLUMN sent_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN last_sent_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN opened_at timestamptz,
      ADD COLUMN declined_at timestamptz,
      ADD COLUMN send_count integer NOT NULL DEFAULT 1,
      ADD CONSTRAINT client_invites_send_count_positive CHECK (send_count > 0),
      ADD CONSTRAINT client_invites_terminal_state_valid CHECK (
        num_nonnulls(accepted_at, revoked_at, declined_at) <= 1
      );

    ALTER TABLE app.client_invites
      DROP CONSTRAINT client_invites_lifecycle_valid;

    DROP INDEX app.client_invites_active_email_idx;
    CREATE UNIQUE INDEX client_invites_active_email_idx
      ON app.client_invites (tenant_id, coach_id, email)
      WHERE accepted_at IS NULL AND revoked_at IS NULL AND declined_at IS NULL;

    CREATE OR REPLACE FUNCTION app.current_invite_token_hash()
    RETURNS bytea
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
    SET search_path = pg_catalog
    AS $function$
      SELECT decode(NULLIF(current_setting('app.invite_token_hash', true), ''), 'hex')
    $function$;

    CREATE POLICY client_invites_token_select ON app.client_invites
      FOR SELECT USING (
        token_hash = app.current_invite_token_hash()
        AND accepted_at IS NULL
        AND revoked_at IS NULL
        AND declined_at IS NULL
        AND expires_at > now()
      );

    CREATE POLICY coaching_relationships_client_scope_resolution
      ON app.coaching_relationships
      FOR SELECT USING (
        app.current_actor_role() = 'client'
        AND client_id = app.current_client_id()
        AND archived_at IS NULL
      );

    CREATE OR REPLACE FUNCTION app.guard_client_onboarding_transition()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = pg_catalog
    AS $function$
    DECLARE
      expected_state text := 'active';
      expected_status text := 'active';
      contract_required boolean := coalesce((OLD.gate_config->>'contractRequired')::boolean, true);
      countersignature_required boolean := coalesce((OLD.gate_config->>'countersignatureRequired')::boolean, false);
      intake_required boolean := coalesce((OLD.gate_config->>'intakeRequired')::boolean, true);
      client_signed boolean;
      coach_signed boolean;
      intake_submitted boolean;
    BEGIN
      IF app.current_actor_role() IS DISTINCT FROM 'client' THEN
        RETURN NEW;
      END IF;

      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
        OR NEW.coach_id IS DISTINCT FROM OLD.coach_id
        OR NEW.client_id IS DISTINCT FROM OLD.client_id
        OR NEW.gate_config IS DISTINCT FROM OLD.gate_config
        OR NEW.contract_template_id IS DISTINCT FROM OLD.contract_template_id
        OR NEW.intake_form_id IS DISTINCT FROM OLD.intake_form_id
        OR NEW.notes_enc IS DISTINCT FROM OLD.notes_enc
        OR NEW.notes_key_version IS DISTINCT FROM OLD.notes_key_version
        OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'clients may only advance their assigned onboarding state'
          USING ERRCODE = '42501';
      END IF;

      SELECT
        coalesce(bool_or(signature.signer_role = 'client'), false),
        coalesce(bool_or(signature.signer_role = 'coach'), false)
      INTO client_signed, coach_signed
      FROM app.contract_instances AS instance
      LEFT JOIN app.contract_signatures AS signature
        ON signature.tenant_id = instance.tenant_id
       AND signature.contract_instance_id = instance.id
      WHERE instance.tenant_id = OLD.tenant_id
        AND instance.relationship_id = OLD.id;

      SELECT EXISTS (
        SELECT 1
        FROM app.intake_responses AS response
        WHERE response.tenant_id = OLD.tenant_id
          AND response.relationship_id = OLD.id
          AND response.submitted_at IS NOT NULL
      ) INTO intake_submitted;

      IF contract_required AND NOT client_signed THEN
        expected_state := 'contract_pending';
        expected_status := 'onboarding';
      ELSIF countersignature_required AND NOT coach_signed THEN
        expected_state := 'countersignature_pending';
        expected_status := 'onboarding';
      ELSIF intake_required AND NOT intake_submitted THEN
        expected_state := 'intake_pending';
        expected_status := 'onboarding';
      END IF;

      IF NEW.onboarding_state <> expected_state OR NEW.status <> expected_status THEN
        RAISE EXCEPTION 'client onboarding transition does not match completed evidence'
          USING ERRCODE = '42501';
      END IF;

      RETURN NEW;
    END
    $function$;

    CREATE TRIGGER coaching_relationships_client_onboarding_guard
      BEFORE UPDATE ON app.coaching_relationships
      FOR EACH ROW EXECUTE FUNCTION app.guard_client_onboarding_transition();

    CREATE POLICY coaching_relationships_client_onboarding_update
      ON app.coaching_relationships
      FOR UPDATE
      USING (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND client_id = app.current_client_id()
        AND archived_at IS NULL
      )
      WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND client_id = app.current_client_id()
        AND archived_at IS NULL
      );

    CREATE OR REPLACE FUNCTION app.resolve_client_invite(target_token_hash bytea)
    RETURNS TABLE (
      invite_id uuid,
      tenant_id uuid,
      relationship_id uuid
    )
    LANGUAGE sql
    STABLE
    SECURITY INVOKER
    SET search_path = pg_catalog
    AS $function$
      SELECT
        invite.id,
        invite.tenant_id,
        invite.relationship_id
      FROM app.client_invites AS invite
      WHERE invite.token_hash = target_token_hash
        AND invite.accepted_at IS NULL
        AND invite.revoked_at IS NULL
        AND invite.declined_at IS NULL
        AND invite.expires_at > now()
      LIMIT 1
    $function$;

    CREATE OR REPLACE FUNCTION app.client_relationship_tenant(
      target_relationship_id uuid,
      target_client_id uuid
    )
    RETURNS uuid
    LANGUAGE sql
    STABLE
    SECURITY INVOKER
    SET search_path = pg_catalog
    AS $function$
      SELECT relationship.tenant_id
      FROM app.coaching_relationships AS relationship
      WHERE relationship.id = target_relationship_id
        AND relationship.client_id = target_client_id
        AND relationship.archived_at IS NULL
      LIMIT 1
    $function$;

    REVOKE ALL ON FUNCTION app.current_invite_token_hash() FROM PUBLIC;
    REVOKE ALL ON FUNCTION app.resolve_client_invite(bytea) FROM PUBLIC;
    REVOKE ALL ON FUNCTION app.client_relationship_tenant(uuid, uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION app.current_invite_token_hash() TO traverse_runtime;
    GRANT EXECUTE ON FUNCTION app.resolve_client_invite(bytea) TO traverse_runtime;
    GRANT EXECUTE ON FUNCTION app.client_relationship_tenant(uuid, uuid) TO traverse_runtime;
  `.execute(database);
}

async function down(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);

  await sql`
    REVOKE ALL ON FUNCTION app.client_relationship_tenant(uuid, uuid) FROM traverse_runtime;
    REVOKE ALL ON FUNCTION app.resolve_client_invite(bytea) FROM traverse_runtime;
    REVOKE ALL ON FUNCTION app.current_invite_token_hash() FROM traverse_runtime;
    DROP FUNCTION app.client_relationship_tenant(uuid, uuid);
    DROP FUNCTION app.resolve_client_invite(bytea);
    DROP POLICY coaching_relationships_client_onboarding_update ON app.coaching_relationships;
    DROP TRIGGER coaching_relationships_client_onboarding_guard ON app.coaching_relationships;
    DROP FUNCTION app.guard_client_onboarding_transition();
    DROP POLICY coaching_relationships_client_scope_resolution ON app.coaching_relationships;
    DROP POLICY client_invites_token_select ON app.client_invites;
    DROP FUNCTION app.current_invite_token_hash();

    DROP INDEX app.client_invites_active_email_idx;
    CREATE UNIQUE INDEX client_invites_active_email_idx
      ON app.client_invites (tenant_id, coach_id, email)
      WHERE accepted_at IS NULL AND revoked_at IS NULL;

    ALTER TABLE app.client_invites
      DROP CONSTRAINT client_invites_terminal_state_valid,
      DROP CONSTRAINT client_invites_send_count_positive,
      DROP COLUMN send_count,
      DROP COLUMN declined_at,
      DROP COLUMN opened_at,
      DROP COLUMN last_sent_at,
      DROP COLUMN sent_at,
      ADD CONSTRAINT client_invites_lifecycle_valid CHECK (
        NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL)
      );
  `.execute(database);
}

export const clientOnboardingMigration: Migration = { down, up };
