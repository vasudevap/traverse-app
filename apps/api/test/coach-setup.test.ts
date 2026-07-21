import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CoachProfileAssetStore,
  CoachSetupActor,
  CoachSetupStore,
  OnboardingDefaults,
  PolicyDefaults,
  SetupProgressStatus,
  StoredCoachSetup,
} from '../src/coach-setup.service.js';
import {
  CoachSetupService,
  TRAVERSE_ONBOARDING_DEFAULTS,
  TRAVERSE_POLICY_DEFAULTS,
} from '../src/coach-setup.service.js';
import {
  STARTER_AGREEMENT_NAME,
  shouldProvisionStarterAgreement,
  starterAgreement,
} from '../src/starter-agreement.js';

const actor: CoachSetupActor = {
  coachId: '22222222-2222-4222-8222-222222222222',
  practiceRole: 'owner',
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '33333333-3333-4333-8333-333333333333',
};

function initialSetup(): StoredCoachSetup {
  return {
    agreementTemplate: null,
    coach: {
      bio: '',
      discipline: 'Leadership coaching',
      displayName: 'Maya Patel',
      profilePhotoRef: null,
      specialties: [],
    },
    onboardingDefaults: { ...TRAVERSE_ONBOARDING_DEFAULTS },
    plan: {
      code: 'practice',
      name: 'Pro',
      trialEndsAt: new Date('2026-08-01T00:00:00.000Z'),
    },
    policies: { ...TRAVERSE_POLICY_DEFAULTS },
    practice: {
      businessAddress: '',
      businessEmail: '',
      displayName: 'North Star Coaching',
      legalName: '',
      phone: '',
      timezone: 'America/Toronto',
      websiteUrl: '',
    },
    progress: {
      branding: 'pending',
      onboardingDefaults: 'pending',
      payments: 'pending',
      policies: 'pending',
      preview: 'pending',
    },
    setupState: 'practice_profile',
  };
}

class MemorySetupStore implements CoachSetupStore {
  readonly state = initialSetup();

  async get() {
    return this.state;
  }

  async savePracticeProfile(_actor: CoachSetupActor, profile: StoredCoachSetup['practice']) {
    this.state.practice = profile;
    this.state.setupState = 'coach_profile';
  }

  async saveCoachProfile(
    _actor: CoachSetupActor,
    profile: Omit<StoredCoachSetup['coach'], 'profilePhotoRef'>,
  ) {
    this.state.coach = { ...profile, profilePhotoRef: this.state.coach.profilePhotoRef };
    this.state.setupState = 'onboarding_defaults';
  }

  async saveProfilePhoto(_actor: CoachSetupActor, objectKey: string) {
    this.state.coach.profilePhotoRef = objectKey;
  }

  async markOptionalSkipped(_actor: CoachSetupActor, item: 'branding' | 'payments') {
    this.state.progress[item] = 'skipped';
  }

  async saveOnboardingDefaults(
    _actor: CoachSetupActor,
    defaults: OnboardingDefaults,
    status: Exclude<SetupProgressStatus, 'pending'>,
  ) {
    this.state.onboardingDefaults = defaults;
    this.state.progress.onboardingDefaults = status;
    this.state.setupState = 'policies';
  }

  async savePolicies(
    _actor: CoachSetupActor,
    policies: PolicyDefaults,
    status: Exclude<SetupProgressStatus, 'pending'>,
  ) {
    this.state.policies = policies;
    this.state.progress.policies = status;
    this.state.setupState = 'first_client';
  }

  async markPreviewed() {
    this.state.progress.preview = 'complete';
    this.state.setupState = 'first_client';
  }
}

class MemoryAssets implements CoachProfileAssetStore {
  confirmed: string | null = null;

  async prepareUpload(input: {
    coachId: string;
    contentType: string;
    size: number;
    tenantId: string;
  }) {
    return {
      headers: { 'content-type': input.contentType },
      objectKey: `tenants/${input.tenantId}/coaches/${input.coachId}/profile/photo.webp`,
      uploadUrl: 'https://uploads.example.test/photo',
    };
  }

  async confirmUpload(objectKey: string) {
    this.confirmed = objectKey;
  }

  async createReadUrl(objectKey: string) {
    return `https://assets.example.test/${objectKey}`;
  }
}

function setup() {
  const store = new MemorySetupStore();
  const assets = new MemoryAssets();
  return { assets, service: new CoachSetupService(store, assets), store };
}

test('TRA-43 repairs a missing agreement template when the invite requires the starter policy', () => {
  assert.equal(
    shouldProvisionStarterAgreement({ contractRequired: true, starterTemplateSelected: true }),
    true,
  );
  assert.equal(
    shouldProvisionStarterAgreement({ contractRequired: false, starterTemplateSelected: true }),
    false,
  );
  assert.equal(
    shouldProvisionStarterAgreement({ contractRequired: true, starterTemplateSelected: false }),
    false,
  );
  assert.equal(STARTER_AGREEMENT_NAME, 'Traverse Starter Coaching Agreement');
  const agreement = starterAgreement({
    cancellationNoticeHours: 48,
    cancellationSummary: '',
    refundPolicy: 'flexible',
  });
  assert.match(agreement, /48 hours notice is requested/);
  assert.match(agreement, /Refund policy: flexible/);
});

test('TRA-39 resumes required setup before optional choices', async () => {
  const { service } = setup();
  const snapshot = await service.get(actor);
  assert.equal(snapshot.nextStep, 'practice');
  assert.deepEqual(
    snapshot.checklist.slice(0, 2).map((item) => item.status),
    ['pending', 'pending'],
  );
});

test('TRA-39 advances through defaults, preview, and dashboard handoff', async () => {
  const { service } = setup();
  let snapshot = await service.savePracticeProfile(actor, {
    businessAddress: '',
    businessEmail: 'hello@example.com',
    displayName: 'North Star Coaching',
    legalName: '',
    phone: '',
    timezone: 'America/Toronto',
    websiteUrl: 'northstar.example',
  });
  assert.equal(snapshot.nextStep, 'coach');
  assert.equal(snapshot.practice.websiteUrl, 'https://northstar.example/');

  snapshot = await service.saveCoachProfile(actor, {
    bio: 'Leadership coach.',
    discipline: 'Leadership coaching',
    displayName: 'Maya Patel',
    specialties: ['Leadership'],
  });
  assert.equal(snapshot.nextStep, 'branding');

  snapshot = await service.skipOptional(actor, 'branding');
  assert.equal(snapshot.nextStep, 'payments');
  snapshot = await service.skipOptional(actor, 'payments');
  assert.equal(snapshot.nextStep, 'defaults');
  snapshot = await service.useDefaultOnboarding(actor);
  assert.equal(snapshot.nextStep, 'policies');
  assert.equal(snapshot.progress.onboardingDefaults, 'skipped');
  snapshot = await service.useDefaultPolicies(actor);
  assert.equal(snapshot.nextStep, 'preview');
  snapshot = await service.markPreviewed(actor);
  assert.equal(snapshot.nextStep, 'dashboard');
  assert.equal(snapshot.setupState, 'first_client');
});

test('TRA-39 keeps the payment gate off until Stripe Connect exists', async () => {
  const { service, store } = setup();
  await service.saveOnboardingDefaults(actor, {
    contractRequired: true,
    countersignatureRequired: false,
    intakeRequired: true,
    inviteExpiryDays: 14,
    paymentRequired: true,
    reminderCadenceDays: [3, 7],
  });
  assert.equal(store.state.onboardingDefaults.paymentRequired, false);
});

test('TRA-39 requires an agreement when the contract gate is on', async () => {
  const { service } = setup();
  await assert.rejects(
    service.savePolicies(actor, {
      ...TRAVERSE_POLICY_DEFAULTS,
      starterTemplateSelected: false,
    }),
    /Select the starter agreement/,
  );
});

test('TRA-39 applies safe defaults when a completed profile jumps to preview', async () => {
  const { service, store } = setup();
  store.state.setupState = 'onboarding_defaults';
  const snapshot = await service.markPreviewed(actor);
  assert.equal(snapshot.nextStep, 'dashboard');
  assert.deepEqual(snapshot.progress, {
    branding: 'skipped',
    onboardingDefaults: 'skipped',
    payments: 'skipped',
    policies: 'skipped',
    preview: 'complete',
  });
});

test('TRA-39 validates and confirms a tenant-scoped profile photo upload', async () => {
  const { assets, service } = setup();
  const prepared = await service.prepareProfilePhoto(actor, {
    contentType: 'image/webp',
    size: 1024,
  });
  assert.match(prepared.objectKey, /tenants\/11111111.*\/profile\/photo\.webp$/);

  const snapshot = await service.confirmProfilePhoto(actor, { objectKey: prepared.objectKey });
  assert.equal(assets.confirmed, prepared.objectKey);
  assert.match(snapshot.coach.profilePhotoUrl ?? '', /^https:\/\/assets\.example\.test\//);

  await assert.rejects(
    service.confirmProfilePhoto(actor, {
      objectKey: 'tenants/another-practice/coaches/another-coach/profile/photo.webp',
    }),
    /outside the coach asset scope/,
  );
  await assert.rejects(
    service.prepareProfilePhoto(actor, { contentType: 'image/svg+xml', size: 100 }),
    /JPEG, PNG, or WebP/,
  );
});
