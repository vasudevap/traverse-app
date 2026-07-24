import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { JsonValue } from '@traverse/db';
import { createOpaqueToken, hashOpaqueToken, hashPassword } from './auth-security.js';

export const CLIENT_ONBOARDING_STORE = Symbol('CLIENT_ONBOARDING_STORE');

export interface CoachOnboardingActor {
  coachId: string;
  practiceRole: 'coach' | 'owner';
  tenantId: string;
  userId: string;
}

export interface ClientOnboardingActor {
  clientId: string;
  userId: string;
}

export interface OnboardingGateConfig {
  contractRequired: boolean;
  countersignatureRequired: boolean;
  intakeRequired: boolean;
  paymentRequired: false;
}

export interface InviteOptions {
  defaults: OnboardingGateConfig & {
    inviteExpiryDays: number;
    reminderCadenceDays: number[];
  };
  forms: Array<{ id: string; name: string; version: number }>;
  templates: Array<{ id: string; name: string; version: number }>;
}

export interface InviteSummary {
  clientName: string;
  email: string;
  expiresAt: Date;
  id: string;
  relationshipId: string;
  status: 'invited';
}

export interface InvitePreview {
  clientName: string;
  coachName: string;
  expiresAt: Date;
  gates: OnboardingGateConfig;
  inviteId: string;
  practiceName: string;
  welcomeMessage: string;
}

export interface OnboardingSnapshot {
  coach: { name: string; practiceName: string };
  contract: null | {
    body: string;
    clientSigned: boolean;
    coachSigned: boolean;
    id: string;
    name: string;
  };
  gates: OnboardingGateConfig;
  intake: null | {
    fields: Array<{
      id: string;
      label: string;
      required: boolean;
      type: 'long_text' | 'short_text';
    }>;
    id: string;
    name: string;
    submitted: boolean;
  };
  relationshipId: string;
  state: string;
}

export interface CoachContractSnapshot {
  body: string;
  clientName: string;
  clientSigned: boolean;
  coachSigned: boolean;
  id: string;
  name: string;
  relationshipId: string;
  state: string;
}

export interface AcceptInviteResult {
  relationshipId: string;
  snapshot: OnboardingSnapshot;
  userId: string;
}

export interface ClientOnboardingStore {
  acceptInvite(input: {
    passwordHash: string | null;
    tokenHash: Buffer;
  }): Promise<AcceptInviteResult | undefined>;
  close?(): Promise<void>;
  countersignContract(input: {
    actor: CoachOnboardingActor;
    contractId: string;
    ip: string | null;
    signerName: string;
    userAgent: string | null;
  }): Promise<OnboardingSnapshot | undefined>;
  createInvite(input: {
    actor: CoachOnboardingActor;
    clientName: string;
    contractTemplateId: string | null;
    email: string;
    expiresAt: Date;
    gates: OnboardingGateConfig;
    intakeFormId: string | null;
    phone: string | null;
    rawToken: string;
    tokenHash: Buffer;
  }): Promise<InviteSummary>;
  declineInvite(tokenHash: Buffer): Promise<boolean>;
  getInviteOptions(actor: CoachOnboardingActor): Promise<InviteOptions>;
  getCoachContract(
    actor: CoachOnboardingActor,
    contractId: string,
  ): Promise<CoachContractSnapshot | undefined>;
  getOnboarding(
    actor: ClientOnboardingActor,
    relationshipId: string,
  ): Promise<OnboardingSnapshot | undefined>;
  getPendingOnboarding(actor: ClientOnboardingActor): Promise<OnboardingSnapshot[]>;
  inspectInvite(tokenHash: Buffer): Promise<InvitePreview | undefined>;
  resendInvite(input: {
    actor: CoachOnboardingActor;
    expiresAt: Date;
    inviteId: string;
    rawToken: string;
    tokenHash: Buffer;
  }): Promise<InviteSummary | undefined>;
  revokeInvite(actor: CoachOnboardingActor, inviteId: string): Promise<boolean>;
  signContract(input: {
    actor: ClientOnboardingActor;
    consentText: string;
    contractId: string;
    ip: string | null;
    relationshipId: string;
    signerName: string;
    userAgent: string | null;
  }): Promise<OnboardingSnapshot | undefined>;
  submitIntake(input: {
    actor: ClientOnboardingActor;
    answers: Record<string, string>;
    relationshipId: string;
  }): Promise<OnboardingSnapshot | undefined>;
}

function requiredString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException(`${label} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new BadRequestException(`${label} must be ${max} characters or fewer.`);
  }
  return normalized;
}

function optionalString(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredString(value, label, max);
}

function emailValue(value: unknown): string {
  const email = requiredString(value, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException('email must be a valid email address.');
  }
  return email;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function integerValue(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new BadRequestException(`inviteExpiryDays must be an integer from ${min} to ${max}.`);
  }
  return value as number;
}

function gates(value: unknown, defaults: OnboardingGateConfig): OnboardingGateConfig {
  const input =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const contractRequired = booleanValue(input.contractRequired, defaults.contractRequired);
  return {
    contractRequired,
    countersignatureRequired:
      contractRequired &&
      booleanValue(input.countersignatureRequired, defaults.countersignatureRequired),
    intakeRequired: booleanValue(input.intakeRequired, defaults.intakeRequired),
    paymentRequired: false,
  };
}

function nullableId(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const id = requiredString(value, label, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new BadRequestException(`${label} must be a valid id.`);
  }
  return id;
}

function answersValue(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('answers must be an object.');
  }
  const answers: Record<string, string> = {};
  for (const [key, answer] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/i.test(key) || typeof answer !== 'string') {
      throw new BadRequestException('answers contain an invalid field.');
    }
    const normalized = answer.trim();
    if (normalized.length > 4_000) {
      throw new BadRequestException('Intake answers must be 4000 characters or fewer.');
    }
    answers[key] = normalized;
  }
  return answers;
}

@Injectable()
export class ClientOnboardingService implements OnApplicationShutdown {
  constructor(
    @Inject(CLIENT_ONBOARDING_STORE)
    private readonly store: ClientOnboardingStore,
  ) {}

  getInviteOptions(actor: CoachOnboardingActor): Promise<InviteOptions> {
    return this.store.getInviteOptions(actor);
  }

  async getCoachContract(
    actor: CoachOnboardingActor,
    contractId: string,
  ): Promise<CoachContractSnapshot> {
    const contract = await this.store.getCoachContract(
      actor,
      requiredString(contractId, 'contractId', 36),
    );
    if (contract === undefined) throw new NotFoundException();
    return contract;
  }

  async createInvite(
    actor: CoachOnboardingActor,
    body: Record<string, unknown>,
  ): Promise<Omit<InviteSummary, 'expiresAt'> & { expiresAt: string }> {
    const options = await this.store.getInviteOptions(actor);
    const gateConfig = gates(body.gates, options.defaults);
    const contractTemplateId = nullableId(body.contractTemplateId, 'contractTemplateId');
    const intakeFormId = nullableId(body.intakeFormId, 'intakeFormId');
    if (gateConfig.contractRequired && contractTemplateId === null) {
      throw new BadRequestException('Select an agreement for this client.');
    }
    if (gateConfig.intakeRequired && intakeFormId === null) {
      throw new BadRequestException('Select an intake form for this client.');
    }
    const expiryDays = integerValue(
      body.inviteExpiryDays,
      options.defaults.inviteExpiryDays,
      1,
      30,
    );
    const rawToken = createOpaqueToken();
    try {
      const created = await this.store.createInvite({
        actor,
        clientName: requiredString(body.clientName, 'clientName', 160),
        contractTemplateId,
        email: emailValue(body.email),
        expiresAt: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000),
        gates: gateConfig,
        intakeFormId,
        phone: optionalString(body.phone, 'phone', 40),
        rawToken,
        tokenHash: hashOpaqueToken(rawToken),
      });
      return { ...created, expiresAt: created.expiresAt.toISOString() };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('An active invitation already exists for this client.');
      }
      throw error;
    }
  }

  async inspectInvite(
    rawToken: string,
  ): Promise<Omit<InvitePreview, 'expiresAt'> & { expiresAt: string }> {
    const preview = await this.store.inspectInvite(
      hashOpaqueToken(requiredString(rawToken, 'token', 200)),
    );
    if (preview === undefined) throw new NotFoundException('Invitation is invalid or expired.');
    return { ...preview, expiresAt: preview.expiresAt.toISOString() };
  }

  async acceptInvite(rawToken: string, body: Record<string, unknown>): Promise<AcceptInviteResult> {
    const mode = body.mode === 'password' ? 'password' : 'magic_link';
    const passwordHash =
      mode === 'password'
        ? await hashPassword(requiredString(body.password, 'password', 200)).catch(
            (error: unknown) => {
              throw new BadRequestException(
                error instanceof Error ? error.message : 'Password is not valid.',
              );
            },
          )
        : null;
    const accepted = await this.store.acceptInvite({
      passwordHash,
      tokenHash: hashOpaqueToken(requiredString(rawToken, 'token', 200)),
    });
    if (accepted === undefined) throw new NotFoundException('Invitation is invalid or expired.');
    return accepted;
  }

  async declineInvite(rawToken: string): Promise<{ status: 'declined' }> {
    const declined = await this.store.declineInvite(
      hashOpaqueToken(requiredString(rawToken, 'token', 200)),
    );
    if (!declined) throw new NotFoundException('Invitation is invalid or expired.');
    return { status: 'declined' };
  }

  async resendInvite(
    actor: CoachOnboardingActor,
    inviteId: string,
    body: Record<string, unknown>,
  ): Promise<Omit<InviteSummary, 'expiresAt'> & { expiresAt: string }> {
    const options = await this.store.getInviteOptions(actor);
    const expiryDays = integerValue(
      body.inviteExpiryDays,
      options.defaults.inviteExpiryDays,
      1,
      30,
    );
    const rawToken = createOpaqueToken();
    const invite = await this.store.resendInvite({
      actor,
      expiresAt: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000),
      inviteId: requiredString(inviteId, 'inviteId', 36),
      rawToken,
      tokenHash: hashOpaqueToken(rawToken),
    });
    if (invite === undefined) throw new NotFoundException('Invitation was not found.');
    return { ...invite, expiresAt: invite.expiresAt.toISOString() };
  }

  async revokeInvite(
    actor: CoachOnboardingActor,
    inviteId: string,
  ): Promise<{ status: 'revoked' }> {
    if (!(await this.store.revokeInvite(actor, requiredString(inviteId, 'inviteId', 36)))) {
      throw new NotFoundException('Invitation was not found.');
    }
    return { status: 'revoked' };
  }

  async getOnboarding(
    actor: ClientOnboardingActor,
    relationshipId: string,
  ): Promise<OnboardingSnapshot> {
    const snapshot = await this.store.getOnboarding(
      actor,
      requiredString(relationshipId, 'relationshipId', 36),
    );
    if (snapshot === undefined) throw new NotFoundException();
    return snapshot;
  }

  getPendingOnboarding(actor: ClientOnboardingActor): Promise<OnboardingSnapshot[]> {
    return this.store.getPendingOnboarding(actor);
  }

  async signContract(
    actor: ClientOnboardingActor,
    relationshipId: string,
    contractId: string,
    body: Record<string, unknown>,
    request: { ip: string | null; userAgent: string | null },
  ): Promise<OnboardingSnapshot> {
    if (body.agreed !== true) {
      throw new BadRequestException('Agreement consent is required.');
    }
    const snapshot = await this.store.signContract({
      actor,
      consentText: 'I have read and agree to this coaching agreement.',
      contractId: requiredString(contractId, 'contractId', 36),
      ip: request.ip,
      relationshipId: requiredString(relationshipId, 'relationshipId', 36),
      signerName: requiredString(body.signerName, 'signerName', 160),
      userAgent: request.userAgent,
    });
    if (snapshot === undefined) throw new NotFoundException();
    return snapshot;
  }

  async countersignContract(
    actor: CoachOnboardingActor,
    contractId: string,
    body: Record<string, unknown>,
    request: { ip: string | null; userAgent: string | null },
  ): Promise<OnboardingSnapshot> {
    if (body.agreed !== true) {
      throw new BadRequestException('Agreement consent is required.');
    }
    const snapshot = await this.store.countersignContract({
      actor,
      contractId: requiredString(contractId, 'contractId', 36),
      ip: request.ip,
      signerName: requiredString(body.signerName, 'signerName', 160),
      userAgent: request.userAgent,
    });
    if (snapshot === undefined) throw new NotFoundException();
    return snapshot;
  }

  async submitIntake(
    actor: ClientOnboardingActor,
    relationshipId: string,
    body: Record<string, unknown>,
  ): Promise<OnboardingSnapshot> {
    const snapshot = await this.store.submitIntake({
      actor,
      answers: answersValue(body.answers),
      relationshipId: requiredString(relationshipId, 'relationshipId', 36),
    });
    if (snapshot === undefined) throw new NotFoundException();
    return snapshot;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.store.close?.();
  }
}

export function asJsonGates(gateConfig: OnboardingGateConfig): JsonValue {
  return {
    contractRequired: gateConfig.contractRequired,
    countersignatureRequired: gateConfig.countersignatureRequired,
    intakeRequired: gateConfig.intakeRequired,
    paymentRequired: false,
  };
}
