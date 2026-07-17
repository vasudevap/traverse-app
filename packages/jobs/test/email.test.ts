import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EmailJobValidationError,
  ResendDeliveryError,
  createResendEmailSender,
  parseEmailDeliveryJob,
  resendApiKey,
} from '../src/email';

const emailJob = {
  entityId: 'entity-1',
  from: 'Traverse <no-reply@mail.traversecoaching.com>',
  html: '<p>Message</p>',
  notificationId: 'notification-1',
  recipientId: 'recipient-1',
  replyTo: 'coach@example.test',
  subject: 'Traverse test message',
  text: 'Message',
  to: 'recipient@example.test',
};

test('email jobs require the delivery and traceability fields', () => {
  assert.deepEqual(parseEmailDeliveryJob(emailJob), emailJob);
  assert.throws(
    () => parseEmailDeliveryJob({ ...emailJob, to: '' }),
    (error: unknown) => error instanceof EmailJobValidationError && error.message.includes('to'),
  );
});

test('Resend sender sends HTML, plain text, and reply-to with the scoped key', async () => {
  let request: Request | undefined;
  const sender = createResendEmailSender('re_test_key', async (input, init) => {
    request = new Request(input, init);
    return Response.json({ id: 'email-1' }, { status: 200 });
  });

  assert.deepEqual(await sender.send(emailJob), { id: 'email-1' });
  assert.equal(request?.url, 'https://api.resend.com/emails');
  assert.equal(request?.headers.get('authorization'), 'Bearer re_test_key');
  assert.deepEqual(await request?.json(), {
    from: emailJob.from,
    html: emailJob.html,
    reply_to: emailJob.replyTo,
    subject: emailJob.subject,
    text: emailJob.text,
    to: [emailJob.to],
  });
});

test('Resend sender makes provider failures retryable and validates the injected key', async () => {
  const sender = createResendEmailSender(
    're_test_key',
    async () => new Response('', { status: 503 }),
  );
  await assert.rejects(() => sender.send(emailJob), ResendDeliveryError);
  assert.equal(resendApiKey('re_scoped_key'), 're_scoped_key');
  assert.throws(() => resendApiKey(undefined), /RESEND_SECRET/);
});
