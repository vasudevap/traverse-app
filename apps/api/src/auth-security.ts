import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

export type AuthRole = 'admin' | 'billingAdmin' | 'client' | 'coach';

export const PASSWORD_MINIMUM_LENGTH = 10;
export const PASSWORD_HASH_OPTIONS = {
  memoryCost: 64 * 1024,
  parallelism: 4,
  timeCost: 3,
  type: argon2.argon2id,
} as const;

export const SESSION_COOKIE_NAMES: Record<AuthRole, string> = {
  admin: 'trv_s_admin',
  billingAdmin: 'trv_s_ba',
  client: 'trv_s_client',
  coach: 'trv_s_coach',
};

export const SESSION_TIMEOUTS: Record<AuthRole, { absoluteMs: number; idleMs: number }> = {
  admin: { absoluteMs: 12 * 60 * 60 * 1000, idleMs: 60 * 60 * 1000 },
  billingAdmin: { absoluteMs: 30 * 24 * 60 * 60 * 1000, idleMs: 7 * 24 * 60 * 60 * 1000 },
  client: { absoluteMs: 60 * 24 * 60 * 60 * 1000, idleMs: 14 * 24 * 60 * 60 * 1000 },
  coach: { absoluteMs: 30 * 24 * 60 * 60 * 1000, idleMs: 7 * 24 * 60 * 60 * 1000 },
};

export function assertValidPassword(password: string): void {
  if (password.length < PASSWORD_MINIMUM_LENGTH) {
    throw new Error(`Password must be at least ${PASSWORD_MINIMUM_LENGTH} characters long.`);
  }
}

/** Hashes a password with the D16 Argon2id baseline. */
export async function hashPassword(password: string): Promise<string> {
  assertValidPassword(password);
  return argon2.hash(password, PASSWORD_HASH_OPTIONS);
}

/** Verifies a password without exposing whether its stored digest is valid. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function passwordNeedsRehash(passwordHash: string): boolean {
  return argon2.needsRehash(passwordHash, PASSWORD_HASH_OPTIONS);
}

/** Generates a 256-bit opaque session, reset, or CSRF token for client transport. */
export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Stores only a SHA-256 digest of raw session and one-time tokens. */
export function hashOpaqueToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function opaqueTokenMatches(token: string, expectedHash: Buffer): boolean {
  const candidateHash = hashOpaqueToken(token);
  return (
    candidateHash.length === expectedHash.length && timingSafeEqual(candidateHash, expectedHash)
  );
}

export function sessionExpiresAt(role: AuthRole, createdAt = new Date()): Date {
  return new Date(createdAt.getTime() + SESSION_TIMEOUTS[role].absoluteMs);
}

export function sessionIdleExpiresAt(role: AuthRole, lastSeenAt = new Date()): Date {
  return new Date(lastSeenAt.getTime() + SESSION_TIMEOUTS[role].idleMs);
}

/** Origin validation is mandatory for every state-changing cross-origin API request. */
export function isTrustedStateChangingOrigin(
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  return origin !== undefined && allowedOrigins.has(origin);
}

/** Double-submit CSRF comparison, constant-time for equal-length tokens. */
export function csrfTokenMatches(
  submittedToken: string | undefined,
  sessionToken: string | undefined,
): boolean {
  if (submittedToken === undefined || sessionToken === undefined) {
    return false;
  }

  const submitted = Buffer.from(submittedToken, 'utf8');
  const expected = Buffer.from(sessionToken, 'utf8');
  return submitted.length === expected.length && timingSafeEqual(submitted, expected);
}
