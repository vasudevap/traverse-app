import { parseVideoTranscodeJob, type VideoTranscodeProcessor } from './transcode.js';

export interface VideoQueueJob {
  data: unknown;
  id: string;
}

export interface VideoQueueJobResult {
  id: string;
  output?: {
    audioBytes: number;
    mediaProcessingMilliseconds: number;
    outputBytes: number;
    processingMilliseconds: number;
    processingMode: 'remux' | 'transcode';
    sourceBytes: number;
    thumbnailBytes: number;
  };
  status: 'completed' | 'deadletter' | 'failed';
}

export interface VideoWorkerLogger {
  error(message: string, context: { error: string; jobId: string }): void;
  info(
    message: string,
    context: {
      jobId: string;
      mediaProcessingMilliseconds: number;
      processingMilliseconds: number;
      processingMode: 'remux' | 'transcode';
    },
  ): void;
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
          mediaProcessingMilliseconds: result.mediaProcessingMilliseconds,
          processingMilliseconds: result.processingMilliseconds,
          processingMode: result.processingMode,
        });
        return {
          id: job.id,
          output: {
            audioBytes: result.audioBytes,
            mediaProcessingMilliseconds: result.mediaProcessingMilliseconds,
            outputBytes: result.outputBytes,
            processingMilliseconds: result.processingMilliseconds,
            processingMode: result.processingMode,
            sourceBytes: result.sourceBytes,
            thumbnailBytes: result.thumbnailBytes,
          },
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
