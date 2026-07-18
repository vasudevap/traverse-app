import { parseVideoTranscodeJob, type VideoTranscodeProcessor } from './transcode.js';

export interface VideoQueueJob {
  data: unknown;
  id: string;
}

export interface VideoQueueJobResult {
  id: string;
  output?: { processingMilliseconds: number };
  status: 'completed' | 'deadletter' | 'failed';
}

export interface VideoWorkerLogger {
  error(message: string, context: { error: string; jobId: string }): void;
  info(message: string, context: { jobId: string; processingMilliseconds: number }): void;
}

/**
 * Keeps invalid queue payloads out of retry loops, while allowing object-store and
 * FFmpeg failures to retain pg-boss retry behavior.
 */
export async function processVideoTranscodeJobs(
  jobs: VideoQueueJob[],
  processor: VideoTranscodeProcessor,
  logger: VideoWorkerLogger,
): Promise<VideoQueueJobResult[]> {
  return Promise.all(
    jobs.map(async (job) => {
      try {
        parseVideoTranscodeJob(job.data);
        const result = await processor.process(job.data);
        logger.info('@traverse/video-worker transcode complete', {
          jobId: job.id,
          processingMilliseconds: result.processingMilliseconds,
        });
        return {
          id: job.id,
          output: { processingMilliseconds: result.processingMilliseconds },
          status: 'completed' as const,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown video transcode failure.';
        logger.error('@traverse/video-worker transcode failed', { error: message, jobId: job.id });
        return {
          id: job.id,
          status: message.includes('video transcode job')
            ? ('deadletter' as const)
            : ('failed' as const),
        };
      }
    }),
  );
}
