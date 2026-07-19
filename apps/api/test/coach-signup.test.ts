import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import type { GeneratedTenantDataKey } from '@traverse/db';
import { StripeFlowBBillingClient } from '../src/coach-signup-adapters.js';
import {
  CoachSignupService,
  type ActivateSignupInput,
  type CoachSignupStore,
  type FlowBBillingClient,
  type FlowBWebhookEvent,
  type PendingVerification,
  type SignupEmailSender,
  type SignupRecordInput,
  type TenantKeyGenerator,
} from '../src/coach-signup.service.js';

class FakeStore implements CoachSignupStore {
  activated: ActivateSignupInput | undefined;
  created: SignupRecordInput | undefined;
  duplicateWebhook = false;
  webhookUpdates: FlowBWebhookEvent[] = [];

  async createPendingSignup(input: SignupRecordInput): Promise<void> {
    this.created = input;
  }

  async findPendingVerification(): Promise<PendingVerification | undefined> {
    if (this.created === undefined) return undefined;
    return {
      billingInterval: this.created.billingInterval,
      coachId: this.created.coachId,
      email: this.created.email,
      name: this.created.name,
      planCode: this.created.planCode,
      promotionCode: this.created.promotionCode,
      tenantId: this.created.tenantId,
      userId: this.created.userId,
    };
  }

  async activateVerifiedSignup(input: ActivateSignupInput): Promise<void> {
    this.activated = input;
  }

  async recordFlowBWebhookEvent(): Promise<boolean> {
    return !this.duplicateWebhook;
  }

  async updateSubscriptionFromWebhook(event: FlowBWebhookEvent): Promise<void> {
    this.webhookUpdates.push(event);
  }
}

class FakeKeyGenerator implements TenantKeyGenerator {
  generatedFor: string | undefined;

  async generate(tenantId: string): Promise<GeneratedTenantDataKey> {
    this.generatedFor = tenantId;
    return {
      keyVersion: 1,
      kmsKeyId: 'alias/traverse-test',
      plaintextKey: Buffer.alloc(32, 7),
      wrappedDataKey: Buffer.from('wrapped-key'),
    };
  }
}

class FakeEmailSender implements SignupEmailSender {
  verificationToken: string | undefined;

  async sendVerificationEmail(input: { token: string }): Promise<void> {
    this.verificationToken = input.token;
  }
}

class FakeBillingClient implements FlowBBillingClient {
  async createTrialSubscription() {
    return {
      stripeCustomerId: 'cus_test',
      stripeSubscriptionId: 'sub_test',
      trialEndsAt: new Date('2026-08-01T00:00:00.000Z'),
      trialStartedAt: new Date('2026-07-18T00:00:00.000Z'),
    };
  }

  async verifyWebhook(payload: unknown): Promise<FlowBWebhookEvent> {
    return {
      data: {
        currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
        status: 'active',
        subscriptionId: 'sub_test',
      },
      id: (payload as { id: string }).id,
      payload: payload as Record<string, unknown>,
      type: 'customer.subscription.updated',
    };
  }
}

function service() {
  const store = new FakeStore();
  const keys = new FakeKeyGenerator();
  const email = new FakeEmailSender();
  const billing = new FakeBillingClient();
  return {
    billing,
    email,
    keys,
    service: new CoachSignupService(store, keys, email, billing),
    store,
  };
}

function validSignup(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    acceptableUseAccepted: true,
    acceptedLegalDocuments: [
      { documentType: 'coach_terms', version: '0.1-in-review' },
      { documentType: 'acceptable_use_policy', version: '0.1-in-review' },
    ],
    billingInterval: 'monthly',
    discipline: 'leadership coaching',
    disciplineBand: 'permitted',
    email: 'Coach@Example.test',
    legalAccepted: true,
    name: 'Coach Example',
    password: 'correct horse battery staple',
    planCode: 'practice',
    practiceName: 'Example Practice',
    ...overrides,
  };
}

test('TRA-38 blocks prohibited signup before creating any account state', async () => {
  const setup = service();
  await assert.rejects(
    () =>
      setup.service.createSignup(validSignup({ disciplineBand: 'prohibited' }), {
        ip: '127.0.0.1',
        userAgent: 'node-test',
      }),
    /selected coaching discipline/,
  );
  assert.equal(setup.store.created, undefined);
});

test('TRA-38 requires restricted discipline attestations', async () => {
  const setup = service();
  await assert.rejects(
    () =>
      setup.service.createSignup(validSignup({ disciplineBand: 'restricted' }), {
        ip: '127.0.0.1',
        userAgent: 'node-test',
      }),
    /Restricted disciplines require both attestations/,
  );
});

test('TRA-38 creates a pending signup with legal, KMS, and verification email state', async () => {
  const setup = service();
  const result = await setup.service.createSignup(validSignup(), {
    ip: '127.0.0.1',
    userAgent: 'node-test',
  });

  assert.equal(result.status, 'pending_verification');
  assert.equal(setup.store.created?.email, 'coach@example.test');
  assert.equal(setup.store.created?.planCode, 'practice');
  assert.equal(setup.store.created?.acceptedLegalDocuments.length, 2);
  assert.equal(setup.keys.generatedFor, result.tenantId);
  assert.equal(setup.email.verificationToken?.length, 43);
});

test('TRA-38 email verification starts the card-optional Flow B trial', async () => {
  const setup = service();
  await setup.service.createSignup(validSignup({ planCode: 'established' }), {
    ip: null,
    userAgent: null,
  });
  const result = await setup.service.verifyEmail(setup.email.verificationToken);

  assert.equal(result.status, 'active');
  assert.equal(result.stripeSubscriptionId, 'sub_test');
  assert.equal(setup.store.activated?.planCode, 'established');
  assert.equal(setup.store.activated?.stripeCustomerId, 'cus_test');
});

test('TRA-38 Flow B webhook handling is idempotent', async () => {
  const setup = service();
  assert.deepEqual(await setup.service.handleFlowBWebhook({ id: 'evt_1' }, 'sig'), {
    duplicate: false,
    processed: true,
  });
  setup.store.duplicateWebhook = true;
  assert.deepEqual(await setup.service.handleFlowBWebhook({ id: 'evt_1' }, 'sig'), {
    duplicate: true,
    processed: false,
  });
  assert.equal(setup.store.webhookUpdates.length, 1);
});

test('TRA-38 Stripe Flow B webhook adapter verifies signed raw payloads', async () => {
  const rawBody = Buffer.from(
    JSON.stringify({
      data: { object: { current_period_end: 1785542400, id: 'sub_test', status: 'active' } },
      id: 'evt_signed',
      type: 'customer.subscription.updated',
    }),
  );
  const timestamp = '1784332800';
  const secret = 'whsec_test_secret';
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');
  const client = new StripeFlowBBillingClient(
    JSON.stringify({ secretKey: 'sk_test_123', webhookSecret: secret }),
  );

  const event = await client.verifyWebhook(
    JSON.parse(rawBody.toString('utf8')),
    `t=${timestamp},v1=${signature}`,
    rawBody,
  );

  assert.equal(event.id, 'evt_signed');
  assert.equal(event.data.subscriptionId, 'sub_test');
  await assert.rejects(
    () =>
      client.verifyWebhook(JSON.parse(rawBody.toString('utf8')), `t=${timestamp},v1=bad`, rawBody),
    /signature verification failed|signature header is invalid/,
  );
});

test('TRA-43 keeps Flow B Stripe price selection on stable plan codes', async () => {
  const requests: Array<{ body: URLSearchParams; path: string }> = [];
  const client = new StripeFlowBBillingClient(
    JSON.stringify({
      priceIds: {
        established: { annual: 'price_premium_annual' },
        practice: { monthly: 'price_pro_monthly' },
        starter: { monthly: 'price_basic_monthly' },
      },
      secretKey: 'sk_test_123',
    }),
    async (input, init) => {
      const url = new URL(String(input));
      requests.push({
        body: new URLSearchParams(init?.body as URLSearchParams),
        path: url.pathname,
      });
      const response = url.pathname.endsWith('/customers')
        ? { id: 'cus_stage2' }
        : { id: 'sub_stage2' };
      return new Response(JSON.stringify(response), { status: 200 });
    },
  );

  await client.createTrialSubscription({
    billingInterval: 'monthly',
    email: 'coach@example.test',
    name: 'Coach Example',
    planCode: 'practice',
    promotionCode: null,
    tenantId: '00000000-0000-7000-8000-000000000001',
    trialDays: 14,
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.path, '/v1/customers');
  assert.equal(requests[1]?.path, '/v1/subscriptions');
  assert.equal(requests[1]?.body.get('items[0][price]'), 'price_pro_monthly');
  assert.equal(
    requests[1]?.body.get('metadata[tenant_id]'),
    '00000000-0000-7000-8000-000000000001',
  );
  assert.equal(
    requests[1]?.body.get('trial_settings[end_behavior][missing_payment_method]'),
    'pause',
  );
  assert.equal(requests[1]?.body.has('promotion_code'), false);
});
