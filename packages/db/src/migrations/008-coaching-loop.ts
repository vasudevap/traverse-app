import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

async function up(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);

  await sql`
    ALTER TABLE app.groups NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE app.group_memberships NO FORCE ROW LEVEL SECURITY;

    ALTER TABLE app.groups
      ADD CONSTRAINT groups_tenant_id_id_coach_id_unique UNIQUE (tenant_id, id, coach_id);
    ALTER TABLE app.group_memberships ADD COLUMN coach_id uuid;
    UPDATE app.group_memberships AS membership
    SET coach_id = cohort.coach_id
    FROM app.groups AS cohort
    WHERE cohort.tenant_id = membership.tenant_id
      AND cohort.id = membership.group_id;
    ALTER TABLE app.group_memberships
      ALTER COLUMN coach_id SET NOT NULL,
      ADD CONSTRAINT group_memberships_group_coach_fk
        FOREIGN KEY (tenant_id, group_id, coach_id)
        REFERENCES app.groups (tenant_id, id, coach_id) ON DELETE RESTRICT;

    DROP POLICY group_memberships_coach_all ON app.group_memberships;
    CREATE POLICY group_memberships_coach_all ON app.group_memberships
      FOR ALL
      USING (
        tenant_id = app.current_tenant_id()
        AND app.can_manage_coach(coach_id)
      )
      WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND app.can_manage_coach(coach_id)
      );

    ALTER TABLE app.groups FORCE ROW LEVEL SECURITY;
    ALTER TABLE app.group_memberships FORCE ROW LEVEL SECURITY;

    ALTER TABLE app.appointments
      ADD COLUMN timezone text NOT NULL DEFAULT 'UTC',
      ADD COLUMN notes text,
      ADD COLUMN booking_hold_id uuid UNIQUE,
      ADD CONSTRAINT appointments_timezone_not_blank CHECK (btrim(timezone) <> ''),
      ADD CONSTRAINT appointments_booking_hold_fk
        FOREIGN KEY (tenant_id, booking_hold_id)
        REFERENCES app.booking_holds (tenant_id, id) ON DELETE RESTRICT;

    ALTER TABLE app.tasks
      ADD COLUMN due_at timestamptz;

    CREATE POLICY appointment_types_client_select ON app.appointment_types
      FOR SELECT USING (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND active
        AND self_bookable
        AND EXISTS (
          SELECT 1 FROM app.coaching_relationships AS relationship
          WHERE relationship.tenant_id = appointment_types.tenant_id
            AND relationship.coach_id = appointment_types.coach_id
            AND relationship.client_id = app.current_client_id()
            AND relationship.status = 'active'
            AND relationship.archived_at IS NULL
        )
      );

    CREATE POLICY availability_windows_client_select ON app.availability_windows
      FOR SELECT USING (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND active
        AND window_type = 'slot'
        AND slot_starts_at > now()
        AND EXISTS (
          SELECT 1 FROM app.coaching_relationships AS relationship
          WHERE relationship.tenant_id = availability_windows.tenant_id
            AND relationship.coach_id = availability_windows.coach_id
            AND relationship.client_id = app.current_client_id()
            AND relationship.status = 'active'
            AND relationship.archived_at IS NULL
        )
      );

    DROP POLICY booking_holds_client_all ON app.booking_holds;
    DROP POLICY booking_holds_coach_all ON app.booking_holds;
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
      WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND EXISTS (
          SELECT 1 FROM app.availability_windows AS availability
          WHERE availability.tenant_id = booking_holds.tenant_id
            AND availability.id = booking_holds.availability_window_id
            AND app.can_manage_coach(availability.coach_id)
        )
      );
    CREATE POLICY booking_holds_client_select ON app.booking_holds
      FOR SELECT USING (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND client_id = app.current_client_id()
      );
    CREATE POLICY booking_holds_client_insert ON app.booking_holds
      FOR INSERT WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND client_id = app.current_client_id()
        AND status = 'active'
        AND expires_at > now()
        AND expires_at <= now() + interval '15 minutes'
        AND EXISTS (
          SELECT 1
          FROM app.availability_windows AS availability
          JOIN app.coaching_relationships AS relationship
            ON relationship.tenant_id = availability.tenant_id
           AND relationship.coach_id = availability.coach_id
          WHERE availability.tenant_id = booking_holds.tenant_id
            AND availability.id = booking_holds.availability_window_id
            AND availability.active
            AND availability.window_type = 'slot'
            AND availability.slot_starts_at > now()
            AND availability.slot_starts_at = booking_holds.starts_at
            AND availability.slot_ends_at = booking_holds.ends_at
            AND relationship.client_id = app.current_client_id()
            AND relationship.status = 'active'
            AND relationship.archived_at IS NULL
        )
      );
    CREATE POLICY booking_holds_client_update ON app.booking_holds
      FOR UPDATE USING (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND client_id = app.current_client_id()
      )
      WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND client_id = app.current_client_id()
      );
    CREATE POLICY booking_holds_client_expire ON app.booking_holds
      FOR UPDATE USING (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND status = 'active'
        AND expires_at <= now()
      )
      WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND status = 'expired'
      );

    CREATE OR REPLACE FUNCTION app.guard_client_booking_hold_update()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      IF app.current_actor_role() = 'client' AND (
        NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
        OR NEW.availability_window_id IS DISTINCT FROM OLD.availability_window_id
        OR NEW.client_id IS DISTINCT FROM OLD.client_id
        OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
        OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR OLD.status <> 'active'
        OR NEW.status NOT IN ('converted', 'released', 'expired')
        OR (NEW.status = 'converted' AND OLD.expires_at <= now())
      ) THEN
        RAISE EXCEPTION 'clients may only resolve their active booking holds'
          USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $function$;

    CREATE TRIGGER booking_holds_guard_client_update
      BEFORE UPDATE ON app.booking_holds
      FOR EACH ROW EXECUTE FUNCTION app.guard_client_booking_hold_update();

    DROP POLICY appointments_client_insert ON app.appointments;
    CREATE POLICY appointments_client_insert ON app.appointments
      FOR INSERT WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND app.current_actor_role() = 'client'
        AND group_id IS NULL
        AND booking_hold_id IS NOT NULL
        AND booked_by_client_id = app.current_client_id()
        AND status = 'booked'
        AND EXISTS (
          SELECT 1
          FROM app.coaching_relationships AS relationship
          JOIN app.booking_holds AS hold
            ON hold.tenant_id = relationship.tenant_id
           AND hold.client_id = relationship.client_id
          JOIN app.availability_windows AS availability
            ON availability.tenant_id = hold.tenant_id
           AND availability.id = hold.availability_window_id
          WHERE relationship.tenant_id = appointments.tenant_id
            AND relationship.id = appointments.relationship_id
            AND relationship.client_id = app.current_client_id()
            AND relationship.coach_id = appointments.coach_id
            AND relationship.status = 'active'
            AND relationship.archived_at IS NULL
            AND hold.id = appointments.booking_hold_id
            AND hold.status = 'converted'
            AND hold.expires_at > now()
            AND hold.starts_at = appointments.starts_at
            AND hold.ends_at = appointments.ends_at
            AND availability.coach_id = appointments.coach_id
            AND availability.timezone = appointments.timezone
            AND appointments.meeting_link IS NULL
            AND appointments.notes IS NULL
            AND EXISTS (
              SELECT 1
              FROM app.appointment_types AS appointment_type
              WHERE appointment_type.tenant_id = appointments.tenant_id
                AND appointment_type.id = appointments.appointment_type_id
                AND appointment_type.coach_id = appointments.coach_id
                AND appointment_type.active
                AND appointment_type.self_bookable
                AND appointment_type.name = appointments.title
            )
        )
      );

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
        OR NEW.due_at IS DISTINCT FROM OLD.due_at
        OR NEW.status NOT IN ('assigned', 'completed')
      ) THEN
        RAISE EXCEPTION 'clients may only complete assigned tasks' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $function$;
  `.execute(database);
}

async function down(database: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL ROLE traverse_ddl`.execute(database);

  await sql`
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

    DROP POLICY appointments_client_insert ON app.appointments;
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

    DROP TRIGGER booking_holds_guard_client_update ON app.booking_holds;
    DROP FUNCTION app.guard_client_booking_hold_update();
    DROP POLICY booking_holds_client_update ON app.booking_holds;
    DROP POLICY booking_holds_client_expire ON app.booking_holds;
    DROP POLICY booking_holds_client_insert ON app.booking_holds;
    DROP POLICY booking_holds_client_select ON app.booking_holds;
    DROP POLICY booking_holds_coach_all ON app.booking_holds;
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

    DROP POLICY availability_windows_client_select ON app.availability_windows;
    DROP POLICY appointment_types_client_select ON app.appointment_types;

    ALTER TABLE app.tasks DROP COLUMN due_at;
    ALTER TABLE app.appointments
      DROP CONSTRAINT appointments_booking_hold_fk,
      DROP CONSTRAINT appointments_timezone_not_blank,
      DROP COLUMN booking_hold_id,
      DROP COLUMN notes,
      DROP COLUMN timezone;

    ALTER TABLE app.groups NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE app.group_memberships NO FORCE ROW LEVEL SECURITY;
    DROP POLICY group_memberships_coach_all ON app.group_memberships;
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
    ALTER TABLE app.group_memberships
      DROP CONSTRAINT group_memberships_group_coach_fk,
      DROP COLUMN coach_id;
    ALTER TABLE app.groups DROP CONSTRAINT groups_tenant_id_id_coach_id_unique;
    ALTER TABLE app.groups FORCE ROW LEVEL SECURITY;
    ALTER TABLE app.group_memberships FORCE ROW LEVEL SECURITY;
  `.execute(database);
}

export const coachingLoopMigration: Migration = { down, up };
