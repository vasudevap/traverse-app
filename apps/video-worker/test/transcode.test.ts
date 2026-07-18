import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  VideoTranscodeProcessor,
  parseVideoTranscodeJob,
  type VideoObjectStore,
} from '../src/transcode';
import { processVideoTranscodeJobs } from '../src/video-jobs';

class MemoryObjects implements VideoObjectStore {
  readonly uploads = new Map<string, { body: Uint8Array; contentType: string }>();

  async download(key: string): Promise<Uint8Array> {
    assert.equal(key, 'private/source.webm');
    return new Uint8Array([1, 2, 3]);
  }

  async upload(input: { body: Uint8Array; contentType: string; key: string }): Promise<void> {
    this.uploads.set(input.key, { body: input.body, contentType: input.contentType });
  }
}

test('transcode job parser rejects unsafe object keys', () => {
  assert.deepEqual(
    parseVideoTranscodeJob({
      attemptId: 'attempt-1',
      inputKey: 'private/source.webm',
      outputKey: 'playback/message.mp4',
      thumbnailKey: 'playback/message.jpg',
    }),
    {
      attemptId: 'attempt-1',
      inputKey: 'private/source.webm',
      outputKey: 'playback/message.mp4',
      thumbnailKey: 'playback/message.jpg',
    },
  );
  assert.throws(
    () =>
      parseVideoTranscodeJob({
        attemptId: 'attempt-1',
        inputKey: '../source.webm',
        outputKey: 'playback/message.mp4',
        thumbnailKey: 'playback/message.jpg',
      }),
    /inputKey is invalid/,
  );
});

test('processor writes browser-playback assets and reports elapsed processing time', async () => {
  const objects = new MemoryObjects();
  const processor = new VideoTranscodeProcessor(objects, {
    async createPlaybackAssets({ inputPath, outputPath, thumbnailPath }) {
      assert.deepEqual(await readFile(inputPath), Buffer.from([1, 2, 3]));
      await writeFile(outputPath, Buffer.from('playback'));
      await writeFile(thumbnailPath, Buffer.from('thumbnail'));
    },
  });

  const result = await processor.process({
    attemptId: 'attempt-1',
    inputKey: 'private/source.webm',
    outputKey: 'playback/message.mp4',
    thumbnailKey: 'playback/message.jpg',
  });

  assert.equal(result.attemptId, 'attempt-1');
  assert.equal(result.outputBytes, 8);
  assert.ok(result.processingMilliseconds >= 0);
  assert.equal(result.thumbnailBytes, 9);
  assert.deepEqual(objects.uploads.get('playback/message.mp4'), {
    body: Buffer.from('playback'),
    contentType: 'video/mp4',
  });
  assert.deepEqual(objects.uploads.get('playback/message.jpg'), {
    body: Buffer.from('thumbnail'),
    contentType: 'image/jpeg',
  });
});

test('job runner dead-letters malformed jobs and retains retry behavior for worker failures', async () => {
  const logs: string[] = [];
  const logger = {
    error: (_message: string, context: { error: string; jobId: string }) =>
      logs.push(context.jobId),
    info: () => undefined,
  };
  const processor = {
    process: async () => {
      throw new Error('S3 unavailable');
    },
  } as VideoTranscodeProcessor;
  const results = await processVideoTranscodeJobs(
    [
      {
        data: { attemptId: '', inputKey: 'source', outputKey: 'output', thumbnailKey: 'thumb' },
        id: 'bad',
      },
      {
        data: {
          attemptId: 'attempt-1',
          inputKey: 'source',
          outputKey: 'output',
          thumbnailKey: 'thumb',
        },
        id: 'retry',
      },
    ],
    processor,
    logger,
  );
  assert.deepEqual(results, [
    { id: 'bad', status: 'deadletter' },
    { id: 'retry', status: 'failed' },
  ]);
  assert.deepEqual(logs.sort(), ['bad', 'retry']);
});
