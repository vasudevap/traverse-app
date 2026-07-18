import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { CoachOnboardingActor } from './client-onboarding.service.js';

export const DATA_PORTABILITY_STORE = Symbol('DATA_PORTABILITY_STORE');
export const DATA_PORTABILITY_ASSETS = Symbol('DATA_PORTABILITY_ASSETS');

const MAX_CSV_BYTES = 1_000_000;
const MAX_CSV_ROWS = 1_000;
const MAX_TAGS = 20;

export interface ClientImportIssue {
  code: string;
  field: 'email' | 'name' | 'notes' | 'row' | 'tags';
  message: string;
  rowNumber: number;
}

export interface ClientImportRow {
  email: string;
  name: string;
  notes: string;
  rowNumber: number;
  tags: string[];
}

export interface ClientImportPreview {
  filename: string;
  issues: ClientImportIssue[];
  rejectedRows: number;
  rows: Array<ClientImportRow & { valid: boolean }>;
  sourceSha256: string;
  totalRows: number;
  validRows: number;
}

export interface ClientImportSummary {
  completedAt: Date | null;
  createdAt: Date;
  errorReport: ClientImportIssue[];
  filename: string | null;
  id: string;
  importedRows: number | null;
  rejectedRows: number | null;
  status: 'failed' | 'pending' | 'processing' | 'ready';
  totalRows: number | null;
}

export interface PracticeExportSummary {
  archiveSizeBytes: number | null;
  completedAt: Date | null;
  createdAt: Date;
  errorCode: string | null;
  expiresAt: Date | null;
  id: string;
  manifest: Record<string, unknown>;
  status: 'expired' | 'failed' | 'pending' | 'processing' | 'ready';
}

export interface DataPortabilityStore {
  createClientImport(input: {
    actor: CoachOnboardingActor;
    filename: string;
    issues: ClientImportIssue[];
    rows: ClientImportRow[];
    sourceSha256: string;
    totalRows: number;
  }): Promise<ClientImportSummary>;
  findExistingRelationshipEmails(
    actor: CoachOnboardingActor,
    emails: readonly string[],
  ): Promise<ReadonlySet<string>>;
  getExport(
    actor: CoachOnboardingActor,
    exportId: string,
  ): Promise<(PracticeExportSummary & { artifactRef: string | null }) | undefined>;
  listExports(actor: CoachOnboardingActor): Promise<PracticeExportSummary[]>;
  listImports(actor: CoachOnboardingActor): Promise<ClientImportSummary[]>;
  requestExport(actor: CoachOnboardingActor): Promise<PracticeExportSummary>;
}

export interface DataPortabilityAssetStore {
  createDownloadUrl(
    objectKey: string,
    filename: string,
  ): Promise<{
    expiresAt: Date;
    url: string;
  }>;
}

function requiredString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException(`${label} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new BadRequestException(`${label} must be ${max} characters or fewer.`);
  }
  return normalized;
}

function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field === '') {
      quoted = true;
    } else if (character === ',') {
      record.push(field);
      field = '';
    } else if (character === '\n') {
      record.push(field.replace(/\r$/, ''));
      records.push(record);
      record = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (quoted) throw new BadRequestException('CSV contains an unclosed quoted field.');
  record.push(field.replace(/\r$/, ''));
  if (record.some((value) => value.trim() !== '') || records.length === 0) records.push(record);
  return records;
}

function headerKey(value: string): 'email' | 'name' | 'notes' | 'tags' | undefined {
  const normalized = value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (['name', 'full_name', 'client_name'].includes(normalized)) return 'name';
  if (['email', 'email_address'].includes(normalized)) return 'email';
  if (['notes', 'client_notes', 'private_notes'].includes(normalized)) return 'notes';
  if (['tags', 'labels'].includes(normalized)) return 'tags';
  return undefined;
}

function issue(
  rowNumber: number,
  field: ClientImportIssue['field'],
  code: string,
  message: string,
): ClientImportIssue {
  return { code, field, message, rowNumber };
}

function parseTags(value: string, rowNumber: number, issues: ClientImportIssue[]): string[] {
  const tags = [
    ...new Set(
      value
        .split(/[;|]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
  if (tags.length > MAX_TAGS) {
    issues.push(issue(rowNumber, 'tags', 'too_many_tags', `Use no more than ${MAX_TAGS} tags.`));
  }
  if (tags.some((tag) => tag.length > 50)) {
    issues.push(
      issue(rowNumber, 'tags', 'tag_too_long', 'Each tag must be 50 characters or fewer.'),
    );
  }
  return tags.slice(0, MAX_TAGS);
}

export function parseClientCsv(filenameValue: unknown, csvValue: unknown): ClientImportPreview {
  const filename = requiredString(filenameValue, 'filename', 255);
  if (!filename.toLowerCase().endsWith('.csv')) {
    throw new BadRequestException('filename must end in .csv.');
  }
  if (typeof csvValue !== 'string' || csvValue.trim() === '') {
    throw new BadRequestException('csv is required.');
  }
  if (Buffer.byteLength(csvValue, 'utf8') > MAX_CSV_BYTES) {
    throw new BadRequestException('CSV must be 1 MB or smaller.');
  }
  const records = parseCsv(csvValue);
  const rawHeader = records.shift();
  if (rawHeader === undefined) throw new BadRequestException('CSV header is required.');
  const header = rawHeader.map(headerKey);
  const nameIndex = header.indexOf('name');
  const emailIndex = header.indexOf('email');
  if (nameIndex < 0 || emailIndex < 0) {
    throw new BadRequestException('CSV must include name and email columns.');
  }
  if (
    header.filter((value) => value === 'name').length > 1 ||
    header.filter((value) => value === 'email').length > 1
  ) {
    throw new BadRequestException('CSV contains duplicate name or email columns.');
  }
  const contentRecords = records.filter((record) => record.some((value) => value.trim() !== ''));
  if (contentRecords.length > MAX_CSV_ROWS) {
    throw new BadRequestException(`CSV must contain ${MAX_CSV_ROWS} client rows or fewer.`);
  }
  const emailIndexOptional = header.indexOf('email');
  const notesIndex = header.indexOf('notes');
  const tagsIndex = header.indexOf('tags');
  const rows: ClientImportPreview['rows'] = [];
  const issues: ClientImportIssue[] = [];
  const seenEmails = new Set<string>();
  for (const [index, record] of contentRecords.entries()) {
    const rowNumber = index + 2;
    const rowIssues: ClientImportIssue[] = [];
    if (record.length > rawHeader.length) {
      rowIssues.push(
        issue(rowNumber, 'row', 'column_count', 'Row has more columns than the header.'),
      );
    }
    const name = (record[nameIndex] ?? '').trim();
    const email = (record[emailIndexOptional] ?? '').trim().toLowerCase();
    const notes = notesIndex < 0 ? '' : (record[notesIndex] ?? '').trim();
    if (name === '') rowIssues.push(issue(rowNumber, 'name', 'required', 'Name is required.'));
    if (name.length > 200)
      rowIssues.push(issue(rowNumber, 'name', 'too_long', 'Name must be 200 characters or fewer.'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      rowIssues.push(issue(rowNumber, 'email', 'invalid', 'Enter a valid email address.'));
    } else if (seenEmails.has(email)) {
      rowIssues.push(
        issue(
          rowNumber,
          'email',
          'duplicate_in_file',
          'Email appears more than once in this file.',
        ),
      );
    } else {
      seenEmails.add(email);
    }
    if (notes.length > 10_000) {
      rowIssues.push(
        issue(rowNumber, 'notes', 'too_long', 'Notes must be 10,000 characters or fewer.'),
      );
    }
    const tags = parseTags(tagsIndex < 0 ? '' : (record[tagsIndex] ?? ''), rowNumber, rowIssues);
    issues.push(...rowIssues);
    rows.push({ email, name, notes, rowNumber, tags, valid: rowIssues.length === 0 });
  }
  return {
    filename,
    issues,
    rejectedRows: rows.filter((row) => !row.valid).length,
    rows,
    sourceSha256: createHash('sha256').update(csvValue, 'utf8').digest('hex'),
    totalRows: rows.length,
    validRows: rows.filter((row) => row.valid).length,
  };
}

@Injectable()
export class DataPortabilityService {
  constructor(
    @Inject(DATA_PORTABILITY_STORE) private readonly store: DataPortabilityStore,
    @Inject(DATA_PORTABILITY_ASSETS) private readonly assets: DataPortabilityAssetStore,
  ) {}

  async previewClientImport(actor: CoachOnboardingActor, body: unknown) {
    const input =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const preview = parseClientCsv(input.filename, input.csv);
    return this.addExistingRelationshipIssues(actor, preview);
  }

  async importClients(actor: CoachOnboardingActor, body: unknown) {
    const preview = await this.previewClientImport(actor, body);
    const rows = preview.rows.filter((row) => row.valid).map(({ valid: _valid, ...row }) => row);
    if (rows.length === 0) {
      throw new BadRequestException('CSV has no valid client rows to import.');
    }
    return this.store.createClientImport({
      actor,
      filename: preview.filename,
      issues: preview.issues,
      rows,
      sourceSha256: preview.sourceSha256,
      totalRows: preview.totalRows,
    });
  }

  listImports(actor: CoachOnboardingActor) {
    return this.store.listImports(actor);
  }

  listExports(actor: CoachOnboardingActor) {
    return this.store.listExports(actor);
  }

  requestExport(actor: CoachOnboardingActor) {
    return this.store.requestExport(actor);
  }

  async downloadExport(actor: CoachOnboardingActor, exportId: string) {
    const record = await this.store.getExport(actor, exportId);
    if (record === undefined) throw new NotFoundException('Export was not found.');
    if (
      record.status !== 'ready' ||
      record.artifactRef === null ||
      record.artifactRef !== `exports/${actor.tenantId}/${record.id}.zip` ||
      record.expiresAt === null ||
      record.expiresAt <= new Date()
    ) {
      throw new BadRequestException('Export is not available for download.');
    }
    const download = await this.assets.createDownloadUrl(
      record.artifactRef,
      `traverse-export-${record.id}.zip`,
    );
    return { ...download, exportId: record.id };
  }

  private async addExistingRelationshipIssues(
    actor: CoachOnboardingActor,
    preview: ClientImportPreview,
  ): Promise<ClientImportPreview> {
    const candidates = preview.rows.filter((row) => row.valid).map((row) => row.email);
    const existing = await this.store.findExistingRelationshipEmails(actor, candidates);
    if (existing.size === 0) return preview;
    const extraIssues = preview.rows
      .filter((row) => row.valid && existing.has(row.email))
      .map((row) =>
        issue(
          row.rowNumber,
          'email',
          'existing_relationship',
          'This client already has a relationship with you.',
        ),
      );
    const affectedRows = new Set(extraIssues.map((entry) => entry.rowNumber));
    const rows = preview.rows.map((row) =>
      affectedRows.has(row.rowNumber) ? { ...row, valid: false } : row,
    );
    const issues = [...preview.issues, ...extraIssues].sort(
      (left, right) => left.rowNumber - right.rowNumber,
    );
    return {
      ...preview,
      issues,
      rejectedRows: rows.filter((row) => !row.valid).length,
      rows,
      validRows: rows.filter((row) => row.valid).length,
    };
  }
}
