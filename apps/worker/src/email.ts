import {
  EmailJobValidationError,
  parseEmailDeliveryJob,
  type ResendEmailSender,
} from '@traverse/jobs';

export interface EmailQueueJob {
  data: unknown;
  id: string;
}

export interface EmailQueueJobResult {
  id: string;
  output?: EmailDeliveryResult;
  status: 'completed' | 'deadletter' | 'failed';
}

export interface EmailWorkerLogger {
  error(message: string, context: { error: string; jobId: string }): void;
  info(
    message: string,
    context: { jobId: string; messageId: string; notificationId: string },
  ): void;
}

export interface EmailDeliveryResult {
  messageId: string;
}

/**
 * Processes each job independently so malformed jobs are dead-lettered while
 * transient provider failures retain pg-boss retry behavior.
 */
export async function processEmailJobs(
  jobs: EmailQueueJob[],
  sender: ResendEmailSender,
  logger: EmailWorkerLogger,
): Promise<EmailQueueJobResult[]> {
  return Promise.all(
    jobs.map(async (job) => {
      try {
        const email = parseEmailDeliveryJob(job.data);
        const delivery = await sender.send(email);
        logger.info('@traverse/worker email sent', {
          jobId: job.id,
          messageId: delivery.id,
          notificationId: email.notificationId,
        });
        return { id: job.id, output: { messageId: delivery.id }, status: 'completed' as const };
      } catch (error) {
        logger.error('@traverse/worker email delivery failed', {
          error: error instanceof Error ? error.message : 'Unknown delivery failure.',
          jobId: job.id,
        });
        return {
          id: job.id,
          status:
            error instanceof EmailJobValidationError
              ? ('deadletter' as const)
              : ('failed' as const),
        };
      }
    }),
  );
}
