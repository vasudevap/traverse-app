/** Queue names per Decision D17; JobDispatcher interface keeps an SQS/Temporal path open. */
export const QUEUES = {
  stripeFlowAWebhooks: 'stripe-flow-a-webhooks',
  stripeFlowBWebhooks: 'stripe-flow-b-webhooks',
  email: 'email',
  retentionDelete: 'retention-delete',
  transcription: 'transcription',
  videoTranscode: 'video-transcode',
} as const;

export interface JobDispatcher {
  enqueue(queue: string, payload: unknown, opts?: { dedupeKey?: string }): Promise<void>;
}
