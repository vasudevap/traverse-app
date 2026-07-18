import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseExportArchiveJob } from '../src/export';

const job = {
  coachId: '22222222-2222-4222-8222-222222222222',
  exportId: '33333333-3333-4333-8333-333333333333',
  practiceRole: 'owner' as const,
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '44444444-4444-4444-8444-444444444444',
};

test('export archive jobs retain tenant and requester boundaries', () => {
  assert.deepEqual(parseExportArchiveJob(job), job);
});

test('export archive jobs reject malformed identities and roles', () => {
  assert.throws(() => parseExportArchiveJob({ ...job, tenantId: 'not-a-uuid' }), /tenantId/);
  assert.throws(() => parseExportArchiveJob({ ...job, practiceRole: 'admin' }), /practiceRole/);
  assert.throws(() => parseExportArchiveJob(null), /must be an object/);
});
