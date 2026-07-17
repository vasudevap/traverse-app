import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type { AuthSubject } from '@traverse/db';
import { createApp } from '../src/create-app.js';
import { hashPassword } from '../src/auth-security.js';
import { TestAuthSessionStore } from './test-auth-store.js';

const origin = 'https://staging-app.traversecoaching.com';

function cookieHeader(setCookies: string[]): string {
  return setCookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

test('TRA-29 completes login, role isolation, CSRF, logout, and immediate revocation', async () => {
  const subject: AuthSubject = {
    clientId: null,
    coachId: '00000000-0000-7000-8000-000000000101',
    email: 'coach@example.test',
    name: 'Coach Example',
    passwordHash: await hashPassword('correct horse battery staple'),
    practiceRole: 'owner',
    role: 'coach',
    status: 'active',
    tenantId: '00000000-0000-7000-8000-000000000001',
    userId: '00000000-0000-7000-8000-000000000011',
  };
  const store = new TestAuthSessionStore([subject]);
  const app = await createApp(
    { logger: false },
    { allowedOrigins: new Set([origin]), authSessionStore: store },
  );

  try {
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const csrf = await fetch(`${baseUrl}/coach/auth/csrf`);
    assert.equal(csrf.status, 200);
    assert.equal(csrf.headers.get('cache-control'), 'no-store');
    const initialCsrf = (await csrf.json()) as { csrfToken: string };
    const preAuthCookies = cookieHeader(csrf.headers.getSetCookie());

    const missingOrigin = await fetch(`${baseUrl}/coach/auth/login`, {
      body: JSON.stringify({ email: subject.email, password: 'correct horse battery staple' }),
      headers: {
        'content-type': 'application/json',
        cookie: preAuthCookies,
        'x-csrf-token': initialCsrf.csrfToken,
      },
      method: 'POST',
    });
    assert.equal(missingOrigin.status, 403);

    const badEmail = await fetch(`${baseUrl}/coach/auth/login`, {
      body: JSON.stringify({ email: 'missing@example.test', password: 'wrong password' }),
      headers: {
        'content-type': 'application/json',
        cookie: preAuthCookies,
        origin,
        'x-csrf-token': initialCsrf.csrfToken,
      },
      method: 'POST',
    });
    const badPassword = await fetch(`${baseUrl}/coach/auth/login`, {
      body: JSON.stringify({ email: subject.email, password: 'wrong password' }),
      headers: {
        'content-type': 'application/json',
        cookie: preAuthCookies,
        origin,
        'x-csrf-token': initialCsrf.csrfToken,
      },
      method: 'POST',
    });
    assert.equal(badEmail.status, 401);
    assert.equal(badPassword.status, 401);
    assert.deepEqual(await badEmail.json(), await badPassword.json());

    const login = await fetch(`${baseUrl}/coach/auth/login`, {
      body: JSON.stringify({ email: subject.email, password: 'correct horse battery staple' }),
      headers: {
        'content-type': 'application/json',
        cookie: preAuthCookies,
        origin,
        'x-csrf-token': initialCsrf.csrfToken,
      },
      method: 'POST',
    });
    assert.equal(login.status, 201);
    assert.equal(login.headers.get('cache-control'), 'no-store');
    const loginBody = (await login.json()) as { csrfToken: string; user: { role: string } };
    assert.equal(loginBody.user.role, 'coach');
    assert.equal(loginBody.csrfToken.length, 43);

    const setCookies = login.headers.getSetCookie();
    assert.equal(setCookies.length, 2);
    const sessionSetCookie = setCookies.find((cookie) => cookie.startsWith('trv_s_coach='));
    const csrfSetCookie = setCookies.find((cookie) => cookie.startsWith('trv_csrf_coach='));
    assert.match(sessionSetCookie ?? '', /; HttpOnly$/);
    assert.match(sessionSetCookie ?? '', /; Secure; SameSite=Lax/);
    assert.doesNotMatch(sessionSetCookie ?? '', /Domain=/i);
    assert.doesNotMatch(csrfSetCookie ?? '', /HttpOnly/);
    const cookies = cookieHeader(setCookies);

    assert.equal(store.sessions.size, 1);
    const storedHash = [...store.sessions.keys()][0] ?? '';
    assert.match(storedHash, /^[0-9a-f]{64}$/);
    assert.equal(cookies.includes(storedHash), false);

    const currentSession = await fetch(`${baseUrl}/coach/auth/session`, {
      headers: { cookie: cookies },
    });
    assert.equal(currentSession.status, 200);
    assert.equal(currentSession.headers.get('cache-control'), 'no-store');
    const currentBody = (await currentSession.json()) as { user: { tenantId: string } };
    assert.equal(currentBody.user.tenantId, subject.tenantId);

    const wrongSurface = await fetch(`${baseUrl}/client/auth/session`, {
      headers: { cookie: cookies },
    });
    assert.equal(wrongSurface.status, 401);

    const missingCsrf = await fetch(`${baseUrl}/coach/auth/logout`, {
      headers: { cookie: cookies, origin },
      method: 'POST',
    });
    assert.equal(missingCsrf.status, 403);

    const logout = await fetch(`${baseUrl}/coach/auth/logout`, {
      headers: {
        cookie: cookies,
        origin,
        'x-csrf-token': loginBody.csrfToken,
      },
      method: 'POST',
    });
    assert.equal(logout.status, 201);
    assert.deepEqual(await logout.json(), { status: 'signed_out' });

    const revokedSession = await fetch(`${baseUrl}/coach/auth/session`, {
      headers: { cookie: cookies },
    });
    assert.equal(revokedSession.status, 401);
  } finally {
    await app.close();
  }
});

test('TRA-38 coach signup uses coach CSRF without a surface route parameter', async () => {
  const app = await createApp(
    { logger: false },
    { allowedOrigins: new Set([origin]), authSessionStore: new TestAuthSessionStore([]) },
  );

  try {
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/coach/signup`, {
      body: JSON.stringify({ disciplineBand: 'prohibited' }),
      headers: {
        'content-type': 'application/json',
        cookie: 'trv_csrf_coach=smoke-token',
        origin,
        'x-csrf-token': 'smoke-token',
      },
      method: 'POST',
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: 'Forbidden',
      message: 'Traverse cannot be used for the selected coaching discipline.',
      statusCode: 403,
    });
  } finally {
    await app.close();
  }
});
