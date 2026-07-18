import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

async function up(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);
  await sql`
    ALTER TABLE app.coaching_relationships
      ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
      ADD COLUMN source_import_id uuid;

    ALTER TABLE app.imports
      ADD COLUMN source_filename text,
      ADD COLUMN source_sha256 text,
      ADD COLUMN error_report jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN completed_at timestamptz;

    UPDATE app.imports
      SET completed_at = updated_at
      WHERE status IN ('ready', 'failed') AND completed_at IS NULL;

    ALTER TABLE app.imports
      ADD CONSTRAINT imports_source_filename_not_blank
        CHECK (source_filename IS NULL OR btrim(source_filename) <> ''),
      ADD CONSTRAINT imports_source_sha256_valid
        CHECK (source_sha256 IS NULL OR source_sha256 ~ '^[0-9a-f]{64}$'),
      ADD CONSTRAINT imports_error_report_array
        CHECK (jsonb_typeof(error_report) = 'array'),
      ADD CONSTRAINT imports_completion_state
        CHECK (
          (status IN ('ready', 'failed') AND completed_at IS NOT NULL)
          OR (status IN ('pending', 'processing') AND completed_at IS NULL)
        );

    ALTER TABLE app.exports
      ADD COLUMN manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN archive_size_bytes bigint,
      ADD COLUMN completed_at timestamptz;

    UPDATE app.exports
      SET completed_at = updated_at
      WHERE status IN ('ready', 'failed', 'expired') AND completed_at IS NULL;

    ALTER TABLE app.exports
      ADD CONSTRAINT exports_manifest_object CHECK (jsonb_typeof(manifest) = 'object'),
      ADD CONSTRAINT exports_archive_size_nonnegative
        CHECK (archive_size_bytes IS NULL OR archive_size_bytes >= 0),
      ADD CONSTRAINT exports_completion_state
        CHECK (
          (status IN ('ready', 'failed', 'expired') AND completed_at IS NOT NULL)
          OR (status IN ('pending', 'processing') AND completed_at IS NULL)
        );

    ALTER TABLE app.coaching_relationships
      ADD CONSTRAINT coaching_relationships_source_import_fk
        FOREIGN KEY (tenant_id, source_import_id)
        REFERENCES app.imports (tenant_id, id);

    CREATE FUNCTION app.guard_relationship_import_provenance()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      IF NEW.source_import_id IS DISTINCT FROM OLD.source_import_id THEN
        RAISE EXCEPTION 'relationship import provenance is immutable'
          USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $function$;

    CREATE TRIGGER coaching_relationships_import_provenance_guard
      BEFORE UPDATE ON app.coaching_relationships
      FOR EACH ROW EXECUTE FUNCTION app.guard_relationship_import_provenance();

    DROP POLICY exports_actor_all ON app.exports;
    CREATE POLICY exports_actor_select ON app.exports
      FOR SELECT USING (
        tenant_id = app.current_tenant_id()
        AND (
          app.current_actor_role() = 'admin'
          OR requested_by = app.current_actor_id()
          OR (app.current_actor_role() = 'coach' AND app.current_practice_role() = 'owner')
        )
      );
    CREATE POLICY exports_actor_insert ON app.exports
      FOR INSERT WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND requested_by = app.current_actor_id()
        AND app.current_actor_role() = 'coach'
      );
    CREATE POLICY exports_requester_update ON app.exports
      FOR UPDATE
      USING (
        tenant_id = app.current_tenant_id()
        AND requested_by = app.current_actor_id()
        AND app.current_actor_role() = 'coach'
      )
      WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND requested_by = app.current_actor_id()
        AND app.current_actor_role() = 'coach'
      );

    DROP POLICY imports_actor_all ON app.imports;
    CREATE POLICY imports_actor_select ON app.imports
      FOR SELECT USING (
        tenant_id = app.current_tenant_id()
        AND (
          app.current_actor_role() = 'admin'
          OR requested_by = app.current_actor_id()
          OR (app.current_actor_role() = 'coach' AND app.current_practice_role() = 'owner')
        )
      );
    CREATE POLICY imports_actor_insert ON app.imports
      FOR INSERT WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND requested_by = app.current_actor_id()
        AND app.current_actor_role() = 'coach'
      );
    CREATE POLICY imports_requester_update ON app.imports
      FOR UPDATE
      USING (
        tenant_id = app.current_tenant_id()
        AND requested_by = app.current_actor_id()
        AND app.current_actor_role() = 'coach'
      )
      WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND requested_by = app.current_actor_id()
        AND app.current_actor_role() = 'coach'
      );
  `.execute(database);
}

async function down(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);
  await sql`
    DROP POLICY imports_requester_update ON app.imports;
    DROP POLICY imports_actor_insert ON app.imports;
    DROP POLICY imports_actor_select ON app.imports;
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

    DROP POLICY exports_requester_update ON app.exports;
    DROP POLICY exports_actor_insert ON app.exports;
    DROP POLICY exports_actor_select ON app.exports;
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

    ALTER TABLE app.exports
      DROP CONSTRAINT exports_completion_state,
      DROP CONSTRAINT exports_archive_size_nonnegative,
      DROP CONSTRAINT exports_manifest_object,
      DROP COLUMN completed_at,
      DROP COLUMN archive_size_bytes,
      DROP COLUMN manifest;

    ALTER TABLE app.imports
      DROP CONSTRAINT imports_completion_state,
      DROP CONSTRAINT imports_error_report_array,
      DROP CONSTRAINT imports_source_sha256_valid,
      DROP CONSTRAINT imports_source_filename_not_blank,
      DROP COLUMN completed_at,
      DROP COLUMN error_report,
      DROP COLUMN source_sha256,
      DROP COLUMN source_filename;

    DROP TRIGGER coaching_relationships_import_provenance_guard ON app.coaching_relationships;
    DROP FUNCTION app.guard_relationship_import_provenance();

    ALTER TABLE app.coaching_relationships
      DROP CONSTRAINT coaching_relationships_source_import_fk,
      DROP COLUMN source_import_id,
      DROP COLUMN tags;
  `.execute(database);
}

export const dataPortabilityMigration: Migration = { down, up };
