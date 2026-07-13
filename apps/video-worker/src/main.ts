/** FFmpeg transcode + thumbnail worker, isolated from latency-critical jobs (D20, remux fast-path per amended V5). */
import { QUEUES } from '@traverse/jobs';

// pg-boss wiring lands with TRA-22; this proves the workspace graph compiles.
export const videoWorkerQueues = Object.values(QUEUES);
console.log('@traverse/video-worker up. queues:', videoWorkerQueues.join(', '));
