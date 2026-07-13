import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QUEUES, type QueueName } from '../src/index';

test('queue names remain the complete D17 set', () => {
  const queueNames: QueueName[] = Object.values(QUEUES);

  assert.deepEqual(queueNames, [
    'stripe-flow-a-webhooks',
    'stripe-flow-b-webhooks',
    'email',
    'retention-delete',
    'transcription',
    'video-transcode',
  ]);
});
