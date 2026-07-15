import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PASSWORD_HASH_OPTIONS,
  PASSWORD_MINIMUM_LENGTH,
  SESSION_COOKIE_NAMES,
  csrfTokenMatches,
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  isTrustedStateChangingOrigin,
  opaqueTokenMatches,
  passwordNeedsRehash,
  sessionExpiresAt,
  sessionIdleExpiresAt,
  verifyPassword,
} from '../src/auth-security';

test('D16 uses the ratified Argon2id baseline and rejects too-short passwords', async () => {
  assert.equal(PASSWORD_HASH_OPTIONS.memoryCost, 64 * 1024);
  assert.equal(PASSWORD_HASH_OPTIONS.parallelism, 4);
  assert.equal(PASSWORD_HASH_OPTIONS.timeCost, 3);
  await assert.rejects(hashPassword('x'.repeat(PASSWORD_MINIMUM_LENGTH - 1)));
});

test('passwords verify only against their Argon2id hash', async () => {
  const passwordHash = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword(passwordHash, 'correct horse battery staple'), true);
  assert.equal(await verifyPassword(passwordHash, 'wrong password'), false);
  assert.equal(passwordNeedsRehash(passwordHash), false);
});

test('opaque tokens are 256-bit, stored hashed, and compared safely', () => {
  const token = createOpaqueToken();
  assert.equal(Buffer.from(token, 'base64url').length, 32);
  const tokenHash = hashOpaqueToken(token);
  assert.equal(opaqueTokenMatches(token, tokenHash), true);
  assert.equal(opaqueTokenMatches(createOpaqueToken(), tokenHash), false);
});

test('session timeout policy and cookie names isolate the four roles', () => {
  const createdAt = new Date('2026-07-15T00:00:00.000Z');
  assert.equal(sessionExpiresAt('admin', createdAt).toISOString(), '2026-07-15T12:00:00.000Z');
  assert.equal(sessionIdleExpiresAt('admin', createdAt).toISOString(), '2026-07-15T01:00:00.000Z');
  assert.deepEqual(Object.values(SESSION_COOKIE_NAMES).sort(), [
    'trv_s_admin',
    'trv_s_ba',
    'trv_s_client',
    'trv_s_coach',
  ]);
});

test('D22 requires an exact trusted Origin and matching double-submit CSRF token', () => {
  const origins = new Set([
    'https://app.traversecoaching.com',
    'https://client.traversecoaching.com',
  ]);
  assert.equal(isTrustedStateChangingOrigin('https://app.traversecoaching.com', origins), true);
  assert.equal(isTrustedStateChangingOrigin('https://evil.example', origins), false);
  assert.equal(isTrustedStateChangingOrigin(undefined, origins), false);
  assert.equal(csrfTokenMatches('csrf-token', 'csrf-token'), true);
  assert.equal(csrfTokenMatches('csrf-token', 'other-token'), false);
  assert.equal(csrfTokenMatches(undefined, 'csrf-token'), false);
});
