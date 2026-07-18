import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  destroyPlaintextKey,
  encryptString,
  type JsonValue,
  type KmsCommandClient,
  type TraverseDatabaseClient,
  unwrapTenantDataKey,
  withTenantContext,
} from '@traverse/db';
import { createTransactionalJobDispatcher, QUEUES, type ExportArchiveJob } from '@traverse/jobs';
import { sql } from 'kysely';
import type { CoachOnboardingActor } from './client-onboarding.service.js';
import type {
  ClientImportIssue,
  ClientImportRow,
  ClientImportSummary,
  DataPortabilityAssetStore,
  DataPortabilityStore,
  PracticeExportSummary,
} from './data-portability.service.js';

interface JobBossSender {
  send(name: string, data?: object | null, options?: object): Promise<string | null>;
}

interface NotesBatchInput {
  keyVersion: number;
  kmsKeyId: string;
  rows: Array<{ notes: string; relationshipId: string }>;
  tenantId: string;
  wrappedDataKey: Buffer;
}

export interface DataPortabilityNotesCipher {
  encrypt(input: NotesBatchInput): Promise<Map<string, Buffer>>;
}

export class KmsDataPortabilityNotesCipher implements DataPortabilityNotesCipher {
  constructor(private readonly kms: KmsCommandClient) {}

  async encrypt(input: NotesBatchInput): Promise<Map<string, Buffer>> {
    const unwrapped = await unwrapTenantDataKey(
      this.kms,
      input.kmsKeyId,
      input.tenantId,
      input.keyVersion,
      input.wrappedDataKey,
    );
    try {
      return new Map(
        input.rows.map((row) => [
          row.relationshipId,
          encryptString(row.notes, unwrapped.plaintextKey, {
            field: 'notes_enc',
            keyVersion: unwrapped.keyVersion,
            rowId: row.relationshipId,
            table: 'coaching_relationships',
            tenantId: input.tenantId,
          }),
        ]),
      );
    } finally {
      destroyPlaintextKey(unwrapped.plaintextKey);
    }
  }
}

function coachContext(actor: CoachOnboardingActor) {
  return {
    actorId: actor.userId,
    coachId: actor.coachId,
    practiceRole: actor.practiceRole,
    role: 'coach' as const,
    tenantId: actor.tenantId,
  };
}

function jsonIssues(value: JsonValue): ClientImportIssue[] {
  if (!Array.isArray(value)) return [];
  const issues: ClientImportIssue[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    if (
      typeof entry.code === 'string' &&
      ['email', 'name', 'notes', 'row', 'tags'].includes(String(entry.field)) &&
      typeof entry.message === 'string' &&
      typeof entry.rowNumber === 'number'
    ) {
      issues.push({
        code: entry.code,
        field: entry.field as ClientImportIssue['field'],
        message: entry.message,
        rowNumber: entry.rowNumber,
      });
    }
  }
  return issues;
}

function date(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function jsonManifest(value: JsonValue): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function importSummary(row: {
  completed_at: Date | null;
  created_at: unknown;
  error_report: JsonValue;
  id: string;
  imported_rows: number | null;
  rejected_rows: number | null;
  source_filename: string | null;
  status: string;
  total_rows: number | null;
}): ClientImportSummary {
  return {
    completedAt: row.completed_at,
    createdAt: date(row.created_at),
    errorReport: jsonIssues(row.error_report),
    filename: row.source_filename,
    id: row.id,
    importedRows: row.imported_rows,
    rejectedRows: row.rejected_rows,
    status: row.status as ClientImportSummary['status'],
    totalRows: row.total_rows,
  };
}

function exportSummary(row: {
  archive_size_bytes: number | null;
  completed_at: Date | null;
  created_at: unknown;
  error_code: string | null;
  expires_at: Date | null;
  id: string;
  manifest: JsonValue;
  status: string;
}): PracticeExportSummary {
  return {
    archiveSizeBytes: row.archive_size_bytes,
    completedAt: row.completed_at,
    createdAt: date(row.created_at),
    errorCode: row.error_code,
    expiresAt: row.expires_at,
    id: row.id,
    manifest: jsonManifest(row.manifest),
    status: row.status as PracticeExportSummary['status'],
  };
}

function issuesJson(issues: ClientImportIssue[]): JsonValue {
  return issues.map((entry) => ({ ...entry }));
}

export class DatabaseDataPortabilityStore implements DataPortabilityStore {
  constructor(
    private readonly database: TraverseDatabaseClient,
    private readonly boss: JobBossSender,
    private readonly notesCipher: DataPortabilityNotesCipher,
  ) {}

  async findExistingRelationshipEmails(
    actor: CoachOnboardingActor,
    emails: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (emails.length === 0) return new Set();
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const rows = await transaction
        .withSchema('app')
        .selectFrom('coaching_relationships as relationship')
        .innerJoin('clients as client', 'client.id', 'relationship.client_id')
        .innerJoin('users as user', 'user.id', 'client.user_id')
        .select('user.email')
        .where('relationship.coach_id', '=', actor.coachId)
        .where('relationship.archived_at', 'is', null)
        .where('user.email', 'in', [...emails])
        .execute();
      return new Set(rows.map((row) => row.email.toLowerCase()));
    });
  }

  async createClientImport(input: {
    actor: CoachOnboardingActor;
    filename: string;
    issues: ClientImportIssue[];
    rows: ClientImportRow[];
    sourceSha256: string;
    totalRows: number;
  }): Promise<ClientImportSummary> {
    return withTenantContext(this.database, coachContext(input.actor), async (transaction) => {
      const database = transaction.withSchema('app');
      const dynamicIssues = [...input.issues];
      const importRecord = await database
        .insertInto('imports')
        .values({
          error_report: issuesJson(dynamicIssues),
          imported_rows: 0,
          rejected_rows: new Set(dynamicIssues.map((entry) => entry.rowNumber)).size,
          requested_by: input.actor.userId,
          source_filename: input.filename,
          source_ref: `inline-sha256:${input.sourceSha256}`,
          source_sha256: input.sourceSha256,
          source_type: 'csv_clients',
          status: 'processing',
          tenant_id: input.actor.tenantId,
          total_rows: input.totalRows,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const notesRows: Array<{ notes: string; relationshipId: string }> = [];
      let importedRows = 0;
      for (const row of input.rows) {
        const existingRelationship = await database
          .selectFrom('coaching_relationships as relationship')
          .innerJoin('clients as client', 'client.id', 'relationship.client_id')
          .innerJoin('users as user', 'user.id', 'client.user_id')
          .select('relationship.id')
          .where('relationship.coach_id', '=', input.actor.coachId)
          .where('relationship.archived_at', 'is', null)
          .where('user.email', '=', row.email)
          .executeTakeFirst();
        if (existingRelationship !== undefined) {
          dynamicIssues.push({
            code: 'existing_relationship',
            field: 'email',
            message: 'This client already has a relationship with you.',
            rowNumber: row.rowNumber,
          });
          continue;
        }
        let user = await database
          .selectFrom('users')
          .select('id')
          .where('email', '=', row.email)
          .executeTakeFirst();
        if (user === undefined) {
          user = await database
            .insertInto('users')
            .values({ email: row.email, name: row.name, password_hash: null, status: 'imported' })
            .returning('id')
            .executeTakeFirstOrThrow();
        }
        let client = await database
          .selectFrom('clients')
          .select('id')
          .where('user_id', '=', user.id)
          .executeTakeFirst();
        if (client === undefined) {
          client = await database
            .insertInto('clients')
            .values({ name: row.name, phone: null, user_id: user.id })
            .returning('id')
            .executeTakeFirstOrThrow();
        }
        const relationship = await database
          .insertInto('coaching_relationships')
          .values({
            client_id: client.id,
            coach_id: input.actor.coachId,
            onboarding_state: 'imported',
            source_import_id: importRecord.id,
            status: 'imported',
            tags: row.tags,
            tenant_id: input.actor.tenantId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        if (row.notes !== '') {
          notesRows.push({ notes: row.notes, relationshipId: relationship.id });
        }
        importedRows += 1;
      }
      if (notesRows.length > 0) {
        const tenantKey = await database
          .selectFrom('tenant_keys')
          .select(['key_version', 'kms_key_id', 'wrapped_data_key'])
          .where('tenant_id', '=', input.actor.tenantId)
          .executeTakeFirstOrThrow();
        const encrypted = await this.notesCipher.encrypt({
          keyVersion: tenantKey.key_version,
          kmsKeyId: tenantKey.kms_key_id,
          rows: notesRows,
          tenantId: input.actor.tenantId,
          wrappedDataKey: tenantKey.wrapped_data_key,
        });
        for (const row of notesRows) {
          await database
            .updateTable('coaching_relationships')
            .set({
              notes_enc: encrypted.get(row.relationshipId),
              notes_key_version: tenantKey.key_version,
              updated_at: sql`now()`,
            })
            .where('id', '=', row.relationshipId)
            .executeTakeFirstOrThrow();
        }
      }
      const rejectedRows = new Set(dynamicIssues.map((entry) => entry.rowNumber)).size;
      const completed = await database
        .updateTable('imports')
        .set({
          completed_at: sql`now()`,
          error_report: issuesJson(dynamicIssues),
          imported_rows: importedRows,
          rejected_rows: rejectedRows,
          status: 'ready',
          updated_at: sql`now()`,
        })
        .where('id', '=', importRecord.id)
        .returning([
          'completed_at',
          'created_at',
          'error_report',
          'id',
          'imported_rows',
          'rejected_rows',
          'source_filename',
          'status',
          'total_rows',
        ])
        .executeTakeFirstOrThrow();
      await database
        .insertInto('event_log')
        .values({
          action: 'practice.clients.imported',
          actor_id: input.actor.userId,
          actor_type: 'coach',
          entity_id: importRecord.id,
          entity_type: 'import',
          metadata: { importedRows, rejectedRows, totalRows: input.totalRows },
          tenant_id: input.actor.tenantId,
        })
        .executeTakeFirstOrThrow();
      return importSummary(completed);
    });
  }

  async listImports(actor: CoachOnboardingActor): Promise<ClientImportSummary[]> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const rows = await transaction
        .withSchema('app')
        .selectFrom('imports')
        .select([
          'completed_at',
          'created_at',
          'error_report',
          'id',
          'imported_rows',
          'rejected_rows',
          'source_filename',
          'status',
          'total_rows',
        ])
        .orderBy('created_at', 'desc')
        .limit(20)
        .execute();
      return rows.map(importSummary);
    });
  }

  async requestExport(actor: CoachOnboardingActor): Promise<PracticeExportSummary> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const database = transaction.withSchema('app');
      const record = await database
        .insertInto('exports')
        .values({ requested_by: actor.userId, scope: 'everything', tenant_id: actor.tenantId })
        .returning([
          'archive_size_bytes',
          'completed_at',
          'created_at',
          'error_code',
          'expires_at',
          'id',
          'manifest',
          'status',
        ])
        .executeTakeFirstOrThrow();
      const dispatcher = createTransactionalJobDispatcher(this.boss, transaction);
      const job: ExportArchiveJob = {
        coachId: actor.coachId,
        exportId: record.id,
        practiceRole: actor.practiceRole,
        tenantId: actor.tenantId,
        userId: actor.userId,
      };
      await dispatcher.enqueue(QUEUES.exportArchive, job, { dedupeKey: record.id });
      await database
        .insertInto('event_log')
        .values({
          action: 'practice.export.requested',
          actor_id: actor.userId,
          actor_type: 'coach',
          entity_id: record.id,
          entity_type: 'export',
          metadata: { scope: 'everything' },
          tenant_id: actor.tenantId,
        })
        .executeTakeFirstOrThrow();
      return exportSummary(record);
    });
  }

  async listExports(actor: CoachOnboardingActor): Promise<PracticeExportSummary[]> {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const database = transaction.withSchema('app');
      await database
        .updateTable('exports')
        .set({
          completed_at: sql`COALESCE(completed_at, now())`,
          status: 'expired',
          updated_at: sql`now()`,
        })
        .where('requested_by', '=', actor.userId)
        .where('status', '=', 'ready')
        .where('expires_at', '<=', new Date())
        .execute();
      const rows = await database
        .selectFrom('exports')
        .select([
          'archive_size_bytes',
          'completed_at',
          'created_at',
          'error_code',
          'expires_at',
          'id',
          'manifest',
          'status',
        ])
        .orderBy('created_at', 'desc')
        .limit(20)
        .execute();
      return rows.map(exportSummary);
    });
  }

  async getExport(actor: CoachOnboardingActor, exportId: string) {
    return withTenantContext(this.database, coachContext(actor), async (transaction) => {
      const row = await transaction
        .withSchema('app')
        .selectFrom('exports')
        .select([
          'archive_size_bytes',
          'artifact_ref',
          'completed_at',
          'created_at',
          'error_code',
          'expires_at',
          'id',
          'manifest',
          'status',
        ])
        .where('id', '=', exportId)
        .executeTakeFirst();
      return row === undefined
        ? undefined
        : { ...exportSummary(row), artifactRef: row.artifact_ref };
    });
  }
}

export class S3DataPortabilityAssetStore implements DataPortabilityAssetStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async createDownloadUrl(objectKey: string, filename: string) {
    if (!objectKey.startsWith('exports/') || objectKey.includes('..')) {
      throw new Error('Export object reference is invalid.');
    }
    const expiresIn = 15 * 60;
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ResponseContentDisposition: `attachment; filename="${filename}"`,
        ResponseContentType: 'application/zip',
      }),
      { expiresIn },
    );
    return { expiresAt: new Date(Date.now() + expiresIn * 1_000), url };
  }
}
