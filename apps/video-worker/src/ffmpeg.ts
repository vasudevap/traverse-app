import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import type { FfmpegRunner, VideoProcessingMode } from './transcode.js';

interface FfprobeOutput {
  format?: { format_name?: unknown };
  streams?: Array<{ codec_name?: unknown; codec_type?: unknown }>;
}

/**
 * Safari MediaRecorder output can avoid a full encode only when its container and
 * first audio/video streams already satisfy the normalized playback contract.
 */
export function selectVideoProcessingMode(probe: FfprobeOutput): VideoProcessingMode {
  const container = typeof probe.format?.format_name === 'string' ? probe.format.format_name : '';
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');
  const isMp4Container = container.split(',').some((name) => name === 'mp4' || name === 'mov');
  return isMp4Container && video?.codec_name === 'h264' && audio?.codec_name === 'aac'
    ? 'remux'
    : 'transcode';
}

export function createPlaybackCommand(input: {
  audioPath: string;
  inputPath: string;
  outputPath: string;
  processingMode: VideoProcessingMode;
}): string[] {
  const playbackCodecArgs =
    input.processingMode === 'remux'
      ? ['-c:v', 'copy', '-c:a', 'copy']
      : [
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-pix_fmt',
          'yuv420p',
          '-vf',
          'scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
        ];
  const audioCodecArgs =
    input.processingMode === 'remux' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '128k'];

  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    input.inputPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0',
    '-map_metadata',
    '-1',
    ...playbackCodecArgs,
    '-movflags',
    '+faststart',
    input.outputPath,
    '-map',
    '0:a:0',
    '-vn',
    '-map_metadata',
    '-1',
    ...audioCodecArgs,
    input.audioPath,
  ];
}

export class NodeFfmpegRunner implements FfmpegRunner {
  constructor(
    private readonly ffmpegBinary = process.env.FFMPEG_BINARY ?? 'ffmpeg',
    private readonly ffprobeBinary = process.env.FFPROBE_BINARY ?? 'ffprobe',
  ) {}

  async createPlaybackAssets(input: {
    audioPath: string;
    inputPath: string;
    outputPath: string;
    thumbnailPath: string;
  }): Promise<{ mediaProcessingMilliseconds: number; processingMode: VideoProcessingMode }> {
    const startedAt = performance.now();
    const probe = await this.run(this.ffprobeBinary, [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,codec_name:format=format_name',
      '-of',
      'json',
      input.inputPath,
    ]);
    const processingMode = selectVideoProcessingMode(this.parseProbe(probe));

    await this.run(
      this.ffmpegBinary,
      createPlaybackCommand({
        audioPath: input.audioPath,
        inputPath: input.inputPath,
        outputPath: input.outputPath,
        processingMode,
      }),
    );
    await this.run(this.ffmpegBinary, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      input.outputPath,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      input.thumbnailPath,
    ]);

    return {
      mediaProcessingMilliseconds: Math.round(performance.now() - startedAt),
      processingMode,
    };
  }

  private parseProbe(value: string): FfprobeOutput {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
      return parsed as FfprobeOutput;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown parse error';
      throw new Error(`FFprobe returned invalid JSON: ${message}`);
    }
  }

  private async run(binary: string, args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let standardError = '';
      let standardOutput = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        standardOutput += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        standardError += chunk;
      });
      child.once('error', (error) => {
        reject(new Error(`${binary} could not start: ${error.message}`));
      });
      child.once('close', (code) => {
        if (code === 0) resolve(standardOutput);
        else reject(new Error(`${binary} exited with code ${code}: ${standardError.trim()}`));
      });
    });
  }
}
