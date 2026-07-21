import type {
  AuthenticatedSession,
  AuthSessionStore,
  AuthSubject,
  CreatePasswordResetInput,
  RotateSessionInput,
} from '@traverse/db';
import type { AuthRole } from '../src/auth-security.js';

interface StoredSession extends RotateSessionInput {
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

function hashKey(hash: Buffer): string {
  return hash.toString('hex');
}

export class TestAuthSessionStore implements AuthSessionStore {
  readonly sessions = new Map<string, StoredSession>();
  readonly passwordResets = new Map<
    string,
    CreatePasswordResetInput & { userId: string; usedAt: Date | null }
  >();

  constructor(readonly subjects: AuthSubject[] = []) {}

  async findSubject(email: string, role: AuthRole): Promise<AuthSubject | undefined> {
    return this.subjects.find((subject) => subject.email === email && subject.role === role);
  }

  async findSubjectByUserId(userId: string, role: AuthRole): Promise<AuthSubject | undefined> {
    return this.subjects.find((subject) => subject.userId === userId && subject.role === role);
  }

  async createPasswordReset(email: string, input: CreatePasswordResetInput) {
    const subject = this.subjects.find(
      (candidate) =>
        candidate.email === email && candidate.role === input.role && candidate.status === 'active',
    );
    if (subject === undefined) return undefined;
    for (const reset of this.passwordResets.values()) {
      if (reset.userId === subject.userId && reset.usedAt === null) reset.usedAt = new Date();
    }
    this.passwordResets.set(hashKey(input.tokenHash), {
      ...input,
      usedAt: null,
      userId: subject.userId,
    });
    return { email: subject.email, name: subject.name, userId: subject.userId };
  }

  async consumePasswordReset(tokenHash: Buffer, role: AuthRole, passwordHash: string, now: Date) {
    const reset = this.passwordResets.get(hashKey(tokenHash));
    const subject = this.subjects.find(
      (candidate) => candidate.userId === reset?.userId && candidate.role === role,
    );
    if (
      reset === undefined ||
      subject === undefined ||
      reset.usedAt !== null ||
      reset.expiresAt <= now
    )
      return false;
    reset.usedAt = now;
    subject.passwordHash = passwordHash;
    for (const session of this.sessions.values()) {
      if (session.userId === subject.userId && session.revokedAt === null) session.revokedAt = now;
    }
    return true;
  }

  async rotateSession(input: RotateSessionInput): Promise<void> {
    if (input.previousTokenHash !== undefined) {
      const previous = this.sessions.get(hashKey(input.previousTokenHash));
      if (previous?.role === input.role && previous.revokedAt === null) {
        previous.revokedAt = new Date();
      }
    }
    const now = new Date();
    this.sessions.set(hashKey(input.tokenHash), {
      ...input,
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
    });
  }

  async validateSession(
    tokenHash: Buffer,
    role: AuthRole,
    idleTimeoutMs: number,
    now: Date,
  ): Promise<AuthenticatedSession | undefined> {
    const stored = this.sessions.get(hashKey(tokenHash));
    const subject = this.subjects.find(
      (candidate) => candidate.userId === stored?.userId && candidate.role === role,
    );
    if (
      stored === undefined ||
      subject === undefined ||
      stored.role !== role ||
      stored.revokedAt !== null ||
      stored.expiresAt <= now ||
      stored.lastSeenAt.getTime() + idleTimeoutMs <= now.getTime()
    ) {
      return undefined;
    }
    stored.lastSeenAt = now;
    return {
      clientId: subject.clientId,
      coachId: subject.coachId,
      email: subject.email,
      expiresAt: stored.expiresAt,
      lastSeenAt: now,
      name: subject.name,
      practiceRole: subject.practiceRole,
      role: subject.role,
      sessionId: hashKey(tokenHash).slice(0, 36),
      status: subject.status,
      tenantId: subject.tenantId,
      userId: subject.userId,
    };
  }

  async revokeSession(tokenHash: Buffer, role: AuthRole, revokedAt: Date): Promise<boolean> {
    const stored = this.sessions.get(hashKey(tokenHash));
    if (stored === undefined || stored.role !== role || stored.revokedAt !== null) {
      return false;
    }
    stored.revokedAt = revokedAt;
    return true;
  }
}
