import type { Kysely } from 'kysely';
import type { ActorRole, Database, PracticeRole } from './schema.js';

export interface AuthSubject {
  clientId: string | null;
  coachId: string | null;
  email: string;
  name: string;
  passwordHash: string | null;
  practiceRole: PracticeRole | null;
  role: ActorRole;
  status: string;
  tenantId: string | null;
  userId: string;
}

export interface AuthenticatedSession extends Omit<AuthSubject, 'passwordHash'> {
  expiresAt: Date;
  lastSeenAt: Date;
  sessionId: string;
}

export interface RotateSessionInput {
  expiresAt: Date;
  ip: string | null;
  previousTokenHash?: Buffer;
  role: ActorRole;
  tokenHash: Buffer;
  userAgent: string | null;
  userId: string;
}

export interface AuthSessionStore {
  close?(): Promise<void>;
  findSubject(email: string, role: ActorRole): Promise<AuthSubject | undefined>;
  findSubjectByUserId(userId: string, role: ActorRole): Promise<AuthSubject | undefined>;
  revokeSession(tokenHash: Buffer, role: ActorRole, revokedAt: Date): Promise<boolean>;
  rotateSession(input: RotateSessionInput): Promise<void>;
  validateSession(
    tokenHash: Buffer,
    role: ActorRole,
    idleTimeoutMs: number,
    now: Date,
  ): Promise<AuthenticatedSession | undefined>;
}

function mapSubject(row: {
  client_id: string | null;
  coach_id: string | null;
  email: string;
  name: string;
  password_hash: string | null;
  practice_role: PracticeRole | null;
  role: ActorRole;
  status: string;
  tenant_id: string | null;
  user_id: string;
}): AuthSubject {
  return {
    clientId: row.client_id,
    coachId: row.coach_id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    practiceRole: row.practice_role,
    role: row.role,
    status: row.status,
    tenantId: row.tenant_id,
    userId: row.user_id,
  };
}

export class DatabaseAuthSessionStore implements AuthSessionStore {
  constructor(private readonly database: Kysely<Database>) {}

  async close(): Promise<void> {
    await this.database.destroy();
  }

  async findSubject(email: string, role: ActorRole): Promise<AuthSubject | undefined> {
    const database = this.database.withSchema('app');
    const row = await database
      .selectFrom('users as user')
      .innerJoin('auth_subjects as subject', 'subject.user_id', 'user.id')
      .select([
        'subject.client_id',
        'subject.coach_id',
        'user.email',
        'user.name',
        'user.password_hash',
        'subject.practice_role',
        'subject.role',
        'user.status',
        'subject.tenant_id',
        'user.id as user_id',
      ])
      .where('user.email', '=', email)
      .where('subject.role', '=', role)
      .executeTakeFirst();

    return row === undefined ? undefined : mapSubject(row);
  }

  async findSubjectByUserId(userId: string, role: ActorRole): Promise<AuthSubject | undefined> {
    const database = this.database.withSchema('app');
    const row = await database
      .selectFrom('users as user')
      .innerJoin('auth_subjects as subject', 'subject.user_id', 'user.id')
      .select([
        'subject.client_id',
        'subject.coach_id',
        'user.email',
        'user.name',
        'user.password_hash',
        'subject.practice_role',
        'subject.role',
        'user.status',
        'subject.tenant_id',
        'user.id as user_id',
      ])
      .where('user.id', '=', userId)
      .where('subject.role', '=', role)
      .executeTakeFirst();

    return row === undefined ? undefined : mapSubject(row);
  }

  async rotateSession(input: RotateSessionInput): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      const database = transaction.withSchema('app');
      if (input.previousTokenHash !== undefined) {
        await database
          .updateTable('sessions')
          .set({ revoked_at: new Date() })
          .where('token_hash', '=', input.previousTokenHash)
          .where('role', '=', input.role)
          .where('user_id', '=', input.userId)
          .where('revoked_at', 'is', null)
          .execute();
      }

      await database
        .insertInto('sessions')
        .values({
          expires_at: input.expiresAt,
          ip: input.ip,
          last_seen_at: new Date(),
          revoked_at: null,
          role: input.role,
          token_hash: input.tokenHash,
          user_agent: input.userAgent,
          user_id: input.userId,
        })
        .executeTakeFirstOrThrow();
    });
  }

  async validateSession(
    tokenHash: Buffer,
    role: ActorRole,
    idleTimeoutMs: number,
    now: Date,
  ): Promise<AuthenticatedSession | undefined> {
    return this.database.transaction().execute(async (transaction) => {
      const database = transaction.withSchema('app');
      const row = await database
        .selectFrom('sessions as session')
        .innerJoin('users as user', 'user.id', 'session.user_id')
        .innerJoin('auth_subjects as subject', (join) =>
          join
            .onRef('subject.user_id', '=', 'session.user_id')
            .onRef('subject.role', '=', 'session.role'),
        )
        .select([
          'subject.client_id',
          'subject.coach_id',
          'user.email',
          'session.expires_at',
          'session.id as session_id',
          'session.last_seen_at',
          'user.name',
          'user.password_hash',
          'subject.practice_role',
          'session.revoked_at',
          'session.role',
          'user.status',
          'subject.tenant_id',
          'session.user_id',
        ])
        .where('session.token_hash', '=', tokenHash)
        .where('session.role', '=', role)
        .forUpdate()
        .executeTakeFirst();

      if (row === undefined || row.revoked_at !== null || row.status !== 'active') {
        return undefined;
      }

      const idleExpiresAt = row.last_seen_at.getTime() + idleTimeoutMs;
      if (row.expires_at <= now || idleExpiresAt <= now.getTime()) {
        await database
          .updateTable('sessions')
          .set({ revoked_at: now })
          .where('id', '=', row.session_id)
          .where('revoked_at', 'is', null)
          .execute();
        return undefined;
      }

      const updated = await database
        .updateTable('sessions')
        .set({ last_seen_at: now })
        .where('id', '=', row.session_id)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      if (updated.numUpdatedRows !== 1n) {
        return undefined;
      }

      const subject = mapSubject(row);
      return {
        clientId: subject.clientId,
        coachId: subject.coachId,
        email: subject.email,
        expiresAt: row.expires_at,
        lastSeenAt: now,
        name: subject.name,
        practiceRole: subject.practiceRole,
        role: subject.role,
        sessionId: row.session_id,
        status: subject.status,
        tenantId: subject.tenantId,
        userId: subject.userId,
      };
    });
  }

  async revokeSession(tokenHash: Buffer, role: ActorRole, revokedAt: Date): Promise<boolean> {
    const result = await this.database
      .withSchema('app')
      .updateTable('sessions')
      .set({ revoked_at: revokedAt })
      .where('token_hash', '=', tokenHash)
      .where('role', '=', role)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows === 1n;
  }
}
