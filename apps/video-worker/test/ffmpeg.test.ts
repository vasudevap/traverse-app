import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaybackCommand, selectVideoProcessingMode } from '../src/ffmpeg';

test('selects the remux fast path only for MP4 H.264/AAC input', () => {
  assert.equal(
    selectVideoProcessingMode({
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
      streams: [
        { codec_name: 'h264', codec_type: 'video' },
        { codec_name: 'aac', codec_type: 'audio' },
      ],
    }),
    'remux',
  );
  assert.equal(
    selectVideoProcessingMode({
      format: { format_name: 'matroska,webm' },
      streams: [
        { codec_name: 'vp9', codec_type: 'video' },
        { codec_name: 'opus', codec_type: 'audio' },
      ],
    }),
    'transcode',
  );
  assert.equal(
    selectVideoProcessingMode({
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
      streams: [
        { codec_name: 'h264', codec_type: 'video' },
        { codec_name: 'opus', codec_type: 'audio' },
      ],
    }),
    'transcode',
  );
});

test('remux command copies compliant playback and audio streams in one pass', () => {
  const command = createPlaybackCommand({
    audioPath: '/tmp/transcription.m4a',
    inputPath: '/tmp/source.mp4',
    outputPath: '/tmp/playback.mp4',
    processingMode: 'remux',
  });

  assert.equal(command.filter((argument) => argument === '-i').length, 1);
  assert.equal(command.filter((argument) => argument === 'copy').length, 3);
  assert.ok(command.includes('+faststart'));
  assert.ok(command.includes('/tmp/playback.mp4'));
  assert.ok(command.includes('/tmp/transcription.m4a'));
  assert.ok(!command.includes('libx264'));
});

test('transcode command normalizes WebM video and extracts AAC audio in one pass', () => {
  const command = createPlaybackCommand({
    audioPath: '/tmp/transcription.m4a',
    inputPath: '/tmp/source.webm',
    outputPath: '/tmp/playback.mp4',
    processingMode: 'transcode',
  });

  assert.equal(command.filter((argument) => argument === '-i').length, 1);
  assert.ok(command.includes('libx264'));
  assert.ok(command.includes('yuv420p'));
  assert.ok(
    command.includes('scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2'),
  );
  assert.equal(command.filter((argument) => argument === 'aac').length, 2);
  assert.ok(command.includes('/tmp/playback.mp4'));
  assert.ok(command.includes('/tmp/transcription.m4a'));
});
