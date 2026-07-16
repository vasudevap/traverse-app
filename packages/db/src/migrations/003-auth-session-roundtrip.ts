import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

async function up(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);

  await sql`
    CREATE TABLE app.auth_subjects (
      user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
      role text NOT NULL,
      tenant_id uuid,
      coach_id uuid,
      client_id uuid REFERENCES app.clients(id) ON DELETE CASCADE,
      practice_role text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, role),
      CONSTRAINT auth_subjects_role_valid
        CHECK (role IN ('admin', 'coach', 'billingAdmin', 'client')),
      CONSTRAINT auth_subjects_practice_role_valid
        CHECK (practice_role IS NULL OR practice_role IN ('owner', 'coach')),
      CONSTRAINT auth_subjects_coach_scope_fk
        FOREIGN KEY (tenant_id, coach_id)
        REFERENCES app.coaches (tenant_id, id)
        ON DELETE CASCADE,
      CONSTRAINT auth_subjects_scope_valid CHECK (
        (
          role = 'coach'
          AND tenant_id IS NOT NULL
          AND coach_id IS NOT NULL
          AND client_id IS NULL
          AND practice_role IS NOT NULL
        )
        OR (
          role = 'client'
          AND tenant_id IS NULL
          AND coach_id IS NULL
          AND client_id IS NOT NULL
          AND practice_role IS NULL
        )
        OR (
          role IN ('admin', 'billingAdmin')
          AND tenant_id IS NULL
          AND coach_id IS NULL
          AND client_id IS NULL
          AND practice_role IS NULL
        )
      )
    );
    CREATE INDEX auth_subjects_role_user_idx ON app.auth_subjects (role, user_id);

    CREATE OR REPLACE FUNCTION app.sync_coach_auth_subject()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        DELETE FROM app.auth_subjects
        WHERE user_id = OLD.user_id AND role = 'coach';
        RETURN OLD;
      END IF;

      IF TG_OP = 'UPDATE' AND OLD.user_id <> NEW.user_id THEN
        DELETE FROM app.auth_subjects
        WHERE user_id = OLD.user_id AND role = 'coach';
      END IF;

      INSERT INTO app.auth_subjects
        (user_id, role, tenant_id, coach_id, practice_role, updated_at)
      VALUES
        (NEW.user_id, 'coach', NEW.tenant_id, NEW.id, NEW.role_in_practice, now())
      ON CONFLICT (user_id, role) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        coach_id = EXCLUDED.coach_id,
        practice_role = EXCLUDED.practice_role,
        updated_at = now();
      RETURN NEW;
    END
    $function$;

    CREATE OR REPLACE FUNCTION app.sync_client_auth_subject()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        DELETE FROM app.auth_subjects
        WHERE user_id = OLD.user_id AND role = 'client';
        RETURN OLD;
      END IF;

      IF TG_OP = 'UPDATE' AND OLD.user_id <> NEW.user_id THEN
        DELETE FROM app.auth_subjects
        WHERE user_id = OLD.user_id AND role = 'client';
      END IF;

      INSERT INTO app.auth_subjects
        (user_id, role, client_id, updated_at)
      VALUES
        (NEW.user_id, 'client', NEW.id, now())
      ON CONFLICT (user_id, role) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        updated_at = now();
      RETURN NEW;
    END
    $function$;

    CREATE TRIGGER coaches_sync_auth_subject
      AFTER INSERT OR UPDATE OF user_id, tenant_id, role_in_practice OR DELETE
      ON app.coaches
      FOR EACH ROW EXECUTE FUNCTION app.sync_coach_auth_subject();

    CREATE TRIGGER clients_sync_auth_subject
      AFTER INSERT OR UPDATE OF user_id OR DELETE
      ON app.clients
      FOR EACH ROW EXECUTE FUNCTION app.sync_client_auth_subject();

    ALTER TABLE app.coaches NO FORCE ROW LEVEL SECURITY;

    INSERT INTO app.auth_subjects
      (user_id, role, tenant_id, coach_id, practice_role)
    SELECT user_id, 'coach', tenant_id, id, role_in_practice
    FROM app.coaches;

    ALTER TABLE app.coaches FORCE ROW LEVEL SECURITY;

    INSERT INTO app.auth_subjects
      (user_id, role, client_id)
    SELECT user_id, 'client', id
    FROM app.clients;

    REVOKE ALL ON app.auth_subjects FROM PUBLIC;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON app.auth_subjects FROM traverse_runtime;
    GRANT SELECT ON app.auth_subjects TO traverse_runtime;
  `.execute(database);
}

async function down(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);
  await sql`
    DROP TRIGGER clients_sync_auth_subject ON app.clients;
    DROP TRIGGER coaches_sync_auth_subject ON app.coaches;
    DROP FUNCTION app.sync_client_auth_subject();
    DROP FUNCTION app.sync_coach_auth_subject();
    DROP TABLE app.auth_subjects;
  `.execute(database);
}

export const authSessionRoundtripMigration: Migration = { down, up };
