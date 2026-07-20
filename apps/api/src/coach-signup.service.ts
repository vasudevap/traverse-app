import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  destroyPlaintextKey,
  type GeneratedTenantDataKey,
  type JsonValue,
  type TraverseDatabaseClient,
} from '@traverse/db';
import { PLAN_CODES, type PlanCode } from '@traverse/config';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { createOpaqueToken, hashOpaqueToken, hashPassword } from './auth-security.js';

export const COACH_SIGNUP_STORE = Symbol('COACH_SIGNUP_STORE');
export const TENANT_KEY_GENERATOR = Symbol('TENANT_KEY_GENERATOR');
export const SIGNUP_EMAIL_SENDER = Symbol('SIGNUP_EMAIL_SENDER');
export const FLOW_B_BILLING_CLIENT = Symbol('FLOW_B_BILLING_CLIENT');

export type BillingInterval = 'annual' | 'monthly';
export type DisciplineBand = 'permitted' | 'prohibited' | 'restricted';

export interface SignupLegalAcceptanceInput {
  documentType: string;
  version: string;
}

export interface CreateCoachSignupInput {
  acceptedLegalDocuments: SignupLegalAcceptanceInput[];
  acceptableUseAccepted: boolean;
  billingInterval: BillingInterval;
  discipline: string;
  disciplineBand: DisciplineBand;
  email: string;
  ip: string | null;
  legalAccepted: boolean;
  name: string;
  password: string;
  planCode: PlanCode;
  practiceName: string;
  promotionCode?: string;
  restrictedCredentialAttestation?: boolean;
  restrictedNonClinicalAttestation?: boolean;
  timezone?: string;
  userAgent: string | null;
}

export interface CreateCoachSignupResult {
  email: string;
  status: 'pending_verification';
  tenantId: string;
}

export interface VerifyCoachEmailResult {
  status: 'active';
  stripeSubscriptionId: string;
  tenantId: string;
  trialEndsAt: Date;
}

export interface SignupRecordInput {
  acceptedLegalDocuments: SignupLegalAcceptanceInput[];
  billingInterval: BillingInterval;
  coachId: string;
  discipline: string;
  email: string;
  ip: string | null;
  name: string;
  passwordHash: string;
  planCode: PlanCode;
  practiceName: string;
  promotionCode: string | null;
  tenantId: string;
  tenantKey: Omit<GeneratedTenantDataKey, 'plaintextKey'>;
  timezone: string;
  tokenExpiresAt: Date;
  tokenHash: Buffer;
  userAgent: string | null;
  userId: string;
}

export interface PendingVerification {
  billingInterval: BillingInterval;
  coachId: string;
  email: string;
  name: string;
  planCode: PlanCode;
  promotionCode: string | null;
  tenantId: string;
  userId: string;
}

export interface ActivateSignupInput {
  planCode: PlanCode;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  tenantId: string;
  tokenHash: Buffer;
  trialEndsAt: Date;
  trialStartedAt: Date;
}

export interface FlowBWebhookEvent {
  data: {
    customerId?: string;
    currentPeriodEnd?: Date | null;
    status?: string;
    subscriptionId?: string;
  };
  id: string;
  payload: Record<string, unknown>;
  type: string;
}

export interface FlowBWebhookResult {
  duplicate: boolean;
  processed: boolean;
}

export interface CoachSignupStore {
  activateVerifiedSignup(input: ActivateSignupInput): Promise<void>;
  createPendingSignup(input: SignupRecordInput): Promise<void>;
  findPendingVerification(tokenHash: Buffer, now: Date): Promise<PendingVerification | undefined>;
  renewPendingVerification(
    email: string,
    tokenHash: Buffer,
    tokenExpiresAt: Date,
    now: Date,
  ): Promise<PendingVerification | undefined>;
  recordFlowBWebhookEvent(event: FlowBWebhookEvent): Promise<boolean>;
  updateSubscriptionFromWebhook(event: FlowBWebhookEvent): Promise<void>;
}

export interface TenantKeyGenerator {
  generate(tenantId: string): Promise<GeneratedTenantDataKey>;
}

export interface SignupEmailSender {
  sendVerificationEmail(input: {
    email: string;
    name: string;
    tenantId: string;
    token: string;
  }): Promise<void>;
}

export interface FlowBBillingClient {
  createTrialSubscription(input: {
    billingInterval: BillingInterval;
    email: string;
    name: string;
    planCode: PlanCode;
    promotionCode: string | null;
    tenantId: string;
    trialDays: number;
  }): Promise<{
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    trialEndsAt: Date;
    trialStartedAt: Date;
  }>;
  verifyWebhook(
    payload: unknown,
    signature: string | undefined,
    rawBody: Buffer | undefined,
  ): Promise<FlowBWebhookEvent>;
}

const DISCIPLINE_BANDS = ['permitted', 'restricted', 'prohibited'] as const;
const BILLING_INTERVALS = ['monthly', 'annual'] as const;
const REQUIRED_LEGAL_DOCUMENTS = ['coach_terms', 'acceptable_use_policy'] as const;

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException(`${label} is required.`);
  }
  return value.trim();
}

function normalizeEmail(value: unknown): string {
  const email = requireString(value, 'email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException('email must be a valid email address.');
  }
  return email;
}

function assertBoolean(value: unknown, label: string): boolean {
  if (value !== true) {
    throw new BadRequestException(`${label} must be accepted.`);
  }
  return true;
}

function assertPlan(value: unknown): PlanCode {
  if (typeof value !== 'string' || !PLAN_CODES.includes(value as PlanCode)) {
    throw new BadRequestException('planCode must identify a valid billing plan.');
  }
  return value as PlanCode;
}

function assertBillingInterval(value: unknown): BillingInterval {
  if (typeof value !== 'string' || !BILLING_INTERVALS.includes(value as BillingInterval)) {
    throw new BadRequestException('billingInterval must be monthly or annual.');
  }
  return value as BillingInterval;
}

function assertDisciplineBand(value: unknown): DisciplineBand {
  if (typeof value !== 'string' || !DISCIPLINE_BANDS.includes(value as DisciplineBand)) {
    throw new BadRequestException('disciplineBand must be permitted, restricted, or prohibited.');
  }
  return value as DisciplineBand;
}

function legalAcceptances(value: unknown): SignupLegalAcceptanceInput[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException('acceptedLegalDocuments are required.');
  }
  const documents = value.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new BadRequestException('acceptedLegalDocuments must contain document objects.');
    }
    const record = entry as Record<string, unknown>;
    return {
      documentType: requireString(record.documentType, 'documentType'),
      version: requireString(record.version, 'version'),
    };
  });
  for (const type of REQUIRED_LEGAL_DOCUMENTS) {
    if (!documents.some((document) => document.documentType === type)) {
      throw new BadRequestException(`${type} acceptance is required.`);
    }
  }
  return documents;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function metadataString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Signup verification metadata missing ${label}.`);
  }
  return value;
}

@Injectable()
export class CoachSignupService {
  constructor(
    @Inject(COACH_SIGNUP_STORE)
    private readonly store: CoachSignupStore,
    @Inject(TENANT_KEY_GENERATOR)
    private readonly tenantKeyGenerator: TenantKeyGenerator,
    @Inject(SIGNUP_EMAIL_SENDER)
    private readonly emailSender: SignupEmailSender,
    @Inject(FLOW_B_BILLING_CLIENT)
    private readonly billingClient: FlowBBillingClient,
  ) {}

  async createSignup(
    input: Record<string, unknown>,
    request: { ip: string | null; userAgent: string | null },
  ): Promise<CreateCoachSignupResult> {
    const disciplineBand = assertDisciplineBand(input.disciplineBand);
    if (disciplineBand === 'prohibited') {
      throw new ForbiddenException('Traverse cannot be used for the selected coaching discipline.');
    }
    if (
      disciplineBand === 'restricted' &&
      (input.restrictedCredentialAttestation !== true ||
        input.restrictedNonClinicalAttestation !== true)
    ) {
      throw new BadRequestException('Restricted disciplines require both attestations.');
    }

    const acceptedLegalDocuments = legalAcceptances(input.acceptedLegalDocuments);
    assertBoolean(input.acceptableUseAccepted, 'acceptableUseAccepted');
    assertBoolean(input.legalAccepted, 'legalAccepted');

    const tenantId = randomUUID();
    const userId = randomUUID();
    const coachId = randomUUID();
    const practiceName = requireString(input.practiceName, 'practiceName');
    const token = createOpaqueToken();
    const tenantKey = await this.tenantKeyGenerator.generate(tenantId);

    try {
      await this.store.createPendingSignup({
        acceptedLegalDocuments,
        billingInterval: assertBillingInterval(input.billingInterval),
        coachId,
        discipline: requireString(input.discipline, 'discipline'),
        email: normalizeEmail(input.email),
        ip: request.ip,
        name: requireString(input.name, 'name'),
        passwordHash: await hashPassword(requireString(input.password, 'password')),
        planCode: assertPlan(input.planCode),
        practiceName,
        promotionCode:
          typeof input.promotionCode === 'string' && input.promotionCode.trim() !== ''
            ? input.promotionCode.trim()
            : null,
        tenantId,
        tenantKey,
        timezone:
          typeof input.timezone === 'string' && input.timezone.trim() !== ''
            ? input.timezone.trim()
            : 'America/Toronto',
        tokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        tokenHash: hashOpaqueToken(token),
        userAgent: request.userAgent,
        userId,
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('A coach account already exists for this email or practice.');
      }
      throw error;
    } finally {
      destroyPlaintextKey(tenantKey.plaintextKey);
    }

    await this.emailSender.sendVerificationEmail({
      email: normalizeEmail(input.email),
      name: requireString(input.name, 'name'),
      tenantId,
      token,
    });

    return { email: normalizeEmail(input.email), status: 'pending_verification', tenantId };
  }

  async verifyEmail(token: unknown): Promise<VerifyCoachEmailResult> {
    const rawToken = requireString(token, 'token');
    const tokenHash = hashOpaqueToken(rawToken);
    const pending = await this.store.findPendingVerification(tokenHash, new Date());
    if (pending === undefined) {
      throw new UnauthorizedException('Verification token is invalid or expired.');
    }

    const trial = await this.billingClient.createTrialSubscription({
      billingInterval: pending.billingInterval,
      email: pending.email,
      name: pending.name,
      planCode: pending.planCode,
      promotionCode: pending.promotionCode,
      tenantId: pending.tenantId,
      trialDays: 14,
    });
    await this.store.activateVerifiedSignup({
      stripeCustomerId: trial.stripeCustomerId,
      stripeSubscriptionId: trial.stripeSubscriptionId,
      planCode: pending.planCode,
      tenantId: pending.tenantId,
      tokenHash,
      trialEndsAt: trial.trialEndsAt,
      trialStartedAt: trial.trialStartedAt,
    });

    return {
      status: 'active',
      stripeSubscriptionId: trial.stripeSubscriptionId,
      tenantId: pending.tenantId,
      trialEndsAt: trial.trialEndsAt,
    };
  }

  async resendVerificationEmail(emailInput: unknown): Promise<{ status: 'pending_verification' }> {
    const email = normalizeEmail(emailInput);
    const token = createOpaqueToken();
    const pending = await this.store.renewPendingVerification(
      email,
      hashOpaqueToken(token),
      new Date(Date.now() + 24 * 60 * 60 * 1000),
      new Date(),
    );
    if (pending !== undefined) {
      await this.emailSender.sendVerificationEmail({
        email: pending.email,
        name: pending.name,
        tenantId: pending.tenantId,
        token,
      });
    }
    return { status: 'pending_verification' };
  }

  async handleFlowBWebhook(
    payload: unknown,
    signature: string | undefined,
    rawBody: Buffer | undefined,
  ): Promise<FlowBWebhookResult> {
    const event = await this.billingClient.verifyWebhook(payload, signature, rawBody);
    const inserted = await this.store.recordFlowBWebhookEvent(event);
    if (!inserted) {
      return { duplicate: true, processed: false };
    }
    await this.store.updateSubscriptionFromWebhook(event);
    return { duplicate: false, processed: true };
  }
}

export class DatabaseCoachSignupStore implements CoachSignupStore {
  constructor(private readonly database: TraverseDatabaseClient) {}

  async createPendingSignup(input: SignupRecordInput): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      await sql`
        SELECT
          set_config('app.tenant_id', ${input.tenantId}, true),
          set_config('app.actor_id', ${input.userId}, true),
          set_config('app.role', 'coach', true),
          set_config('app.coach_id', ${input.coachId}, true),
          set_config('app.client_id', '', true),
          set_config('app.practice_role', 'owner', true)
      `.execute(transaction);
      const database = transaction.withSchema('app');
      await database
        .insertInto('users')
        .values({
          email: input.email,
          id: input.userId,
          name: input.name,
          password_hash: input.passwordHash,
          status: 'pending_verification',
        })
        .executeTakeFirstOrThrow();
      await database
        .insertInto('tenants')
        .values({
          id: input.tenantId,
          name: input.practiceName,
          status: 'pending_verification',
          subdomain: `${slug(input.practiceName) || 'practice'}-${input.tenantId.slice(0, 8)}`,
          timezone: input.timezone,
        })
        .executeTakeFirstOrThrow();
      await sql`
        SELECT app.insert_tenant_key(
          ${input.tenantId}::uuid,
          ${input.tenantKey.wrappedDataKey},
          ${input.tenantKey.kmsKeyId},
          ${input.tenantKey.keyVersion}
        )
      `.execute(transaction);
      await database
        .insertInto('coaches')
        .values({
          discipline: input.discipline,
          display_name: input.name,
          id: input.coachId,
          role_in_practice: 'owner',
          tenant_id: input.tenantId,
          user_id: input.userId,
        })
        .executeTakeFirstOrThrow();

      for (const accepted of input.acceptedLegalDocuments) {
        const document = await database
          .selectFrom('legal_documents')
          .select(['id', 'document_type', 'version'])
          .where('document_type', '=', accepted.documentType)
          .where('version', '=', accepted.version)
          .executeTakeFirst();
        if (document === undefined) {
          throw new BadRequestException('Accepted legal document version is not available.');
        }
        await database
          .insertInto('legal_acceptances')
          .values({
            document_type: document.document_type,
            ip: input.ip,
            legal_document_id: document.id,
            user_agent: input.userAgent,
            user_id: input.userId,
            version: document.version,
          })
          .executeTakeFirstOrThrow();
      }

      await database
        .insertInto('auth_tokens')
        .values({
          expires_at: input.tokenExpiresAt,
          metadata: {
            billingInterval: input.billingInterval,
            coachId: input.coachId,
            planCode: input.planCode,
            promotionCode: input.promotionCode,
            tenantId: input.tenantId,
          },
          purpose: 'email_verify',
          token_hash: input.tokenHash,
          user_id: input.userId,
        })
        .executeTakeFirstOrThrow();
      await database
        .insertInto('event_log')
        .values({
          action: 'coach.practice.created',
          actor_id: input.userId,
          actor_type: 'coach',
          entity_id: input.tenantId,
          entity_type: 'tenant',
          metadata: { planCode: input.planCode },
          tenant_id: input.tenantId,
        })
        .executeTakeFirstOrThrow();
    });
  }

  async findPendingVerification(
    tokenHash: Buffer,
    now: Date,
  ): Promise<PendingVerification | undefined> {
    const database = this.database.withSchema('app');
    const row = await database
      .selectFrom('auth_tokens as token')
      .innerJoin('users as user', 'user.id', 'token.user_id')
      .select(['token.metadata', 'token.user_id', 'user.email', 'user.name'])
      .where('token.token_hash', '=', tokenHash)
      .where('token.purpose', '=', 'email_verify')
      .where('token.used_at', 'is', null)
      .where('token.expires_at', '>', now)
      .where('user.status', '=', 'pending_verification')
      .executeTakeFirst();
    if (row === undefined) return undefined;
    const metadata = row.metadata as Record<string, unknown>;
    const planCode = metadataString(metadata.planCode, 'planCode') as PlanCode;
    const billingInterval = metadataString(
      metadata.billingInterval,
      'billingInterval',
    ) as BillingInterval;
    return {
      billingInterval,
      coachId: metadataString(metadata.coachId, 'coachId'),
      email: row.email,
      name: row.name,
      planCode,
      promotionCode:
        typeof metadata.promotionCode === 'string' && metadata.promotionCode.trim() !== ''
          ? metadata.promotionCode
          : null,
      tenantId: metadataString(metadata.tenantId, 'tenantId'),
      userId: row.user_id,
    };
  }

  async renewPendingVerification(
    email: string,
    tokenHash: Buffer,
    tokenExpiresAt: Date,
    now: Date,
  ): Promise<PendingVerification | undefined> {
    return this.database.transaction().execute(async (transaction) => {
      const database = transaction.withSchema('app');
      const row = await database
        .selectFrom('auth_tokens as token')
        .innerJoin('users as user', 'user.id', 'token.user_id')
        .select(['token.id', 'token.metadata', 'token.user_id', 'user.email', 'user.name'])
        .where('user.email', '=', email)
        .where('token.purpose', '=', 'email_verify')
        .where('token.used_at', 'is', null)
        .where('token.expires_at', '>', now)
        .where('user.status', '=', 'pending_verification')
        .executeTakeFirst();
      if (row === undefined) return undefined;
      await database
        .updateTable('auth_tokens')
        .set({ expires_at: tokenExpiresAt, token_hash: tokenHash })
        .where('id', '=', row.id)
        .executeTakeFirstOrThrow();
      const metadata = row.metadata as Record<string, unknown>;
      return {
        billingInterval: metadataString(metadata.billingInterval, 'billingInterval') as BillingInterval,
        coachId: metadataString(metadata.coachId, 'coachId'),
        email: row.email,
        name: row.name,
        planCode: metadataString(metadata.planCode, 'planCode') as PlanCode,
        promotionCode:
          typeof metadata.promotionCode === 'string' && metadata.promotionCode.trim() !== ''
            ? metadata.promotionCode
            : null,
        tenantId: metadataString(metadata.tenantId, 'tenantId'),
        userId: row.user_id,
      };
    });
  }

  async activateVerifiedSignup(input: ActivateSignupInput): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      await sql`
        SELECT
          set_config('app.tenant_id', ${input.tenantId}, true),
          set_config('app.actor_id', '', true),
          set_config('app.role', 'admin', true),
          set_config('app.coach_id', '', true),
          set_config('app.client_id', '', true),
          set_config('app.practice_role', '', true)
      `.execute(transaction);
      const database = transaction.withSchema('app');
      const token = await database
        .updateTable('auth_tokens')
        .set({ used_at: new Date() })
        .where('token_hash', '=', input.tokenHash)
        .where('used_at', 'is', null)
        .returning(['user_id'])
        .executeTakeFirst();
      if (token === undefined) {
        throw new UnauthorizedException('Verification token is invalid or expired.');
      }
      await database
        .updateTable('users')
        .set({ status: 'active' })
        .where('id', '=', token.user_id)
        .executeTakeFirstOrThrow();
      await database
        .updateTable('tenants')
        .set({
          setup_state: 'practice_profile',
          status: 'active',
        })
        .where('id', '=', input.tenantId)
        .executeTakeFirstOrThrow();
      await database
        .insertInto('coach_billing_customers')
        .values({
          stripe_customer_id: input.stripeCustomerId,
          tenant_id: input.tenantId,
        })
        .executeTakeFirstOrThrow();
      const billingPlan = await database
        .selectFrom('billing_plans')
        .select('id')
        .where('code', '=', input.planCode)
        .executeTakeFirstOrThrow();
      await database
        .insertInto('coach_subscriptions')
        .values({
          plan_id: billingPlan.id,
          status: 'trialing',
          stripe_subscription_id: input.stripeSubscriptionId,
          tenant_id: input.tenantId,
          trial_ends_at: input.trialEndsAt.toISOString(),
        })
        .executeTakeFirstOrThrow();
    });
  }

  async recordFlowBWebhookEvent(event: FlowBWebhookEvent): Promise<boolean> {
    const result = await this.database
      .withSchema('app')
      .insertInto('stripe_webhook_events')
      .values({
        event_type: event.type,
        flow: 'flow_b',
        payload: event.payload as JsonValue,
        stripe_event_id: event.id,
      })
      .onConflict((conflict) => conflict.column('stripe_event_id').doNothing())
      .executeTakeFirst();
    return result.numInsertedOrUpdatedRows === 1n;
  }

  async updateSubscriptionFromWebhook(event: FlowBWebhookEvent): Promise<void> {
    if (event.data.subscriptionId === undefined || event.data.status === undefined) {
      return;
    }
    await this.database
      .withSchema('app')
      .updateTable('coach_subscriptions')
      .set({
        current_period_end: event.data.currentPeriodEnd?.toISOString() ?? null,
        status: event.data.status,
      })
      .where('stripe_subscription_id', '=', event.data.subscriptionId)
      .execute();
  }
}
