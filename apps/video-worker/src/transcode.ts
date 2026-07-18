import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

export interface VideoTranscodeJob {
  attemptId: string;
  inputKey: string;
  outputKey: string;
  thumbnailKey: string;
}

export interface VideoObjectStore {
  download(key: string): Promise<Uint8Array>;
  upload(input: { body: Uint8Array; contentType: string; key: string }): Promise<void>;
}

export interface FfmpegRunner {
  createPlaybackAssets(input: {
    inputPath: string;
    outputPath: string;
    thumbnailPath: string;
  }): Promise<void>;
}

export interface VideoTranscodeResult {
  attemptId: string;
  outputBytes: number;
  processingMilliseconds: number;
  thumbnailBytes: number;
}

function validObjectKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1024 &&
    !value.startsWith('/') &&
    !value.includes('..')
  );
}

/** Validates the isolated queue contract before filesystem or object-store access. */
export function parseVideoTranscodeJob(payload: unknown): VideoTranscodeJob {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('video transcode job must be an object.');
  }
  const candidate = payload as Partial<VideoTranscodeJob>;
  if (typeof candidate.attemptId !== 'string' || candidate.attemptId.trim() === '') {
    throw new Error('video transcode job attemptId is required.');
  }
  const { inputKey, outputKey, thumbnailKey } = candidate;
  if (!validObjectKey(inputKey)) throw new Error('video transcode job inputKey is invalid.');
  if (!validObjectKey(outputKey)) {
    throw new Error('video transcode job outputKey is invalid.');
  }
  if (!validObjectKey(thumbnailKey)) {
    throw new Error('video transcode job thumbnailKey is invalid.');
  }
  return {
    attemptId: candidate.attemptId,
    inputKey,
    outputKey,
    thumbnailKey,
  };
}

/**
 * Runs one source object through FFmpeg and writes browser-playable MP4 and JPEG
 * assets. The queue schema stays deliberately small so the later domain migration
 * can introduce video-message state without changing this worker contract.
 */
export class VideoTranscodeProcessor {
  constructor(
    private readonly objects: VideoObjectStore,
    private readonly ffmpeg: FfmpegRunner,
  ) {}

  async process(payload: unknown): Promise<VideoTranscodeResult> {
    const job = parseVideoTranscodeJob(payload);
    const workingDirectory = await mkdtemp(join(tmpdir(), 'traverse-video-'));
    const inputPath = join(workingDirectory, 'source');
    const outputPath = join(workingDirectory, 'playback.mp4');
    const thumbnailPath = join(workingDirectory, 'thumbnail.jpg');
    const startedAt = performance.now();

    try {
      await writeFile(inputPath, await this.objects.download(job.inputKey));
      await this.ffmpeg.createPlaybackAssets({ inputPath, outputPath, thumbnailPath });
      const [output, thumbnail] = await Promise.all([
        readFile(outputPath),
        readFile(thumbnailPath),
      ]);
      await Promise.all([
        this.objects.upload({ body: output, contentType: 'video/mp4', key: job.outputKey }),
        this.objects.upload({ body: thumbnail, contentType: 'image/jpeg', key: job.thumbnailKey }),
      ]);
      return {
        attemptId: job.attemptId,
        outputBytes: output.byteLength,
        processingMilliseconds: Math.round(performance.now() - startedAt),
        thumbnailBytes: thumbnail.byteLength,
      };
    } finally {
      await rm(workingDirectory, { force: true, recursive: true });
    }
  }
}
