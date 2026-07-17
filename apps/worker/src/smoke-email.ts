import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  QUEUES,
  createJobBoss,
  databaseConnectionString,
  type EmailDeliveryJob,
} from '@traverse/jobs';

const SMOKE_TIMEOUT_MS = 45_000;
const SMOKE_POLL_INTERVAL_MS = 1_000;

interface SmokeBoss {
  findJobs(
    name: string,
    options: { id: string },
  ): Promise<Array<{ output?: unknown; state: string }>>;
  send(
    name: string,
    data: object,
    options: { singletonKey: string; singletonSeconds: number },
  ): Promise<string | null>;
  start(): Promise<unknown>;
  stop(options: { close: boolean }): Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function smokeRecipient(
  environment: string | undefined,
  recipient: string | undefined,
): string {
  if (environment !== 'nonprod') {
    throw new Error(
      'Email smoke testing is permitted only when DEPLOYMENT_ENVIRONMENT is nonprod.',
    );
  }
  if (recipient === undefined || !recipient.includes('@')) {
    throw new Error('EMAIL_SMOKE_RECIPIENT must be a single valid email address.');
  }
  return recipient;
}

export function createSmokeEmailJob(recipient: string, now = new Date()): EmailDeliveryJob {
  const testId = randomUUID();
  return {
    entityId: testId,
    from: 'Traverse <no-reply@mail.traversecoaching.com>',
    html: `<p>This is a controlled Traverse NonProd email delivery smoke test sent at ${now.toISOString()}.</p>`,
    notificationId: `resend-smoke-${testId}`,
    recipientId: createHash('sha256').update(recipient).digest('hex'),
    subject: 'Traverse NonProd email delivery smoke test',
    text: `This is a controlled Traverse NonProd email delivery smoke test sent at ${now.toISOString()}.`,
    to: recipient,
  };
}

export async function enqueueAndConfirmSmokeEmail(
  boss: SmokeBoss,
  recipient: string,
  now = new Date(),
): Promise<{ jobId: string; messageId: string }> {
  const email = createSmokeEmailJob(recipient, now);
  await boss.start();

  try {
    const jobId = await boss.send(QUEUES.email, email, {
      singletonKey: email.notificationId,
      singletonSeconds: 5 * 60,
    });
    if (jobId === null) {
      throw new Error('Email smoke job was not created.');
    }

    const deadline = Date.now() + SMOKE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const jobs = await boss.findJobs(QUEUES.email, { id: jobId });
      const job = jobs[0];
      const messageId =
        typeof job?.output === 'object' && job.output !== null
          ? (job.output as { messageId?: unknown }).messageId
          : undefined;
      if (job?.state === 'completed' && typeof messageId === 'string') {
        return { jobId, messageId };
      }
      if (job?.state === 'failed') {
        throw new Error(`Email smoke job ${jobId} failed before delivery.`);
      }
      await sleep(SMOKE_POLL_INTERVAL_MS);
    }

    throw new Error(
      `Email smoke job ${jobId} did not complete within ${SMOKE_TIMEOUT_MS / 1000} seconds.`,
    );
  } finally {
    await boss.stop({ close: true });
  }
}

async function main(): Promise<void> {
  const recipient = smokeRecipient(
    process.env.DEPLOYMENT_ENVIRONMENT,
    process.env.EMAIL_SMOKE_RECIPIENT,
  );
  const boss = createJobBoss({
    connectionString: databaseConnectionString(process.env.DATABASE_SECRET),
    ssl: { rejectUnauthorized: true },
    supervise: false,
  });
  const result = await enqueueAndConfirmSmokeEmail(boss, recipient);
  console.log(`Email smoke test completed. jobId=${result.jobId} messageId=${result.messageId}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(
      'Email smoke test failed.',
      error instanceof Error ? error.message : 'Unknown error.',
    );
    process.exitCode = 1;
  });
}
