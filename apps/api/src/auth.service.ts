import { Inject, Injectable, OnApplicationShutdown, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedSession, AuthSessionStore, AuthSubject } from '@traverse/db';
import {
  createOpaqueToken,
  hashOpaqueToken,
  SESSION_TIMEOUTS,
  sessionExpiresAt,
  verifyPassword,
  type AuthRole,
} from './auth-security.js';

export const AUTH_SESSION_STORE = Symbol('AUTH_SESSION_STORE');

const INVALID_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$f52qSwfjfmMI0xgwSzF2dA$ByzGp4HSgAOUCjDWwSMYQDMYiihYrr6aF99dQJjZ1eg';

export interface LoginInput {
  email: string;
  ip: string | null;
  password: string;
  previousToken?: string;
  role: AuthRole;
  userAgent: string | null;
}

export interface LoginResult {
  csrfToken: string;
  expiresAt: Date;
  sessionToken: string;
  subject: Omit<AuthSubject, 'passwordHash'>;
}

export interface StartSessionInput {
  ip: string | null;
  previousToken?: string;
  role: AuthRole;
  userAgent: string | null;
  userId: string;
}

function publicSubject(subject: AuthSubject): Omit<AuthSubject, 'passwordHash'> {
  return {
    clientId: subject.clientId,
    coachId: subject.coachId,
    email: subject.email,
    name: subject.name,
    practiceRole: subject.practiceRole,
    role: subject.role,
    status: subject.status,
    tenantId: subject.tenantId,
    userId: subject.userId,
  };
}

@Injectable()
export class AuthService implements OnApplicationShutdown {
  constructor(
    @Inject(AUTH_SESSION_STORE)
    private readonly store: AuthSessionStore,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const email = input.email.trim().toLowerCase();
    const subject = await this.store.findSubject(email, input.role);
    const passwordHash = subject?.passwordHash ?? INVALID_PASSWORD_HASH;
    const passwordMatches = await verifyPassword(passwordHash, input.password);

    if (
      subject === undefined ||
      subject.passwordHash === null ||
      subject.status !== 'active' ||
      !passwordMatches
    ) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    return this.createSession(subject, input);
  }

  async startSession(input: StartSessionInput): Promise<LoginResult> {
    const subject = await this.store.findSubjectByUserId(input.userId, input.role);
    if (subject === undefined || subject.status !== 'active') {
      throw new UnauthorizedException('Authentication required.');
    }
    return this.createSession(subject, input);
  }

  private async createSession(
    subject: AuthSubject,
    input: Pick<StartSessionInput, 'ip' | 'previousToken' | 'role' | 'userAgent'>,
  ): Promise<LoginResult> {
    const now = new Date();
    const sessionToken = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const expiresAt = sessionExpiresAt(input.role, now);
    await this.store.rotateSession({
      expiresAt,
      ip: input.ip,
      ...(input.previousToken === undefined
        ? {}
        : { previousTokenHash: hashOpaqueToken(input.previousToken) }),
      role: input.role,
      tokenHash: hashOpaqueToken(sessionToken),
      userAgent: input.userAgent,
      userId: subject.userId,
    });

    return {
      csrfToken,
      expiresAt,
      sessionToken,
      subject: publicSubject(subject),
    };
  }

  async authenticate(token: string, role: AuthRole): Promise<AuthenticatedSession> {
    const session = await this.store.validateSession(
      hashOpaqueToken(token),
      role,
      SESSION_TIMEOUTS[role].idleMs,
      new Date(),
    );
    if (session === undefined) {
      throw new UnauthorizedException('Authentication required.');
    }
    return session;
  }

  async logout(token: string, role: AuthRole): Promise<void> {
    await this.store.revokeSession(hashOpaqueToken(token), role, new Date());
  }

  async onApplicationShutdown(): Promise<void> {
    await this.store.close?.();
  }
}
