import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { AuthSubject } from '@traverse/db';
import type {
  ClientOnboardingActor,
  ClientOnboardingStore,
  CoachOnboardingActor,
  InviteOptions,
  OnboardingSnapshot,
} from '../src/client-onboarding.service.js';
import { ClientOnboardingService } from '../src/client-onboarding.service.js';
import { verifyPassword } from '../src/auth-security.js';
import { createApp } from '../src/create-app.js';
import {
  clientOnboardingContext,
  determineOnboardingState,
} from '../src/client-onboarding-store.js';
import { TestAuthSessionStore } from './test-auth-store.js';

const coach: CoachOnboardingActor = {
  coachId: '22222222-2222-4222-8222-222222222222',
  practiceRole: 'owner',
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '33333333-3333-4333-8333-333333333333',
};
const client: ClientOnboardingActor = {
  clientId: '44444444-4444-4444-8444-444444444444',
  userId: '55555555-5555-4555-8555-555555555555',
};
const relationshipId = '66666666-6666-4666-8666-666666666666';
const contractId = '77777777-7777-4777-8777-777777777777';
const inviteId = '88888888-8888-4888-8888-888888888888';
const templateId = '99999999-9999-4999-8999-999999999999';
const formId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function snapshot(state = 'contract_pending'): OnboardingSnapshot {
  return {
    coach: { name: 'Maya Patel', practiceName: 'North Star Coaching' },
    contract: {
      body: 'A coaching agreement.',
      clientSigned: false,
      coachSigned: false,
      id: contractId,
      name: 'Starter agreement',
    },
    gates: {
      contractRequired: true,
      countersignatureRequired: false,
      intakeRequired: true,
      paymentRequired: false,
    },
    intake: {
      fields: [
        {
          id: 'coaching_goals',
          label: 'What would you like to work on?',
          required: true,
          type: 'long_text',
        },
      ],
      id: formId,
      name: 'Starter intake',
      submitted: false,
    },
    relationshipId,
    state,
  };
}

class MemoryOnboardingStore implements ClientOnboardingStore {
  readonly options: InviteOptions = {
    defaults: {
      contractRequired: true,
      countersignatureRequired: false,
      intakeRequired: true,
      inviteExpiryDays: 14,
      paymentRequired: false,
      reminderCadenceDays: [3, 7],
    },
    forms: [{ id: formId, name: 'Starter intake', version: 1 }],
    templates: [{ id: templateId, name: 'Starter agreement', version: 1 }],
  };
  acceptedPasswordHash: string | null | undefined;
  acceptedTokenHash: Buffer | undefined;
  created:
    (Parameters<ClientOnboardingStore['createInvite']>[0] & { observedAt: Date }) | undefined;

  async getInviteOptions() {
    return this.options;
  }

  async createInvite(input: Parameters<ClientOnboardingStore['createInvite']>[0]) {
    this.created = { ...input, observedAt: new Date() };
    return {
      clientName: input.clientName,
      email: input.email,
      expiresAt: input.expiresAt,
      id: inviteId,
      relationshipId,
      status: 'invited' as const,
    };
  }

  async inspectInvite() {
    return {
      clientName: 'Alex Rivera',
      coachName: 'Maya Patel',
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      gates: this.options.defaults,
      inviteId,
      practiceName: 'North Star Coaching',
      welcomeMessage: 'I am looking forward to working together.',
    };
  }

  async acceptInvite(input: Parameters<ClientOnboardingStore['acceptInvite']>[0]) {
    this.acceptedPasswordHash = input.passwordHash;
    this.acceptedTokenHash = input.tokenHash;
    return { relationshipId, snapshot: snapshot(), userId: client.userId };
  }

  async declineInvite() {
    return true;
  }

  async resendInvite(input: Parameters<ClientOnboardingStore['resendInvite']>[0]) {
    return {
      clientName: 'Alex Rivera',
      email: 'alex@example.test',
      expiresAt: input.expiresAt,
      id: input.inviteId,
      relationshipId,
      status: 'invited' as const,
    };
  }

  async revokeInvite() {
    return true;
  }

  async getOnboarding() {
    return snapshot();
  }

  async getPendingOnboarding() {
    return [snapshot('intake_pending')];
  }

  async getCoachContract() {
    return {
      body: 'A coaching agreement.',
      clientName: 'Alex Rivera',
      clientSigned: true,
      coachSigned: false,
      id: contractId,
      name: 'Starter agreement',
      relationshipId,
      state: 'countersignature_pending',
    };
  }

  async signContract() {
    return snapshot('intake_pending');
  }

  async countersignContract() {
    return snapshot('intake_pending');
  }

  async submitIntake() {
    return snapshot('active');
  }
}

test('TRA-40 creates a hashed, expiring, coach-branded client invitation', async () => {
  const store = new MemoryOnboardingStore();
  const service = new ClientOnboardingService(store);
  const result = await service.createInvite(coach, {
    clientName: ' Alex Rivera ',
    contractTemplateId: templateId,
    email: ' ALEX@Example.Test ',
    gates: {
      contractRequired: true,
      countersignatureRequired: false,
      intakeRequired: true,
      paymentRequired: true,
    },
    intakeFormId: formId,
  });

  assert.equal(result.status, 'invited');
  assert.equal(store.created?.clientName, 'Alex Rivera');
  assert.equal(store.created?.email, 'alex@example.test');
  assert.equal(store.created?.gates.paymentRequired, false);
  assert.equal(store.created?.rawToken.length, 43);
  assert.equal(store.created?.tokenHash.length, 32);
  assert.equal(store.created?.tokenHash.toString('utf8').includes(store.created.rawToken), false);
  const lifetime = (store.created?.expiresAt.getTime() ?? 0) - Date.now();
  assert.ok(lifetime > 13.9 * 24 * 60 * 60 * 1000);
  assert.ok(lifetime <= 14 * 24 * 60 * 60 * 1000);
});

test('TRA-40 supports password and invite-link activation without replacing existing passwords', async () => {
  const store = new MemoryOnboardingStore();
  const service = new ClientOnboardingService(store);
  await service.acceptInvite('invite-token', {
    mode: 'password',
    password: 'correct horse battery staple',
  });
  assert.equal(
    await verifyPassword(store.acceptedPasswordHash ?? '', 'correct horse battery staple'),
    true,
  );
  assert.equal(store.acceptedTokenHash?.length, 32);

  await service.acceptInvite('second-invite-token', { mode: 'magic_link' });
  assert.equal(store.acceptedPasswordHash, null);
});

test('TRA-102 gives an authenticated client their incomplete onboarding snapshot', async () => {
  const service = new ClientOnboardingService(new MemoryOnboardingStore());
  const pending = await service.getPendingOnboarding(client);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.state, 'intake_pending');
  assert.equal(pending[0]?.intake?.submitted, false);
});

test('TRA-40 state machine enforces gates in contract, countersignature, intake order', () => {
  const gates = {
    contractRequired: true,
    countersignatureRequired: true,
    intakeRequired: true,
    paymentRequired: false as const,
  };
  assert.equal(
    determineOnboardingState({
      clientSigned: false,
      coachSigned: false,
      gates,
      intakeSubmitted: false,
    }),
    'contract_pending',
  );
  assert.equal(
    determineOnboardingState({
      clientSigned: true,
      coachSigned: false,
      gates,
      intakeSubmitted: false,
    }),
    'countersignature_pending',
  );
  assert.equal(
    determineOnboardingState({
      clientSigned: true,
      coachSigned: true,
      gates,
      intakeSubmitted: false,
    }),
    'intake_pending',
  );
  assert.equal(
    determineOnboardingState({
      clientSigned: true,
      coachSigned: true,
      gates,
      intakeSubmitted: true,
    }),
    'active',
  );
});

test('TRA-40 carries the assigned coach in the client onboarding RLS context', () => {
  assert.deepEqual(
    clientOnboardingContext(client, {
      coachId: coach.coachId,
      tenantId: coach.tenantId,
    }),
    {
      actorId: client.userId,
      clientId: client.clientId,
      coachId: coach.coachId,
      role: 'client',
      tenantId: coach.tenantId,
    },
  );
});

test('TRA-40 exposes the preserved contract to its assigned coach for countersignature', async () => {
  const service = new ClientOnboardingService(new MemoryOnboardingStore());
  const contract = await service.getCoachContract(coach, contractId);
  assert.equal(contract.id, contractId);
  assert.equal(contract.clientName, 'Alex Rivera');
  assert.equal(contract.clientSigned, true);
  assert.equal(contract.coachSigned, false);
  assert.equal(contract.state, 'countersignature_pending');
});

test('TRA-40 rejects incomplete gate configuration and malformed intake answers', async () => {
  const store = new MemoryOnboardingStore();
  const service = new ClientOnboardingService(store);
  await assert.rejects(
    service.createInvite(coach, {
      clientName: 'Alex Rivera',
      email: 'alex@example.test',
      gates: { contractRequired: true, intakeRequired: true },
    }),
    /Select an agreement/,
  );
  await assert.rejects(
    service.submitIntake(client, relationshipId, {
      answers: { coaching_goals: 'x'.repeat(4_001) },
    }),
    /4000 characters/,
  );
});

test('TRA-40 invitation acceptance establishes a revocable client session', async () => {
  const subject: AuthSubject = {
    clientId: client.clientId,
    coachId: null,
    email: 'alex@example.test',
    name: 'Alex Rivera',
    passwordHash: null,
    practiceRole: null,
    role: 'client',
    status: 'active',
    tenantId: null,
    userId: client.userId,
  };
  const authStore = new TestAuthSessionStore([subject]);
  const app = await createApp(
    { logger: false },
    {
      allowedOrigins: new Set(['https://staging-client.traversecoaching.com']),
      authSessionStore: authStore,
      clientOnboardingStore: new MemoryOnboardingStore(),
    },
  );
  try {
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const csrf = await fetch(`${baseUrl}/client/auth/csrf`);
    const csrfBody = (await csrf.json()) as { csrfToken: string };
    const csrfCookie = csrf.headers.getSetCookie()[0]?.split(';')[0] ?? '';
    const accepted = await fetch(`${baseUrl}/client/invitations/invite-token/accept`, {
      body: JSON.stringify({ mode: 'magic_link' }),
      headers: {
        'content-type': 'application/json',
        cookie: csrfCookie,
        origin: 'https://staging-client.traversecoaching.com',
        'x-csrf-token': csrfBody.csrfToken,
      },
      method: 'POST',
    });
    const acceptedBody = await accepted.text();
    assert.equal(accepted.status, 201, acceptedBody);
    const cookies = accepted.headers.getSetCookie();
    assert.ok(cookies.some((cookie) => cookie.startsWith('trv_s_client=')));
    assert.ok(cookies.some((cookie) => cookie.startsWith('trv_csrf_client=')));
    const sessionCookie = cookies
      .find((cookie) => cookie.startsWith('trv_s_client='))
      ?.split(';')[0];
    const pending = await fetch(`${baseUrl}/client/onboarding/pending`, {
      headers: { cookie: sessionCookie ?? '' },
    });
    const pendingBody = (await pending.json()) as OnboardingSnapshot[];
    assert.equal(pending.status, 200);
    assert.equal(pendingBody[0]?.state, 'intake_pending');
    assert.equal(authStore.sessions.size, 1);
  } finally {
    await app.close();
  }
});
