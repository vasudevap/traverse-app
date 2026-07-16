import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GENERIC_WORKER_QUEUES,
  QUEUE_DEFINITIONS,
  QUEUES,
  VIDEO_WORKER_QUEUES,
  createJobQueues,
  createTransactionalJobDispatcher,
  databaseConnectionString,
  deadLetterQueueName,
  jobBossOptions,
  type QueueName,
} from '../src/index';

test('queue names remain the complete D17 set', () => {
  const queueNames: QueueName[] = Object.values(QUEUES);

  assert.deepEqual(queueNames, [
    'stripe-flow-a-webhooks',
    'stripe-flow-b-webhooks',
    'email',
    'retention-delete',
    'transcription',
    'video-transcode',
  ]);
});

test('queue definitions create a dedicated dead-letter queue first', async () => {
  const created: Array<{ name: string; options: object | undefined }> = [];
  await createJobQueues({
    createQueue: async (name, options) => {
      created.push({ name, options });
    },
  });

  assert.equal(created.length, QUEUE_DEFINITIONS.length * 2);
  assert.deepEqual(
    created.slice(0, QUEUE_DEFINITIONS.length).map(({ name }) => name),
    QUEUE_DEFINITIONS.map(({ name }) => deadLetterQueueName(name)),
  );
  assert.equal(created.at(-1)?.options?.deadLetter, deadLetterQueueName(QUEUES.videoTranscode));
  assert.deepEqual(GENERIC_WORKER_QUEUES, [
    QUEUES.stripeFlowAWebhooks,
    QUEUES.stripeFlowBWebhooks,
    QUEUES.email,
    QUEUES.retentionDelete,
    QUEUES.transcription,
  ]);
  assert.deepEqual(VIDEO_WORKER_QUEUES, [QUEUES.videoTranscode]);
});

test('runtime pg-boss supervision avoids partition DDL while retaining live monitoring', () => {
  const options = jobBossOptions({
    connectionString: 'postgresql://runtime@example.test/traverse',
  });

  assert.equal(options.createSchema, false);
  assert.equal(options.migrate, false);
  assert.equal(options.persistQueueStats, false);
  assert.equal(options.persistWarnings, true);
  assert.equal(options.supervise, true);
});

test('dispatcher sends through the supplied Kysely transaction with an optional dedupe key', async () => {
  const calls: Array<{
    name: string;
    data: object | null | undefined;
    options: object | undefined;
  }> = [];
  const dispatcher = createTransactionalJobDispatcher(
    {
      send: async (name, data, options) => {
        calls.push({ name, data, options });
        return 'job-id';
      },
    },
    {
      executeQuery: async () => ({ rows: [] }),
    },
  );

  await dispatcher.enqueue(QUEUES.email, { notificationId: 'notice-1' }, { dedupeKey: 'notice-1' });
  assert.equal(calls[0]?.name, QUEUES.email);
  assert.equal((calls[0]?.options as { singletonKey: string }).singletonKey, 'notice-1');
  assert.equal((calls[0]?.options as { singletonSeconds: number }).singletonSeconds, 24 * 60 * 60);
});

test('runtime database credentials are parsed into an encoded connection string', () => {
  const connectionString = databaseConnectionString(
    JSON.stringify({
      database: 'traverse',
      host: 'db.example.test',
      password: 'pa:ss',
      port: 5432,
      sslmode: 'verify-full',
      username: 'traverse_runtime',
    }),
  );

  assert.equal(
    connectionString,
    'postgresql://traverse_runtime:pa%3Ass@db.example.test:5432/traverse',
  );
});
