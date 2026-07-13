import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QUEUES } from '@traverse/jobs';
import { videoWorkerQueues } from '../src/main';

test('video worker imports the shared queue registry', () => {
  assert.deepEqual(videoWorkerQueues, Object.values(QUEUES));
});
