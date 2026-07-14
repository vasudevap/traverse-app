import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { QUEUES } from '@traverse/jobs';
import { startWorkerHealthServer } from '../src/health';
import { workerQueues } from '../src/main';

test('generic worker imports the shared queue registry', () => {
  assert.deepEqual(workerQueues, Object.values(QUEUES));
});

test('generic worker health server reports liveness', async () => {
  const server = startWorkerHealthServer(0, 'worker');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.notEqual(typeof address, 'string');
    assert.ok(address);

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', service: 'worker' });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
