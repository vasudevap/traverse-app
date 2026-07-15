import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../src/create-app.js';
import { TestAuthSessionStore } from './test-auth-store.js';

test('GET /health returns the API liveness response', async () => {
  const app = await createApp(
    { logger: false },
    { allowedOrigins: new Set(), authSessionStore: new TestAuthSessionStore() },
  );

  try {
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    const body = (await response.json()) as {
      status: string;
      service: string;
      ts: string;
    };

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'api');
    assert.ok(Number.isFinite(Date.parse(body.ts)));
  } finally {
    await app.close();
  }
});
