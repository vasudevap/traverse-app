import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QUEUES } from '@traverse/jobs';
import { workerQueues } from '../src/main';

test('generic worker imports the shared queue registry', () => {
  assert.deepEqual(workerQueues, Object.values(QUEUES));
});
