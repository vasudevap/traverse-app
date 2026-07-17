import { BadRequestException, Inject, Injectable } from '@nestjs/common';

export const COACH_SETUP_STORE = Symbol('COACH_SETUP_STORE');
export const COACH_PROFILE_ASSET_STORE = Symbol('COACH_PROFILE_ASSET_STORE');

export type SetupState =
  | 'coach_profile'
  | 'complete'
  | 'first_client'
  | 'onboarding_defaults'
  | 'policies'
  | 'practice_profile';
export type SetupProgressStatus = 'complete' | 'pending' | 'skipped';
export type SetupProgressItem =
  'branding' | 'onboardingDefaults' | 'payments' | 'policies' | 'preview';
export type SetupStep =
  | 'branding'
  | 'coach'
  | 'dashboard'
  | 'defaults'
  | 'payments'
  | 'policies'
  | 'practice'
  | 'preview';

export interface CoachSetupActor {
  coachId: string;
  practiceRole: 'owner';
  tenantId: string;
  userId: string;
}

export interface PracticeProfile {
  businessAddress: string;
  businessEmail: string;
  displayName: string;
  legalName: string;
  phone: string;
  timezone: string;
  websiteUrl: string;
}

export interface CoachProfile {
  bio: string;
  discipline: string;
  displayName: string;
  profilePhotoRef: string | null;
  specialties: string[];
}

export interface OnboardingDefaults {
  contractRequired: boolean;
  countersignatureRequired: boolean;
  intakeRequired: boolean;
  inviteExpiryDays: number;
  paymentRequired: false;
  reminderCadenceDays: number[];
}

export interface PolicyDefaults {
  cancellationNoticeHours: number;
  cancellationSummary: string;
  refundPolicy: 'flexible' | 'standard' | 'strict';
  starterTemplateSelected: boolean;
  welcomeMessage: string;
}

export interface SetupProgress {
  branding: SetupProgressStatus;
  onboardingDefaults: SetupProgressStatus;
  payments: SetupProgressStatus;
  policies: SetupProgressStatus;
  preview: SetupProgressStatus;
}

export interface StoredCoachSetup {
  agreementTemplate: { id: string; name: string } | null;
  coach: CoachProfile;
  onboardingDefaults: OnboardingDefaults;
  plan: { code: string; name: string; trialEndsAt: Date };
  policies: PolicyDefaults;
  practice: PracticeProfile;
  progress: SetupProgress;
  setupState: SetupState;
}

export interface SetupChecklistItem {
  label: string;
  required: boolean;
  status: SetupProgressStatus;
  step: SetupStep;
}

export interface CoachSetupSnapshot extends Omit<StoredCoachSetup, 'coach' | 'plan'> {
  checklist: SetupChecklistItem[];
  coach: CoachProfile & { profilePhotoUrl: string | null };
  nextStep: SetupStep;
  plan: { code: string; name: string; trialEndsAt: string };
}

export interface CoachSetupStore {
  get(actor: CoachSetupActor): Promise<StoredCoachSetup>;
  markOptionalSkipped(actor: CoachSetupActor, item: 'branding' | 'payments'): Promise<void>;
  markPreviewed(actor: CoachSetupActor): Promise<void>;
  saveCoachProfile(
    actor: CoachSetupActor,
    profile: Omit<CoachProfile, 'profilePhotoRef'>,
  ): Promise<void>;
  saveOnboardingDefaults(
    actor: CoachSetupActor,
    defaults: OnboardingDefaults,
    status: Exclude<SetupProgressStatus, 'pending'>,
  ): Promise<void>;
  savePolicies(
    actor: CoachSetupActor,
    policies: PolicyDefaults,
    status: Exclude<SetupProgressStatus, 'pending'>,
  ): Promise<void>;
  savePracticeProfile(actor: CoachSetupActor, profile: PracticeProfile): Promise<void>;
  saveProfilePhoto(actor: CoachSetupActor, objectKey: string): Promise<void>;
}

export interface ProfilePhotoUpload {
  headers: Record<string, string>;
  objectKey: string;
  uploadUrl: string;
}

export interface CoachProfileAssetStore {
  confirmUpload(objectKey: string): Promise<void>;
  createReadUrl(objectKey: string): Promise<string>;
  prepareUpload(input: {
    coachId: string;
    contentType: string;
    size: number;
    tenantId: string;
  }): Promise<ProfilePhotoUpload>;
}

export const TRAVERSE_ONBOARDING_DEFAULTS: OnboardingDefaults = {
  contractRequired: true,
  countersignatureRequired: false,
  intakeRequired: true,
  inviteExpiryDays: 14,
  paymentRequired: false,
  reminderCadenceDays: [3, 7],
};

export const TRAVERSE_POLICY_DEFAULTS: PolicyDefaults = {
  cancellationNoticeHours: 24,
  cancellationSummary: 'Please give at least 24 hours notice when you need to reschedule.',
  refundPolicy: 'standard',
  starterTemplateSelected: true,
  welcomeMessage: 'Glad you are here. I am looking forward to working together.',
};

const SETUP_STATE_ORDER: SetupState[] = [
  'practice_profile',
  'coach_profile',
  'onboarding_defaults',
  'policies',
  'first_client',
  'complete',
];
const PROFILE_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

function stringValue(
  value: unknown,
  label: string,
  options: { max: number; required?: boolean },
): string {
  if (typeof value !== 'string') {
    if (options.required === true) throw new BadRequestException(`${label} is required.`);
    return '';
  }
  const normalized = value.trim();
  if (options.required === true && normalized === '') {
    throw new BadRequestException(`${label} is required.`);
  }
  if (normalized.length > options.max) {
    throw new BadRequestException(`${label} must be ${options.max} characters or fewer.`);
  }
  return normalized;
}

function emailValue(value: unknown): string {
  const email = stringValue(value, 'businessEmail', { max: 254 });
  if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException('businessEmail must be a valid email address.');
  }
  return email.toLowerCase();
}

function timezoneValue(value: unknown): string {
  const timezone = stringValue(value, 'timezone', { max: 100, required: true });
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
  } catch {
    throw new BadRequestException('timezone must be a valid IANA timezone.');
  }
  return timezone;
}

function websiteValue(value: unknown): string {
  const website = stringValue(value, 'websiteUrl', { max: 300 });
  if (website === '') return '';
  const withProtocol = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  try {
    const url = new URL(withProtocol);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol.');
    return url.toString();
  } catch {
    throw new BadRequestException('websiteUrl must be a valid web address.');
  }
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new BadRequestException(`${label} must be true or false.`);
  }
  return value;
}

function integerValue(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new BadRequestException(`${label} must be an integer from ${min} to ${max}.`);
  }
  return value as number;
}

function stateAtLeast(current: SetupState, expected: SetupState): boolean {
  return SETUP_STATE_ORDER.indexOf(current) >= SETUP_STATE_ORDER.indexOf(expected);
}

function checklist(snapshot: StoredCoachSetup): SetupChecklistItem[] {
  const practiceComplete =
    snapshot.practice.displayName !== '' && stateAtLeast(snapshot.setupState, 'coach_profile');
  const coachComplete =
    snapshot.coach.displayName !== '' &&
    snapshot.coach.discipline !== '' &&
    stateAtLeast(snapshot.setupState, 'onboarding_defaults');
  return [
    {
      label: 'Practice profile',
      required: true,
      status: practiceComplete ? 'complete' : 'pending',
      step: 'practice',
    },
    {
      label: 'Coach profile',
      required: true,
      status: coachComplete ? 'complete' : 'pending',
      step: 'coach',
    },
    {
      label: 'Branding',
      required: false,
      status: snapshot.progress.branding,
      step: 'branding',
    },
    {
      label: 'Connect payments',
      required: false,
      status: snapshot.progress.payments,
      step: 'payments',
    },
    {
      label: 'Onboarding defaults',
      required: false,
      status: snapshot.progress.onboardingDefaults,
      step: 'defaults',
    },
    {
      label: 'Policies and agreement',
      required: false,
      status: snapshot.progress.policies,
      step: 'policies',
    },
  ];
}

function nextStep(snapshot: StoredCoachSetup): SetupStep {
  const items = checklist(snapshot);
  const pendingRequired = items.find((item) => item.required && item.status === 'pending');
  if (pendingRequired !== undefined) return pendingRequired.step;
  const pendingOptional = items.find((item) => !item.required && item.status === 'pending');
  if (pendingOptional !== undefined) return pendingOptional.step;
  if (snapshot.progress.preview === 'pending') return 'preview';
  return 'dashboard';
}

function specialtiesValue(value: unknown): string[] {
  if (!Array.isArray(value)) throw new BadRequestException('specialties must be a list.');
  if (value.length > 10) throw new BadRequestException('specialties can contain at most 10 items.');
  const specialties = value.map((entry) =>
    stringValue(entry, 'specialty', { max: 60, required: true }),
  );
  return [...new Set(specialties)];
}

function reminderCadenceValue(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 4) {
    throw new BadRequestException('reminderCadenceDays must contain up to 4 days.');
  }
  const days = value.map((day) => integerValue(day, 'reminder day', 1, 30));
  return [...new Set(days)].sort((left, right) => left - right);
}

@Injectable()
export class CoachSetupService {
  constructor(
    @Inject(COACH_SETUP_STORE)
    private readonly store: CoachSetupStore,
    @Inject(COACH_PROFILE_ASSET_STORE)
    private readonly assets: CoachProfileAssetStore,
  ) {}

  async get(actor: CoachSetupActor): Promise<CoachSetupSnapshot> {
    const stored = await this.store.get(actor);
    const profilePhotoUrl =
      stored.coach.profilePhotoRef === null
        ? null
        : await this.assets.createReadUrl(stored.coach.profilePhotoRef);
    return {
      ...stored,
      checklist: checklist(stored),
      coach: { ...stored.coach, profilePhotoUrl },
      nextStep: nextStep(stored),
      plan: { ...stored.plan, trialEndsAt: stored.plan.trialEndsAt.toISOString() },
    };
  }

  async savePracticeProfile(actor: CoachSetupActor, input: Record<string, unknown>) {
    await this.store.savePracticeProfile(actor, {
      businessAddress: stringValue(input.businessAddress, 'businessAddress', { max: 500 }),
      businessEmail: emailValue(input.businessEmail),
      displayName: stringValue(input.displayName, 'displayName', { max: 120, required: true }),
      legalName: stringValue(input.legalName, 'legalName', { max: 200 }),
      phone: stringValue(input.phone, 'phone', { max: 40 }),
      timezone: timezoneValue(input.timezone),
      websiteUrl: websiteValue(input.websiteUrl),
    });
    return this.get(actor);
  }

  async saveCoachProfile(actor: CoachSetupActor, input: Record<string, unknown>) {
    await this.store.saveCoachProfile(actor, {
      bio: stringValue(input.bio, 'bio', { max: 600 }),
      discipline: stringValue(input.discipline, 'discipline', { max: 120, required: true }),
      displayName: stringValue(input.displayName, 'displayName', { max: 120, required: true }),
      specialties: specialtiesValue(input.specialties),
    });
    return this.get(actor);
  }

  async prepareProfilePhoto(actor: CoachSetupActor, input: Record<string, unknown>) {
    const contentType = stringValue(input.contentType, 'contentType', { max: 100, required: true });
    const size = integerValue(input.size, 'size', 1, PROFILE_PHOTO_MAX_BYTES);
    if (!PROFILE_PHOTO_TYPES.has(contentType)) {
      throw new BadRequestException('Profile photo must be a JPEG, PNG, or WebP image.');
    }
    return this.assets.prepareUpload({ ...actor, contentType, size });
  }

  async confirmProfilePhoto(actor: CoachSetupActor, input: Record<string, unknown>) {
    const objectKey = stringValue(input.objectKey, 'objectKey', { max: 500, required: true });
    const prefix = `tenants/${actor.tenantId}/coaches/${actor.coachId}/profile/`;
    if (!objectKey.startsWith(prefix)) {
      throw new BadRequestException('Profile photo key is outside the coach asset scope.');
    }
    await this.assets.confirmUpload(objectKey);
    await this.store.saveProfilePhoto(actor, objectKey);
    return this.get(actor);
  }

  async skipOptional(actor: CoachSetupActor, item: string) {
    if (item !== 'branding' && item !== 'payments') {
      throw new BadRequestException('Only branding or payments can be skipped here.');
    }
    await this.store.markOptionalSkipped(actor, item);
    return this.get(actor);
  }

  async saveOnboardingDefaults(actor: CoachSetupActor, input: Record<string, unknown>) {
    const contractRequired = booleanValue(input.contractRequired, 'contractRequired');
    await this.store.saveOnboardingDefaults(
      actor,
      {
        contractRequired,
        countersignatureRequired:
          contractRequired &&
          booleanValue(input.countersignatureRequired, 'countersignatureRequired'),
        intakeRequired: booleanValue(input.intakeRequired, 'intakeRequired'),
        inviteExpiryDays: integerValue(input.inviteExpiryDays, 'inviteExpiryDays', 1, 30),
        paymentRequired: false,
        reminderCadenceDays: reminderCadenceValue(input.reminderCadenceDays),
      },
      'complete',
    );
    return this.get(actor);
  }

  async useDefaultOnboarding(actor: CoachSetupActor) {
    await this.store.saveOnboardingDefaults(actor, TRAVERSE_ONBOARDING_DEFAULTS, 'skipped');
    return this.get(actor);
  }

  async savePolicies(actor: CoachSetupActor, input: Record<string, unknown>) {
    const refundPolicy = stringValue(input.refundPolicy, 'refundPolicy', {
      max: 20,
      required: true,
    });
    if (!['flexible', 'standard', 'strict'].includes(refundPolicy)) {
      throw new BadRequestException('refundPolicy must be flexible, standard, or strict.');
    }
    const starterTemplateSelected = booleanValue(
      input.starterTemplateSelected,
      'starterTemplateSelected',
    );
    const before = await this.store.get(actor);
    if (before.onboardingDefaults.contractRequired && !starterTemplateSelected) {
      throw new BadRequestException(
        'Select the starter agreement or turn off the contract onboarding gate.',
      );
    }
    await this.store.savePolicies(
      actor,
      {
        cancellationNoticeHours: integerValue(
          input.cancellationNoticeHours,
          'cancellationNoticeHours',
          0,
          168,
        ),
        cancellationSummary: stringValue(input.cancellationSummary, 'cancellationSummary', {
          max: 600,
        }),
        refundPolicy: refundPolicy as PolicyDefaults['refundPolicy'],
        starterTemplateSelected,
        welcomeMessage: stringValue(input.welcomeMessage, 'welcomeMessage', { max: 300 }),
      },
      'complete',
    );
    return this.get(actor);
  }

  async useDefaultPolicies(actor: CoachSetupActor) {
    await this.store.savePolicies(actor, TRAVERSE_POLICY_DEFAULTS, 'skipped');
    return this.get(actor);
  }

  async markPreviewed(actor: CoachSetupActor) {
    let before = await this.store.get(actor);
    const required = checklist(before).filter((item) => item.required);
    if (required.some((item) => item.status !== 'complete')) {
      throw new BadRequestException('Complete the practice and coach profiles before preview.');
    }
    if (before.progress.branding === 'pending') {
      await this.store.markOptionalSkipped(actor, 'branding');
    }
    if (before.progress.payments === 'pending') {
      await this.store.markOptionalSkipped(actor, 'payments');
    }
    if (before.progress.onboardingDefaults === 'pending') {
      await this.store.saveOnboardingDefaults(actor, TRAVERSE_ONBOARDING_DEFAULTS, 'skipped');
    }
    before = await this.store.get(actor);
    if (before.progress.policies === 'pending') {
      await this.store.savePolicies(actor, TRAVERSE_POLICY_DEFAULTS, 'skipped');
    }
    await this.store.markPreviewed(actor);
    return this.get(actor);
  }
}
