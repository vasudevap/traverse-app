import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CoachOnboardingActor } from '../src/client-onboarding.service.js';
import {
  DataPortabilityService,
  parseClientCsv,
  type ClientImportSummary,
  type DataPortabilityStore,
  type PracticeExportSummary,
} from '../src/data-portability.service.js';
import { createApp } from '../src/create-app.js';
import { TestAuthSessionStore } from './test-auth-store.js';

const actor: CoachOnboardingActor = {
  coachId: '22222222-2222-4222-8222-222222222222',
  practiceRole: 'owner',
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '33333333-3333-4333-8333-333333333333',
};
const exportId = '44444444-4444-4444-8444-444444444444';

function importSummary(): ClientImportSummary {
  return {
    completedAt: new Date('2026-07-17T12:00:00.000Z'),
    createdAt: new Date('2026-07-17T12:00:00.000Z'),
    errorReport: [],
    filename: 'clients.csv',
    id: '55555555-5555-4555-8555-555555555555',
    importedRows: 1,
    rejectedRows: 1,
    status: 'ready',
    totalRows: 2,
  };
}

function exportSummary(status: PracticeExportSummary['status'] = 'ready'): PracticeExportSummary {
  return {
    archiveSizeBytes: 512,
    completedAt: new Date('2026-07-17T12:00:00.000Z'),
    createdAt: new Date('2026-07-17T12:00:00.000Z'),
    errorCode: null,
    expiresAt: new Date('2026-07-24T12:00:00.000Z'),
    id: exportId,
    manifest: { version: 1 },
    status,
  };
}

class MemoryDataPortabilityStore implements DataPortabilityStore {
  created: Parameters<DataPortabilityStore['createClientImport']>[0] | undefined;
  existing = new Set<string>();
  exportRecord: (PracticeExportSummary & { artifactRef: string | null }) | undefined = {
    ...exportSummary(),
    artifactRef: `exports/${actor.tenantId}/${exportId}.zip`,
  };

  async createClientImport(input: Parameters<DataPortabilityStore['createClientImport']>[0]) {
    this.created = input;
    return importSummary();
  }

  async findExistingRelationshipEmails() {
    return this.existing;
  }

  async getExport() {
    return this.exportRecord;
  }

  async listExports() {
    return [exportSummary()];
  }

  async listImports() {
    return [importSummary()];
  }

  async requestExport() {
    return exportSummary('pending');
  }
}

const csv = [
  'Client Name,Email Address,Private Notes,Labels',
  '"Alex Rivera",ALEX@example.test,"Goal: say ""no"" more often",leadership|priority',
  'Duplicate,alex@example.test,,',
  'Invalid,not-an-email,,',
].join('\r\n');

test('client CSV parser normalizes aliases, quoted fields, tags, and row errors', () => {
  const preview = parseClientCsv('clients.csv', csv);

  assert.equal(preview.totalRows, 3);
  assert.equal(preview.validRows, 1);
  assert.equal(preview.rejectedRows, 2);
  assert.deepEqual(preview.rows[0], {
    email: 'alex@example.test',
    name: 'Alex Rivera',
    notes: 'Goal: say "no" more often',
    rowNumber: 2,
    tags: ['leadership', 'priority'],
    valid: true,
  });
  assert.deepEqual(
    preview.issues.map(({ code, rowNumber }) => ({ code, rowNumber })),
    [
      { code: 'duplicate_in_file', rowNumber: 3 },
      { code: 'invalid', rowNumber: 4 },
    ],
  );
  assert.match(preview.sourceSha256, /^[0-9a-f]{64}$/);
});

test('client CSV import revalidates existing relationships and persists valid rows only', async () => {
  const store = new MemoryDataPortabilityStore();
  const service = new DataPortabilityService(store, {
    createDownloadUrl: async () => ({
      expiresAt: new Date(),
      url: 'https://download.example.test',
    }),
  });
  store.existing.add('alex@example.test');
  const blocked = await service.previewClientImport(actor, { csv, filename: 'clients.csv' });
  assert.equal(blocked.validRows, 0);
  assert.equal(
    blocked.issues.some(({ code }) => code === 'existing_relationship'),
    true,
  );
  await assert.rejects(
    () => service.importClients(actor, { csv, filename: 'clients.csv' }),
    BadRequestException,
  );

  store.existing.clear();
  await service.importClients(actor, { csv, filename: 'clients.csv' });
  assert.equal(store.created?.rows.length, 1);
  assert.equal(store.created?.rows[0]?.email, 'alex@example.test');
  assert.equal(store.created?.totalRows, 3);
});

test('export downloads require a ready, unexpired, requester-visible archive', async () => {
  const store = new MemoryDataPortabilityStore();
  let requestedObjectKey = '';
  const service = new DataPortabilityService(store, {
    createDownloadUrl: async (objectKey) => {
      requestedObjectKey = objectKey;
      return {
        expiresAt: new Date('2026-07-17T12:15:00.000Z'),
        url: 'https://download.example.test/signed',
      };
    },
  });

  const download = await service.downloadExport(actor, exportId);
  assert.equal(download.exportId, exportId);
  assert.equal(requestedObjectKey, `exports/${actor.tenantId}/${exportId}.zip`);

  store.exportRecord = { ...exportSummary('pending'), artifactRef: null };
  await assert.rejects(() => service.downloadExport(actor, exportId), BadRequestException);
  store.exportRecord = {
    ...exportSummary(),
    artifactRef: `exports/99999999-9999-4999-8999-999999999999/${exportId}.zip`,
  };
  await assert.rejects(() => service.downloadExport(actor, exportId), BadRequestException);
  store.exportRecord = undefined;
  await assert.rejects(() => service.downloadExport(actor, exportId), NotFoundException);
});

test('CSV JSON payloads above the Express default limit reach authorization guards', async () => {
  const app = await createApp(
    { logger: false },
    {
      allowedOrigins: new Set(['https://app.example.test']),
      authSessionStore: new TestAuthSessionStore(),
    },
  );
  await app.listen(0, '127.0.0.1');
  try {
    const { port } = app.getHttpServer().address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/coach/imports/clients/preview`, {
      body: JSON.stringify({ csv: `name,email\n${'a'.repeat(150_000)}`, filename: 'clients.csv' }),
      headers: { 'content-type': 'application/json', origin: 'https://app.example.test' },
      method: 'POST',
    });
    assert.equal(response.status, 401);
  } finally {
    await app.close();
  }
});
