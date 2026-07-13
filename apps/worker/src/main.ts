/** Generic pg-boss worker: transcription submit/poll, retention delete, email, webhook retry (D17). */
import { QUEUES } from '@traverse/jobs';

// pg-boss wiring lands with TRA-22; this proves the workspace graph compiles.
console.log('@traverse/worker up. queues:', Object.values(QUEUES).join(', '));
