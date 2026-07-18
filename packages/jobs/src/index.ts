import {
  PgBoss,
  fromKysely,
  type ConstructorOptions,
  type KyselyTransactionLike,
  type Queue,
} from 'pg-boss';

export {
  createResendEmailSender,
  EmailJobValidationError,
  parseEmailDeliveryJob,
  resendApiKey,
  ResendDeliveryError,
  type EmailDeliveryJob,
  type ResendEmailSender,
} from './email.js';
export { parseExportArchiveJob, type ExportArchiveJob } from './export.js';

/** Queue names per Decision D17. */
export const QUEUES = {
  stripeFlowAWebhooks: 'stripe-flow-a-webhooks',
  stripeFlowBWebhooks: 'stripe-flow-b-webhooks',
  email: 'email',
  exportArchive: 'export-archive',
  retentionDelete: 'retention-delete',
  transcription: 'transcription',
  videoTranscode: 'video-transcode',
} as const;

/** Every valid queue name, derived from QUEUES so a typo cannot reach enqueue(). */
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOB_SCHEMA = 'pgboss';
export const GENERIC_WORKER_QUEUES = [
  QUEUES.stripeFlowAWebhooks,
  QUEUES.stripeFlowBWebhooks,
  QUEUES.email,
  QUEUES.exportArchive,
  QUEUES.retentionDelete,
  QUEUES.transcription,
] as const;
export const VIDEO_WORKER_QUEUES = [QUEUES.videoTranscode] as const;

const DAY_IN_SECONDS = 24 * 60 * 60;
const DEAD_LETTER_SUFFIX = '-dead-letter';

export function deadLetterQueueName(queue: QueueName): string {
  return `${queue}${DEAD_LETTER_SUFFIX}`;
}

const DEFAULT_QUEUE_OPTIONS: Omit<Queue, 'name'> = {
  deleteAfterSeconds: 30 * DAY_IN_SECONDS,
  heartbeatSeconds: 60,
  notify: true,
  retryBackoff: true,
  retryDelay: 60,
  retryDelayMax: 60 * 60,
  retryLimit: 5,
  warningQueueSize: 100,
};

const VIDEO_QUEUE_OPTIONS: Omit<Queue, 'name'> = {
  ...DEFAULT_QUEUE_OPTIONS,
  expireInSeconds: 2 * 60 * 60,
  warningQueueSize: 25,
};

export interface QueueDefinition {
  name: QueueName;
  options: Omit<Queue, 'name'>;
}

export const QUEUE_DEFINITIONS: ReadonlyArray<Readonly<QueueDefinition>> = [
  { name: QUEUES.stripeFlowAWebhooks, options: DEFAULT_QUEUE_OPTIONS },
  { name: QUEUES.stripeFlowBWebhooks, options: DEFAULT_QUEUE_OPTIONS },
  { name: QUEUES.email, options: DEFAULT_QUEUE_OPTIONS },
  { name: QUEUES.exportArchive, options: DEFAULT_QUEUE_OPTIONS },
  { name: QUEUES.retentionDelete, options: DEFAULT_QUEUE_OPTIONS },
  { name: QUEUES.transcription, options: DEFAULT_QUEUE_OPTIONS },
  { name: QUEUES.videoTranscode, options: VIDEO_QUEUE_OPTIONS },
];

const DEAD_LETTER_QUEUE_OPTIONS: Omit<Queue, 'name'> = {
  deleteAfterSeconds: 90 * DAY_IN_SECONDS,
  retryLimit: 0,
  warningQueueSize: 1,
};

export interface JobBossConfig {
  connectionString: string;
  createSchema?: boolean;
  migrate?: boolean;
  persistQueueStats?: boolean;
  ssl?: unknown;
  supervise?: boolean;
}

export function jobBossOptions(config: JobBossConfig): ConstructorOptions {
  return {
    connectionString: config.connectionString,
    createSchema: config.createSchema ?? false,
    migrate: config.migrate ?? false,
    // Runtime roles cannot own pg-boss's daily queue_stats partition DDL. Live
    // getQueueStats() readings remain available when persisted snapshots are disabled.
    persistQueueStats: config.persistQueueStats ?? false,
    persistWarnings: true,
    schema: JOB_SCHEMA,
    ssl: config.ssl,
    supervise: config.supervise ?? true,
    useListenNotify: true,
  };
}

/**
 * Creates a pg-boss client against its isolated schema. Runtime callers must leave
 * createSchema and migrate disabled: only the migration task owns database DDL.
 */
export function createJobBoss(config: JobBossConfig): PgBoss {
  return new PgBoss(jobBossOptions(config));
}

/** Creates the six D17 queues and their isolated dead-letter queues. */
export async function createJobQueues(boss: Pick<PgBoss, 'createQueue'>): Promise<void> {
  for (const queue of QUEUE_DEFINITIONS) {
    await boss.createQueue(deadLetterQueueName(queue.name), DEAD_LETTER_QUEUE_OPTIONS);
  }

  for (const queue of QUEUE_DEFINITIONS) {
    await boss.createQueue(queue.name, {
      ...queue.options,
      deadLetter: deadLetterQueueName(queue.name),
    });
  }
}

/**
 * Runs pg-boss's supported schema migration and creates named queues. This is invoked
 * only by the ECS migration task, after the app migration grants runtime access.
 */
export async function initializeJobInfrastructure(
  config: Omit<JobBossConfig, 'createSchema' | 'migrate'>,
): Promise<void> {
  const boss = createJobBoss({ ...config, createSchema: false, migrate: true, supervise: false });
  try {
    await boss.start();
    await createJobQueues(boss);
  } finally {
    await boss.stop({ close: true });
  }
}

export interface JobDispatcher {
  enqueue(queue: QueueName, payload: unknown, opts?: { dedupeKey?: string }): Promise<void>;
}

interface JobSender {
  send(name: string, data?: object | null, options?: object): Promise<string | null>;
}

/**
 * Enqueues jobs through the current Kysely transaction. Rolling back the domain write
 * also rolls back the job insert, which is the required G5 transactional-outbox pattern.
 */
export function createTransactionalJobDispatcher(
  boss: JobSender,
  transaction: KyselyTransactionLike,
): JobDispatcher {
  return {
    async enqueue(queue, payload, options) {
      await boss.send(queue, payload as object, {
        db: fromKysely(transaction),
        ...(options?.dedupeKey === undefined
          ? {}
          : { singletonKey: options.dedupeKey, singletonSeconds: DAY_IN_SECONDS }),
      });
    },
  };
}

interface DatabaseSecret {
  database: string;
  host: string;
  password: string;
  port: number;
  sslmode: 'verify-full';
  username: string;
}

/** Parses the injected runtime secret without logging its credentials. */
export function databaseConnectionString(
  rawSecret: string | undefined,
  variableName = 'DATABASE_SECRET',
): string {
  if (rawSecret === undefined) {
    throw new Error(`${variableName} is required.`);
  }

  const parsed: unknown = JSON.parse(rawSecret);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Partial<DatabaseSecret>).database !== 'string' ||
    typeof (parsed as Partial<DatabaseSecret>).host !== 'string' ||
    typeof (parsed as Partial<DatabaseSecret>).password !== 'string' ||
    typeof (parsed as Partial<DatabaseSecret>).port !== 'number' ||
    typeof (parsed as Partial<DatabaseSecret>).username !== 'string' ||
    (parsed as Partial<DatabaseSecret>).sslmode !== 'verify-full'
  ) {
    throw new Error(`${variableName} has an invalid database credential shape.`);
  }

  const secret = parsed as DatabaseSecret;
  return new URL(
    `postgresql://${encodeURIComponent(secret.username)}:${encodeURIComponent(secret.password)}@${secret.host}:${secret.port}/${secret.database}`,
  ).toString();
}
