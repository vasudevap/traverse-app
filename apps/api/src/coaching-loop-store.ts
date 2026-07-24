import {
  decryptString,
  destroyPlaintextKey,
  encryptString,
  type JsonValue,
  type KmsCommandClient,
  type TenantTransaction,
  type TraverseDatabaseClient,
  unwrapTenantDataKey,
  withTenantContext,
} from '@traverse/db';
import { createTransactionalJobDispatcher, type EmailDeliveryJob, QUEUES } from '@traverse/jobs';
import { sql } from 'kysely';
import type { ClientOnboardingActor, CoachOnboardingActor } from './client-onboarding.service.js';
import type {
  AppointmentSnapshot,
  AppointmentTypeSnapshot,
  AvailabilitySnapshot,
  BookingHoldSnapshot,
  ClientHomeSnapshot,
  ClientRelationshipHome,
  CoachDashboardSnapshot,
  CoachRelationshipSummary,
  CoachRelationshipWorkspace,
  CoachingLoopStore,
  GroupSnapshot,
  RelationshipHealth,
  TaskSnapshot,
} from './coaching-loop.service.js';

interface JobBossSender {
  send(name: string, data?: object | null, options?: object): Promise<string | null>;
}

interface StoreConfig {
  clientAppBaseUrl: string;
  coachAppBaseUrl: string;
  emailFrom: string;
}

interface RelationshipScope {
  id: string;
  tenantId: string;
}

interface NotesCipherInput {
  keyVersion: number;
  kmsKeyId: string;
  notes?: string;
  notesEnc?: Buffer;
  relationshipId: string;
  tenantId: string;
  wrappedDataKey: Buffer;
}

export interface RelationshipNotesCipher {
  decrypt(input: NotesCipherInput & { notesEnc: Buffer }): Promise<string>;
  encrypt(input: NotesCipherInput & { notes: string }): Promise<Buffer>;
}

export class KmsRelationshipNotesCipher implements RelationshipNotesCipher {
  constructor(private readonly kms: KmsCommandClient) {}

  async encrypt(input: NotesCipherInput & { notes: string }): Promise<Buffer> {
    const key = await unwrapTenantDataKey(
      this.kms,
      input.kmsKeyId,
      input.tenantId,
      input.keyVersion,
      input.wrappedDataKey,
    );
    try {
      return encryptString(input.notes, key.plaintextKey, {
        field: 'notes_enc',
        keyVersion: key.keyVersion,
        rowId: input.relationshipId,
        table: 'coaching_relationships',
        tenantId: input.tenantId,
      });
    } finally {
      destroyPlaintextKey(key.plaintextKey);
    }
  }

  async decrypt(input: NotesCipherInput & { notesEnc: Buffer }): Promise<string> {
    const key = await unwrapTenantDataKey(
      this.kms,
      input.kmsKeyId,
      input.tenantId,
      input.keyVersion,
      input.wrappedDataKey,
    );
    try {
      return decryptString(input.notesEnc, key.plaintextKey, {
        field: 'notes_enc',
        keyVersion: key.keyVersion,
        rowId: input.relationshipId,
        table: 'coaching_relationships',
        tenantId: input.tenantId,
      });
    } finally {
      destroyPlaintextKey(key.plaintextKey);
    }
  }
}

interface AppointmentRow {
  appointment_type_id: string | null;
  booked_by_client_id: string | null;
  ends_at: Date;
  group_id: string | null;
  group_name: string | null;
  id: string;
  meeting_link: string | null;
  notes: string | null;
  relationship_id: string | null;
  client_name: string | null;
  starts_at: Date;
  status: string;
  timezone: string;
  title: string;
}

function coachContext(actor: CoachOnboardingActor) {
  return {
    actorId: actor.userId,
    coachId: actor.coachId,
    practiceRole: actor.practiceRole,
    role: 'coach' as const,
    tenantId: actor.tenantId,
  };
}

function clientContext(actor: ClientOnboardingActor, tenantId: string) {
  return {
    actorId: actor.userId,
    clientId: actor.clientId,
    role: 'client' as const,
    tenantId,
  };
}

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function appointmentSnapshot(
  row: AppointmentRow,
  surface: 'client' | 'coach',
): AppointmentSnapshot {
  const target =
    row.relationship_id === null
      ? { id: row.group_id ?? '', name: row.group_name ?? 'Coaching group', type: 'group' as const }
      : { id: row.relationship_id, name: row.client_name ?? 'Client', type: 'client' as const };
  const status =
    row.status === 'booked' || row.status === 'canceled' || row.status === 'completed'
      ? row.status
      : 'scheduled';
  return {
    appointmentTypeId: row.appointment_type_id,
    bookedByClient: row.booked_by_client_id !== null,
    calendarUrl: `/api/${surface}/appointments/${encodeURIComponent(row.id)}/ical`,
    endsAt: row.ends_at,
    id: row.id,
    meetingLink: row.meeting_link,
    notes: row.notes,
    startsAt: row.starts_at,
    status,
    target,
    timezone: row.timezone,
    title: row.title,
  };
}

function appointmentTypeSnapshot(row: {
  active: boolean;
  currency: string | null;
  default_duration_minutes: number;
  id: string;
  name: string;
  notes: string | null;
  price_amount: number | null;
  self_bookable: boolean;
}): AppointmentTypeSnapshot {
  return {
    active: row.active,
    currency: row.currency,
    defaultDurationMinutes: row.default_duration_minutes,
    id: row.id,
    name: row.name,
    notes: row.notes,
    priceAmount: row.price_amount,
    selfBookable: row.self_bookable,
  };
}

function availabilitySnapshot(row: {
  active: boolean;
  id: string;
  local_ends_at: string | null;
  local_starts_at: string | null;
  slot_ends_at: Date | null;
  slot_starts_at: Date | null;
  timezone: string;
  weekday: number | null;
  window_type: string;
}): AvailabilitySnapshot {
  return {
    active: row.active,
    endsAt: row.slot_ends_at,
    id: row.id,
    localEndsAt: row.local_ends_at,
    localStartsAt: row.local_starts_at,
    startsAt: row.slot_starts_at,
    timezone: row.timezone,
    type: row.window_type === 'slot' ? 'slot' : 'weekly',
    weekday: row.weekday,
  };
}

function taskSnapshot(row: {
  client_name: string;
  completed_at: Date | null;
  description: string | null;
  due_at: Date | null;
  id: string;
  relationship_id: string;
  status: string;
  title: string;
}): TaskSnapshot {
  return {
    clientName: row.client_name,
    completedAt: row.completed_at,
    description: row.description,
    dueAt: row.due_at,
    id: row.id,
    relationshipId: row.relationship_id,
    status: row.status === 'completed' || row.status === 'canceled' ? row.status : 'assigned',
    title: row.title,
  };
}

async function appointmentRows(transaction: TenantTransaction, coachId?: string) {
  let query = transaction
    .withSchema('app')
    .selectFrom('appointments as appointment')
    .leftJoin(
      'coaching_relationships as relationship',
      'relationship.id',
      'appointment.relationship_id',
    )
    .leftJoin('clients as client', 'client.id', 'relationship.client_id')
    .leftJoin('groups as cohort', 'cohort.id', 'appointment.group_id')
    .select([
      'appointment.appointment_type_id',
      'appointment.booked_by_client_id',
      'appointment.ends_at',
      'appointment.group_id',
      'appointment.id',
      'appointment.meeting_link',
      'appointment.notes',
      'appointment.relationship_id',
      'appointment.starts_at',
      'appointment.status',
      'appointment.timezone',
      'appointment.title',
      'client.name as client_name',
      'cohort.name as group_name',
    ]);
  if (coachId !== undefined) query = query.where('appointment.coach_id', '=', coachId);
  return query.orderBy('appointment.starts_at').execute() as Promise<AppointmentRow[]>;
}

async function taskRows(transaction: TenantTransaction, relationshipId?: string) {
  let query = transaction
    .withSchema('app')
    .selectFrom('tasks as task')
    .innerJoin('coaching_relationships as relationship', 'relationship.id', 'task.relationship_id')
    .innerJoin('clients as client', 'client.id', 'relationship.client_id')
    .select([
      'client.name as client_name',
      'task.completed_at',
      'task.description',
      'task.due_at',
      'task.id',
      'task.relationship_id',
      'task.status',
      'task.title',
    ]);
  if (relationshipId !== undefined)
    query = query.where('task.relationship_id', '=', relationshipId);
  return query.orderBy('task.created_at', 'desc').execute();
}

async function groupSnapshot(
  transaction: TenantTransaction,
  groupId: string,
): Promise<GroupSnapshot | undefined> {
  const database = transaction.withSchema('app');
  const group = await database
    .selectFrom('groups')
    .select(['archived_at', 'description', 'id', 'name'])
    .where('id', '=', groupId)
    .executeTakeFirst();
  if (group === undefined) return undefined;
  const members = await database
    .selectFrom('group_memberships as membership')
    .innerJoin('clients as client', 'client.id', 'membership.client_id')
    .select(['client.id as clientId', 'client.name'])
    .where('membership.group_id', '=', groupId)
    .orderBy('client.name')
    .execute();
  return {
    archivedAt: group.archived_at,
    description: group.description,
    id: group.id,
    members,
    name: group.name,
  };
}

async function groups(transaction: TenantTransaction, coachId: string): Promise<GroupSnapshot[]> {
  const ids = await transaction
    .withSchema('app')
    .selectFrom('groups')
    .select('id')
    .where('coach_id', '=', coachId)
    .orderBy('name')
    .execute();
  const snapshots = await Promise.all(ids.map(({ id }) => groupSnapshot(transaction, id)));
  return snapshots.filter((item): item is GroupSnapshot => item !== undefined);
}

async function clientRelationshipScopes(
  database: TraverseDatabaseClient,
  actor: ClientOnboardingActor,
): Promise<RelationshipScope[]> {
  return database.transaction().execute(async (transaction) => {
    await sql`
      SELECT
        set_config('app.tenant_id', '', true),
        set_config('app.actor_id', ${actor.userId}, true),
        set_config('app.role', 'client', true),
        set_config('app.coach_id', '', true),
        set_config('app.client_id', ${actor.clientId}, true),
        set_config('app.practice_role', '', true)
    `.execute(transaction);
    const result = await sql<{ id: string; tenant_id: string }>`
      SELECT id, tenant_id
      FROM app.coaching_relationships
      WHERE client_id = ${actor.clientId}
        AND status = 'active'
        AND archived_at IS NULL
      ORDER BY created_at
    `.execute(transaction);
    return result.rows.map((row) => ({ id: row.id, tenantId: row.tenant_id }));
  });
}

async function relationshipScope(
  database: TraverseDatabaseClient,
  actor: ClientOnboardingActor,
  relationshipId: string,
): Promise<RelationshipScope | undefined> {
  return (await clientRelationshipScopes(database, actor)).find(
    (item) => item.id === relationshipId,
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function enqueueEmail(
  boss: JobBossSender,
  transaction: TenantTransaction,
  job: EmailDeliveryJob,
): Promise<void> {
  await createTransactionalJobDispatcher(boss, transaction).enqueue(QUEUES.email, job, {
    dedupeKey: job.notificationId,
  });
}

async function recordEvent(
  transaction: TenantTransaction,
  input: {
    action: string;
    actorId: string;
    actorType: 'client' | 'coach';
    entityId: string;
    entityType: string;
    metadata?: Record<string, JsonValue>;
    tenantId: string;
  },
) {
  await transaction
    .withSchema('app')
    .insertInto('event_log')
    .values({
      action: input.action,
      actor_id: input.actorId,
      actor_type: input.actorType,
      entity_id: input.entityId,
      entity_type: input.entityType,
      metadata: input.metadata ?? {},
      tenant_id: input.tenantId,
    })
    .executeTakeFirstOrThrow();
}

function relationshipHealth(input: {
  createdAt: Date;
  lastActivityAt: Date;
  openTasks: number;
  upcoming: AppointmentSnapshot | null;
  touched: boolean;
}): RelationshipHealth {
  if (!input.touched) {
    return Date.now() - input.createdAt.getTime() < 7 * 24 * 60 * 60 * 1000
      ? 'newly_active'
      : 'awaiting_first_touch';
  }
  if (input.upcoming !== null) return 'scheduled';
  if (input.openTasks > 0) return 'task_pending';
  return Date.now() - input.lastActivityAt.getTime() > 14 * 24 * 60 * 60 * 1000
    ? 'inactive_risk'
    : 'active';
}

export class DatabaseCoachingLoopStore implements CoachingLoopStore {
  constructor(
    private readonly database: TraverseDatabaseClient,
    private readonly boss: JobBossSender,
    private readonly notesCipher: RelationshipNotesCipher,
    private readonly config: StoreConfig,
  ) {}

  async getCoachDashboard(actor: CoachOnboardingActor): Promise<CoachDashboardSnapshot> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const database = transaction.withSchema('app');
      const coach = await database
        .selectFrom('coaches as coach')
        .innerJoin('users as user', 'user.id', 'coach.user_id')
        .innerJoin('tenants as tenant', 'tenant.id', 'coach.tenant_id')
        .select(['tenant.timezone', 'user.name'])
        .where('coach.id', '=', actor.coachId)
        .executeTakeFirstOrThrow();
      const relationshipRows = await database
        .selectFrom('coaching_relationships as relationship')
        .innerJoin('clients as client', 'client.id', 'relationship.client_id')
        .innerJoin('users as user', 'user.id', 'client.user_id')
        .leftJoin('client_invites as invite', 'invite.relationship_id', 'relationship.id')
        .leftJoin('contract_instances as contract', 'contract.relationship_id', 'relationship.id')
        .select([
          'client.id as client_id',
          'client.name as client_name',
          'contract.id as contract_id',
          'relationship.created_at',
          'relationship.id',
          'relationship.onboarding_state',
          'relationship.status',
          'relationship.updated_at',
          'invite.expires_at as invite_expires_at',
          'user.email',
        ])
        .where('relationship.coach_id', '=', actor.coachId)
        .where('relationship.status', 'in', ['active', 'invited', 'onboarding'])
        .where('relationship.archived_at', 'is', null)
        .execute();
      const allAppointments = (await appointmentRows(transaction, actor.coachId)).map((row) =>
        appointmentSnapshot(row, 'coach'),
      );
      const allTasks = (await taskRows(transaction)).map(taskSnapshot);
      const now = new Date();
      const relationships: CoachRelationshipSummary[] = relationshipRows.map((relationship) => {
        const appointments = allAppointments.filter(
          (item) => item.target.type === 'client' && item.target.id === relationship.id,
        );
        const tasks = allTasks.filter((item) => item.relationshipId === relationship.id);
        const upcoming =
          appointments.find(
            (item) =>
              item.startsAt > now && (item.status === 'scheduled' || item.status === 'booked'),
          ) ?? null;
        const openTasks = tasks.filter((item) => item.status === 'assigned').length;
        const activity = [
          asDate(relationship.updated_at),
          ...appointments.map((item) => item.startsAt),
          ...tasks.flatMap((item) => (item.completedAt === null ? [] : [item.completedAt])),
        ];
        const lastActivityAt = activity.reduce((latest, value) =>
          value > latest ? value : latest,
        );
        return {
          client: {
            email: relationship.email,
            id: relationship.client_id,
            name: relationship.client_name,
          },
          contractId: relationship.contract_id,
          health:
            relationship.status === 'invited'
              ? 'invited'
              : relationship.status === 'onboarding'
                ? 'onboarding'
                : relationshipHealth({
                    createdAt: asDate(relationship.created_at),
                    lastActivityAt,
                    openTasks,
                    touched: appointments.length > 0 || tasks.length > 0,
                    upcoming,
                  }),
          id: relationship.id,
          inviteExpiresAt: relationship.invite_expires_at,
          lastActivityAt,
          nextAppointment: upcoming,
          onboardingState: relationship.onboarding_state,
          openTaskCount: openTasks,
        };
      });
      const priority: Record<RelationshipHealth, number> = {
        active: 4,
        awaiting_first_touch: 1,
        inactive_risk: 0,
        invited: 0,
        onboarding: 1,
        newly_active: 3,
        scheduled: 5,
        task_pending: 2,
      };
      relationships.sort((left, right) => priority[left.health] - priority[right.health]);
      const appointmentTypes = await database
        .selectFrom('appointment_types')
        .selectAll()
        .where('coach_id', '=', actor.coachId)
        .orderBy('name')
        .execute();
      return {
        appointmentTypes: appointmentTypes.map(appointmentTypeSnapshot),
        coachName: coach.name,
        groups: await groups(transaction, actor.coachId),
        relationships,
        timezone: coach.timezone,
        upcomingAppointments: allAppointments.filter(
          (item) =>
            item.startsAt > now && (item.status === 'scheduled' || item.status === 'booked'),
        ),
      };
    });
  }

  async getCoachWorkspace(
    actor: CoachOnboardingActor,
    relationshipId: string,
  ): Promise<CoachRelationshipWorkspace | undefined> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const database = transaction.withSchema('app');
      const relationship = await database
        .selectFrom('coaching_relationships as relationship')
        .innerJoin('clients as client', 'client.id', 'relationship.client_id')
        .innerJoin('users as user', 'user.id', 'client.user_id')
        .innerJoin('tenant_keys as key', 'key.tenant_id', 'relationship.tenant_id')
        .select([
          'client.id as client_id',
          'client.name as client_name',
          'client.phone',
          'key.key_version',
          'key.kms_key_id',
          'key.wrapped_data_key',
          'relationship.created_at',
          'relationship.id',
          'relationship.notes_enc',
          'relationship.notes_key_version',
          'relationship.updated_at',
          'user.email',
        ])
        .where('relationship.id', '=', relationshipId)
        .where('relationship.coach_id', '=', actor.coachId)
        .where('relationship.status', '=', 'active')
        .where('relationship.archived_at', 'is', null)
        .executeTakeFirst();
      if (relationship === undefined) return undefined;
      const appointments = (await appointmentRows(transaction, actor.coachId))
        .filter((row) => row.relationship_id === relationshipId)
        .map((row) => appointmentSnapshot(row, 'coach'));
      const tasks = (await taskRows(transaction, relationshipId)).map(taskSnapshot);
      const upcoming =
        appointments.find(
          (item) =>
            item.startsAt > new Date() && (item.status === 'scheduled' || item.status === 'booked'),
        ) ?? null;
      const notes =
        relationship.notes_enc === null || relationship.notes_key_version === null
          ? ''
          : await this.notesCipher.decrypt({
              keyVersion: relationship.notes_key_version,
              kmsKeyId: relationship.kms_key_id,
              notesEnc: relationship.notes_enc,
              relationshipId: relationship.id,
              tenantId: actor.tenantId,
              wrappedDataKey: relationship.wrapped_data_key,
            });
      return {
        appointments,
        client: {
          email: relationship.email,
          id: relationship.client_id,
          name: relationship.client_name,
          phone: relationship.phone,
        },
        health: relationshipHealth({
          createdAt: asDate(relationship.created_at),
          lastActivityAt: asDate(relationship.updated_at),
          openTasks: tasks.filter((item) => item.status === 'assigned').length,
          touched: appointments.length > 0 || tasks.length > 0,
          upcoming,
        }),
        id: relationship.id,
        notes,
        tasks,
      };
    });
  }

  async saveRelationshipNotes(
    actor: CoachOnboardingActor,
    relationshipId: string,
    notes: string,
  ): Promise<CoachRelationshipWorkspace | undefined> {
    const saved = await withTenantContext(
      this.database,
      coachContext(actor),
      async (transaction) => {
        const database = transaction.withSchema('app');
        const relationship = await database
          .selectFrom('coaching_relationships as relationship')
          .innerJoin('tenant_keys as key', 'key.tenant_id', 'relationship.tenant_id')
          .select(['key.key_version', 'key.kms_key_id', 'key.wrapped_data_key', 'relationship.id'])
          .where('relationship.id', '=', relationshipId)
          .where('relationship.coach_id', '=', actor.coachId)
          .where('relationship.status', '=', 'active')
          .executeTakeFirst();
        if (relationship === undefined) return false;
        const notesEnc =
          notes === ''
            ? null
            : await this.notesCipher.encrypt({
                keyVersion: relationship.key_version,
                kmsKeyId: relationship.kms_key_id,
                notes,
                relationshipId,
                tenantId: actor.tenantId,
                wrappedDataKey: relationship.wrapped_data_key,
              });
        await database
          .updateTable('coaching_relationships')
          .set({
            notes_enc: notesEnc,
            notes_key_version: notesEnc === null ? null : relationship.key_version,
            updated_at: sql`now()`,
          })
          .where('id', '=', relationshipId)
          .executeTakeFirstOrThrow();
        await recordEvent(transaction, {
          action: 'coach.relationship.notes_updated',
          actorId: actor.userId,
          actorType: 'coach',
          entityId: relationshipId,
          entityType: 'coaching_relationship',
          metadata: { hasNotes: notes !== '' },
          tenantId: actor.tenantId,
        });
        return true;
      },
    );
    return saved ? this.getCoachWorkspace(actor, relationshipId) : undefined;
  }

  async createAppointmentType(
    actor: CoachOnboardingActor,
    input: Omit<AppointmentTypeSnapshot, 'active' | 'id'>,
  ): Promise<AppointmentTypeSnapshot> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const created = await transaction
        .withSchema('app')
        .insertInto('appointment_types')
        .values({
          coach_id: actor.coachId,
          currency: input.currency,
          default_duration_minutes: input.defaultDurationMinutes,
          name: input.name,
          notes: input.notes,
          price_amount: input.priceAmount,
          self_bookable: input.selfBookable,
          tenant_id: actor.tenantId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return appointmentTypeSnapshot(created);
    });
  }

  async updateAppointmentType(
    actor: CoachOnboardingActor,
    appointmentTypeId: string,
    input: Partial<Omit<AppointmentTypeSnapshot, 'id'>>,
  ): Promise<AppointmentTypeSnapshot | undefined> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const values: Record<string, unknown> = { updated_at: sql`now()` };
      if (input.active !== undefined) values.active = input.active;
      if (input.currency !== undefined) values.currency = input.currency;
      if (input.defaultDurationMinutes !== undefined) {
        values.default_duration_minutes = input.defaultDurationMinutes;
      }
      if (input.name !== undefined) values.name = input.name;
      if (input.notes !== undefined) values.notes = input.notes;
      if (input.priceAmount !== undefined) values.price_amount = input.priceAmount;
      if (input.selfBookable !== undefined) values.self_bookable = input.selfBookable;
      const updated = await transaction
        .withSchema('app')
        .updateTable('appointment_types')
        .set(values)
        .where('id', '=', appointmentTypeId)
        .where('coach_id', '=', actor.coachId)
        .returningAll()
        .executeTakeFirst();
      return updated === undefined ? undefined : appointmentTypeSnapshot(updated);
    });
  }

  async listAvailability(actor: CoachOnboardingActor): Promise<AvailabilitySnapshot[]> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const rows = await transaction
        .withSchema('app')
        .selectFrom('availability_windows')
        .selectAll()
        .where('coach_id', '=', actor.coachId)
        .where('active', '=', true)
        .orderBy('slot_starts_at')
        .execute();
      return rows.map(availabilitySnapshot);
    });
  }

  async createAvailability(
    actor: CoachOnboardingActor,
    input:
      | { endsAt: Date; startsAt: Date; timezone: string; type: 'slot' }
      | {
          localEndsAt: string;
          localStartsAt: string;
          timezone: string;
          type: 'weekly';
          weekday: number;
        },
  ): Promise<AvailabilitySnapshot> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const created = await transaction
        .withSchema('app')
        .insertInto('availability_windows')
        .values(
          input.type === 'slot'
            ? {
                coach_id: actor.coachId,
                slot_ends_at: input.endsAt,
                slot_starts_at: input.startsAt,
                tenant_id: actor.tenantId,
                timezone: input.timezone,
                window_type: 'slot',
              }
            : {
                coach_id: actor.coachId,
                local_ends_at: input.localEndsAt,
                local_starts_at: input.localStartsAt,
                tenant_id: actor.tenantId,
                timezone: input.timezone,
                weekday: input.weekday,
                window_type: 'weekly',
              },
        )
        .returningAll()
        .executeTakeFirstOrThrow();
      return availabilitySnapshot(created);
    });
  }

  async removeAvailability(actor: CoachOnboardingActor, availabilityId: string): Promise<boolean> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const updated = await transaction
        .withSchema('app')
        .updateTable('availability_windows')
        .set({ active: false, updated_at: sql`now()` })
        .where('id', '=', availabilityId)
        .where('coach_id', '=', actor.coachId)
        .where('active', '=', true)
        .returning('id')
        .executeTakeFirst();
      return updated !== undefined;
    });
  }

  async createAppointment(
    actor: CoachOnboardingActor,
    input: Parameters<CoachingLoopStore['createAppointment']>[1],
  ): Promise<AppointmentSnapshot | undefined> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const database = transaction.withSchema('app');
      if (input.relationshipId !== null) {
        const relationship = await database
          .selectFrom('coaching_relationships')
          .select('id')
          .where('id', '=', input.relationshipId)
          .where('coach_id', '=', actor.coachId)
          .where('status', '=', 'active')
          .where('archived_at', 'is', null)
          .executeTakeFirst();
        if (relationship === undefined) return undefined;
      } else {
        const group = await database
          .selectFrom('groups')
          .select('id')
          .where('id', '=', input.groupId)
          .where('coach_id', '=', actor.coachId)
          .where('archived_at', 'is', null)
          .executeTakeFirst();
        if (group === undefined) return undefined;
      }
      if (input.appointmentTypeId !== null) {
        const appointmentType = await database
          .selectFrom('appointment_types')
          .select('id')
          .where('id', '=', input.appointmentTypeId)
          .where('coach_id', '=', actor.coachId)
          .where('active', '=', true)
          .executeTakeFirst();
        if (appointmentType === undefined) return undefined;
      }
      const created = await database
        .insertInto('appointments')
        .values({
          appointment_type_id: input.appointmentTypeId,
          coach_id: actor.coachId,
          ends_at: input.endsAt,
          group_id: input.groupId,
          meeting_link: input.meetingLink,
          notes: input.notes,
          relationship_id: input.relationshipId,
          starts_at: input.startsAt,
          tenant_id: actor.tenantId,
          timezone: input.timezone,
          title: input.title,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await recordEvent(transaction, {
        action: 'coach.appointment.created',
        actorId: actor.userId,
        actorType: 'coach',
        entityId: created.id,
        entityType: 'appointment',
        metadata: { groupId: input.groupId, relationshipId: input.relationshipId },
        tenantId: actor.tenantId,
      });
      await this.notifyAppointment(transaction, created.id, 'created');
      const row = (await appointmentRows(transaction, actor.coachId)).find(
        (item) => item.id === created.id,
      );
      if (row === undefined) throw new Error('Created appointment could not be reloaded.');
      return appointmentSnapshot(row, 'coach');
    });
  }

  async updateAppointment(
    actor: CoachOnboardingActor,
    appointmentId: string,
    input: Parameters<CoachingLoopStore['updateAppointment']>[2],
  ): Promise<AppointmentSnapshot | undefined> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const database = transaction.withSchema('app');
      const current = await database
        .selectFrom('appointments')
        .selectAll()
        .where('id', '=', appointmentId)
        .where('coach_id', '=', actor.coachId)
        .executeTakeFirst();
      if (current === undefined || current.status === 'canceled') return undefined;
      const updated = await database
        .updateTable('appointments')
        .set(
          input.action === 'reschedule'
            ? {
                ends_at: input.endsAt,
                meeting_link: input.meetingLink,
                notes: input.notes,
                starts_at: input.startsAt,
                timezone: input.timezone,
                updated_at: sql`now()`,
              }
            : input.action === 'cancel'
              ? { canceled_at: sql`now()`, status: 'canceled', updated_at: sql`now()` }
              : { status: 'completed', updated_at: sql`now()` },
        )
        .where('id', '=', appointmentId)
        .returning('id')
        .executeTakeFirstOrThrow();
      const action =
        input.action === 'reschedule'
          ? 'coach.appointment.updated'
          : input.action === 'cancel'
            ? 'coach.appointment.cancelled'
            : 'coach.appointment.completed';
      await recordEvent(transaction, {
        action,
        actorId: actor.userId,
        actorType: 'coach',
        entityId: appointmentId,
        entityType: 'appointment',
        metadata: {
          previousEndsAt: current.ends_at.toISOString(),
          previousStartsAt: current.starts_at.toISOString(),
        },
        tenantId: actor.tenantId,
      });
      if (input.action !== 'complete') {
        await this.notifyAppointment(transaction, updated.id, input.action);
      }
      const row = (await appointmentRows(transaction, actor.coachId)).find(
        (item) => item.id === appointmentId,
      );
      return row === undefined ? undefined : appointmentSnapshot(row, 'coach');
    });
  }

  private async notifyAppointment(
    transaction: TenantTransaction,
    appointmentId: string,
    action: 'cancel' | 'created' | 'reschedule',
  ): Promise<void> {
    const database = transaction.withSchema('app');
    const appointment = await database
      .selectFrom('appointments as appointment')
      .innerJoin('coaches as coach', 'coach.id', 'appointment.coach_id')
      .innerJoin('users as coach_user', 'coach_user.id', 'coach.user_id')
      .select([
        'appointment.group_id',
        'appointment.relationship_id',
        'appointment.starts_at',
        'appointment.title',
        'coach_user.email as coach_email',
        'coach_user.name as coach_name',
      ])
      .where('appointment.id', '=', appointmentId)
      .executeTakeFirstOrThrow();
    const recipients =
      appointment.relationship_id !== null
        ? await database
            .selectFrom('coaching_relationships as relationship')
            .innerJoin('clients as client', 'client.id', 'relationship.client_id')
            .innerJoin('users as user', 'user.id', 'client.user_id')
            .select(['client.id', 'client.name', 'user.email'])
            .where('relationship.id', '=', appointment.relationship_id)
            .execute()
        : await database
            .selectFrom('group_memberships as membership')
            .innerJoin('clients as client', 'client.id', 'membership.client_id')
            .innerJoin('users as user', 'user.id', 'client.user_id')
            .select(['client.id', 'client.name', 'user.email'])
            .where('membership.group_id', '=', appointment.group_id)
            .execute();
    const verb =
      action === 'created' ? 'scheduled' : action === 'reschedule' ? 'rescheduled' : 'canceled';
    for (const recipient of recipients) {
      const home = new URL('/', this.config.clientAppBaseUrl).toString();
      await enqueueEmail(this.boss, transaction, {
        entityId: appointmentId,
        from: this.config.emailFrom,
        html: `<p>Hi ${escapeHtml(recipient.name)},</p><p>${escapeHtml(appointment.coach_name)} ${verb} ${escapeHtml(appointment.title)}.</p><p><a href="${home}">View your coaching space</a></p>`,
        notificationId: `appointment-${action}:${appointmentId}:${recipient.id}:${appointment.starts_at.toISOString()}`,
        recipientId: recipient.id,
        replyTo: appointment.coach_email,
        subject: `${appointment.coach_name} ${verb} a coaching session`,
        text: `${appointment.coach_name} ${verb} ${appointment.title}. View details: ${home}`,
        to: recipient.email,
      });
    }
  }

  private async notifyCoachOfClientBooking(
    transaction: TenantTransaction,
    appointmentId: string,
  ): Promise<void> {
    const booking = await transaction
      .withSchema('app')
      .selectFrom('appointments as appointment')
      .innerJoin(
        'coaching_relationships as relationship',
        'relationship.id',
        'appointment.relationship_id',
      )
      .innerJoin('clients as client', 'client.id', 'relationship.client_id')
      .innerJoin('users as client_user', 'client_user.id', 'client.user_id')
      .innerJoin('coaches as coach', 'coach.id', 'appointment.coach_id')
      .innerJoin('users as coach_user', 'coach_user.id', 'coach.user_id')
      .select([
        'appointment.starts_at',
        'appointment.title',
        'client.name as client_name',
        'client_user.email as client_email',
        'coach.id as coach_id',
        'coach_user.email as coach_email',
        'relationship.id as relationship_id',
      ])
      .where('appointment.id', '=', appointmentId)
      .executeTakeFirstOrThrow();
    const home = new URL(
      `/clients/${encodeURIComponent(booking.relationship_id)}`,
      this.config.coachAppBaseUrl,
    ).toString();
    await enqueueEmail(this.boss, transaction, {
      entityId: appointmentId,
      from: this.config.emailFrom,
      html: `<p>${escapeHtml(booking.client_name)} booked ${escapeHtml(booking.title)} for ${escapeHtml(booking.starts_at.toISOString())}.</p><p><a href="${home}">Open the client workspace</a></p>`,
      notificationId: `client-booked:${appointmentId}:${booking.starts_at.toISOString()}`,
      recipientId: booking.coach_id,
      replyTo: booking.client_email,
      subject: `${booking.client_name} booked a coaching session`,
      text: `${booking.client_name} booked ${booking.title} for ${booking.starts_at.toISOString()}. Open the client workspace: ${home}`,
      to: booking.coach_email,
    });
  }

  private async notifyCoachOfTaskCompletion(
    transaction: TenantTransaction,
    taskId: string,
  ): Promise<void> {
    const task = await transaction
      .withSchema('app')
      .selectFrom('tasks as task')
      .innerJoin(
        'coaching_relationships as relationship',
        'relationship.id',
        'task.relationship_id',
      )
      .innerJoin('clients as client', 'client.id', 'relationship.client_id')
      .innerJoin('coaches as coach', 'coach.id', 'relationship.coach_id')
      .innerJoin('users as coach_user', 'coach_user.id', 'coach.user_id')
      .select([
        'client.name as client_name',
        'coach.id as coach_id',
        'coach_user.email as coach_email',
        'relationship.id as relationship_id',
        'task.title',
      ])
      .where('task.id', '=', taskId)
      .executeTakeFirstOrThrow();
    const home = new URL(
      `/clients/${encodeURIComponent(task.relationship_id)}`,
      this.config.coachAppBaseUrl,
    ).toString();
    await enqueueEmail(this.boss, transaction, {
      entityId: taskId,
      from: this.config.emailFrom,
      html: `<p>${escapeHtml(task.client_name)} completed ${escapeHtml(task.title)}.</p><p><a href="${home}">Open the client workspace</a></p>`,
      notificationId: `task-completed:${taskId}`,
      recipientId: task.coach_id,
      subject: `${task.client_name} completed a coaching task`,
      text: `${task.client_name} completed ${task.title}. Open the client workspace: ${home}`,
      to: task.coach_email,
    });
  }

  async createTask(
    actor: CoachOnboardingActor,
    input: Parameters<CoachingLoopStore['createTask']>[1],
  ): Promise<TaskSnapshot | undefined> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const database = transaction.withSchema('app');
      const relationship = await database
        .selectFrom('coaching_relationships as relationship')
        .innerJoin('clients as client', 'client.id', 'relationship.client_id')
        .innerJoin('users as user', 'user.id', 'client.user_id')
        .select(['client.id as client_id', 'client.name', 'user.email'])
        .where('relationship.id', '=', input.relationshipId)
        .where('relationship.coach_id', '=', actor.coachId)
        .where('relationship.status', '=', 'active')
        .where('relationship.archived_at', 'is', null)
        .executeTakeFirst();
      if (relationship === undefined) return undefined;
      const created = await database
        .insertInto('tasks')
        .values({
          description: input.description,
          due_at: input.dueAt,
          relationship_id: input.relationshipId,
          tenant_id: actor.tenantId,
          title: input.title,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await recordEvent(transaction, {
        action: 'coach.task.assigned',
        actorId: actor.userId,
        actorType: 'coach',
        entityId: created.id,
        entityType: 'task',
        tenantId: actor.tenantId,
      });
      const home = new URL('/', this.config.clientAppBaseUrl).toString();
      await enqueueEmail(this.boss, transaction, {
        entityId: created.id,
        from: this.config.emailFrom,
        html: `<p>Hi ${escapeHtml(relationship.name)},</p><p>Your coach assigned a new task: ${escapeHtml(input.title)}.</p><p><a href="${home}">Open your coaching space</a></p>`,
        notificationId: `task-assigned:${created.id}`,
        recipientId: relationship.client_id,
        subject: `A new coaching task: ${input.title}`,
        text: `Your coach assigned a new task: ${input.title}. Open it: ${home}`,
        to: relationship.email,
      });
      const row = (await taskRows(transaction, input.relationshipId)).find(
        (item) => item.id === created.id,
      );
      if (row === undefined) throw new Error('Created task could not be reloaded.');
      return taskSnapshot(row);
    });
  }

  async updateTask(
    actor: CoachOnboardingActor,
    taskId: string,
    input: { action: 'cancel' | 'reopen' },
  ): Promise<TaskSnapshot | undefined> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const updated = await transaction
        .withSchema('app')
        .updateTable('tasks as task')
        .from('coaching_relationships as relationship')
        .set({
          completed_at: null,
          status: input.action === 'cancel' ? 'canceled' : 'assigned',
          updated_at: sql`now()`,
        })
        .whereRef('relationship.id', '=', 'task.relationship_id')
        .where('relationship.coach_id', '=', actor.coachId)
        .where('task.id', '=', taskId)
        .returning('task.relationship_id')
        .executeTakeFirst();
      if (updated === undefined) return undefined;
      const row = (await taskRows(transaction, updated.relationship_id)).find(
        (item) => item.id === taskId,
      );
      return row === undefined ? undefined : taskSnapshot(row);
    });
  }

  async createGroup(
    actor: CoachOnboardingActor,
    input: { description: string | null; name: string },
  ): Promise<GroupSnapshot> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const created = await transaction
        .withSchema('app')
        .insertInto('groups')
        .values({
          coach_id: actor.coachId,
          description: input.description,
          name: input.name,
          tenant_id: actor.tenantId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return (await groupSnapshot(transaction, created.id))!;
    });
  }

  async updateGroup(
    actor: CoachOnboardingActor,
    groupId: string,
    input: { archived: boolean; description: string | null; name: string },
  ): Promise<GroupSnapshot | undefined> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const updated = await transaction
        .withSchema('app')
        .updateTable('groups')
        .set({
          archived_at: input.archived ? sql`now()` : null,
          description: input.description,
          name: input.name,
          updated_at: sql`now()`,
        })
        .where('id', '=', groupId)
        .where('coach_id', '=', actor.coachId)
        .returning('id')
        .executeTakeFirst();
      return updated === undefined ? undefined : groupSnapshot(transaction, groupId);
    });
  }

  async addGroupMember(
    actor: CoachOnboardingActor,
    groupId: string,
    clientId: string,
  ): Promise<GroupSnapshot | undefined> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const database = transaction.withSchema('app');
      const group = await database
        .selectFrom('groups')
        .select('id')
        .where('id', '=', groupId)
        .where('coach_id', '=', actor.coachId)
        .where('archived_at', 'is', null)
        .executeTakeFirst();
      const relationship = await database
        .selectFrom('coaching_relationships')
        .select('id')
        .where('coach_id', '=', actor.coachId)
        .where('client_id', '=', clientId)
        .where('status', '=', 'active')
        .where('archived_at', 'is', null)
        .executeTakeFirst();
      if (group === undefined || relationship === undefined) return undefined;
      await database
        .insertInto('group_memberships')
        .values({
          client_id: clientId,
          coach_id: actor.coachId,
          group_id: groupId,
          tenant_id: actor.tenantId,
        })
        .onConflict((conflict) => conflict.columns(['group_id', 'client_id']).doNothing())
        .execute();
      return groupSnapshot(transaction, groupId);
    });
  }

  async removeGroupMember(
    actor: CoachOnboardingActor,
    groupId: string,
    clientId: string,
  ): Promise<GroupSnapshot | undefined> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const deleted = await transaction
        .withSchema('app')
        .deleteFrom('group_memberships')
        .where('group_id', '=', groupId)
        .where('client_id', '=', clientId)
        .returning('id')
        .executeTakeFirst();
      return deleted === undefined ? undefined : groupSnapshot(transaction, groupId);
    });
  }

  async getClientHome(actor: ClientOnboardingActor): Promise<ClientHomeSnapshot> {
    const scopes = await clientRelationshipScopes(this.database, actor);
    const relationships: ClientRelationshipHome[] = [];
    const appointments: AppointmentSnapshot[] = [];
    const tasks: TaskSnapshot[] = [];
    for (const scope of scopes) {
      await withTenantContext(
        this.database,
        clientContext(actor, scope.tenantId),
        async (transaction) => {
          const database = transaction.withSchema('app');
          const relationship = await database
            .selectFrom('coaching_relationships as relationship')
            .innerJoin('coaches as coach', 'coach.id', 'relationship.coach_id')
            .innerJoin('users as coach_user', 'coach_user.id', 'coach.user_id')
            .innerJoin('tenants as tenant', 'tenant.id', 'relationship.tenant_id')
            .select(['coach_user.name as coach_name', 'relationship.coach_id', 'tenant.name'])
            .where('relationship.id', '=', scope.id)
            .executeTakeFirstOrThrow();
          const slots = await database
            .selectFrom('availability_windows as availability')
            .selectAll()
            .where('availability.coach_id', '=', relationship.coach_id)
            .where('availability.window_type', '=', 'slot')
            .where('availability.active', '=', true)
            .where('availability.slot_starts_at', '>', new Date())
            .where((builder) =>
              builder.not(
                builder.exists(
                  builder
                    .selectFrom('booking_holds as hold')
                    .select('hold.id')
                    .whereRef('hold.availability_window_id', '=', 'availability.id')
                    .where('hold.status', '=', 'active')
                    .where('hold.expires_at', '>', new Date()),
                ),
              ),
            )
            .orderBy('availability.slot_starts_at')
            .execute();
          const appointmentTypes = await database
            .selectFrom('appointment_types')
            .selectAll()
            .where('coach_id', '=', relationship.coach_id)
            .where('active', '=', true)
            .where('self_bookable', '=', true)
            .orderBy('name')
            .execute();
          relationships.push({
            appointmentTypes: appointmentTypes.map(appointmentTypeSnapshot),
            availableSlots: slots.map(availabilitySnapshot),
            coach: { name: relationship.coach_name, practiceName: relationship.name },
            id: scope.id,
          });
          appointments.push(
            ...(await appointmentRows(transaction))
              .filter(
                (row) =>
                  row.relationship_id === scope.id ||
                  (row.group_id !== null && row.starts_at > new Date()),
              )
              .map((row) => appointmentSnapshot(row, 'client')),
          );
          tasks.push(...(await taskRows(transaction, scope.id)).map(taskSnapshot));
        },
      );
    }
    const uniqueAppointments = [
      ...new Map(appointments.map((appointment) => [appointment.id, appointment])).values(),
    ].sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
    const assignedTasks = tasks.filter((task) => task.status === 'assigned');
    const now = Date.now();
    const imminent = uniqueAppointments.find(
      (appointment) =>
        appointment.startsAt.getTime() >= now &&
        appointment.startsAt.getTime() - now <= 48 * 60 * 60 * 1000 &&
        appointment.status !== 'canceled',
    );
    const future = uniqueAppointments.find(
      (appointment) => appointment.startsAt.getTime() >= now && appointment.status !== 'canceled',
    );
    return {
      appointments: uniqueAppointments,
      nextAction:
        imminent !== undefined
          ? {
              appointmentId: imminent.id,
              kind: 'appointment',
              startsAt: imminent.startsAt,
              title: imminent.title,
            }
          : assignedTasks[0] !== undefined
            ? { kind: 'task', taskId: assignedTasks[0].id, title: assignedTasks[0].title }
            : future !== undefined
              ? {
                  appointmentId: future.id,
                  kind: 'appointment',
                  startsAt: future.startsAt,
                  title: future.title,
                }
              : { kind: 'waiting', message: 'Your coach is preparing your next step.' },
      relationships,
      tasks,
    };
  }

  async createClientBookingHold(
    actor: ClientOnboardingActor,
    input: { availabilityId: string; relationshipId: string },
  ): Promise<BookingHoldSnapshot | undefined> {
    const scope = await relationshipScope(this.database, actor, input.relationshipId);
    if (scope === undefined) return undefined;
    return withTenantContext(
      this.database,
      clientContext(actor, scope.tenantId),
      async (transaction) => {
        const database = transaction.withSchema('app');
        const slot = await database
          .selectFrom('availability_windows as availability')
          .innerJoin(
            'coaching_relationships as relationship',
            'relationship.coach_id',
            'availability.coach_id',
          )
          .select(['availability.slot_ends_at', 'availability.slot_starts_at'])
          .where('availability.id', '=', input.availabilityId)
          .where('availability.window_type', '=', 'slot')
          .where('availability.active', '=', true)
          .where('availability.slot_starts_at', '>', new Date())
          .where('relationship.id', '=', input.relationshipId)
          .where('relationship.client_id', '=', actor.clientId)
          .executeTakeFirst();
        if (slot?.slot_starts_at === null || slot?.slot_ends_at === null || slot === undefined) {
          return undefined;
        }
        await database
          .updateTable('booking_holds')
          .set({ status: 'expired', updated_at: sql`now()` })
          .where('availability_window_id', '=', input.availabilityId)
          .where('status', '=', 'active')
          .where('expires_at', '<=', new Date())
          .execute();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        const created = await database
          .insertInto('booking_holds')
          .values({
            availability_window_id: input.availabilityId,
            client_id: actor.clientId,
            ends_at: slot.slot_ends_at,
            expires_at: expiresAt,
            starts_at: slot.slot_starts_at,
            tenant_id: scope.tenantId,
          })
          .returning(['ends_at', 'expires_at', 'id', 'starts_at'])
          .executeTakeFirstOrThrow();
        return {
          endsAt: created.ends_at,
          expiresAt: created.expires_at,
          id: created.id,
          relationshipId: input.relationshipId,
          startsAt: created.starts_at,
        };
      },
    );
  }

  async confirmClientBooking(
    actor: ClientOnboardingActor,
    input: { appointmentTypeId: string; holdId: string; relationshipId: string },
  ): Promise<AppointmentSnapshot | undefined> {
    const scope = await relationshipScope(this.database, actor, input.relationshipId);
    if (scope === undefined) return undefined;
    return withTenantContext(
      this.database,
      clientContext(actor, scope.tenantId),
      async (transaction) => {
        const database = transaction.withSchema('app');
        const hold = await database
          .selectFrom('booking_holds as hold')
          .innerJoin(
            'availability_windows as availability',
            'availability.id',
            'hold.availability_window_id',
          )
          .innerJoin(
            'coaching_relationships as relationship',
            'relationship.coach_id',
            'availability.coach_id',
          )
          .innerJoin('appointment_types as type', 'type.coach_id', 'availability.coach_id')
          .select([
            'availability.timezone',
            'hold.ends_at',
            'hold.starts_at',
            'relationship.coach_id',
            'type.name as type_name',
          ])
          .where('hold.id', '=', input.holdId)
          .where('hold.client_id', '=', actor.clientId)
          .where('hold.status', '=', 'active')
          .where('hold.expires_at', '>', new Date())
          .where('relationship.id', '=', input.relationshipId)
          .where('relationship.client_id', '=', actor.clientId)
          .where('type.id', '=', input.appointmentTypeId)
          .where('type.self_bookable', '=', true)
          .where('type.active', '=', true)
          .executeTakeFirst();
        if (hold === undefined) return undefined;
        await database
          .updateTable('booking_holds')
          .set({ status: 'converted', updated_at: sql`now()` })
          .where('id', '=', input.holdId)
          .where('status', '=', 'active')
          .executeTakeFirstOrThrow();
        const created = await database
          .insertInto('appointments')
          .values({
            appointment_type_id: input.appointmentTypeId,
            booked_by_client_id: actor.clientId,
            booking_hold_id: input.holdId,
            coach_id: hold.coach_id,
            ends_at: hold.ends_at,
            relationship_id: input.relationshipId,
            starts_at: hold.starts_at,
            status: 'booked',
            tenant_id: scope.tenantId,
            timezone: hold.timezone,
            title: hold.type_name,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await recordEvent(transaction, {
          action: 'client.appointment.booked',
          actorId: actor.userId,
          actorType: 'client',
          entityId: created.id,
          entityType: 'appointment',
          metadata: { holdId: input.holdId },
          tenantId: scope.tenantId,
        });
        await this.notifyAppointment(transaction, created.id, 'created');
        await this.notifyCoachOfClientBooking(transaction, created.id);
        const row = (await appointmentRows(transaction)).find((item) => item.id === created.id);
        return row === undefined ? undefined : appointmentSnapshot(row, 'client');
      },
    );
  }

  async releaseClientBookingHold(actor: ClientOnboardingActor, holdId: string): Promise<boolean> {
    for (const scope of await clientRelationshipScopes(this.database, actor)) {
      const released = await withTenantContext(
        this.database,
        clientContext(actor, scope.tenantId),
        async (transaction) => {
          const updated = await transaction
            .withSchema('app')
            .updateTable('booking_holds')
            .set({ status: 'released', updated_at: sql`now()` })
            .where('id', '=', holdId)
            .where('client_id', '=', actor.clientId)
            .where('status', '=', 'active')
            .returning('id')
            .executeTakeFirst();
          return updated !== undefined;
        },
      );
      if (released) return true;
    }
    return false;
  }

  async completeClientTask(
    actor: ClientOnboardingActor,
    taskId: string,
  ): Promise<TaskSnapshot | undefined> {
    for (const scope of await clientRelationshipScopes(this.database, actor)) {
      const task = await withTenantContext(
        this.database,
        clientContext(actor, scope.tenantId),
        async (transaction) => {
          const updated = await transaction
            .withSchema('app')
            .updateTable('tasks')
            .set({ completed_at: sql`now()`, status: 'completed', updated_at: sql`now()` })
            .where('id', '=', taskId)
            .where('relationship_id', '=', scope.id)
            .where('status', '=', 'assigned')
            .returning('id')
            .executeTakeFirst();
          if (updated === undefined) return undefined;
          await recordEvent(transaction, {
            action: 'client.task.completed',
            actorId: actor.userId,
            actorType: 'client',
            entityId: taskId,
            entityType: 'task',
            tenantId: scope.tenantId,
          });
          await this.notifyCoachOfTaskCompletion(transaction, taskId);
          const row = (await taskRows(transaction, scope.id)).find((item) => item.id === taskId);
          return row === undefined ? undefined : taskSnapshot(row);
        },
      );
      if (task !== undefined) return task;
    }
    return undefined;
  }

  async getClientAppointment(
    actor: ClientOnboardingActor,
    appointmentId: string,
  ): Promise<AppointmentSnapshot | undefined> {
    for (const scope of await clientRelationshipScopes(this.database, actor)) {
      const appointment = await withTenantContext(
        this.database,
        clientContext(actor, scope.tenantId),
        async (transaction) => {
          const row = (await appointmentRows(transaction)).find(
            (item) => item.id === appointmentId,
          );
          return row === undefined ? undefined : appointmentSnapshot(row, 'client');
        },
      );
      if (appointment !== undefined) return appointment;
    }
    return undefined;
  }
}
