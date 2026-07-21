import { NotFoundException } from '@nestjs/common';
import {
  type JsonValue,
  type TenantTransaction,
  type TraverseDatabaseClient,
  withTenantContext,
} from '@traverse/db';
import { sql } from 'kysely';
import {
  type CoachSetupActor,
  type CoachSetupStore,
  type OnboardingDefaults,
  type PolicyDefaults,
  type SetupProgress,
  type SetupProgressItem,
  type SetupProgressStatus,
  type SetupState,
  type StoredCoachSetup,
  TRAVERSE_ONBOARDING_DEFAULTS,
  TRAVERSE_POLICY_DEFAULTS,
} from './coach-setup.service.js';
import { STARTER_AGREEMENT_NAME, starterAgreement } from './starter-agreement.js';

const SETUP_STATES: SetupState[] = [
  'practice_profile',
  'coach_profile',
  'onboarding_defaults',
  'policies',
  'first_client',
  'complete',
];

function recordValue(value: JsonValue): Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function text(value: JsonValue | undefined, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function boolean(value: JsonValue | undefined, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function integer(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

function integerList(value: JsonValue | undefined, fallback: number[]): number[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'number')) return fallback;
  return value as number[];
}

function progressStatus(value: JsonValue | undefined): SetupProgressStatus {
  return value === 'complete' || value === 'skipped' ? value : 'pending';
}

function setupProgress(value: JsonValue): SetupProgress {
  const progress = recordValue(value);
  return {
    branding: progressStatus(progress.branding),
    onboardingDefaults: progressStatus(progress.onboardingDefaults),
    payments: progressStatus(progress.payments),
    policies: progressStatus(progress.policies),
    preview: progressStatus(progress.preview),
  };
}

function onboardingDefaults(value: JsonValue): OnboardingDefaults {
  const defaults = recordValue(value);
  return {
    contractRequired: boolean(
      defaults.contractRequired,
      TRAVERSE_ONBOARDING_DEFAULTS.contractRequired,
    ),
    countersignatureRequired: boolean(
      defaults.countersignatureRequired,
      TRAVERSE_ONBOARDING_DEFAULTS.countersignatureRequired,
    ),
    intakeRequired: boolean(defaults.intakeRequired, TRAVERSE_ONBOARDING_DEFAULTS.intakeRequired),
    inviteExpiryDays: integer(
      defaults.inviteExpiryDays,
      TRAVERSE_ONBOARDING_DEFAULTS.inviteExpiryDays,
    ),
    paymentRequired: false,
    reminderCadenceDays: integerList(
      defaults.reminderCadenceDays,
      TRAVERSE_ONBOARDING_DEFAULTS.reminderCadenceDays,
    ),
  };
}

function policyDefaults(policyValue: JsonValue, messageValue: JsonValue): PolicyDefaults {
  const policies = recordValue(policyValue);
  const messages = recordValue(messageValue);
  const refundPolicy = text(policies.refundPolicy, TRAVERSE_POLICY_DEFAULTS.refundPolicy);
  return {
    cancellationNoticeHours: integer(
      policies.cancellationNoticeHours,
      TRAVERSE_POLICY_DEFAULTS.cancellationNoticeHours,
    ),
    cancellationSummary: text(
      policies.cancellationSummary,
      TRAVERSE_POLICY_DEFAULTS.cancellationSummary,
    ),
    refundPolicy:
      refundPolicy === 'flexible' || refundPolicy === 'strict' ? refundPolicy : 'standard',
    starterTemplateSelected: boolean(
      policies.starterTemplateSelected,
      TRAVERSE_POLICY_DEFAULTS.starterTemplateSelected,
    ),
    welcomeMessage: text(messages.welcomeMessage, TRAVERSE_POLICY_DEFAULTS.welcomeMessage),
  };
}

function setupState(value: string): SetupState {
  return SETUP_STATES.includes(value as SetupState) ? (value as SetupState) : 'practice_profile';
}

function nullable(value: string): string | null {
  return value === '' ? null : value;
}

function targetState(current: SetupState, target: SetupState): SetupState {
  return SETUP_STATES.indexOf(current) >= SETUP_STATES.indexOf(target) ? current : target;
}

function tenantContext(actor: CoachSetupActor) {
  return {
    actorId: actor.userId,
    coachId: actor.coachId,
    practiceRole: actor.practiceRole,
    role: 'coach' as const,
    tenantId: actor.tenantId,
  };
}

async function advanceState(
  database: TenantTransaction,
  actor: CoachSetupActor,
  target: SetupState,
): Promise<void> {
  const scoped = database.withSchema('app');
  const current = await scoped
    .selectFrom('tenants')
    .select('setup_state')
    .where('id', '=', actor.tenantId)
    .executeTakeFirstOrThrow();
  await scoped
    .updateTable('tenants')
    .set({
      setup_state: targetState(setupState(current.setup_state), target),
      updated_at: sql`now()`,
    })
    .where('id', '=', actor.tenantId)
    .executeTakeFirstOrThrow();
}

async function setProgress(
  database: TenantTransaction,
  actor: CoachSetupActor,
  item: SetupProgressItem,
  status: SetupProgressStatus,
): Promise<void> {
  await database
    .withSchema('app')
    .updateTable('tenants')
    .set({
      setup_progress: sql<JsonValue>`jsonb_set(
        setup_progress,
        ARRAY[${item}]::text[],
        ${JSON.stringify(status)}::jsonb,
        true
      )`,
      updated_at: sql`now()`,
    })
    .where('id', '=', actor.tenantId)
    .executeTakeFirstOrThrow();
}

async function logEvent(
  database: TenantTransaction,
  actor: CoachSetupActor,
  action: string,
  entityType: 'coach' | 'practice',
  entityId: string,
  metadata: Record<string, JsonValue> = {},
): Promise<void> {
  await database
    .withSchema('app')
    .insertInto('event_log')
    .values({
      action,
      actor_id: actor.userId,
      actor_type: 'coach',
      entity_id: entityId,
      entity_type: entityType,
      metadata,
      tenant_id: actor.tenantId,
    })
    .executeTakeFirstOrThrow();
}

export class DatabaseCoachSetupStore implements CoachSetupStore {
  constructor(private readonly database: TraverseDatabaseClient) {}

  async get(actor: CoachSetupActor): Promise<StoredCoachSetup> {
    return withTenantContext(this.database, tenantContext(actor), async (transaction) => {
      const database = transaction.withSchema('app');
      const practice = await database
        .selectFrom('tenants')
        .select([
          'business_address',
          'business_email',
          'legal_name',
          'message_templates',
          'name',
          'onboarding_defaults',
          'phone',
          'policy_defaults',
          'setup_progress',
          'setup_state',
          'timezone',
          'website_url',
        ])
        .where('id', '=', actor.tenantId)
        .executeTakeFirst();
      const coach = await database
        .selectFrom('coaches')
        .select(['bio', 'discipline', 'display_name', 'profile_photo_ref', 'specialties'])
        .where('id', '=', actor.coachId)
        .where('tenant_id', '=', actor.tenantId)
        .executeTakeFirst();
      const subscription = await database
        .selectFrom('coach_subscriptions as subscription')
        .innerJoin('billing_plans as plan', 'plan.id', 'subscription.plan_id')
        .select(['plan.code', 'plan.name', 'subscription.trial_ends_at'])
        .where('subscription.tenant_id', '=', actor.tenantId)
        .executeTakeFirst();
      const agreement = await database
        .selectFrom('contract_templates')
        .select(['id', 'name'])
        .where('tenant_id', '=', actor.tenantId)
        .where('coach_id', '=', actor.coachId)
        .where('active', '=', true)
        .orderBy('updated_at', 'desc')
        .executeTakeFirst();

      if (practice === undefined || coach === undefined || subscription === undefined) {
        throw new NotFoundException('Coach setup record was not found.');
      }

      return {
        agreementTemplate: agreement ?? null,
        coach: {
          bio: coach.bio ?? '',
          discipline: coach.discipline ?? '',
          displayName: coach.display_name ?? '',
          profilePhotoRef: coach.profile_photo_ref,
          specialties: coach.specialties,
        },
        onboardingDefaults: onboardingDefaults(practice.onboarding_defaults),
        plan: {
          code: subscription.code,
          name: subscription.name,
          trialEndsAt: subscription.trial_ends_at,
        },
        policies: policyDefaults(practice.policy_defaults, practice.message_templates),
        practice: {
          businessAddress: practice.business_address ?? '',
          businessEmail: practice.business_email ?? '',
          displayName: practice.name,
          legalName: practice.legal_name ?? '',
          phone: practice.phone ?? '',
          timezone: practice.timezone,
          websiteUrl: practice.website_url ?? '',
        },
        progress: setupProgress(practice.setup_progress),
        setupState: setupState(practice.setup_state),
      };
    });
  }

  async savePracticeProfile(actor: CoachSetupActor, profile: StoredCoachSetup['practice']) {
    await withTenantContext(this.database, tenantContext(actor), async (transaction) => {
      await transaction
        .withSchema('app')
        .updateTable('tenants')
        .set({
          business_address: nullable(profile.businessAddress),
          business_email: nullable(profile.businessEmail),
          legal_name: nullable(profile.legalName),
          name: profile.displayName,
          phone: nullable(profile.phone),
          timezone: profile.timezone,
          updated_at: sql`now()`,
          website_url: nullable(profile.websiteUrl),
        })
        .where('id', '=', actor.tenantId)
        .executeTakeFirstOrThrow();
      await advanceState(transaction, actor, 'coach_profile');
      await logEvent(transaction, actor, 'coach.profile.completed', 'practice', actor.tenantId, {
        part: 'practice',
      });
    });
  }

  async saveCoachProfile(
    actor: CoachSetupActor,
    profile: Omit<StoredCoachSetup['coach'], 'profilePhotoRef'>,
  ) {
    await withTenantContext(this.database, tenantContext(actor), async (transaction) => {
      await transaction
        .withSchema('app')
        .updateTable('coaches')
        .set({
          bio: nullable(profile.bio),
          discipline: profile.discipline,
          display_name: profile.displayName,
          specialties: profile.specialties,
          updated_at: sql`now()`,
        })
        .where('tenant_id', '=', actor.tenantId)
        .where('id', '=', actor.coachId)
        .executeTakeFirstOrThrow();
      await advanceState(transaction, actor, 'onboarding_defaults');
      await logEvent(transaction, actor, 'coach.profile.completed', 'coach', actor.coachId, {
        part: 'coach',
      });
    });
  }

  async saveProfilePhoto(actor: CoachSetupActor, objectKey: string) {
    await withTenantContext(this.database, tenantContext(actor), async (transaction) => {
      await transaction
        .withSchema('app')
        .updateTable('coaches')
        .set({ profile_photo_ref: objectKey, updated_at: sql`now()` })
        .where('tenant_id', '=', actor.tenantId)
        .where('id', '=', actor.coachId)
        .executeTakeFirstOrThrow();
      await logEvent(transaction, actor, 'coach.profile.photo_uploaded', 'coach', actor.coachId);
    });
  }

  async markOptionalSkipped(actor: CoachSetupActor, item: 'branding' | 'payments') {
    await withTenantContext(this.database, tenantContext(actor), async (transaction) => {
      await setProgress(transaction, actor, item, 'skipped');
      await logEvent(
        transaction,
        actor,
        item === 'branding' ? 'coach.branding.skipped' : 'coach.connect.skipped',
        'practice',
        actor.tenantId,
      );
    });
  }

  async saveOnboardingDefaults(
    actor: CoachSetupActor,
    defaults: OnboardingDefaults,
    status: 'complete' | 'skipped',
  ) {
    await withTenantContext(this.database, tenantContext(actor), async (transaction) => {
      await transaction
        .withSchema('app')
        .updateTable('tenants')
        .set({
          onboarding_defaults: { ...defaults } as JsonValue,
          updated_at: sql`now()`,
        })
        .where('id', '=', actor.tenantId)
        .executeTakeFirstOrThrow();
      await setProgress(transaction, actor, 'onboardingDefaults', status);
      await advanceState(transaction, actor, 'policies');
      await logEvent(transaction, actor, 'coach.defaults.configured', 'practice', actor.tenantId, {
        source: status === 'skipped' ? 'traverse_defaults' : 'coach',
      });
    });
  }

  async savePolicies(
    actor: CoachSetupActor,
    policies: PolicyDefaults,
    status: 'complete' | 'skipped',
  ) {
    await withTenantContext(this.database, tenantContext(actor), async (transaction) => {
      const database = transaction.withSchema('app');
      await database
        .updateTable('tenants')
        .set({
          message_templates: { welcomeMessage: policies.welcomeMessage },
          policy_defaults: {
            cancellationNoticeHours: policies.cancellationNoticeHours,
            cancellationSummary: policies.cancellationSummary,
            refundPolicy: policies.refundPolicy,
            starterTemplateSelected: policies.starterTemplateSelected,
          },
          updated_at: sql`now()`,
        })
        .where('id', '=', actor.tenantId)
        .executeTakeFirstOrThrow();

      const existing = await database
        .selectFrom('contract_templates')
        .select('id')
        .where('tenant_id', '=', actor.tenantId)
        .where('coach_id', '=', actor.coachId)
        .where('name', '=', STARTER_AGREEMENT_NAME)
        .executeTakeFirst();
      if (existing === undefined && policies.starterTemplateSelected) {
        await database
          .insertInto('contract_templates')
          .values({
            body: starterAgreement(policies),
            coach_id: actor.coachId,
            name: STARTER_AGREEMENT_NAME,
            tenant_id: actor.tenantId,
          })
          .executeTakeFirstOrThrow();
      } else if (existing !== undefined) {
        await database
          .updateTable('contract_templates')
          .set({
            active: policies.starterTemplateSelected,
            body: starterAgreement(policies),
            updated_at: sql`now()`,
            version: sql`version + 1`,
          })
          .where('id', '=', existing.id)
          .where('tenant_id', '=', actor.tenantId)
          .executeTakeFirstOrThrow();
      }

      await setProgress(transaction, actor, 'policies', status);
      await advanceState(transaction, actor, 'first_client');
      await logEvent(transaction, actor, 'coach.policies.configured', 'practice', actor.tenantId, {
        source: status === 'skipped' ? 'traverse_defaults' : 'coach',
      });
    });
  }

  async markPreviewed(actor: CoachSetupActor) {
    await withTenantContext(this.database, tenantContext(actor), async (transaction) => {
      await setProgress(transaction, actor, 'preview', 'complete');
      await advanceState(transaction, actor, 'first_client');
      await logEvent(transaction, actor, 'coach.setup.previewed', 'practice', actor.tenantId);
    });
  }
}
