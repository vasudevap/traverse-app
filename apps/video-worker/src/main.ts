/** FFmpeg transcode + thumbnail worker, isolated from latency-critical jobs (D20, remux fast-path per amended V5). */
import { fileURLToPath } from 'node:url';
import { QUEUES } from '@traverse/jobs';
import { startVideoWorkerHealthServer } from './health.js';

// pg-boss wiring lands with TRA-22; this proves the workspace graph compiles.
export const videoWorkerQueues = Object.values(QUEUES);

function bootstrap(): void {
  startVideoWorkerHealthServer(Number(process.env.VIDEO_WORKER_HEALTH_PORT ?? 3002));
  console.log('@traverse/video-worker up. queues:', videoWorkerQueues.join(', '));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  bootstrap();
}
