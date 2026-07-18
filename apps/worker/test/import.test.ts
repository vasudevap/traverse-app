import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { GENERIC_WORKER_QUEUES } from '@traverse/jobs';
import { startWorkerHealthServer } from '../src/health';
import { configuredWorkerKmsKeyId, workerQueues } from '../src/main';

test('generic worker owns only non-video queues', () => {
  assert.deepEqual(workerQueues, GENERIC_WORKER_QUEUES);
});

test('generic worker resolves an explicit or deployment-scoped KMS key', () => {
  assert.equal(
    configuredWorkerKmsKeyId({
      APP_KMS_KEY_ID: 'arn:aws:kms:us-east-1:111122223333:key/test',
      DEPLOYMENT_ENVIRONMENT: 'nonprod',
    }),
    'arn:aws:kms:us-east-1:111122223333:key/test',
  );
  assert.equal(
    configuredWorkerKmsKeyId({ DEPLOYMENT_ENVIRONMENT: 'nonprod' }),
    'alias/traverse/nonprod/application',
  );
  assert.equal(
    configuredWorkerKmsKeyId({ DEPLOYMENT_ENVIRONMENT: 'prod' }),
    'alias/traverse/prod/application',
  );
  assert.throws(
    () => configuredWorkerKmsKeyId({}),
    /APP_KMS_KEY_ID is required when DEPLOYMENT_ENVIRONMENT is not set/,
  );
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
