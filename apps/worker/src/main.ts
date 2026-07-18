/** Generic pg-boss worker: transcription submit/poll, retention delete, email, webhook retry (D17). */
import { fileURLToPath } from 'node:url';
import { KMSClient } from '@aws-sdk/client-kms';
import { S3Client } from '@aws-sdk/client-s3';
import { createDatabase, databaseConnectionString as dbConnectionString } from '@traverse/db';
import {
  GENERIC_WORKER_QUEUES,
  QUEUES,
  createJobBoss,
  createResendEmailSender,
  databaseConnectionString,
  resendApiKey,
} from '@traverse/jobs';
import { processEmailJobs } from './email.js';
import { DatabaseExportArchiveRunner, processExportJobs } from './export.js';
import { startWorkerHealthServer } from './health.js';

export const workerQueues = GENERIC_WORKER_QUEUES;

async function bootstrap(): Promise<void> {
  const connectionString = databaseConnectionString(process.env.DATABASE_SECRET);
  const boss = createJobBoss({
    connectionString,
    ssl: { rejectUnauthorized: true },
  });
  await boss.start();
  const emailSender = createResendEmailSender(resendApiKey(process.env.RESEND_SECRET));
  await boss.work(QUEUES.email, { localConcurrency: 1, perJobResults: true }, async (jobs) =>
    processEmailJobs(jobs, emailSender, console),
  );
  const assetBucket = process.env.ASSET_BUCKET_NAME;
  const kmsKeyId = process.env.APP_KMS_KEY_ID;
  if (assetBucket === undefined || assetBucket.trim() === '')
    throw new Error('ASSET_BUCKET_NAME is required.');
  if (kmsKeyId === undefined || kmsKeyId.trim() === '')
    throw new Error('APP_KMS_KEY_ID is required.');
  const database = createDatabase({
    connectionString: dbConnectionString(process.env.DATABASE_SECRET),
    ssl: { rejectUnauthorized: true },
  });
  const exportRunner = new DatabaseExportArchiveRunner(
    database,
    boss,
    new KMSClient({}),
    new S3Client({}),
    {
      assetBucket,
      coachAppBaseUrl: process.env.COACH_APP_BASE_URL ?? 'https://app.traversecoaching.com',
      emailFrom: process.env.CLIENT_EMAIL_FROM ?? 'Traverse <no-reply@mail.traversecoaching.com>',
      kmsKeyId,
    },
  );
  await boss.work(
    QUEUES.exportArchive,
    { localConcurrency: 1, perJobResults: true },
    async (jobs) => processExportJobs(jobs, exportRunner, console),
  );
  startWorkerHealthServer(Number(process.env.WORKER_HEALTH_PORT ?? 3001), 'worker');
  console.log('@traverse/worker up. queues:', workerQueues.join(', '));

  const shutdown = async (): Promise<void> => {
    await boss.stop({ close: true, graceful: true, timeout: 30_000 });
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void bootstrap().catch((error: unknown) => {
    console.error('@traverse/worker startup failed.', error);
    process.exitCode = 1;
  });
}
