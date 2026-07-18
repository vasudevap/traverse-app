import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

export interface VideoTranscodeJob {
  audioKey: string;
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
    audioPath: string;
    inputPath: string;
    outputPath: string;
    thumbnailPath: string;
  }): Promise<{
    mediaProcessingMilliseconds: number;
    processingMode: VideoProcessingMode;
  }>;
}

export type VideoProcessingMode = 'remux' | 'transcode';

export interface VideoTranscodeResult {
  audioBytes: number;
  attemptId: string;
  mediaProcessingMilliseconds: number;
  outputBytes: number;
  processingMode: VideoProcessingMode;
  processingMilliseconds: number;
  sourceBytes: number;
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
  const { audioKey, inputKey, outputKey, thumbnailKey } = candidate;
  if (!validObjectKey(audioKey)) throw new Error('video transcode job audioKey is invalid.');
  if (!validObjectKey(inputKey)) throw new Error('video transcode job inputKey is invalid.');
  if (!validObjectKey(outputKey)) {
    throw new Error('video transcode job outputKey is invalid.');
  }
  if (!validObjectKey(thumbnailKey)) {
    throw new Error('video transcode job thumbnailKey is invalid.');
  }
  return {
    audioKey,
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
    const audioPath = join(workingDirectory, 'transcription.m4a');
    const outputPath = join(workingDirectory, 'playback.mp4');
    const thumbnailPath = join(workingDirectory, 'thumbnail.jpg');
    const startedAt = performance.now();

    try {
      const source = await this.objects.download(job.inputKey);
      await writeFile(inputPath, source);
      const mediaResult = await this.ffmpeg.createPlaybackAssets({
        audioPath,
        inputPath,
        outputPath,
        thumbnailPath,
      });
      const [audio, output, thumbnail] = await Promise.all([
        readFile(audioPath),
        readFile(outputPath),
        readFile(thumbnailPath),
      ]);
      await Promise.all([
        this.objects.upload({ body: audio, contentType: 'audio/mp4', key: job.audioKey }),
        this.objects.upload({ body: output, contentType: 'video/mp4', key: job.outputKey }),
        this.objects.upload({ body: thumbnail, contentType: 'image/jpeg', key: job.thumbnailKey }),
      ]);
      return {
        audioBytes: audio.byteLength,
        attemptId: job.attemptId,
        mediaProcessingMilliseconds: mediaResult.mediaProcessingMilliseconds,
        outputBytes: output.byteLength,
        processingMode: mediaResult.processingMode,
        processingMilliseconds: Math.round(performance.now() - startedAt),
        sourceBytes: source.byteLength,
        thumbnailBytes: thumbnail.byteLength,
      };
    } finally {
      await rm(workingDirectory, { force: true, recursive: true });
    }
  }
}
