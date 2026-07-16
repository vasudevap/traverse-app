/** Generic pg-boss worker: transcription submit/poll, retention delete, email, webhook retry (D17). */
import { fileURLToPath } from 'node:url';
import {
  GENERIC_WORKER_QUEUES,
  QUEUES,
  createJobBoss,
  createResendEmailSender,
  databaseConnectionString,
  resendApiKey,
} from '@traverse/jobs';
import { processEmailJobs } from './email.js';
import { startWorkerHealthServer } from './health.js';

export const workerQueues = GENERIC_WORKER_QUEUES;

async function bootstrap(): Promise<void> {
  const boss = createJobBoss({
    connectionString: databaseConnectionString(process.env.DATABASE_SECRET),
    ssl: { rejectUnauthorized: true },
  });
  await boss.start();
  const emailSender = createResendEmailSender(resendApiKey(process.env.RESEND_SECRET));
  await boss.work(QUEUES.email, { localConcurrency: 1, perJobResults: true }, async (jobs) =>
    processEmailJobs(jobs, emailSender, console),
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
