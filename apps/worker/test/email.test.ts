import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processEmailJobs, type EmailQueueJob } from '../src/email';

const job = (data: unknown): EmailQueueJob => ({
  data,
  id: 'job-1',
});

const validEmail = {
  entityId: 'entity-1',
  from: 'Traverse <no-reply@mail.traversecoaching.com>',
  html: '<p>Message</p>',
  notificationId: 'notification-1',
  recipientId: 'recipient-1',
  subject: 'Subject',
  text: 'Message',
  to: 'recipient@example.test',
};

const logs: Array<{ level: string; message: string }> = [];
const logger = {
  error: (message: string) => logs.push({ level: 'error', message }),
  info: (message: string) => logs.push({ level: 'info', message }),
};

test('email worker completes a valid send without logging recipient content', async () => {
  logs.length = 0;
  const results = await processEmailJobs(
    [job(validEmail)],
    { send: async () => ({ id: 'message-1' }) },
    logger,
  );

  assert.deepEqual(results, [
    { id: 'job-1', output: { messageId: 'message-1' }, status: 'completed' },
  ]);
  assert.deepEqual(logs, [{ level: 'info', message: '@traverse/worker email sent' }]);
});

test('email worker dead-letters malformed jobs and retries provider errors', async () => {
  logs.length = 0;
  const malformed = await processEmailJobs(
    [job({})],
    { send: async () => ({ id: 'unused' }) },
    logger,
  );
  const retryable = await processEmailJobs(
    [job(validEmail)],
    { send: async () => Promise.reject(new Error('provider unavailable')) },
    logger,
  );

  assert.deepEqual(malformed, [{ id: 'job-1', status: 'deadletter' }]);
  assert.deepEqual(retryable, [{ id: 'job-1', status: 'failed' }]);
  assert.equal(logs.filter(({ level }) => level === 'error').length, 2);
});
