import {
  destroyPlaintextKey,
  encryptString,
  type JsonValue,
  type KmsCommandClient,
  type TenantTransaction,
  type TraverseDatabaseClient,
  unwrapTenantDataKey,
  withTenantContext,
} from '@traverse/db';
import { createTransactionalJobDispatcher, QUEUES, type EmailDeliveryJob } from '@traverse/jobs';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import type {
  AcceptInviteResult,
  ClientOnboardingActor,
  ClientOnboardingStore,
  CoachContractSnapshot,
  CoachOnboardingActor,
  InviteOptions,
  InvitePreview,
  InviteSummary,
  OnboardingGateConfig,
  OnboardingSnapshot,
} from './client-onboarding.service.js';
import { asJsonGates } from './client-onboarding.service.js';
import {
  STARTER_AGREEMENT_NAME,
  shouldProvisionStarterAgreement,
  starterAgreement,
} from './starter-agreement.js';

interface JobBossSender {
  send(name: string, data?: object | null, options?: object): Promise<string | null>;
  stop(options: { close: boolean }): Promise<void>;
}

interface IntakeEncryptionInput {
  answers: Record<string, string>;
  keyVersion: number;
  kmsKeyId: string;
  responseId: string;
  tenantId: string;
  wrappedDataKey: Buffer;
}

export interface IntakeAnswerEncryptor {
  encrypt(input: IntakeEncryptionInput): Promise<Buffer>;
}

export class KmsIntakeAnswerEncryptor implements IntakeAnswerEncryptor {
  constructor(private readonly kms: KmsCommandClient) {}

  async encrypt(input: IntakeEncryptionInput): Promise<Buffer> {
    const unwrapped = await unwrapTenantDataKey(
      this.kms,
      input.kmsKeyId,
      input.tenantId,
      input.keyVersion,
      input.wrappedDataKey,
    );
    try {
      return encryptString(JSON.stringify(input.answers), unwrapped.plaintextKey, {
        field: 'answers_enc',
        keyVersion: unwrapped.keyVersion,
        rowId: input.responseId,
        table: 'intake_responses',
        tenantId: input.tenantId,
      });
    } finally {
      destroyPlaintextKey(unwrapped.plaintextKey);
    }
  }
}

interface StoreConfig {
  clientAppBaseUrl: string;
  coachAppBaseUrl: string;
  emailFrom: string;
}

interface ResolvedInvite {
  client_id: string;
  invite_id: string;
  relationship_id: string;
  tenant_id: string;
  user_id: string;
}

type InviteScope = Pick<ResolvedInvite, 'invite_id' | 'relationship_id' | 'tenant_id'>;

const STARTER_INTAKE_NAME = 'Traverse Starter Intake';
const STARTER_INTAKE_SCHEMA: JsonValue = {
  fields: [
    {
      id: 'coaching_goals',
      label: 'What would you most like to work on through coaching?',
      required: true,
      type: 'long_text',
    },
    {
      id: 'desired_change',
      label: 'What would meaningful progress look like for you?',
      required: true,
      type: 'long_text',
    },
    {
      id: 'anything_else',
      label: 'Is there anything else you would like your coach to know?',
      required: false,
      type: 'long_text',
    },
  ],
};

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

function record(value: JsonValue): Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function boolean(value: JsonValue | undefined, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function number(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

function numberList(value: JsonValue | undefined, fallback: number[]): number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number')
    ? (value as number[])
    : fallback;
}

function gateConfig(value: JsonValue): OnboardingGateConfig {
  const gates = record(value);
  const contractRequired = boolean(gates.contractRequired, true);
  return {
    contractRequired,
    countersignatureRequired: contractRequired && boolean(gates.countersignatureRequired, false),
    intakeRequired: boolean(gates.intakeRequired, true),
    paymentRequired: false,
  };
}

export function determineOnboardingState(input: {
  clientSigned: boolean;
  coachSigned: boolean;
  gates: OnboardingGateConfig;
  intakeSubmitted: boolean;
}): 'active' | 'contract_pending' | 'countersignature_pending' | 'intake_pending' {
  if (input.gates.contractRequired && !input.clientSigned) return 'contract_pending';
  if (input.gates.countersignatureRequired && !input.coachSigned) {
    return 'countersignature_pending';
  }
  if (input.gates.intakeRequired && !input.intakeSubmitted) return 'intake_pending';
  return 'active';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function inviteStatus(row: { accepted_at: Date | null; revoked_at: Date | null }): 'invited' {
  if (row.accepted_at !== null || row.revoked_at !== null) {
    throw new Error('Invitation is no longer active.');
  }
  return 'invited';
}

function invitationJob(input: {
  clientName: string;
  coachEmail: string;
  coachName: string;
  email: string;
  from: string;
  inviteId: string;
  practiceName: string;
  rawToken: string;
  sendCount: number;
  urlBase: string;
  welcomeMessage: string;
}): EmailDeliveryJob {
  const inviteUrl = new URL('/onboarding', input.urlBase);
  inviteUrl.searchParams.set('token', input.rawToken);
  const safeClient = escapeHtml(input.clientName);
  const safeCoach = escapeHtml(input.coachName);
  const safePractice = escapeHtml(input.practiceName);
  const safeMessage = escapeHtml(input.welcomeMessage);
  return {
    entityId: input.inviteId,
    from: input.from,
    html: `<p>Hi ${safeClient},</p><p>${safeCoach} from ${safePractice} has invited you to begin coaching.</p><p>${safeMessage}</p><p><a href="${inviteUrl.toString()}">Begin your coaching setup</a></p><p>This secure invitation expires automatically.</p>`,
    notificationId: `client-invite:${input.inviteId}:${input.sendCount}`,
    recipientId: input.inviteId,
    replyTo: input.coachEmail,
    subject: `${input.coachName} has invited you to begin coaching`,
    text: `Hi ${input.clientName}, ${input.coachName} from ${input.practiceName} has invited you to begin coaching. ${input.welcomeMessage} Begin securely: ${inviteUrl.toString()}`,
    to: input.email,
  };
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

async function setResolvedInviteContext(
  transaction: TenantTransaction,
  tokenHash: Buffer,
): Promise<ResolvedInvite | undefined> {
  await sql`
    SELECT set_config('app.invite_token_hash', ${tokenHash.toString('hex')}, true)
  `.execute(transaction);
  const resolved = await sql<InviteScope>`
    SELECT * FROM app.resolve_client_invite(${tokenHash})
  `.execute(transaction);
  const invite = resolved.rows[0];
  if (invite === undefined) return undefined;
  await sql`
    SELECT
      set_config('app.tenant_id', ${invite.tenant_id}, true),
      set_config('app.actor_id', '', true),
      set_config('app.role', 'admin', true),
      set_config('app.coach_id', '', true),
      set_config('app.client_id', '', true),
      set_config('app.practice_role', '', true)
  `.execute(transaction);
  const subject = await transaction
    .withSchema('app')
    .selectFrom('coaching_relationships as relationship')
    .innerJoin('clients as client', 'client.id', 'relationship.client_id')
    .select(['client.id as client_id', 'client.user_id'])
    .where('relationship.id', '=', invite.relationship_id)
    .executeTakeFirst();
  if (subject === undefined) return undefined;
  await sql`
    SELECT
      set_config('app.actor_id', ${subject.user_id}, true),
      set_config('app.client_id', ${subject.client_id}, true)
  `.execute(transaction);
  return { ...invite, ...subject };
}

async function relationshipTenant(
  database: TraverseDatabaseClient,
  actor: ClientOnboardingActor,
  relationshipId: string,
): Promise<string | undefined> {
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
    const result = await sql<{ tenant_id: string | null }>`
      SELECT app.client_relationship_tenant(${relationshipId}, ${actor.clientId}) AS tenant_id
    `.execute(transaction);
    return result.rows[0]?.tenant_id ?? undefined;
  });
}

function parseFields(value: JsonValue): NonNullable<OnboardingSnapshot['intake']>['fields'] {
  const fields = record(value).fields;
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((field) => {
    const candidate = record(field);
    if (typeof candidate.id !== 'string' || typeof candidate.label !== 'string') return [];
    return [
      {
        id: candidate.id,
        label: candidate.label,
        required: candidate.required === true,
        type: candidate.type === 'short_text' ? ('short_text' as const) : ('long_text' as const),
      },
    ];
  });
}

async function onboardingSnapshot(
  transaction: TenantTransaction,
  relationshipId: string,
): Promise<OnboardingSnapshot | undefined> {
  const database = transaction.withSchema('app');
  const relationship = await database
    .selectFrom('coaching_relationships as relationship')
    .innerJoin('coaches as coach', 'coach.id', 'relationship.coach_id')
    .innerJoin('users as coach_user', 'coach_user.id', 'coach.user_id')
    .innerJoin('tenants as tenant', 'tenant.id', 'relationship.tenant_id')
    .select([
      'relationship.gate_config',
      'relationship.id',
      'relationship.onboarding_state',
      'tenant.name as practice_name',
      'coach_user.name as coach_name',
    ])
    .where('relationship.id', '=', relationshipId)
    .executeTakeFirst();
  if (relationship === undefined) return undefined;

  const contract = await database
    .selectFrom('contract_instances as instance')
    .leftJoin('contract_templates as template', 'template.id', 'instance.template_id')
    .select(['instance.id', 'instance.signed_snapshot', 'template.name'])
    .where('instance.relationship_id', '=', relationshipId)
    .executeTakeFirst();
  const signatures =
    contract === undefined
      ? []
      : await database
          .selectFrom('contract_signatures')
          .select('signer_role')
          .where('contract_instance_id', '=', contract.id)
          .execute();
  const intake = await database
    .selectFrom('intake_forms as form')
    .innerJoin('coaching_relationships as relationship', 'relationship.intake_form_id', 'form.id')
    .leftJoin('intake_responses as response', (join) =>
      join
        .onRef('response.relationship_id', '=', 'relationship.id')
        .onRef('response.intake_form_id', '=', 'form.id'),
    )
    .select(['form.form_schema', 'form.id', 'form.name', 'response.submitted_at'])
    .where('relationship.id', '=', relationshipId)
    .executeTakeFirst();

  return {
    coach: { name: relationship.coach_name, practiceName: relationship.practice_name },
    contract:
      contract === undefined
        ? null
        : {
            body: contract.signed_snapshot,
            clientSigned: signatures.some((signature) => signature.signer_role === 'client'),
            coachSigned: signatures.some((signature) => signature.signer_role === 'coach'),
            id: contract.id,
            name: contract.name ?? 'Coaching agreement',
          },
    gates: gateConfig(relationship.gate_config),
    intake:
      intake === undefined
        ? null
        : {
            fields: parseFields(intake.form_schema),
            id: intake.id,
            name: intake.name,
            submitted: intake.submitted_at !== null,
          },
    relationshipId: relationship.id,
    state: relationship.onboarding_state,
  };
}

async function advanceOnboarding(
  transaction: TenantTransaction,
  relationshipId: string,
  boss: JobBossSender,
  config: StoreConfig,
): Promise<void> {
  const database = transaction.withSchema('app');
  const relationship = await database
    .selectFrom('coaching_relationships as relationship')
    .innerJoin('clients as client', 'client.id', 'relationship.client_id')
    .innerJoin('users as client_user', 'client_user.id', 'client.user_id')
    .innerJoin('coaches as coach', 'coach.id', 'relationship.coach_id')
    .innerJoin('users as coach_user', 'coach_user.id', 'coach.user_id')
    .innerJoin('tenants as tenant', 'tenant.id', 'relationship.tenant_id')
    .select([
      'relationship.gate_config',
      'relationship.onboarding_state',
      'relationship.tenant_id',
      'client_user.email as client_email',
      'client_user.name as client_name',
      'coach_user.email as coach_email',
      'coach_user.name as coach_name',
      'tenant.name as practice_name',
    ])
    .where('relationship.id', '=', relationshipId)
    .executeTakeFirstOrThrow();
  const gates = gateConfig(relationship.gate_config);
  const contract = await database
    .selectFrom('contract_instances')
    .select('id')
    .where('relationship_id', '=', relationshipId)
    .executeTakeFirst();
  const signatures =
    contract === undefined
      ? []
      : await database
          .selectFrom('contract_signatures')
          .select('signer_role')
          .where('contract_instance_id', '=', contract.id)
          .execute();
  const intake = await database
    .selectFrom('intake_responses')
    .select('submitted_at')
    .where('relationship_id', '=', relationshipId)
    .executeTakeFirst();

  const nextState = determineOnboardingState({
    clientSigned: signatures.some((item) => item.signer_role === 'client'),
    coachSigned: signatures.some((item) => item.signer_role === 'coach'),
    gates,
    intakeSubmitted: intake?.submitted_at != null,
  });

  await database
    .updateTable('coaching_relationships')
    .set({
      onboarding_state: nextState,
      status: nextState === 'active' ? 'active' : 'onboarding',
      updated_at: sql`now()`,
    })
    .where('id', '=', relationshipId)
    .executeTakeFirstOrThrow();

  if (
    nextState === 'countersignature_pending' &&
    relationship.onboarding_state !== 'countersignature_pending' &&
    contract !== undefined
  ) {
    const signatureUrl = new URL(
      `/contracts/${encodeURIComponent(contract.id)}/sign`,
      config.coachAppBaseUrl,
    );
    await enqueueEmail(boss, transaction, {
      entityId: contract.id,
      from: config.emailFrom,
      html: `<p>${escapeHtml(relationship.client_name)} has signed the coaching agreement.</p><p><a href="${signatureUrl.toString()}">Review and countersign the agreement</a></p>`,
      notificationId: `coach-contract-countersign:${contract.id}`,
      recipientId: relationshipId,
      subject: `${relationship.client_name} signed the coaching agreement`,
      text: `${relationship.client_name} signed the coaching agreement. Review and countersign: ${signatureUrl.toString()}`,
      to: relationship.coach_email,
    });
  }

  if (nextState === 'active' && relationship.onboarding_state !== 'active') {
    const clientJob: EmailDeliveryJob = {
      entityId: relationshipId,
      from: config.emailFrom,
      html: `<p>Hi ${escapeHtml(relationship.client_name)},</p><p>Your coaching space with ${escapeHtml(relationship.coach_name)} is ready.</p>`,
      notificationId: `client-onboarding-complete:${relationshipId}`,
      recipientId: relationshipId,
      replyTo: relationship.coach_email,
      subject: 'Your coaching space is ready',
      text: `Hi ${relationship.client_name}, your coaching space with ${relationship.coach_name} is ready.`,
      to: relationship.client_email,
    };
    const coachJob: EmailDeliveryJob = {
      entityId: relationshipId,
      from: config.emailFrom,
      html: `<p>${escapeHtml(relationship.client_name)} has completed onboarding.</p>`,
      notificationId: `coach-client-onboarding-complete:${relationshipId}`,
      recipientId: relationshipId,
      subject: `${relationship.client_name} completed onboarding`,
      text: `${relationship.client_name} has completed onboarding for ${relationship.practice_name}.`,
      to: relationship.coach_email,
    };
    await enqueueEmail(boss, transaction, clientJob);
    await enqueueEmail(boss, transaction, coachJob);
  }
}

export class DatabaseClientOnboardingStore implements ClientOnboardingStore {
  constructor(
    private readonly database: TraverseDatabaseClient,
    private readonly boss: JobBossSender,
    private readonly encryptor: IntakeAnswerEncryptor,
    private readonly config: StoreConfig,
  ) {}

  async close(): Promise<void> {
    await this.boss.stop({ close: true });
  }

  async getInviteOptions(actor: CoachOnboardingActor): Promise<InviteOptions> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const database = transaction.withSchema('app');
      const tenant = await database
        .selectFrom('tenants')
        .select(['onboarding_defaults', 'policy_defaults'])
        .where('id', '=', actor.tenantId)
        .executeTakeFirstOrThrow();
      let forms = await database
        .selectFrom('intake_forms')
        .select(['id', 'name', 'version'])
        .where('coach_id', '=', actor.coachId)
        .where('active', '=', true)
        .orderBy('name')
        .execute();
      if (forms.length === 0) {
        const created = await database
          .insertInto('intake_forms')
          .values({
            coach_id: actor.coachId,
            form_schema: STARTER_INTAKE_SCHEMA,
            name: STARTER_INTAKE_NAME,
            tenant_id: actor.tenantId,
          })
          .returning(['id', 'name', 'version'])
          .executeTakeFirstOrThrow();
        forms = [created];
      }
      let templates = await database
        .selectFrom('contract_templates')
        .select(['id', 'name', 'version'])
        .where('coach_id', '=', actor.coachId)
        .where('active', '=', true)
        .orderBy('name')
        .execute();
      const defaults = record(tenant.onboarding_defaults);
      const policies = record(tenant.policy_defaults);
      const defaultsGates = gateConfig(tenant.onboarding_defaults);
      if (
        templates.length === 0 &&
        shouldProvisionStarterAgreement(defaultsGates.contractRequired)
      ) {
        const created = await database
          .insertInto('contract_templates')
          .values({
            body: starterAgreement({
              cancellationNoticeHours: number(policies.cancellationNoticeHours, 24),
              cancellationSummary:
                typeof policies.cancellationSummary === 'string'
                  ? policies.cancellationSummary
                  : '',
              refundPolicy:
                policies.refundPolicy === 'flexible' || policies.refundPolicy === 'strict'
                  ? policies.refundPolicy
                  : 'standard',
            }),
            coach_id: actor.coachId,
            name: STARTER_AGREEMENT_NAME,
            tenant_id: actor.tenantId,
          })
          .returning(['id', 'name', 'version'])
          .executeTakeFirstOrThrow();
        templates = [created];
      }
      return {
        defaults: {
          ...defaultsGates,
          inviteExpiryDays: number(defaults.inviteExpiryDays, 14),
          reminderCadenceDays: numberList(defaults.reminderCadenceDays, [3, 7]),
        },
        forms,
        templates,
      };
    });
  }

  async getCoachContract(
    actor: CoachOnboardingActor,
    contractId: string,
  ): Promise<CoachContractSnapshot | undefined> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const database = transaction.withSchema('app');
      const contract = await database
        .selectFrom('contract_instances as instance')
        .innerJoin(
          'coaching_relationships as relationship',
          'relationship.id',
          'instance.relationship_id',
        )
        .innerJoin('clients as client', 'client.id', 'relationship.client_id')
        .leftJoin('contract_templates as template', 'template.id', 'instance.template_id')
        .select([
          'client.name as client_name',
          'instance.id',
          'instance.relationship_id',
          'instance.signed_snapshot',
          'relationship.onboarding_state',
          'template.name',
        ])
        .where('instance.id', '=', contractId)
        .where('relationship.coach_id', '=', actor.coachId)
        .executeTakeFirst();
      if (contract === undefined) return undefined;
      const signatures = await database
        .selectFrom('contract_signatures')
        .select('signer_role')
        .where('contract_instance_id', '=', contract.id)
        .execute();
      return {
        body: contract.signed_snapshot,
        clientName: contract.client_name,
        clientSigned: signatures.some((signature) => signature.signer_role === 'client'),
        coachSigned: signatures.some((signature) => signature.signer_role === 'coach'),
        id: contract.id,
        name: contract.name ?? 'Coaching agreement',
        relationshipId: contract.relationship_id,
        state: contract.onboarding_state,
      };
    });
  }

  async createInvite(input: Parameters<ClientOnboardingStore['createInvite']>[0]) {
    return withTenantContext(this.database, coachContext(input.actor), async (transaction) => {
      const database = transaction.withSchema('app');
      const coach = await database
        .selectFrom('coaches as coach')
        .innerJoin('users as user', 'user.id', 'coach.user_id')
        .innerJoin('tenants as tenant', 'tenant.id', 'coach.tenant_id')
        .select([
          'user.email as coach_email',
          'user.name as coach_name',
          'tenant.message_templates',
          'tenant.name as practice_name',
        ])
        .where('coach.id', '=', input.actor.coachId)
        .executeTakeFirstOrThrow();
      const existingInvite = await database
        .selectFrom('client_invites')
        .select(['expires_at', 'id', 'relationship_id'])
        .where('coach_id', '=', input.actor.coachId)
        .where('email', '=', input.email)
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .where('declined_at', 'is', null)
        .executeTakeFirst();
      if (existingInvite !== undefined) {
        if (existingInvite.expires_at > new Date()) {
          const conflict = new Error('Active invitation exists.') as Error & { code: string };
          conflict.code = '23505';
          throw conflict;
        }
        await database
          .updateTable('client_invites')
          .set({ revoked_at: sql`now()`, updated_at: sql`now()` })
          .where('id', '=', existingInvite.id)
          .executeTakeFirstOrThrow();
        if (existingInvite.relationship_id !== null) {
          await database
            .updateTable('coaching_relationships')
            .set({
              archived_at: sql`now()`,
              onboarding_state: 'revoked',
              status: 'revoked',
              updated_at: sql`now()`,
            })
            .where('id', '=', existingInvite.relationship_id)
            .executeTakeFirstOrThrow();
        }
      }

      let user = await database
        .selectFrom('users')
        .select(['id', 'name'])
        .where('email', '=', input.email)
        .executeTakeFirst();
      if (user === undefined) {
        user = await database
          .insertInto('users')
          .values({
            email: input.email,
            name: input.clientName,
            password_hash: null,
            status: 'invited',
          })
          .returning(['id', 'name'])
          .executeTakeFirstOrThrow();
      }
      let client = await database
        .selectFrom('clients')
        .select('id')
        .where('user_id', '=', user.id)
        .executeTakeFirst();
      if (client === undefined) {
        client = await database
          .insertInto('clients')
          .values({ name: input.clientName, phone: input.phone, user_id: user.id })
          .returning('id')
          .executeTakeFirstOrThrow();
      }
      const importedRelationship = await database
        .selectFrom('coaching_relationships')
        .select('id')
        .where('coach_id', '=', input.actor.coachId)
        .where('client_id', '=', client.id)
        .where('archived_at', 'is', null)
        .where('onboarding_state', '=', 'imported')
        .executeTakeFirst();
      const relationship =
        importedRelationship === undefined
          ? await database
              .insertInto('coaching_relationships')
              .values({
                client_id: client.id,
                coach_id: input.actor.coachId,
                contract_template_id: input.contractTemplateId,
                gate_config: asJsonGates(input.gates),
                intake_form_id: input.intakeFormId,
                onboarding_state: 'invited',
                status: 'invited',
                tenant_id: input.actor.tenantId,
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          : await database
              .updateTable('coaching_relationships')
              .set({
                contract_template_id: input.contractTemplateId,
                gate_config: asJsonGates(input.gates),
                intake_form_id: input.intakeFormId,
                onboarding_state: 'invited',
                status: 'invited',
                updated_at: sql`now()`,
              })
              .where('id', '=', importedRelationship.id)
              .returning('id')
              .executeTakeFirstOrThrow();

      if (input.gates.contractRequired && input.contractTemplateId !== null) {
        const template = await database
          .selectFrom('contract_templates')
          .select(['body', 'id', 'version'])
          .where('id', '=', input.contractTemplateId)
          .where('coach_id', '=', input.actor.coachId)
          .where('active', '=', true)
          .executeTakeFirstOrThrow();
        await database
          .insertInto('contract_instances')
          .values({
            relationship_id: relationship.id,
            signed_snapshot: template.body,
            template_id: template.id,
            template_version: template.version,
            tenant_id: input.actor.tenantId,
          })
          .executeTakeFirstOrThrow();
      }

      const invite = await database
        .insertInto('client_invites')
        .values({
          client_name: input.clientName,
          coach_id: input.actor.coachId,
          contract_template_id: input.contractTemplateId,
          email: input.email,
          expires_at: input.expiresAt,
          gate_config: asJsonGates(input.gates),
          intake_form_id: input.intakeFormId,
          phone: input.phone,
          relationship_id: relationship.id,
          tenant_id: input.actor.tenantId,
          token_hash: input.tokenHash,
        })
        .returning(['accepted_at', 'expires_at', 'id', 'revoked_at'])
        .executeTakeFirstOrThrow();
      const messages = record(coach.message_templates);
      const welcomeMessage =
        typeof messages.welcomeMessage === 'string'
          ? messages.welcomeMessage
          : 'I am looking forward to working together.';
      await enqueueEmail(
        this.boss,
        transaction,
        invitationJob({
          clientName: input.clientName,
          coachEmail: coach.coach_email,
          coachName: coach.coach_name,
          email: input.email,
          from: this.config.emailFrom,
          inviteId: invite.id,
          practiceName: coach.practice_name,
          rawToken: input.rawToken,
          sendCount: 1,
          urlBase: this.config.clientAppBaseUrl,
          welcomeMessage,
        }),
      );
      await database
        .insertInto('event_log')
        .values([
          {
            action: 'client.invite.sent',
            actor_id: input.actor.userId,
            actor_type: 'coach',
            entity_id: invite.id,
            entity_type: 'client_invite',
            metadata: { relationshipId: relationship.id },
            tenant_id: input.actor.tenantId,
          },
          {
            action: 'coach.first_invite.sent',
            actor_id: input.actor.userId,
            actor_type: 'coach',
            entity_id: input.actor.coachId,
            entity_type: 'coach',
            metadata: {},
            tenant_id: input.actor.tenantId,
          },
        ])
        .execute();
      if (input.actor.practiceRole === 'owner') {
        await database
          .updateTable('tenants')
          .set({ setup_state: 'complete', updated_at: sql`now()` })
          .where('id', '=', input.actor.tenantId)
          .executeTakeFirstOrThrow();
      }
      return {
        clientName: input.clientName,
        email: input.email,
        expiresAt: invite.expires_at,
        id: invite.id,
        relationshipId: relationship.id,
        status: inviteStatus(invite),
      } satisfies InviteSummary;
    });
  }

  async inspectInvite(tokenHash: Buffer): Promise<InvitePreview | undefined> {
    return this.database.transaction().execute(async (transaction) => {
      const resolved = await setResolvedInviteContext(transaction, tokenHash);
      if (resolved === undefined) return undefined;
      const database = transaction.withSchema('app');
      const invite = await database
        .selectFrom('client_invites as invite')
        .innerJoin('coaches as coach', 'coach.id', 'invite.coach_id')
        .innerJoin('users as user', 'user.id', 'coach.user_id')
        .innerJoin('tenants as tenant', 'tenant.id', 'invite.tenant_id')
        .select([
          'invite.client_name',
          'invite.expires_at',
          'invite.gate_config',
          'invite.id',
          'tenant.message_templates',
          'tenant.name as practice_name',
          'user.name as coach_name',
        ])
        .where('invite.id', '=', resolved.invite_id)
        .executeTakeFirstOrThrow();
      await database
        .updateTable('client_invites')
        .set({ opened_at: sql`coalesce(opened_at, now())`, updated_at: sql`now()` })
        .where('id', '=', resolved.invite_id)
        .executeTakeFirstOrThrow();
      const messages = record(invite.message_templates);
      return {
        clientName: invite.client_name,
        coachName: invite.coach_name,
        expiresAt: invite.expires_at,
        gates: gateConfig(invite.gate_config),
        inviteId: invite.id,
        practiceName: invite.practice_name,
        welcomeMessage:
          typeof messages.welcomeMessage === 'string'
            ? messages.welcomeMessage
            : 'I am looking forward to working together.',
      };
    });
  }

  async acceptInvite(input: {
    passwordHash: string | null;
    tokenHash: Buffer;
  }): Promise<AcceptInviteResult | undefined> {
    return this.database.transaction().execute(async (transaction) => {
      const resolved = await setResolvedInviteContext(transaction, input.tokenHash);
      if (resolved === undefined) return undefined;
      const database = transaction.withSchema('app');
      const user = await database
        .selectFrom('users')
        .select(['password_hash', 'status'])
        .where('id', '=', resolved.user_id)
        .executeTakeFirstOrThrow();
      await database
        .updateTable('users')
        .set({
          ...(user.password_hash === null && input.passwordHash !== null
            ? { password_hash: input.passwordHash }
            : {}),
          status: 'active',
          updated_at: sql`now()`,
        })
        .where('id', '=', resolved.user_id)
        .executeTakeFirstOrThrow();
      await database
        .updateTable('client_invites')
        .set({ accepted_at: sql`now()`, updated_at: sql`now()` })
        .where('id', '=', resolved.invite_id)
        .executeTakeFirstOrThrow();
      await sql`
        SELECT set_config('app.role', 'client', true)
      `.execute(transaction);
      await advanceOnboarding(transaction, resolved.relationship_id, this.boss, this.config);
      await database
        .insertInto('event_log')
        .values({
          action: 'client.invite.accepted',
          actor_id: resolved.user_id,
          actor_type: 'client',
          entity_id: resolved.invite_id,
          entity_type: 'client_invite',
          metadata: { previousStatus: user.status },
          tenant_id: resolved.tenant_id,
        })
        .executeTakeFirstOrThrow();
      const snapshot = await onboardingSnapshot(transaction, resolved.relationship_id);
      if (snapshot === undefined) throw new Error('Accepted onboarding relationship is missing.');
      return {
        relationshipId: resolved.relationship_id,
        snapshot,
        userId: resolved.user_id,
      };
    });
  }

  async declineInvite(tokenHash: Buffer): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const resolved = await setResolvedInviteContext(transaction, tokenHash);
      if (resolved === undefined) return false;
      const database = transaction.withSchema('app');
      await database
        .updateTable('client_invites')
        .set({ declined_at: sql`now()`, updated_at: sql`now()` })
        .where('id', '=', resolved.invite_id)
        .executeTakeFirstOrThrow();
      await database
        .updateTable('coaching_relationships')
        .set({
          archived_at: sql`now()`,
          onboarding_state: 'declined',
          status: 'declined',
          updated_at: sql`now()`,
        })
        .where('id', '=', resolved.relationship_id)
        .executeTakeFirstOrThrow();
      return true;
    });
  }

  async resendInvite(
    input: Parameters<ClientOnboardingStore['resendInvite']>[0],
  ): Promise<InviteSummary | undefined> {
    return withTenantContext(this.database, coachContext(input.actor), async (transaction) => {
      const database = transaction.withSchema('app');
      const invite = await database
        .selectFrom('client_invites as invite')
        .innerJoin('coaches as coach', 'coach.id', 'invite.coach_id')
        .innerJoin('users as user', 'user.id', 'coach.user_id')
        .innerJoin('tenants as tenant', 'tenant.id', 'invite.tenant_id')
        .select([
          'invite.accepted_at',
          'invite.client_name',
          'invite.email',
          'invite.id',
          'invite.relationship_id',
          'invite.revoked_at',
          'invite.send_count',
          'tenant.message_templates',
          'tenant.name as practice_name',
          'user.email as coach_email',
          'user.name as coach_name',
        ])
        .where('invite.id', '=', input.inviteId)
        .where('invite.coach_id', '=', input.actor.coachId)
        .where('invite.accepted_at', 'is', null)
        .where('invite.revoked_at', 'is', null)
        .where('invite.declined_at', 'is', null)
        .executeTakeFirst();
      if (invite === undefined || invite.relationship_id === null) return undefined;
      const sendCount = invite.send_count + 1;
      const updated = await database
        .updateTable('client_invites')
        .set({
          expires_at: input.expiresAt,
          last_sent_at: sql`now()`,
          send_count: sendCount,
          token_hash: input.tokenHash,
          updated_at: sql`now()`,
        })
        .where('id', '=', invite.id)
        .returning(['accepted_at', 'expires_at', 'revoked_at'])
        .executeTakeFirstOrThrow();
      const messages = record(invite.message_templates);
      await enqueueEmail(
        this.boss,
        transaction,
        invitationJob({
          clientName: invite.client_name,
          coachEmail: invite.coach_email,
          coachName: invite.coach_name,
          email: invite.email,
          from: this.config.emailFrom,
          inviteId: invite.id,
          practiceName: invite.practice_name,
          rawToken: input.rawToken,
          sendCount,
          urlBase: this.config.clientAppBaseUrl,
          welcomeMessage:
            typeof messages.welcomeMessage === 'string'
              ? messages.welcomeMessage
              : 'I am looking forward to working together.',
        }),
      );
      return {
        clientName: invite.client_name,
        email: invite.email,
        expiresAt: updated.expires_at,
        id: invite.id,
        relationshipId: invite.relationship_id,
        status: inviteStatus(updated),
      };
    });
  }

  async revokeInvite(actor: CoachOnboardingActor, inviteId: string): Promise<boolean> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const database = transaction.withSchema('app');
      const invite = await database
        .updateTable('client_invites')
        .set({ revoked_at: sql`now()`, updated_at: sql`now()` })
        .where('id', '=', inviteId)
        .where('coach_id', '=', actor.coachId)
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .returning('relationship_id')
        .executeTakeFirst();
      if (invite?.relationship_id === undefined || invite.relationship_id === null) return false;
      await database
        .updateTable('coaching_relationships')
        .set({
          archived_at: sql`now()`,
          onboarding_state: 'revoked',
          status: 'revoked',
          updated_at: sql`now()`,
        })
        .where('id', '=', invite.relationship_id)
        .executeTakeFirstOrThrow();
      return true;
    });
  }

  async getOnboarding(
    actor: ClientOnboardingActor,
    relationshipId: string,
  ): Promise<OnboardingSnapshot | undefined> {
    const tenantId = await relationshipTenant(this.database, actor, relationshipId);
    if (tenantId === undefined) return undefined;
    return withTenantContext(this.database, clientContext(actor, tenantId), (transaction) =>
      onboardingSnapshot(transaction, relationshipId),
    );
  }

  async signContract(
    input: Parameters<ClientOnboardingStore['signContract']>[0],
  ): Promise<OnboardingSnapshot | undefined> {
    const tenantId = await relationshipTenant(this.database, input.actor, input.relationshipId);
    if (tenantId === undefined) return undefined;
    return withTenantContext(
      this.database,
      clientContext(input.actor, tenantId),
      async (transaction) => {
        const database = transaction.withSchema('app');
        const contract = await database
          .selectFrom('contract_instances as instance')
          .innerJoin(
            'coaching_relationships as relationship',
            'relationship.id',
            'instance.relationship_id',
          )
          .select('instance.id')
          .where('instance.id', '=', input.contractId)
          .where('instance.relationship_id', '=', input.relationshipId)
          .where('relationship.onboarding_state', '=', 'contract_pending')
          .executeTakeFirst();
        if (contract === undefined) return undefined;
        await database
          .insertInto('contract_signatures')
          .values({
            consent_text: input.consentText,
            contract_instance_id: contract.id,
            ip: input.ip,
            signer_name: input.signerName,
            signer_role: 'client',
            signer_user_id: input.actor.userId,
            tenant_id: tenantId,
            user_agent: input.userAgent,
          })
          .onConflict((conflict) =>
            conflict.columns(['contract_instance_id', 'signer_role']).doNothing(),
          )
          .execute();
        await advanceOnboarding(transaction, input.relationshipId, this.boss, this.config);
        return onboardingSnapshot(transaction, input.relationshipId);
      },
    );
  }

  async countersignContract(
    input: Parameters<ClientOnboardingStore['countersignContract']>[0],
  ): Promise<OnboardingSnapshot | undefined> {
    return withTenantContext(this.database, coachContext(input.actor), async (transaction) => {
      const database = transaction.withSchema('app');
      const contract = await database
        .selectFrom('contract_instances as instance')
        .innerJoin(
          'coaching_relationships as relationship',
          'relationship.id',
          'instance.relationship_id',
        )
        .select(['instance.id', 'instance.relationship_id'])
        .where('instance.id', '=', input.contractId)
        .where('relationship.coach_id', '=', input.actor.coachId)
        .where('relationship.onboarding_state', '=', 'countersignature_pending')
        .executeTakeFirst();
      if (contract === undefined) return undefined;
      await database
        .insertInto('contract_signatures')
        .values({
          consent_text: 'I have read and agree to this coaching agreement.',
          contract_instance_id: contract.id,
          ip: input.ip,
          signer_name: input.signerName,
          signer_role: 'coach',
          signer_user_id: input.actor.userId,
          tenant_id: input.actor.tenantId,
          user_agent: input.userAgent,
        })
        .onConflict((conflict) =>
          conflict.columns(['contract_instance_id', 'signer_role']).doNothing(),
        )
        .execute();
      await advanceOnboarding(transaction, contract.relationship_id, this.boss, this.config);
      return onboardingSnapshot(transaction, contract.relationship_id);
    });
  }

  async submitIntake(
    input: Parameters<ClientOnboardingStore['submitIntake']>[0],
  ): Promise<OnboardingSnapshot | undefined> {
    const tenantId = await relationshipTenant(this.database, input.actor, input.relationshipId);
    if (tenantId === undefined) return undefined;
    return withTenantContext(
      this.database,
      clientContext(input.actor, tenantId),
      async (transaction) => {
        const database = transaction.withSchema('app');
        const relationship = await database
          .selectFrom('coaching_relationships as relationship')
          .innerJoin('intake_forms as form', 'form.id', 'relationship.intake_form_id')
          .innerJoin('tenant_keys as key', 'key.tenant_id', 'relationship.tenant_id')
          .select([
            'form.id as form_id',
            'form.version as form_version',
            'key.key_version',
            'key.kms_key_id',
            'key.wrapped_data_key',
          ])
          .where('relationship.id', '=', input.relationshipId)
          .where('relationship.onboarding_state', '=', 'intake_pending')
          .executeTakeFirst();
        if (relationship === undefined) return undefined;
        const responseId = randomUUID();
        const ciphertext = await this.encryptor.encrypt({
          answers: input.answers,
          keyVersion: relationship.key_version,
          kmsKeyId: relationship.kms_key_id,
          responseId,
          tenantId,
          wrappedDataKey: relationship.wrapped_data_key,
        });
        await database
          .insertInto('intake_responses')
          .values({
            answers_enc: ciphertext,
            answers_key_version: relationship.key_version,
            form_version: relationship.form_version,
            id: responseId,
            intake_form_id: relationship.form_id,
            relationship_id: input.relationshipId,
            submitted_at: sql`now()`,
            tenant_id: tenantId,
          })
          .onConflict((conflict) => conflict.columns(['tenant_id', 'relationship_id']).doNothing())
          .execute();
        await advanceOnboarding(transaction, input.relationshipId, this.boss, this.config);
        return onboardingSnapshot(transaction, input.relationshipId);
      },
    );
  }
}
