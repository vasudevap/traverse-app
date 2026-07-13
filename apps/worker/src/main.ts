/** Generic pg-boss worker: transcription submit/poll, retention delete, email, webhook retry (D17). */
import { QUEUES } from '@traverse/jobs';

// pg-boss wiring lands with TRA-22; this proves the workspace graph compiles.
export const workerQueues = Object.values(QUEUES);
console.log('@traverse/worker up. queues:', workerQueues.join(', '));
