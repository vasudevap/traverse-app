/** Queue names per Decision D17; JobDispatcher interface keeps an SQS/Temporal path open. */
export const QUEUES = {
  stripeFlowAWebhooks: 'stripe-flow-a-webhooks',
  stripeFlowBWebhooks: 'stripe-flow-b-webhooks',
  email: 'email',
  retentionDelete: 'retention-delete',
  transcription: 'transcription',
  videoTranscode: 'video-transcode',
} as const;

/** Every valid queue name, derived from QUEUES so a typo cannot reach enqueue(). */
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobDispatcher {
  enqueue(queue: QueueName, payload: unknown, opts?: { dedupeKey?: string }): Promise<void>;
}
