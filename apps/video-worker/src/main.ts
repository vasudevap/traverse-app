/** FFmpeg transcode + thumbnail worker, isolated from latency-critical jobs (D20, remux fast-path per amended V5). */
import { fileURLToPath } from 'node:url';
import { S3Client } from '@aws-sdk/client-s3';
import {
  QUEUES,
  VIDEO_WORKER_QUEUES,
  createJobBoss,
  databaseConnectionString,
} from '@traverse/jobs';
import { NodeFfmpegRunner } from './ffmpeg.js';
import { startVideoWorkerHealthServer } from './health.js';
import { S3VideoObjectStore } from './object-store.js';
import { VideoTranscodeProcessor } from './transcode.js';
import { processVideoTranscodeJobs } from './video-jobs.js';

export const videoWorkerQueues = VIDEO_WORKER_QUEUES;

async function bootstrap(): Promise<void> {
  const assetBucket = process.env.ASSET_BUCKET_NAME;
  if (assetBucket === undefined || assetBucket.trim() === '') {
    throw new Error('ASSET_BUCKET_NAME is required.');
  }
  const boss = createJobBoss({
    connectionString: databaseConnectionString(process.env.DATABASE_SECRET),
    ssl: { rejectUnauthorized: true },
  });
  await boss.start();
  const processor = new VideoTranscodeProcessor(
    new S3VideoObjectStore(new S3Client({}), assetBucket),
    new NodeFfmpegRunner(),
  );
  await boss.work(
    QUEUES.videoTranscode,
    { localConcurrency: 1, perJobResults: true },
    async (jobs) => processVideoTranscodeJobs(jobs, processor, console),
  );
  startVideoWorkerHealthServer(Number(process.env.VIDEO_WORKER_HEALTH_PORT ?? 3002));
  console.log('@traverse/video-worker up. queues:', videoWorkerQueues.join(', '));

  const shutdown = async (): Promise<void> => {
    await boss.stop({ close: true, graceful: true, timeout: 30_000 });
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void bootstrap().catch((error: unknown) => {
    console.error('@traverse/video-worker startup failed.', error);
    process.exitCode = 1;
  });
}
