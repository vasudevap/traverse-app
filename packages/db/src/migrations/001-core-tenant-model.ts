import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE app.kysely_migration OWNER TO traverse_ddl;
    ALTER TABLE app.kysely_migration_lock OWNER TO traverse_ddl;
  `.execute(database);

  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);

  await sql`CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public`.execute(database);

  await sql`
    CREATE OR REPLACE FUNCTION app.current_client_id()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
    SET search_path = pg_catalog
    AS $function$
      SELECT NULLIF(current_setting('app.client_id', true), '')::uuid
    $function$;

    CREATE OR REPLACE FUNCTION app.current_practice_role()
    RETURNS text
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
    SET search_path = pg_catalog
    AS $function$
      SELECT NULLIF(current_setting('app.practice_role', true), '')
    $function$;

    REVOKE ALL ON FUNCTION app.current_client_id() FROM PUBLIC;
    REVOKE ALL ON FUNCTION app.current_practice_role() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION app.current_client_id() TO traverse_runtime;
    GRANT EXECUTE ON FUNCTION app.current_practice_role() TO traverse_runtime;

    CREATE TABLE app.users (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      email public.citext NOT NULL UNIQUE,
      password_hash text,
      name text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT users_email_not_blank CHECK (btrim(email::text) <> ''),
      CONSTRAINT users_name_not_blank CHECK (btrim(name) <> ''),
      CONSTRAINT users_status_not_blank CHECK (btrim(status) <> '')
    );

    CREATE TABLE app.sessions (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
      role text NOT NULL,
      token_hash bytea NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      ip inet,
      user_agent text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT sessions_role_valid
        CHECK (role IN ('admin', 'coach', 'billingAdmin', 'client')),
      CONSTRAINT sessions_token_hash_present CHECK (octet_length(token_hash) >= 32),
      CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
    );
    CREATE INDEX sessions_user_active_idx
      ON app.sessions (user_id, expires_at)
      WHERE revoked_at IS NULL;
    CREATE INDEX sessions_expiry_idx ON app.sessions (expires_at);

    CREATE TABLE app.auth_tokens (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
      purpose text NOT NULL,
      token_hash bytea NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT auth_tokens_purpose_valid
        CHECK (purpose IN ('magic_link', 'password_reset', 'email_verify')),
      CONSTRAINT auth_tokens_hash_present CHECK (octet_length(token_hash) >= 32),
      CONSTRAINT auth_tokens_expiry_after_creation CHECK (expires_at > created_at)
    );
    CREATE INDEX auth_tokens_user_purpose_idx
      ON app.auth_tokens (user_id, purpose, expires_at);

    CREATE TABLE app.tenants (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      name text NOT NULL,
      subdomain public.citext NOT NULL UNIQUE,
      status text NOT NULL DEFAULT 'active',
      custom_domain public.citext UNIQUE,
      custom_domain_verified_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT tenants_name_not_blank CHECK (btrim(name) <> ''),
      CONSTRAINT tenants_subdomain_valid
        CHECK (subdomain::text ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
      CONSTRAINT tenants_status_not_blank CHECK (btrim(status) <> '')
    );

    CREATE TABLE app.tenant_keys (
      tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
      wrapped_data_key bytea NOT NULL,
      kms_key_id text NOT NULL,
      key_version integer NOT NULL DEFAULT 1,
      rotated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT tenant_keys_wrapped_key_present CHECK (octet_length(wrapped_data_key) > 0),
      CONSTRAINT tenant_keys_kms_key_present CHECK (btrim(kms_key_id) <> ''),
      CONSTRAINT tenant_keys_version_positive CHECK (key_version > 0)
    );

    CREATE TABLE app.coaches (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      user_id uuid NOT NULL UNIQUE REFERENCES app.users(id) ON DELETE RESTRICT,
      role_in_practice text NOT NULL,
      display_name text,
      bio text,
      discipline text,
      status text NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT coaches_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT coaches_role_valid CHECK (role_in_practice IN ('owner', 'coach')),
      CONSTRAINT coaches_status_not_blank CHECK (btrim(status) <> '')
    );
    CREATE UNIQUE INDEX coaches_one_owner_per_tenant_idx
      ON app.coaches (tenant_id)
      WHERE role_in_practice = 'owner';

    CREATE TABLE app.clients (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      user_id uuid NOT NULL UNIQUE REFERENCES app.users(id) ON DELETE RESTRICT,
      name text NOT NULL,
      phone text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT clients_name_not_blank CHECK (btrim(name) <> '')
    );

    CREATE TABLE app.coaching_relationships (
      id uuid PRIMARY KEY DEFAULT uuidv7(),
      tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE RESTRICT,
      coach_id uuid NOT NULL,
      client_id uuid NOT NULL REFERENCES app.clients(id) ON DELETE RESTRICT,
      status text NOT NULL DEFAULT 'invited',
      onboarding_state text NOT NULL DEFAULT 'pending',
      notes_enc bytea,
      notes_key_version integer,
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT coaching_relationships_tenant_id_id_unique UNIQUE (tenant_id, id),
      CONSTRAINT coaching_relationships_coach_fk
        FOREIGN KEY (tenant_id, coach_id)
        REFERENCES app.coaches (tenant_id, id)
        ON DELETE RESTRICT,
      CONSTRAINT coaching_relationships_status_not_blank CHECK (btrim(status) <> ''),
      CONSTRAINT coaching_relationships_onboarding_not_blank
        CHECK (btrim(onboarding_state) <> ''),
      CONSTRAINT coaching_relationships_notes_key_pair
        CHECK (
          (notes_enc IS NULL AND notes_key_version IS NULL)
          OR (notes_enc IS NOT NULL AND notes_key_version > 0)
        )
    );
    CREATE UNIQUE INDEX coaching_relationships_active_unique_idx
      ON app.coaching_relationships (tenant_id, coach_id, client_id)
      WHERE archived_at IS NULL;

    ALTER TABLE app.tenants ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.tenants FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenants_select ON app.tenants
      FOR SELECT
      USING (
        id = app.current_tenant_id()
        AND app.current_actor_role() IN ('admin', 'coach', 'client')
      );
    CREATE POLICY tenants_insert ON app.tenants
      FOR INSERT
      WITH CHECK (
        id = app.current_tenant_id()
        AND (
          app.current_actor_role() = 'admin'
          OR (
            app.current_actor_role() = 'coach'
            AND app.current_practice_role() = 'owner'
          )
        )
      );
    CREATE POLICY tenants_update ON app.tenants
      FOR UPDATE
      USING (
        id = app.current_tenant_id()
        AND (
          app.current_actor_role() = 'admin'
          OR (
            app.current_actor_role() = 'coach'
            AND app.current_practice_role() = 'owner'
          )
        )
      )
      WITH CHECK (id = app.current_tenant_id());
    CREATE POLICY tenants_delete ON app.tenants
      FOR DELETE
      USING (
        id = app.current_tenant_id()
        AND (
          app.current_actor_role() = 'admin'
          OR (
            app.current_actor_role() = 'coach'
            AND app.current_practice_role() = 'owner'
          )
        )
      );

    ALTER TABLE app.tenant_keys ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.tenant_keys FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_keys_select ON app.tenant_keys
      FOR SELECT
      USING (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() IN ('admin', 'coach', 'client')
      );

    ALTER TABLE app.coaches ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.coaches FORCE ROW LEVEL SECURITY;
    CREATE POLICY coaches_select ON app.coaches
      FOR SELECT
      USING (
        tenant_id = app.current_tenant_id()
        AND (
          app.current_actor_role() IN ('admin', 'coach')
          OR (
            app.current_actor_role() = 'client'
            AND id = app.current_coach_id()
          )
        )
      );
    CREATE POLICY coaches_insert ON app.coaches
      FOR INSERT
      WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (
          app.current_actor_role() = 'admin'
          OR (
            app.current_actor_role() = 'coach'
            AND app.current_practice_role() = 'owner'
          )
        )
      );
    CREATE POLICY coaches_update ON app.coaches
      FOR UPDATE
      USING (
        tenant_id = app.current_tenant_id()
        AND (
          app.current_actor_role() = 'admin'
          OR (
            app.current_actor_role() = 'coach'
            AND (
              app.current_practice_role() = 'owner'
              OR id = app.current_coach_id()
            )
          )
        )
      )
      WITH CHECK (tenant_id = app.current_tenant_id());
    CREATE POLICY coaches_delete ON app.coaches
      FOR DELETE
      USING (
        tenant_id = app.current_tenant_id()
        AND (
          app.current_actor_role() = 'admin'
          OR (
            app.current_actor_role() = 'coach'
            AND app.current_practice_role() = 'owner'
          )
        )
      );

    ALTER TABLE app.coaching_relationships ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.coaching_relationships FORCE ROW LEVEL SECURITY;
    CREATE POLICY coaching_relationships_select ON app.coaching_relationships
      FOR SELECT
      USING (
        tenant_id = app.current_tenant_id()
        AND (
          app.current_actor_role() = 'admin'
          OR (
            app.current_actor_role() = 'coach'
            AND (
              app.current_practice_role() = 'owner'
              OR (
                app.current_practice_role() = 'coach'
                AND coach_id = app.current_coach_id()
              )
            )
          )
          OR (
            app.current_actor_role() = 'client'
            AND client_id = app.current_client_id()
          )
        )
      );
    CREATE POLICY coaching_relationships_insert ON app.coaching_relationships
      FOR INSERT
      WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (
          app.current_actor_role() = 'admin'
          OR (
            app.current_actor_role() = 'coach'
            AND (
              app.current_practice_role() = 'owner'
              OR (
                app.current_practice_role() = 'coach'
                AND coach_id = app.current_coach_id()
              )
            )
          )
        )
      );
    CREATE POLICY coaching_relationships_update ON app.coaching_relationships
      FOR UPDATE
      USING (
        tenant_id = app.current_tenant_id()
        AND (
          app.current_actor_role() = 'admin'
          OR (
            app.current_actor_role() = 'coach'
            AND (
              app.current_practice_role() = 'owner'
              OR (
                app.current_practice_role() = 'coach'
                AND coach_id = app.current_coach_id()
              )
            )
          )
        )
      )
      WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (
          app.current_actor_role() = 'admin'
          OR (
            app.current_actor_role() = 'coach'
            AND (
              app.current_practice_role() = 'owner'
              OR (
                app.current_practice_role() = 'coach'
                AND coach_id = app.current_coach_id()
              )
            )
          )
        )
      );

    REVOKE ALL ON app.kysely_migration FROM traverse_runtime;
    REVOKE ALL ON app.kysely_migration_lock FROM traverse_runtime;
    REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON app.users, app.sessions, app.auth_tokens, app.tenants, app.clients
      TO traverse_runtime;
    GRANT SELECT, INSERT, DELETE ON app.coaches TO traverse_runtime;
    REVOKE UPDATE ON app.coaches FROM traverse_runtime;
    GRANT UPDATE (display_name, bio, discipline, status, updated_at)
      ON app.coaches
      TO traverse_runtime;
    GRANT SELECT, INSERT, UPDATE
      ON app.coaching_relationships
      TO traverse_runtime;
    GRANT SELECT ON app.tenant_keys TO traverse_runtime;
    REVOKE TRUNCATE ON ALL TABLES IN SCHEMA app FROM traverse_runtime;
    REVOKE INSERT, UPDATE, DELETE ON app.tenant_keys FROM traverse_runtime;
    REVOKE DELETE ON app.coaching_relationships FROM traverse_runtime;
  `.execute(database);
}

async function down(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);
  await sql`
    DROP TABLE app.coaching_relationships;
    DROP TABLE app.clients;
    DROP TABLE app.coaches;
    DROP TABLE app.tenant_keys;
    DROP TABLE app.tenants;
    DROP TABLE app.auth_tokens;
    DROP TABLE app.sessions;
    DROP TABLE app.users;
  `.execute(database);
}

export const coreTenantModelMigration: Migration = { down, up };
