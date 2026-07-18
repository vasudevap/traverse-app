import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import {
  createTransactionalJobDispatcher,
  parseExportArchiveJob,
  QUEUES,
  type EmailDeliveryJob,
  type ExportArchiveJob,
} from '@traverse/jobs';
import {
  decryptString,
  destroyPlaintextKey,
  type JsonValue,
  type KmsCommandClient,
  type TraverseDatabaseClient,
  unwrapTenantDataKey,
  withTenantContext,
} from '@traverse/db';
import { zipSync, strToU8 } from 'fflate';
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';

export interface ExportQueueJob {
  data: unknown;
  id: string;
}

export interface ExportQueueJobResult {
  id: string;
  output?: { exportId: string };
  status: 'completed' | 'deadletter' | 'failed';
}

export interface ExportWorkerLogger {
  error(message: string, context: { error: string; jobId: string }): void;
  info(message: string, context: { exportId: string; jobId: string }): void;
}

export interface ExportArchiveRunner {
  run(job: ExportArchiveJob): Promise<void>;
}

interface ArchiveFile {
  bytes: Uint8Array;
  domain: string;
  path: string;
}

interface CollectedStage2Data {
  actor: { email: string; name: string };
  files: ArchiveFile[];
  manifestCounts: Record<string, number>;
}

function actorContext(job: ExportArchiveJob) {
  return {
    actorId: job.userId,
    coachId: job.coachId,
    practiceRole: job.practiceRole,
    role: 'coach' as const,
    tenantId: job.tenantId,
  };
}

function jsonFile(path: string, domain: string, value: unknown): ArchiveFile {
  return { bytes: strToU8(`${JSON.stringify(value, null, 2)}\n`), domain, path };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvFile(path: string, domain: string, header: string[], rows: unknown[][]): ArchiveFile {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
  return { bytes: strToU8(`${lines.join('\r\n')}\r\n`), domain, path };
}

function pdfSafeText(value: string, font: PDFFont): string {
  return [...value]
    .map((character) => {
      try {
        font.encodeText(character);
        return character;
      } catch {
        return '?';
      }
    })
    .join('');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function createContractPdf(title: string, body: string): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage([612, 792]);
  let y = 748;
  page.drawText(pdfSafeText(title, bold), { font: bold, size: 16, x: 54, y });
  y -= 30;
  const paragraphs = body.split('\n').map((paragraph) => pdfSafeText(paragraph, font));
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    const lines: string[] = [];
    for (const word of words) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (font.widthOfTextAtSize(candidate, 10) > 504 && line !== '') {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
    for (const text of lines) {
      if (y < 54) {
        page = document.addPage([612, 792]);
        y = 748;
      }
      page.drawText(text, { font, size: 10, x: 54, y });
      y -= 14;
    }
    y -= 8;
  }
  await document.attach(strToU8(body), 'signed-contract.txt', {
    description: 'Exact UTF-8 signed contract snapshot',
    mimeType: 'text/plain; charset=utf-8',
  });
  return document.save();
}

function contentManifest(
  files: ArchiveFile[],
  job: ExportArchiveJob,
  counts: Record<string, number>,
) {
  return {
    counts,
    deferredDomains: [
      'invoices and payment records become available with Stage 4',
      'video files and transcripts become available with Stage 3',
    ],
    exportId: job.exportId,
    files: files.map((file) => ({
      bytes: file.bytes.byteLength,
      domain: file.domain,
      path: file.path,
      sha256: createHash('sha256').update(file.bytes).digest('hex'),
    })),
    generatedAt: new Date().toISOString(),
    scope: job.practiceRole === 'owner' ? 'practice' : 'requesting-coach',
    tenantId: job.tenantId,
    version: 1,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown export failure.';
}

function iso(value: unknown): string {
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}

export async function processExportJobs(
  jobs: ExportQueueJob[],
  runner: ExportArchiveRunner,
  logger: ExportWorkerLogger,
): Promise<ExportQueueJobResult[]> {
  return Promise.all(
    jobs.map(async (queueJob) => {
      let job: ExportArchiveJob;
      try {
        job = parseExportArchiveJob(queueJob.data);
      } catch (error) {
        logger.error('@traverse/worker export job rejected', {
          error: errorMessage(error),
          jobId: queueJob.id,
        });
        return { id: queueJob.id, status: 'deadletter' as const };
      }
      try {
        await runner.run(job);
        logger.info('@traverse/worker export ready', {
          exportId: job.exportId,
          jobId: queueJob.id,
        });
        return {
          id: queueJob.id,
          output: { exportId: job.exportId },
          status: 'completed' as const,
        };
      } catch (error) {
        logger.error('@traverse/worker export failed', {
          error: errorMessage(error),
          jobId: queueJob.id,
        });
        return { id: queueJob.id, status: 'failed' as const };
      }
    }),
  );
}

export class DatabaseExportArchiveRunner implements ExportArchiveRunner {
  constructor(
    private readonly database: TraverseDatabaseClient,
    private readonly boss: {
      send(name: string, data?: object | null, options?: object): Promise<string | null>;
    },
    private readonly kms: KmsCommandClient,
    private readonly s3: S3Client,
    private readonly config: {
      assetBucket: string;
      coachAppBaseUrl: string;
      emailFrom: string;
      kmsKeyId: string;
    },
  ) {}

  async run(job: ExportArchiveJob): Promise<void> {
    try {
      const collected = await this.collect(job);
      if (collected === undefined) return;
      const manifest = contentManifest(collected.files, job, collected.manifestCounts);
      const files = [...collected.files, jsonFile('manifest.json', 'manifest', manifest)];
      const archive = zipSync(Object.fromEntries(files.map((file) => [file.path, file.bytes])), {
        level: 6,
      });
      const objectKey = `exports/${job.tenantId}/${job.exportId}.zip`;
      await this.s3.send(
        new PutObjectCommand({
          Body: archive,
          Bucket: this.config.assetBucket,
          ContentDisposition: `attachment; filename="traverse-export-${job.exportId}.zip"`,
          ContentType: 'application/zip',
          Key: objectKey,
          SSEKMSKeyId: this.config.kmsKeyId,
          ServerSideEncryption: 'aws:kms',
        }),
      );
      await this.markReady(job, objectKey, archive.byteLength, manifest, collected.actor);
    } catch (error) {
      await this.markFailed(job);
      throw error;
    }
  }

  private async collect(job: ExportArchiveJob): Promise<CollectedStage2Data | undefined> {
    return withTenantContext(this.database, actorContext(job), async (transaction) => {
      const database = transaction.withSchema('app');
      const exportRecord = await database
        .selectFrom('exports')
        .select(['id', 'status'])
        .where('id', '=', job.exportId)
        .where('requested_by', '=', job.userId)
        .executeTakeFirst();
      if (exportRecord === undefined) throw new Error('Export request was not found.');
      if (exportRecord.status === 'ready') return undefined;
      await database
        .updateTable('exports')
        .set({ completed_at: null, error_code: null, status: 'processing', updated_at: sql`now()` })
        .where('id', '=', job.exportId)
        .executeTakeFirstOrThrow();

      const actor = await database
        .selectFrom('users')
        .select(['email', 'name'])
        .where('id', '=', job.userId)
        .executeTakeFirstOrThrow();
      const tenant = await database
        .selectFrom('tenants')
        .select([
          'business_address',
          'business_email',
          'legal_name',
          'name',
          'phone',
          'subdomain',
          'timezone',
          'website_url',
        ])
        .where('id', '=', job.tenantId)
        .executeTakeFirstOrThrow();
      let coachQuery = database
        .selectFrom('coaches as coach')
        .innerJoin('users as user', 'user.id', 'coach.user_id')
        .select([
          'coach.bio',
          'coach.discipline',
          'coach.display_name',
          'coach.id',
          'coach.profile_photo_ref',
          'coach.role_in_practice',
          'coach.specialties',
          'coach.status',
          'user.email',
          'user.name',
        ]);
      if (job.practiceRole !== 'owner') coachQuery = coachQuery.where('coach.id', '=', job.coachId);
      const coaches = await coachQuery.orderBy('user.name').execute();
      let relationshipQuery = database
        .selectFrom('coaching_relationships as relationship')
        .innerJoin('clients as client', 'client.id', 'relationship.client_id')
        .innerJoin('users as user', 'user.id', 'client.user_id')
        .innerJoin('coaches as coach', 'coach.id', 'relationship.coach_id')
        .select([
          'client.id as client_id',
          'client.name as client_name',
          'client.phone',
          'coach.display_name as coach_name',
          'relationship.archived_at',
          'relationship.coach_id',
          'relationship.created_at',
          'relationship.id',
          'relationship.notes_enc',
          'relationship.notes_key_version',
          'relationship.onboarding_state',
          'relationship.source_import_id',
          'relationship.status',
          'relationship.tags',
          'user.email',
        ]);
      if (job.practiceRole !== 'owner') {
        relationshipQuery = relationshipQuery.where('relationship.coach_id', '=', job.coachId);
      }
      const relationships = await relationshipQuery.orderBy('client.name').execute();
      const relationshipIds = relationships.map((row) => row.id);
      const tenantKey = await database
        .selectFrom('tenant_keys')
        .select(['key_version', 'kms_key_id', 'wrapped_data_key'])
        .where('tenant_id', '=', job.tenantId)
        .executeTakeFirstOrThrow();
      const unwrapped = await unwrapTenantDataKey(
        this.kms,
        tenantKey.kms_key_id,
        job.tenantId,
        tenantKey.key_version,
        tenantKey.wrapped_data_key,
      );
      try {
        const clientRows = relationships.map((row) => [
          row.client_id,
          row.client_name,
          row.email,
          row.phone,
          row.coach_name,
          row.status,
          row.onboarding_state,
          row.source_import_id ?? '',
          row.tags.join(';'),
          row.notes_enc === null || row.notes_key_version === null
            ? ''
            : decryptString(row.notes_enc, unwrapped.plaintextKey, {
                field: 'notes_enc',
                keyVersion: row.notes_key_version,
                rowId: row.id,
                table: 'coaching_relationships',
                tenantId: job.tenantId,
              }),
          iso(row.created_at),
          row.archived_at?.toISOString() ?? '',
        ]);
        const files: ArchiveFile[] = [
          jsonFile('practice/profile.json', 'practice', tenant),
          jsonFile('practice/coaches.json', 'practice', coaches),
          csvFile(
            'clients/clients.csv',
            'clients',
            [
              'client_id',
              'name',
              'email',
              'phone',
              'coach',
              'status',
              'onboarding_state',
              'source_import_id',
              'tags',
              'notes',
              'created_at',
              'archived_at',
            ],
            clientRows,
          ),
        ];

        let contractTemplateQuery = database.selectFrom('contract_templates').selectAll();
        let intakeFormQuery = database.selectFrom('intake_forms').selectAll();
        if (job.practiceRole !== 'owner') {
          contractTemplateQuery = contractTemplateQuery.where('coach_id', '=', job.coachId);
          intakeFormQuery = intakeFormQuery.where('coach_id', '=', job.coachId);
        }
        const [contractTemplates, intakeForms] = await Promise.all([
          contractTemplateQuery.orderBy('created_at').execute(),
          intakeFormQuery.orderBy('created_at').execute(),
        ]);
        files.push(jsonFile('contracts/templates.json', 'contracts', contractTemplates));
        files.push(jsonFile('intake/forms.json', 'intake', intakeForms));

        const contracts =
          relationshipIds.length === 0
            ? []
            : await database
                .selectFrom('contract_instances as contract')
                .leftJoin('contract_templates as template', 'template.id', 'contract.template_id')
                .select([
                  'contract.created_at',
                  'contract.id',
                  'contract.relationship_id',
                  'contract.signed_snapshot',
                  'contract.template_version',
                  'template.name',
                ])
                .where('contract.relationship_id', 'in', relationshipIds)
                .execute();
        const contractIds = contracts.map((row) => row.id);
        const signatures =
          contractIds.length === 0
            ? []
            : await database
                .selectFrom('contract_signatures')
                .select([
                  'consent_text',
                  'contract_instance_id',
                  'ip',
                  'signed_at',
                  'signer_name',
                  'signer_role',
                  'signer_user_id',
                  'user_agent',
                ])
                .where('contract_instance_id', 'in', contractIds)
                .execute();
        for (const contract of contracts) {
          files.push({
            bytes: await createContractPdf(
              contract.name ?? 'Coaching agreement',
              contract.signed_snapshot,
            ),
            domain: 'contracts',
            path: `contracts/${contract.id}.pdf`,
          });
        }
        files.push(jsonFile('contracts/index.json', 'contracts', { contracts, signatures }));

        const intake =
          relationshipIds.length === 0
            ? []
            : await database
                .selectFrom('intake_responses')
                .select([
                  'answers_enc',
                  'answers_key_version',
                  'created_at',
                  'intake_form_id',
                  'id',
                  'relationship_id',
                  'submitted_at',
                ])
                .where('relationship_id', 'in', relationshipIds)
                .execute();
        const intakeJson = intake.map((row) => ({
          answers: JSON.parse(
            decryptString(row.answers_enc, unwrapped.plaintextKey, {
              field: 'answers_enc',
              keyVersion: row.answers_key_version,
              rowId: row.id,
              table: 'intake_responses',
              tenantId: job.tenantId,
            }),
          ) as unknown,
          createdAt: row.created_at,
          formId: row.intake_form_id,
          id: row.id,
          relationshipId: row.relationship_id,
          submittedAt: row.submitted_at,
        }));
        files.push(jsonFile('intake/responses.json', 'intake', intakeJson));

        let appointmentQuery = database
          .selectFrom('appointments')
          .select([
            'coach_id',
            'ends_at',
            'group_id',
            'id',
            'meeting_link',
            'notes',
            'relationship_id',
            'starts_at',
            'status',
            'timezone',
            'title',
          ]);
        if (job.practiceRole !== 'owner')
          appointmentQuery = appointmentQuery.where('coach_id', '=', job.coachId);
        const appointments = await appointmentQuery.orderBy('starts_at').execute();
        files.push(
          csvFile(
            'appointments/appointments.csv',
            'appointments',
            [
              'id',
              'title',
              'starts_at',
              'ends_at',
              'timezone',
              'status',
              'relationship_id',
              'group_id',
              'meeting_link',
              'notes',
            ],
            appointments.map((row) => [
              row.id,
              row.title,
              row.starts_at.toISOString(),
              row.ends_at.toISOString(),
              row.timezone,
              row.status,
              row.relationship_id,
              row.group_id,
              row.meeting_link,
              row.notes,
            ]),
          ),
        );

        const tasks =
          relationshipIds.length === 0
            ? []
            : await database
                .selectFrom('tasks')
                .select([
                  'created_at',
                  'completed_at',
                  'description',
                  'due_at',
                  'id',
                  'relationship_id',
                  'status',
                  'title',
                ])
                .where('relationship_id', 'in', relationshipIds)
                .orderBy('created_at')
                .execute();
        files.push(
          csvFile(
            'tasks/tasks.csv',
            'tasks',
            [
              'id',
              'relationship_id',
              'title',
              'description',
              'due_at',
              'status',
              'assigned_at',
              'completed_at',
            ],
            tasks.map((row) => [
              row.id,
              row.relationship_id,
              row.title,
              row.description,
              row.due_at?.toISOString(),
              row.status,
              iso(row.created_at),
              row.completed_at?.toISOString(),
            ]),
          ),
        );

        let groupQuery = database.selectFrom('groups').selectAll();
        if (job.practiceRole !== 'owner')
          groupQuery = groupQuery.where('coach_id', '=', job.coachId);
        const groups = await groupQuery.orderBy('name').execute();
        const groupIds = groups.map((row) => row.id);
        const memberships =
          groupIds.length === 0
            ? []
            : await database
                .selectFrom('group_memberships')
                .select(['client_id', 'created_at', 'group_id'])
                .where('group_id', 'in', groupIds)
                .execute();
        files.push(jsonFile('groups/groups.json', 'groups', { groups, memberships }));

        let typeQuery = database.selectFrom('appointment_types').selectAll();
        let availabilityQuery = database.selectFrom('availability_windows').selectAll();
        if (job.practiceRole !== 'owner') {
          typeQuery = typeQuery.where('coach_id', '=', job.coachId);
          availabilityQuery = availabilityQuery.where('coach_id', '=', job.coachId);
        }
        let auditQuery = database.selectFrom('event_log').selectAll();
        if (job.practiceRole !== 'owner')
          auditQuery = auditQuery.where('actor_id', '=', job.userId);
        const [appointmentTypes, availability, imports, audit] = await Promise.all([
          typeQuery.orderBy('name').execute(),
          availabilityQuery.orderBy('created_at').execute(),
          database.selectFrom('imports').selectAll().orderBy('created_at').execute(),
          auditQuery.orderBy('occurred_at').execute(),
        ]);
        files.push(jsonFile('scheduling/appointment-types.json', 'scheduling', appointmentTypes));
        files.push(jsonFile('scheduling/availability.json', 'scheduling', availability));
        files.push(jsonFile('migration/import-history.json', 'migration', imports));
        files.push(jsonFile('audit/event-log.json', 'audit', audit));
        return {
          actor,
          files,
          manifestCounts: {
            appointments: appointments.length,
            auditEvents: audit.length,
            clients: relationships.length,
            contracts: contracts.length,
            contractTemplates: contractTemplates.length,
            coaches: coaches.length,
            groups: groups.length,
            imports: imports.length,
            intakeForms: intakeForms.length,
            intakeResponses: intake.length,
            tasks: tasks.length,
          },
        };
      } finally {
        destroyPlaintextKey(unwrapped.plaintextKey);
      }
    });
  }

  private async markReady(
    job: ExportArchiveJob,
    objectKey: string,
    archiveSizeBytes: number,
    manifest: Record<string, unknown>,
    actor: { email: string; name: string },
  ): Promise<void> {
    await withTenantContext(this.database, actorContext(job), async (transaction) => {
      const database = transaction.withSchema('app');
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000);
      await database
        .updateTable('exports')
        .set({
          archive_size_bytes: archiveSizeBytes,
          artifact_ref: objectKey,
          completed_at: now,
          error_code: null,
          expires_at: expiresAt,
          manifest: manifest as JsonValue,
          status: 'ready',
          updated_at: sql`now()`,
        })
        .where('id', '=', job.exportId)
        .where('requested_by', '=', job.userId)
        .executeTakeFirstOrThrow();
      const exportUrl = new URL('/settings/data', this.config.coachAppBaseUrl).toString();
      const email: EmailDeliveryJob = {
        entityId: job.exportId,
        from: this.config.emailFrom,
        html: `<p>Hi ${escapeHtml(actor.name)},</p><p>Your Traverse export is ready. The download remains available for seven days.</p><p><a href="${exportUrl}">Download your export</a></p>`,
        notificationId: `export-ready:${job.exportId}`,
        recipientId: job.userId,
        subject: 'Your Traverse export is ready',
        text: `Hi ${actor.name}, your Traverse export is ready and remains available for seven days: ${exportUrl}`,
        to: actor.email,
      };
      await createTransactionalJobDispatcher(this.boss, transaction).enqueue(QUEUES.email, email, {
        dedupeKey: `export-ready:${job.exportId}`,
      });
      await database
        .insertInto('event_log')
        .values({
          action: 'practice.export.ready',
          actor_id: job.userId,
          actor_type: 'coach',
          entity_id: job.exportId,
          entity_type: 'export',
          metadata: { archiveSizeBytes, expiresAt: expiresAt.toISOString() },
          tenant_id: job.tenantId,
        })
        .executeTakeFirstOrThrow();
    });
  }

  private async markFailed(job: ExportArchiveJob): Promise<void> {
    await withTenantContext(this.database, actorContext(job), async (transaction) => {
      const now = new Date();
      await transaction
        .withSchema('app')
        .updateTable('exports')
        .set({
          completed_at: now,
          error_code: 'archive_generation_failed',
          status: 'failed',
          updated_at: sql`now()`,
        })
        .where('id', '=', job.exportId)
        .where('requested_by', '=', job.userId)
        .execute();
    });
  }
}
