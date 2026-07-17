import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

async function up(database: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public`.execute(database);
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);

  await sql`
    ALTER TABLE app.tenants
      ADD COLUMN legal_name text,
      ADD COLUMN business_email public.citext,
      ADD COLUMN phone text,
      ADD COLUMN timezone text NOT NULL DEFAULT 'America/Toronto',
      ADD COLUMN coach_type text,
      ADD COLUMN business_address text,
      ADD COLUMN website_url text,
      ADD COLUMN setup_state text NOT NULL DEFAULT 'practice_profile',
      ADD COLUMN onboarding_defaults jsonb NOT NULL DEFAULT '{"contractRequired":true,"countersignatureRequired":false,"intakeRequired":true,"paymentRequired":false}'::jsonb,
      ADD COLUMN message_templates jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN policy_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD CONSTRAINT tenants_business_email_not_blank
        CHECK (business_email IS NULL OR btrim(business_email::text) <> ''),
      ADD CONSTRAINT tenants_timezone_not_blank CHECK (btrim(timezone) <> ''),
      ADD CONSTRAINT tenants_setup_state_valid CHECK (
        setup_state IN (
          'practice_profile', 'coach_profile', 'onboarding_defaults',
          'policies', 'first_client', 'complete'
        )
      );

    ALTER TABLE app.coaches
      ADD COLUMN specialties text[] NOT NULL DEFAULT '{}',
      ADD COLUMN profile_photo_ref text;

    CREATE OR REPLACE FUNCTION app.can_manage_coach(target_coach_id uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
    SET search_path = pg_catalog
    AS $function$
      SELECT
        app.current_actor_role() = 'admin'
        OR (
          app.current_actor_role() = 'coach'
          AND (
            app.current_practice_role() = 'owner'
            OR app.current_coach_id() = target_coach_id
          )
        )
    $function$;
    REVOKE ALL ON FUNCTION app.can_manage_coach(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION app.can_manage_coach(uuid) TO traverse_runtime;

    CREATE TABLE app.billing_plans (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      code text NOT NULL UNIQUE,
      name text NOT NULL,
      monthly_prices jsonb NOT NULL,
      annual_prices jsonb NOT NULL,
      client_cap integer,
      storage_gb integer NOT NULL,
      retention_max_days integer NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT billing_plans_code_valid CHECK (code IN ('starter', 'practice', 'established')),
      CONSTRAINT billing_plans_name_not_blank CHECK (btrim(name) <> ''),
      CONSTRAINT billing_plans_client_cap_positive CHECK (client_cap IS NULL OR client_cap > 0),
      CONSTRAINT billing_plans_storage_positive CHECK (storage_gb > 0),
      CONSTRAINT billing_plans_retention_positive CHECK (retention_max_days > 0)
    );

    INSERT INTO app.billing_plans
      (code, name, monthly_prices, annual_prices, client_cap, storage_gb, retention_max_days)
    VALUES
      ('starter', 'Starter', '{"USD":1900,"CAD":1900}', '{"USD":19000,"CAD":19000}', 40, 25, 30),
      ('practice', 'Practice', '{"USD":3900,"CAD":3900}', '{"USD":39000,"CAD":39000}', 75, 100, 180),
      ('established', 'Established', '{"USD":7900,"CAD":7900}', '{"USD":79000,"CAD":79000}', NULL, 500, 365);

    CREATE TABLE app.coach_billing_customers (
      tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE RESTRICT,
      stripe_customer_id text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT coach_billing_customers_customer_not_blank
        CHECK (btrim(stripe_customer_id) <> '')
    );
    CREATE INDEX coach_billing_customers_tenant_idx
      ON app.coach_billing_customers (tenant_id);

    CREATE TABLE app.coach_subscriptions (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      plan_id uuid NOT NULL REFERENCES app.billing_plans(id) ON DELETE RESTRICT,
      status text NOT NULL DEFAULT 'trialing',
      billing_interval text NOT NULL DEFAULT 'monthly',
      currency text NOT NULL DEFAULT 'USD',
      trial_started_at timestamptz NOT NULL DEFAULT now(),
      trial_ends_at timestamptz NOT NULL,
      promotion_code text,
      current_period_end timestamptz,
      cancel_at_period_end boolean NOT NULL DEFAULT false,
      stripe_subscription_id text UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT coach_subscriptions_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT coach_subscriptions_one_current UNIQUE (tenant_id),
      CONSTRAINT coach_subscriptions_status_valid CHECK (
        status IN ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'paused')
      ),
      CONSTRAINT coach_subscriptions_interval_valid
        CHECK (billing_interval IN ('monthly', 'annual')),
      CONSTRAINT coach_subscriptions_currency_valid CHECK (currency ~ '^[A-Z]{3}$'),
      CONSTRAINT coach_subscriptions_trial_valid CHECK (trial_ends_at > trial_started_at)
    );
    CREATE INDEX coach_subscriptions_tenant_idx ON app.coach_subscriptions (tenant_id, status);

    CREATE TABLE app.legal_documents (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      document_type text NOT NULL,
      version text NOT NULL,
      status text NOT NULL DEFAULT 'in_review',
      effective_at timestamptz,
      content_ref text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT legal_documents_type_version_unique UNIQUE (document_type, version),
      CONSTRAINT legal_documents_id_type_version_unique UNIQUE (id, document_type, version),
      CONSTRAINT legal_documents_type_not_blank CHECK (btrim(document_type) <> ''),
      CONSTRAINT legal_documents_version_not_blank CHECK (btrim(version) <> ''),
      CONSTRAINT legal_documents_status_valid
        CHECK (status IN ('draft', 'in_review', 'published', 'retired')),
      CONSTRAINT legal_documents_content_ref_not_blank CHECK (btrim(content_ref) <> '')
    );

    INSERT INTO app.legal_documents (document_type, version, status, content_ref)
    VALUES
      ('coach_terms', '0.1-in-review', 'in_review', 'legal://coach-terms/0.1-in-review'),
      ('acceptable_use_policy', '0.1-in-review', 'in_review', 'legal://acceptable-use/0.1-in-review');

    CREATE TABLE app.legal_acceptances (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
      legal_document_id uuid NOT NULL REFERENCES app.legal_documents(id) ON DELETE RESTRICT,
      document_type text NOT NULL,
      version text NOT NULL,
      accepted_at timestamptz NOT NULL DEFAULT now(),
      ip inet,
      user_agent text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT legal_acceptances_user_document_unique UNIQUE (user_id, legal_document_id),
      CONSTRAINT legal_acceptances_document_snapshot_fk
        FOREIGN KEY (legal_document_id, document_type, version)
        REFERENCES app.legal_documents (id, document_type, version) ON DELETE RESTRICT
    );
    CREATE INDEX legal_acceptances_user_idx ON app.legal_acceptances (user_id, accepted_at);

    CREATE TABLE app.contract_templates (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      coach_id uuid NOT NULL,
      name text NOT NULL,
      version integer NOT NULL DEFAULT 1,
      body text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT contract_templates_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT contract_templates_coach_fk FOREIGN KEY (tenant_id, coach_id)
        REFERENCES app.coaches (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT contract_templates_name_not_blank CHECK (btrim(name) <> ''),
      CONSTRAINT contract_templates_body_not_blank CHECK (btrim(body) <> ''),
      CONSTRAINT contract_templates_version_positive CHECK (version > 0)
    );
    CREATE INDEX contract_templates_tenant_coach_idx
      ON app.contract_templates (tenant_id, coach_id);

    CREATE TABLE app.intake_forms (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      coach_id uuid NOT NULL,
      name text NOT NULL,
      version integer NOT NULL DEFAULT 1,
      form_schema jsonb NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT intake_forms_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT intake_forms_coach_fk FOREIGN KEY (tenant_id, coach_id)
        REFERENCES app.coaches (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT intake_forms_name_not_blank CHECK (btrim(name) <> ''),
      CONSTRAINT intake_forms_version_positive CHECK (version > 0),
      CONSTRAINT intake_forms_schema_object CHECK (jsonb_typeof(form_schema) = 'object')
    );
    CREATE INDEX intake_forms_tenant_coach_idx ON app.intake_forms (tenant_id, coach_id);

    ALTER TABLE app.coaching_relationships
      ADD COLUMN gate_config jsonb NOT NULL DEFAULT '{"contractRequired":true,"countersignatureRequired":false,"intakeRequired":true,"paymentRequired":false}'::jsonb,
      ADD COLUMN contract_template_id uuid,
      ADD COLUMN intake_form_id uuid,
      ADD CONSTRAINT coaching_relationships_contract_template_fk
        FOREIGN KEY (tenant_id, contract_template_id)
        REFERENCES app.contract_templates (tenant_id, id) ON DELETE RESTRICT,
      ADD CONSTRAINT coaching_relationships_intake_form_fk
        FOREIGN KEY (tenant_id, intake_form_id)
        REFERENCES app.intake_forms (tenant_id, id) ON DELETE RESTRICT;

    CREATE TABLE app.client_invites (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      coach_id uuid NOT NULL,
      client_name text NOT NULL,
      email public.citext NOT NULL,
      phone text,
      token_hash bytea NOT NULL UNIQUE,
      gate_config jsonb NOT NULL,
      contract_template_id uuid,
      intake_form_id uuid,
      proposed_slots jsonb NOT NULL DEFAULT '[]'::jsonb,
      expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
      accepted_at timestamptz,
      revoked_at timestamptz,
      relationship_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT client_invites_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT client_invites_coach_fk FOREIGN KEY (tenant_id, coach_id)
        REFERENCES app.coaches (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT client_invites_contract_template_fk FOREIGN KEY (tenant_id, contract_template_id)
        REFERENCES app.contract_templates (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT client_invites_intake_form_fk FOREIGN KEY (tenant_id, intake_form_id)
        REFERENCES app.intake_forms (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT client_invites_relationship_fk FOREIGN KEY (tenant_id, relationship_id)
        REFERENCES app.coaching_relationships (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT client_invites_name_not_blank CHECK (btrim(client_name) <> ''),
      CONSTRAINT client_invites_email_not_blank CHECK (btrim(email::text) <> ''),
      CONSTRAINT client_invites_token_present CHECK (octet_length(token_hash) >= 32),
      CONSTRAINT client_invites_expiry_valid CHECK (expires_at > created_at),
      CONSTRAINT client_invites_proposed_slots_array
        CHECK (jsonb_typeof(proposed_slots) = 'array'),
      CONSTRAINT client_invites_lifecycle_valid CHECK (
        NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL)
      )
    );
    CREATE INDEX client_invites_tenant_coach_idx
      ON app.client_invites (tenant_id, coach_id, expires_at);
    CREATE UNIQUE INDEX client_invites_active_email_idx
      ON app.client_invites (tenant_id, coach_id, email)
      WHERE accepted_at IS NULL AND revoked_at IS NULL;

    CREATE TABLE app.contract_instances (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      relationship_id uuid NOT NULL,
      template_id uuid,
      template_version integer NOT NULL,
      signed_snapshot text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT contract_instances_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT contract_instances_relationship_unique UNIQUE (tenant_id, relationship_id),
      CONSTRAINT contract_instances_relationship_fk FOREIGN KEY (tenant_id, relationship_id)
        REFERENCES app.coaching_relationships (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT contract_instances_template_fk FOREIGN KEY (tenant_id, template_id)
        REFERENCES app.contract_templates (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT contract_instances_version_positive CHECK (template_version > 0),
      CONSTRAINT contract_instances_snapshot_not_blank CHECK (btrim(signed_snapshot) <> '')
    );
    CREATE INDEX contract_instances_tenant_relationship_idx
      ON app.contract_instances (tenant_id, relationship_id);

    CREATE TABLE app.contract_signatures (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      contract_instance_id uuid NOT NULL,
      signer_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
      signer_role text NOT NULL,
      signer_name text NOT NULL,
      consent_text text NOT NULL,
      signed_at timestamptz NOT NULL DEFAULT now(),
      ip inet,
      user_agent text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT contract_signatures_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT contract_signatures_one_role UNIQUE (contract_instance_id, signer_role),
      CONSTRAINT contract_signatures_instance_fk FOREIGN KEY (tenant_id, contract_instance_id)
        REFERENCES app.contract_instances (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT contract_signatures_role_valid CHECK (signer_role IN ('client', 'coach')),
      CONSTRAINT contract_signatures_name_not_blank CHECK (btrim(signer_name) <> ''),
      CONSTRAINT contract_signatures_consent_not_blank CHECK (btrim(consent_text) <> '')
    );
    CREATE INDEX contract_signatures_tenant_contract_idx
      ON app.contract_signatures (tenant_id, contract_instance_id);

    CREATE TABLE app.intake_responses (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      relationship_id uuid NOT NULL,
      intake_form_id uuid NOT NULL,
      form_version integer NOT NULL,
      answers_enc bytea NOT NULL,
      answers_key_version integer NOT NULL,
      submitted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT intake_responses_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT intake_responses_relationship_unique UNIQUE (tenant_id, relationship_id),
      CONSTRAINT intake_responses_relationship_fk FOREIGN KEY (tenant_id, relationship_id)
        REFERENCES app.coaching_relationships (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT intake_responses_form_fk FOREIGN KEY (tenant_id, intake_form_id)
        REFERENCES app.intake_forms (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT intake_responses_version_positive CHECK (form_version > 0),
      CONSTRAINT intake_responses_ciphertext_present CHECK (octet_length(answers_enc) > 33),
      CONSTRAINT intake_responses_key_version_positive CHECK (answers_key_version > 0)
    );
    CREATE INDEX intake_responses_tenant_relationship_idx
      ON app.intake_responses (tenant_id, relationship_id);

    CREATE TABLE app.groups (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      coach_id uuid NOT NULL,
      name text NOT NULL,
      description text,
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT groups_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT groups_coach_fk FOREIGN KEY (tenant_id, coach_id)
        REFERENCES app.coaches (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT groups_name_not_blank CHECK (btrim(name) <> '')
    );
    CREATE INDEX groups_tenant_coach_idx ON app.groups (tenant_id, coach_id);

    CREATE TABLE app.group_memberships (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      group_id uuid NOT NULL,
      client_id uuid NOT NULL REFERENCES app.clients(id) ON DELETE RESTRICT,
      joined_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT group_memberships_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT group_memberships_member_unique UNIQUE (group_id, client_id),
      CONSTRAINT group_memberships_group_fk FOREIGN KEY (tenant_id, group_id)
        REFERENCES app.groups (tenant_id, id) ON DELETE RESTRICT
    );
    CREATE INDEX group_memberships_tenant_group_idx
      ON app.group_memberships (tenant_id, group_id, client_id);

    CREATE TABLE app.appointment_types (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      coach_id uuid NOT NULL,
      name text NOT NULL,
      default_duration_minutes integer NOT NULL,
      price_amount integer,
      currency text,
      notes text,
      self_bookable boolean NOT NULL DEFAULT false,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT appointment_types_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT appointment_types_coach_fk FOREIGN KEY (tenant_id, coach_id)
        REFERENCES app.coaches (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT appointment_types_name_not_blank CHECK (btrim(name) <> ''),
      CONSTRAINT appointment_types_duration_positive CHECK (default_duration_minutes > 0),
      CONSTRAINT appointment_types_price_nonnegative CHECK (price_amount IS NULL OR price_amount >= 0),
      CONSTRAINT appointment_types_currency_pair CHECK (
        (price_amount IS NULL AND currency IS NULL)
        OR (price_amount IS NOT NULL AND currency ~ '^[A-Z]{3}$')
      )
    );
    CREATE INDEX appointment_types_tenant_coach_idx
      ON app.appointment_types (tenant_id, coach_id);

    CREATE TABLE app.availability_windows (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      coach_id uuid NOT NULL,
      window_type text NOT NULL,
      weekday smallint,
      local_starts_at time,
      local_ends_at time,
      slot_starts_at timestamptz,
      slot_ends_at timestamptz,
      timezone text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT availability_windows_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT availability_windows_coach_fk FOREIGN KEY (tenant_id, coach_id)
        REFERENCES app.coaches (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT availability_windows_type_valid CHECK (window_type IN ('weekly', 'slot')),
      CONSTRAINT availability_windows_timezone_not_blank CHECK (btrim(timezone) <> ''),
      CONSTRAINT availability_windows_shape_valid CHECK (
        (
          window_type = 'weekly' AND weekday BETWEEN 0 AND 6
          AND local_starts_at IS NOT NULL AND local_ends_at > local_starts_at
          AND slot_starts_at IS NULL AND slot_ends_at IS NULL
        )
        OR (
          window_type = 'slot' AND weekday IS NULL
          AND local_starts_at IS NULL AND local_ends_at IS NULL
          AND slot_starts_at IS NOT NULL AND slot_ends_at > slot_starts_at
        )
      )
    );
    CREATE INDEX availability_windows_tenant_coach_idx
      ON app.availability_windows (tenant_id, coach_id, active);

    CREATE TABLE app.booking_holds (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      availability_window_id uuid NOT NULL,
      client_id uuid NOT NULL REFERENCES app.clients(id) ON DELETE RESTRICT,
      starts_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'active',
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT booking_holds_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT booking_holds_window_fk FOREIGN KEY (tenant_id, availability_window_id)
        REFERENCES app.availability_windows (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT booking_holds_status_valid CHECK (status IN ('active', 'converted', 'expired', 'released')),
      CONSTRAINT booking_holds_time_valid CHECK (ends_at > starts_at),
      CONSTRAINT booking_holds_expiry_valid CHECK (expires_at > created_at)
    );
    CREATE INDEX booking_holds_tenant_client_idx
      ON app.booking_holds (tenant_id, client_id, starts_at);
    CREATE UNIQUE INDEX booking_holds_one_active_slot_idx
      ON app.booking_holds (tenant_id, availability_window_id, starts_at) WHERE status = 'active';

    CREATE TABLE app.appointments (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      coach_id uuid NOT NULL,
      relationship_id uuid,
      group_id uuid,
      appointment_type_id uuid,
      title text NOT NULL,
      starts_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL,
      meeting_link text,
      status text NOT NULL DEFAULT 'scheduled',
      booked_by_client_id uuid REFERENCES app.clients(id) ON DELETE RESTRICT,
      canceled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT appointments_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT appointments_coach_fk FOREIGN KEY (tenant_id, coach_id)
        REFERENCES app.coaches (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT appointments_relationship_fk FOREIGN KEY (tenant_id, relationship_id)
        REFERENCES app.coaching_relationships (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT appointments_group_fk FOREIGN KEY (tenant_id, group_id)
        REFERENCES app.groups (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT appointments_type_fk FOREIGN KEY (tenant_id, appointment_type_id)
        REFERENCES app.appointment_types (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT appointments_subject_valid CHECK ((relationship_id IS NULL) <> (group_id IS NULL)),
      CONSTRAINT appointments_title_not_blank CHECK (btrim(title) <> ''),
      CONSTRAINT appointments_time_valid CHECK (ends_at > starts_at),
      CONSTRAINT appointments_status_valid CHECK (status IN ('scheduled', 'booked', 'completed', 'canceled')),
      CONSTRAINT appointments_canceled_pair CHECK (
        (status = 'canceled' AND canceled_at IS NOT NULL)
        OR (status <> 'canceled' AND canceled_at IS NULL)
      )
    );
    CREATE INDEX appointments_tenant_coach_start_idx
      ON app.appointments (tenant_id, coach_id, starts_at);
    ALTER TABLE app.appointments ADD CONSTRAINT appointments_no_coach_overlap
      EXCLUDE USING gist (
        tenant_id WITH =,
        coach_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
      ) WHERE (status IN ('scheduled', 'booked'));

    CREATE TABLE app.tasks (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      relationship_id uuid NOT NULL,
      title text NOT NULL,
      description text,
      status text NOT NULL DEFAULT 'assigned',
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT tasks_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT tasks_relationship_fk FOREIGN KEY (tenant_id, relationship_id)
        REFERENCES app.coaching_relationships (tenant_id, id) ON DELETE RESTRICT,
      CONSTRAINT tasks_title_not_blank CHECK (btrim(title) <> ''),
      CONSTRAINT tasks_status_valid CHECK (status IN ('assigned', 'completed', 'canceled')),
      CONSTRAINT tasks_completed_pair CHECK (
        (status = 'completed' AND completed_at IS NOT NULL)
        OR (status <> 'completed' AND completed_at IS NULL)
      )
    );
    CREATE INDEX tasks_tenant_relationship_idx
      ON app.tasks (tenant_id, relationship_id, status);

    CREATE TABLE app.event_log (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      actor_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
      actor_type text NOT NULL,
      action text NOT NULL,
      entity_type text NOT NULL,
      entity_id uuid,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT event_log_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT event_log_actor_type_valid CHECK (actor_type IN ('admin', 'coach', 'client')),
      CONSTRAINT event_log_action_not_blank CHECK (btrim(action) <> ''),
      CONSTRAINT event_log_entity_type_not_blank CHECK (btrim(entity_type) <> ''),
      CONSTRAINT event_log_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
    );
    CREATE INDEX event_log_tenant_time_idx ON app.event_log (tenant_id, occurred_at DESC);

    CREATE TABLE app.exports (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      requested_by uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
      scope text NOT NULL DEFAULT 'everything',
      status text NOT NULL DEFAULT 'pending',
      artifact_ref text,
      error_code text,
      expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT exports_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT exports_scope_valid CHECK (scope IN ('everything')),
      CONSTRAINT exports_status_valid CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'expired')),
      CONSTRAINT exports_artifact_state CHECK (
        (status = 'ready' AND artifact_ref IS NOT NULL AND expires_at IS NOT NULL)
        OR status <> 'ready'
      )
    );
    CREATE INDEX exports_tenant_requester_idx ON app.exports (tenant_id, requested_by, created_at DESC);

    CREATE TABLE app.imports (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      requested_by uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
      source_type text NOT NULL DEFAULT 'csv_clients',
      source_ref text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      total_rows integer,
      imported_rows integer,
      rejected_rows integer,
      error_report_ref text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT imports_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT imports_source_type_valid CHECK (source_type IN ('csv_clients', 'practice_do', 'profi')),
      CONSTRAINT imports_source_ref_not_blank CHECK (btrim(source_ref) <> ''),
      CONSTRAINT imports_status_valid CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
      CONSTRAINT imports_counts_nonnegative CHECK (
        (total_rows IS NULL OR total_rows >= 0)
        AND (imported_rows IS NULL OR imported_rows >= 0)
        AND (rejected_rows IS NULL OR rejected_rows >= 0)
      )
    );
    CREATE INDEX imports_tenant_requester_idx ON app.imports (tenant_id, requested_by, created_at DESC);

    CREATE OR REPLACE FUNCTION app.enforce_stage2_immutable_rows()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      RAISE EXCEPTION 'append-only table % does not allow %', TG_TABLE_NAME, TG_OP
        USING ERRCODE = '42501';
    END
    $function$;

    CREATE OR REPLACE FUNCTION app.enforce_intake_response_update()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      IF OLD.submitted_at IS NOT NULL THEN
        RAISE EXCEPTION 'submitted intake responses are immutable' USING ERRCODE = '42501';
      END IF;
      IF NEW.tenant_id <> OLD.tenant_id
        OR NEW.relationship_id <> OLD.relationship_id
        OR NEW.intake_form_id <> OLD.intake_form_id
        OR NEW.form_version <> OLD.form_version
      THEN
        RAISE EXCEPTION 'intake response identity is immutable' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $function$;

    CREATE OR REPLACE FUNCTION app.enforce_client_task_update()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      IF app.current_actor_role() = 'client' AND (
        NEW.tenant_id <> OLD.tenant_id
        OR NEW.relationship_id <> OLD.relationship_id
        OR NEW.title <> OLD.title
        OR NEW.description IS DISTINCT FROM OLD.description
        OR NEW.status NOT IN ('assigned', 'completed')
      ) THEN
        RAISE EXCEPTION 'clients may only complete assigned tasks' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $function$;

    CREATE TRIGGER intake_responses_guard_update
      BEFORE UPDATE ON app.intake_responses
      FOR EACH ROW EXECUTE FUNCTION app.enforce_intake_response_update();
    CREATE TRIGGER tasks_guard_client_update
      BEFORE UPDATE ON app.tasks
      FOR EACH ROW EXECUTE FUNCTION app.enforce_client_task_update();

    CREATE TRIGGER legal_acceptances_append_only
      BEFORE UPDATE OR DELETE ON app.legal_acceptances
      FOR EACH ROW EXECUTE FUNCTION app.enforce_stage2_immutable_rows();
    CREATE TRIGGER contract_instances_append_only
      BEFORE UPDATE OR DELETE ON app.contract_instances
      FOR EACH ROW EXECUTE FUNCTION app.enforce_stage2_immutable_rows();
    CREATE TRIGGER contract_signatures_append_only
      BEFORE UPDATE OR DELETE ON app.contract_signatures
      FOR EACH ROW EXECUTE FUNCTION app.enforce_stage2_immutable_rows();
    CREATE TRIGGER event_log_append_only
      BEFORE UPDATE OR DELETE ON app.event_log
      FOR EACH ROW EXECUTE FUNCTION app.enforce_stage2_immutable_rows();
  `.execute(database);

  const coachOwnedTables = [
    'contract_templates',
    'intake_forms',
    'client_invites',
    'groups',
    'appointment_types',
    'availability_windows',
  ];
  for (const table of coachOwnedTables) {
    await sql
      .raw(
        `
      ALTER TABLE app.${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE app.${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY ${table}_coach_all ON app.${table}
        FOR ALL
        USING (tenant_id = app.current_tenant_id() AND app.can_manage_coach(coach_id))
        WITH CHECK (tenant_id = app.current_tenant_id() AND app.can_manage_coach(coach_id));
    `,
      )
      .execute(database);
  }

  const relationshipTables = ['contract_instances', 'intake_responses', 'tasks'];
  for (const table of relationshipTables) {
    await sql
      .raw(
        `
      ALTER TABLE app.${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE app.${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY ${table}_coach_select ON app.${table}
        FOR SELECT USING (
          tenant_id = app.current_tenant_id()
          AND EXISTS (
            SELECT 1 FROM app.coaching_relationships AS relationship
            WHERE relationship.tenant_id = ${table}.tenant_id
              AND relationship.id = ${table}.relationship_id
              AND app.can_manage_coach(relationship.coach_id)
          )
        );
      CREATE POLICY ${table}_client_select ON app.${table}
        FOR SELECT USING (
          tenant_id = app.current_tenant_id()
          AND app.current_actor_role() = 'client'
          AND EXISTS (
            SELECT 1 FROM app.coaching_relationships AS relationship
            WHERE relationship.tenant_id = ${table}.tenant_id
              AND relationship.id = ${table}.relationship_id
              AND relationship.client_id = app.current_client_id()
          )
        );
    `,
      )
      .execute(database);
  }

  await sql`
    CREATE POLICY contract_instances_coach_insert ON app.contract_instances
      FOR INSERT WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND EXISTS (
          SELECT 1 FROM app.coaching_relationships AS relationship
          WHERE relationship.tenant_id = contract_instances.tenant_id
            AND relationship.id = contract_instances.relationship_id
            AND app.can_manage_coach(relationship.coach_id)
        )
      );
    ALTER TABLE app.contract_signatures ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.contract_signatures FORCE ROW LEVEL SECURITY;
    CREATE POLICY contract_signatures_actor_select ON app.contract_signatures
      FOR SELECT USING (
        tenant_id = app.current_tenant_id()
        AND EXISTS (
          SELECT 1
          FROM app.contract_instances AS instance
          JOIN app.coaching_relationships AS relationship
            ON relationship.tenant_id = instance.tenant_id
           AND relationship.id = instance.relationship_id
          WHERE instance.tenant_id = contract_signatures.tenant_id
            AND instance.id = contract_signatures.contract_instance_id
            AND (
              app.can_manage_coach(relationship.coach_id)
              OR (
                app.current_actor_role() = 'client'
                AND relationship.client_id = app.current_client_id()
              )
            )
        )
      );
    CREATE POLICY contract_signatures_actor_insert ON app.contract_signatures
      FOR INSERT WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND signer_user_id = app.current_actor_id()
        AND signer_role = app.current_actor_role()
        AND EXISTS (
          SELECT 1
          FROM app.contract_instances AS instance
          JOIN app.coaching_relationships AS relationship
            ON relationship.tenant_id = instance.tenant_id
           AND relationship.id = instance.relationship_id
          WHERE instance.tenant_id = contract_signatures.tenant_id
            AND instance.id = contract_signatures.contract_instance_id
            AND (
              (signer_role = 'client' AND relationship.client_id = app.current_client_id())
              OR (signer_role = 'coach' AND app.can_manage_coach(relationship.coach_id))
            )
        )
      );
    CREATE POLICY intake_responses_client_insert ON app.intake_responses
      FOR INSERT WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND EXISTS (
          SELECT 1 FROM app.coaching_relationships AS relationship
          WHERE relationship.tenant_id = intake_responses.tenant_id
            AND relationship.id = intake_responses.relationship_id
            AND relationship.client_id = app.current_client_id()
            AND relationship.intake_form_id = intake_responses.intake_form_id
        )
      );
    CREATE POLICY intake_responses_client_update ON app.intake_responses
      FOR UPDATE
      USING (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND EXISTS (
          SELECT 1 FROM app.coaching_relationships AS relationship
          WHERE relationship.tenant_id = intake_responses.tenant_id
            AND relationship.id = intake_responses.relationship_id
            AND relationship.client_id = app.current_client_id()
        )
      )
      WITH CHECK (tenant_id = app.current_tenant_id());
    CREATE POLICY tasks_coach_insert ON app.tasks
      FOR INSERT WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND EXISTS (
          SELECT 1 FROM app.coaching_relationships AS relationship
          WHERE relationship.tenant_id = tasks.tenant_id
            AND relationship.id = tasks.relationship_id
            AND app.can_manage_coach(relationship.coach_id)
        )
      );
    CREATE POLICY tasks_coach_update ON app.tasks
      FOR UPDATE
      USING (
        tenant_id = app.current_tenant_id()
        AND EXISTS (
          SELECT 1 FROM app.coaching_relationships AS relationship
          WHERE relationship.tenant_id = tasks.tenant_id
            AND relationship.id = tasks.relationship_id
            AND app.can_manage_coach(relationship.coach_id)
        )
      )
      WITH CHECK (tenant_id = app.current_tenant_id());
    CREATE POLICY tasks_client_update ON app.tasks
      FOR UPDATE
      USING (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND EXISTS (
          SELECT 1 FROM app.coaching_relationships AS relationship
          WHERE relationship.tenant_id = tasks.tenant_id
            AND relationship.id = tasks.relationship_id
            AND relationship.client_id = app.current_client_id()
        )
      )
      WITH CHECK (tenant_id = app.current_tenant_id());

    ALTER TABLE app.coach_billing_customers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.coach_billing_customers FORCE ROW LEVEL SECURITY;
    CREATE POLICY coach_billing_customers_owner_all ON app.coach_billing_customers
      FOR ALL
      USING (
        tenant_id = app.current_tenant_id()
        AND (
          app.current_actor_role() = 'admin'
          OR (app.current_actor_role() = 'coach' AND app.current_practice_role() = 'owner')
        )
      )
      WITH CHECK (tenant_id = app.current_tenant_id());

    ALTER TABLE app.coach_subscriptions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.coach_subscriptions FORCE ROW LEVEL SECURITY;
    CREATE POLICY coach_subscriptions_coach_select ON app.coach_subscriptions
      FOR SELECT USING (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() IN ('admin', 'coach')
      );
    CREATE POLICY coach_subscriptions_owner_insert ON app.coach_subscriptions
      FOR INSERT WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (
          app.current_actor_role() = 'admin'
          OR (app.current_actor_role() = 'coach' AND app.current_practice_role() = 'owner')
        )
      );
    CREATE POLICY coach_subscriptions_owner_update ON app.coach_subscriptions
      FOR UPDATE
      USING (
        tenant_id = app.current_tenant_id()
        AND (
          app.current_actor_role() = 'admin'
          OR (app.current_actor_role() = 'coach' AND app.current_practice_role() = 'owner')
        )
      )
      WITH CHECK (tenant_id = app.current_tenant_id());

    ALTER TABLE app.legal_acceptances ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.legal_acceptances FORCE ROW LEVEL SECURITY;
    CREATE POLICY legal_acceptances_actor_select ON app.legal_acceptances
      FOR SELECT USING (user_id = app.current_actor_id() OR app.current_actor_role() = 'admin');
    CREATE POLICY legal_acceptances_actor_insert ON app.legal_acceptances
      FOR INSERT WITH CHECK (user_id = app.current_actor_id());

    ALTER TABLE app.group_memberships ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.group_memberships FORCE ROW LEVEL SECURITY;
    CREATE POLICY group_memberships_coach_all ON app.group_memberships
      FOR ALL
      USING (
        tenant_id = app.current_tenant_id()
        AND EXISTS (
          SELECT 1 FROM app.groups AS cohort
          WHERE cohort.tenant_id = group_memberships.tenant_id
            AND cohort.id = group_memberships.group_id
            AND app.can_manage_coach(cohort.coach_id)
        )
      )
      WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND EXISTS (
          SELECT 1 FROM app.groups AS cohort
          WHERE cohort.tenant_id = group_memberships.tenant_id
            AND cohort.id = group_memberships.group_id
            AND app.can_manage_coach(cohort.coach_id)
        )
      );
    CREATE POLICY group_memberships_client_select ON app.group_memberships
      FOR SELECT USING (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND client_id = app.current_client_id()
      );
    CREATE POLICY groups_client_select ON app.groups
      FOR SELECT USING (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND EXISTS (
          SELECT 1 FROM app.group_memberships AS membership
          WHERE membership.tenant_id = groups.tenant_id
            AND membership.group_id = groups.id
            AND membership.client_id = app.current_client_id()
        )
      );

    ALTER TABLE app.booking_holds ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.booking_holds FORCE ROW LEVEL SECURITY;
    CREATE POLICY booking_holds_client_all ON app.booking_holds
      FOR ALL
      USING (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND client_id = app.current_client_id()
      )
      WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND client_id = app.current_client_id()
      );
    CREATE POLICY booking_holds_coach_all ON app.booking_holds
      FOR ALL
      USING (
        tenant_id = app.current_tenant_id()
        AND EXISTS (
          SELECT 1 FROM app.availability_windows AS availability
          WHERE availability.tenant_id = booking_holds.tenant_id
            AND availability.id = booking_holds.availability_window_id
            AND app.can_manage_coach(availability.coach_id)
        )
      )
      WITH CHECK (tenant_id = app.current_tenant_id());

    ALTER TABLE app.appointments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.appointments FORCE ROW LEVEL SECURITY;
    CREATE POLICY appointments_coach_all ON app.appointments
      FOR ALL
      USING (tenant_id = app.current_tenant_id() AND app.can_manage_coach(coach_id))
      WITH CHECK (tenant_id = app.current_tenant_id() AND app.can_manage_coach(coach_id));
    CREATE POLICY appointments_client_select ON app.appointments
      FOR SELECT USING (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND (
          EXISTS (
            SELECT 1 FROM app.coaching_relationships AS relationship
            WHERE relationship.tenant_id = appointments.tenant_id
              AND relationship.id = appointments.relationship_id
              AND relationship.client_id = app.current_client_id()
          )
          OR EXISTS (
            SELECT 1 FROM app.group_memberships AS membership
            WHERE membership.tenant_id = appointments.tenant_id
              AND membership.group_id = appointments.group_id
              AND membership.client_id = app.current_client_id()
          )
        )
      );
    CREATE POLICY appointments_client_insert ON app.appointments
      FOR INSERT WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND group_id IS NULL
        AND booked_by_client_id = app.current_client_id()
        AND status = 'booked'
        AND EXISTS (
          SELECT 1 FROM app.coaching_relationships AS relationship
          WHERE relationship.tenant_id = appointments.tenant_id
            AND relationship.id = appointments.relationship_id
            AND relationship.client_id = app.current_client_id()
            AND relationship.coach_id = appointments.coach_id
        )
      );

    ALTER TABLE app.event_log ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.event_log FORCE ROW LEVEL SECURITY;
    CREATE POLICY event_log_coach_select ON app.event_log
      FOR SELECT USING (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() IN ('admin', 'coach')
      );
    CREATE POLICY event_log_actor_insert ON app.event_log
      FOR INSERT WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND actor_id = app.current_actor_id()
        AND actor_type = app.current_actor_role()
      );

    ALTER TABLE app.exports ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.exports FORCE ROW LEVEL SECURITY;
    CREATE POLICY exports_actor_all ON app.exports
      FOR ALL
      USING (
        tenant_id = app.current_tenant_id()
        AND (
          app.current_actor_role() = 'admin'
          OR requested_by = app.current_actor_id()
          OR (app.current_actor_role() = 'coach' AND app.current_practice_role() = 'owner')
        )
      )
      WITH CHECK (tenant_id = app.current_tenant_id());

    ALTER TABLE app.imports ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.imports FORCE ROW LEVEL SECURITY;
    CREATE POLICY imports_actor_all ON app.imports
      FOR ALL
      USING (
        tenant_id = app.current_tenant_id()
        AND (
          app.current_actor_role() = 'admin'
          OR requested_by = app.current_actor_id()
          OR (app.current_actor_role() = 'coach' AND app.current_practice_role() = 'owner')
        )
      )
      WITH CHECK (tenant_id = app.current_tenant_id());

    REVOKE ALL ON app.billing_plans, app.legal_documents FROM traverse_runtime;
    GRANT SELECT ON app.billing_plans, app.legal_documents TO traverse_runtime;

    GRANT SELECT, INSERT ON app.legal_acceptances, app.contract_instances,
      app.contract_signatures, app.event_log TO traverse_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE ON app.legal_acceptances, app.contract_instances,
      app.contract_signatures, app.event_log FROM traverse_runtime;

    GRANT SELECT, INSERT, UPDATE ON app.coach_billing_customers, app.coach_subscriptions,
      app.contract_templates, app.intake_forms, app.client_invites, app.intake_responses,
      app.groups, app.appointment_types, app.appointments, app.tasks, app.exports, app.imports
      TO traverse_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON app.group_memberships,
      app.availability_windows, app.booking_holds TO traverse_runtime;
    REVOKE DELETE, TRUNCATE ON app.coach_billing_customers, app.coach_subscriptions,
      app.contract_templates, app.intake_forms, app.client_invites, app.intake_responses,
      app.groups, app.appointment_types, app.appointments, app.tasks, app.exports, app.imports
      FROM traverse_runtime;
  `.execute(database);
}

async function down(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);
  await sql`
    DROP POLICY IF EXISTS groups_client_select ON app.groups;

    DROP TABLE app.imports;
    DROP TABLE app.exports;
    DROP TABLE app.event_log;
    DROP TABLE app.tasks;
    DROP TABLE app.appointments;
    DROP TABLE app.booking_holds;
    DROP TABLE app.availability_windows;
    DROP TABLE app.appointment_types;
    DROP TABLE app.group_memberships;
    DROP TABLE app.groups;
    DROP TABLE app.intake_responses;
    DROP TABLE app.contract_signatures;
    DROP TABLE app.contract_instances;
    DROP TABLE app.client_invites;

    ALTER TABLE app.coaching_relationships
      DROP CONSTRAINT coaching_relationships_intake_form_fk,
      DROP CONSTRAINT coaching_relationships_contract_template_fk,
      DROP COLUMN intake_form_id,
      DROP COLUMN contract_template_id,
      DROP COLUMN gate_config;

    DROP TABLE app.intake_forms;
    DROP TABLE app.contract_templates;
    DROP TABLE app.legal_acceptances;
    DROP TABLE app.legal_documents;
    DROP TABLE app.coach_subscriptions;
    DROP TABLE app.coach_billing_customers;
    DROP TABLE app.billing_plans;

    DROP FUNCTION app.enforce_client_task_update();
    DROP FUNCTION app.enforce_intake_response_update();
    DROP FUNCTION app.enforce_stage2_immutable_rows();
    DROP FUNCTION app.can_manage_coach(uuid);

    ALTER TABLE app.coaches
      DROP COLUMN profile_photo_ref,
      DROP COLUMN specialties;
    ALTER TABLE app.tenants
      DROP CONSTRAINT tenants_setup_state_valid,
      DROP CONSTRAINT tenants_timezone_not_blank,
      DROP CONSTRAINT tenants_business_email_not_blank,
      DROP COLUMN policy_defaults,
      DROP COLUMN message_templates,
      DROP COLUMN onboarding_defaults,
      DROP COLUMN setup_state,
      DROP COLUMN website_url,
      DROP COLUMN business_address,
      DROP COLUMN coach_type,
      DROP COLUMN timezone,
      DROP COLUMN phone,
      DROP COLUMN business_email,
      DROP COLUMN legal_name;
  `.execute(database);
}

export const stage2CoreDomainMigration: Migration = { down, up };
