export interface ExportArchiveJob {
  coachId: string;
  exportId: string;
  practiceRole: 'coach' | 'owner';
  tenantId: string;
  userId: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseExportArchiveJob(value: unknown): ExportArchiveJob {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Export archive job must be an object.');
  }
  const candidate = value as Partial<ExportArchiveJob>;
  for (const field of ['coachId', 'exportId', 'tenantId', 'userId'] as const) {
    if (typeof candidate[field] !== 'string' || !UUID_PATTERN.test(candidate[field])) {
      throw new Error(`Export archive job ${field} must be a UUID.`);
    }
  }
  if (candidate.practiceRole !== 'coach' && candidate.practiceRole !== 'owner') {
    throw new Error('Export archive job practiceRole is invalid.');
  }
  return candidate as ExportArchiveJob;
}
