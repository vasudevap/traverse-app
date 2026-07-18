import { spawn } from 'node:child_process';
import type { FfmpegRunner } from './transcode.js';

export class NodeFfmpegRunner implements FfmpegRunner {
  constructor(private readonly binary = process.env.FFMPEG_BINARY ?? 'ffmpeg') {}

  async createPlaybackAssets(input: {
    inputPath: string;
    outputPath: string;
    thumbnailPath: string;
  }): Promise<void> {
    await this.run([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      input.inputPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      input.outputPath,
    ]);
    await this.run([
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
  }

  private async run(args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const process = spawn(this.binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let standardError = '';
      process.stderr.setEncoding('utf8');
      process.stderr.on('data', (chunk: string) => {
        standardError += chunk;
      });
      process.once('error', (error) => {
        reject(new Error(`FFmpeg could not start: ${error.message}`));
      });
      process.once('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}: ${standardError.trim()}`));
      });
    });
  }
}
