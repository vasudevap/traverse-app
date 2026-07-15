import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { VIDEO_WORKER_QUEUES } from '@traverse/jobs';
import { startVideoWorkerHealthServer } from '../src/health';
import { videoWorkerQueues } from '../src/main';

test('video worker owns only the video queue', () => {
  assert.deepEqual(videoWorkerQueues, VIDEO_WORKER_QUEUES);
});

test('video worker health server reports liveness', async () => {
  const server = startVideoWorkerHealthServer(0);
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.notEqual(typeof address, 'string');
    assert.ok(address);

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', service: 'video-worker' });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
