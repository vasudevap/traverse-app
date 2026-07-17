import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QUEUES } from '@traverse/jobs';
import {
  createSmokeEmailJob,
  enqueueAndConfirmSmokeEmail,
  smokeRecipient,
} from '../src/smoke-email';

test('email smoke command accepts only an explicit NonProd recipient', () => {
  assert.equal(smokeRecipient('nonprod', 'owner@example.test'), 'owner@example.test');
  assert.throws(
    () => smokeRecipient('prod', 'owner@example.test'),
    /only when DEPLOYMENT_ENVIRONMENT is nonprod/,
  );
  assert.throws(() => smokeRecipient('nonprod', undefined), /EMAIL_SMOKE_RECIPIENT/);
});

test('email smoke job is traceable without storing the recipient identifier in plaintext', () => {
  const job = createSmokeEmailJob('owner@example.test', new Date('2026-07-17T00:00:00.000Z'));

  assert.equal(job.to, 'owner@example.test');
  assert.notEqual(job.recipientId, 'owner@example.test');
  assert.match(job.notificationId, /^resend-smoke-/);
  assert.match(job.text, /2026-07-17T00:00:00.000Z/);
});

test('email smoke command waits for the worker completion result', async () => {
  const calls: string[] = [];
  const result = await enqueueAndConfirmSmokeEmail(
    {
      findJobs: async (name, { id }) => {
        calls.push(`find:${name}:${id}`);
        return [{ output: { messageId: 'resend-message-1' }, state: 'completed' }];
      },
      send: async (name) => {
        calls.push(`send:${name}`);
        return 'job-1';
      },
      start: async () => {
        calls.push('start');
      },
      stop: async () => {
        calls.push('stop');
      },
    },
    'owner@example.test',
  );

  assert.deepEqual(result, { jobId: 'job-1', messageId: 'resend-message-1' });
  assert.deepEqual(calls, ['start', `send:${QUEUES.email}`, `find:${QUEUES.email}:job-1`, 'stop']);
});
