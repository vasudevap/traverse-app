import { KMSClient } from '@aws-sdk/client-kms';
import { createResendEmailSender, resendApiKey } from '@traverse/jobs';
import { generateTenantDataKey, type GeneratedTenantDataKey } from '@traverse/db';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  BillingInterval,
  FlowBBillingClient,
  FlowBWebhookEvent,
  SignupEmailSender,
  TenantKeyGenerator,
} from './coach-signup.service.js';
import type { PlanCode } from '@traverse/config';

interface StripeSecretConfig {
  priceIds?: Partial<Record<PlanCode, Partial<Record<BillingInterval, string>>>>;
  secretKey?: string;
  webhookSecret?: string;
}

function parseStripeSecret(rawSecret: string | undefined): StripeSecretConfig {
  if (rawSecret === undefined || rawSecret.trim() === '') {
    throw new Error('STRIPE_SECRET is required.');
  }
  if (rawSecret.startsWith('sk_')) {
    return { secretKey: rawSecret };
  }
  const parsed: unknown = JSON.parse(rawSecret);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('STRIPE_SECRET must be a Stripe key or JSON object.');
  }
  const config = parsed as StripeSecretConfig;
  if (typeof config.secretKey !== 'string' || !config.secretKey.startsWith('sk_')) {
    throw new Error('STRIPE_SECRET.secretKey must contain a Stripe secret key.');
  }
  return config;
}

function requiredPriceId(
  priceIds: StripeSecretConfig['priceIds'],
  planCode: PlanCode,
  billingInterval: BillingInterval,
): string {
  const priceId = priceIds?.[planCode]?.[billingInterval];
  if (typeof priceId !== 'string' || priceId.trim() === '') {
    throw new Error(`Stripe price id missing for ${planCode}/${billingInterval}.`);
  }
  return priceId;
}

async function stripeRequest(
  secretKey: string,
  path: string,
  body: URLSearchParams,
  idempotencyKey: string,
  fetchImplementation: typeof fetch,
): Promise<Record<string, unknown>> {
  const response = await fetchImplementation(`https://api.stripe.com/v1/${path}`, {
    body,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey,
    },
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Stripe request ${path} failed with HTTP ${response.status}.`);
  }
  const parsed: unknown = await response.json();
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Stripe request ${path} returned an invalid body.`);
  }
  return parsed as Record<string, unknown>;
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function verifyStripeSignature(
  rawBody: Buffer | undefined,
  signature: string,
  secret: string,
): void {
  if (rawBody === undefined) {
    throw new Error('Stripe raw request body is required for signature verification.');
  }
  const parts = new Map(
    signature
      .split(',')
      .map((part) => part.split('=', 2))
      .filter((part): part is [string, string] => part.length === 2),
  );
  const timestamp = parts.get('t');
  const v1Signature = parts.get('v1');
  if (timestamp === undefined || v1Signature === undefined) {
    throw new Error('Stripe signature header is invalid.');
  }
  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(v1Signature, 'hex');
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error('Stripe signature verification failed.');
  }
}

export class AwsTenantKeyGenerator implements TenantKeyGenerator {
  private readonly client = new KMSClient({});

  constructor(private readonly kmsKeyId: string) {}

  async generate(tenantId: string): Promise<GeneratedTenantDataKey> {
    return generateTenantDataKey(this.client, this.kmsKeyId, tenantId, 1);
  }
}

export class ResendSignupEmailSender implements SignupEmailSender {
  private readonly sender;

  constructor(
    resendSecret: string | undefined,
    private readonly appBaseUrl: string,
    private readonly from: string,
  ) {
    this.sender = createResendEmailSender(resendApiKey(resendSecret));
  }

  async sendVerificationEmail(input: {
    email: string;
    name: string;
    tenantId: string;
    token: string;
  }): Promise<void> {
    const verificationUrl = new URL('/verify-email', this.appBaseUrl);
    verificationUrl.searchParams.set('token', input.token);
    await this.sender.send({
      entityId: input.tenantId,
      from: this.from,
      html: `<p>Hi ${input.name},</p><p>Verify your Traverse email to start your trial:</p><p><a href="${verificationUrl.toString()}">Verify email</a></p>`,
      notificationId: `coach-email-verify:${input.tenantId}`,
      recipientId: input.tenantId,
      subject: 'Verify your Traverse email',
      text: `Hi ${input.name}, verify your Traverse email to start your trial: ${verificationUrl.toString()}`,
      to: input.email,
    });
  }
}

export class StripeFlowBBillingClient implements FlowBBillingClient {
  private config: StripeSecretConfig | undefined;

  constructor(
    private readonly rawSecret: string | undefined,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  private stripeConfig(): StripeSecretConfig {
    this.config ??= parseStripeSecret(this.rawSecret);
    return this.config;
  }

  async createTrialSubscription(input: {
    billingInterval: BillingInterval;
    email: string;
    name: string;
    planCode: PlanCode;
    promotionCode: string | null;
    tenantId: string;
    trialDays: number;
  }) {
    const config = this.stripeConfig();
    const secretKey = config.secretKey ?? '';
    const customer = await stripeRequest(
      secretKey,
      'customers',
      new URLSearchParams({
        email: input.email,
        name: input.name,
        'metadata[tenant_id]': input.tenantId,
      }),
      `flow-b-customer:${input.tenantId}`,
      this.fetchImplementation,
    );
    const stripeCustomerId = customer.id;
    if (typeof stripeCustomerId !== 'string') {
      throw new Error('Stripe customer response did not include an id.');
    }

    const trialEndsAt = new Date(Date.now() + input.trialDays * 24 * 60 * 60 * 1000);
    const subscription = await stripeRequest(
      secretKey,
      'subscriptions',
      new URLSearchParams({
        customer: stripeCustomerId,
        'items[0][price]': requiredPriceId(config.priceIds, input.planCode, input.billingInterval),
        'metadata[tenant_id]': input.tenantId,
        payment_behavior: 'default_incomplete',
        trial_end: String(unixSeconds(trialEndsAt)),
        'trial_settings[end_behavior][missing_payment_method]': 'pause',
        ...(input.promotionCode === null ? {} : { promotion_code: input.promotionCode }),
      }),
      `flow-b-subscription:${input.tenantId}`,
      this.fetchImplementation,
    );
    const stripeSubscriptionId = subscription.id;
    if (typeof stripeSubscriptionId !== 'string') {
      throw new Error('Stripe subscription response did not include an id.');
    }
    return {
      stripeCustomerId,
      stripeSubscriptionId,
      trialEndsAt,
      trialStartedAt: new Date(),
    };
  }

  async verifyWebhook(
    payload: unknown,
    signature: string | undefined,
    rawBody: Buffer | undefined,
  ): Promise<FlowBWebhookEvent> {
    if (signature === undefined || signature.trim() === '') {
      throw new Error('Stripe signature is required.');
    }
    const config = this.stripeConfig();
    if (config.webhookSecret !== undefined && config.webhookSecret.trim() !== '') {
      verifyStripeSignature(rawBody, signature, config.webhookSecret);
    }
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('Stripe webhook payload must be an object.');
    }
    const event = payload as Record<string, unknown>;
    const data = event.data as { object?: Record<string, unknown> } | undefined;
    const object = data?.object ?? {};
    const id = typeof event.id === 'string' ? event.id : '';
    const type = typeof event.type === 'string' ? event.type : '';
    if (id === '' || type === '') {
      throw new Error('Stripe webhook event id and type are required.');
    }
    return {
      data: {
        currentPeriodEnd:
          typeof object.current_period_end === 'number'
            ? new Date(object.current_period_end * 1000)
            : null,
        customerId: typeof object.customer === 'string' ? object.customer : undefined,
        status: typeof object.status === 'string' ? object.status : undefined,
        subscriptionId: typeof object.id === 'string' ? object.id : undefined,
      },
      id,
      payload: event,
      type,
    };
  }
}
