/** Generic pg-boss worker: transcription submit/poll, retention delete, email, webhook retry (D17). */
import { fileURLToPath } from 'node:url';
import { QUEUES } from '@traverse/jobs';
import { startWorkerHealthServer } from './health.js';

// pg-boss wiring lands with TRA-22; this proves the workspace graph compiles.
export const workerQueues = Object.values(QUEUES);

function bootstrap(): void {
  startWorkerHealthServer(Number(process.env.WORKER_HEALTH_PORT ?? 3001), 'worker');
  console.log('@traverse/worker up. queues:', workerQueues.join(', '));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  bootstrap();
}
