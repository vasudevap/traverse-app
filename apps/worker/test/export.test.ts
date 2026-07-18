import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { createContractPdf, processExportJobs, type ExportQueueJob } from '../src/export';

const validJob = {
  coachId: '22222222-2222-4222-8222-222222222222',
  exportId: '33333333-3333-4333-8333-333333333333',
  practiceRole: 'owner' as const,
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '44444444-4444-4444-8444-444444444444',
};

const queueJob = (data: unknown): ExportQueueJob => ({ data, id: 'job-1' });

test('export worker completes valid jobs without logging tenant or requester content', async () => {
  const calls: unknown[] = [];
  const logs: Array<{ context: object; level: string; message: string }> = [];
  const results = await processExportJobs(
    [queueJob(validJob)],
    { run: async (job) => calls.push(job) },
    {
      error: (message, context) => logs.push({ context, level: 'error', message }),
      info: (message, context) => logs.push({ context, level: 'info', message }),
    },
  );

  assert.deepEqual(calls, [validJob]);
  assert.deepEqual(results, [
    { id: 'job-1', output: { exportId: validJob.exportId }, status: 'completed' },
  ]);
  assert.equal(JSON.stringify(logs).includes(validJob.tenantId), false);
  assert.equal(JSON.stringify(logs).includes(validJob.userId), false);
});

test('export worker dead-letters malformed jobs and retries archive failures', async () => {
  const logs: Array<{ context: object; level: string; message: string }> = [];
  const logger = {
    error: (message: string, context: { error: string; jobId: string }) =>
      logs.push({ context, level: 'error', message }),
    info: (message: string, context: { exportId: string; jobId: string }) =>
      logs.push({ context, level: 'info', message }),
  };
  const malformed = await processExportJobs([queueJob({})], { run: async () => {} }, logger);
  const retryable = await processExportJobs(
    [queueJob(validJob)],
    { run: async () => Promise.reject(new Error('storage unavailable')) },
    logger,
  );

  assert.deepEqual(malformed, [{ id: 'job-1', status: 'deadletter' }]);
  assert.deepEqual(retryable, [{ id: 'job-1', status: 'failed' }]);
  assert.equal(logs.filter(({ level }) => level === 'error').length, 2);
});

test('contract PDF generation accepts Unicode snapshots and produces a valid PDF', async () => {
  const pdf = await createContractPdf('Accordé', 'Signed terms: Привет 🌱');
  const content = Buffer.from(pdf);
  const loaded = await PDFDocument.load(pdf);

  assert.equal(content.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.equal(loaded.getPageCount(), 1);
  assert.ok(content.length > 1_000);
});
