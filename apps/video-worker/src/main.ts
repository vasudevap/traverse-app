/** FFmpeg transcode + thumbnail worker, isolated from latency-critical jobs (D20, remux fast-path per amended V5). */
import { QUEUES } from '@traverse/jobs';

// pg-boss wiring lands with TRA-22; this proves the workspace graph compiles.
console.log('@traverse/video-worker up. queues:', Object.values(QUEUES).join(', '));
