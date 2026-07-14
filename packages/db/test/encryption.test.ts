import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import {
  DecryptCommand,
  type DecryptCommandOutput,
  GenerateDataKeyCommand,
  type GenerateDataKeyCommandOutput,
} from '@aws-sdk/client-kms';
import {
  decryptString,
  destroyPlaintextKey,
  encryptString,
  generateTenantDataKey,
  unwrapTenantDataKey,
  type EncryptedFieldContext,
  type KmsCommandClient,
} from '../src/index';

const tenantId = '00000000-0000-7000-8000-000000000001';
const rowId = '00000000-0000-7000-8000-000000000301';
const context: EncryptedFieldContext = {
  field: 'notes_enc',
  keyVersion: 1,
  rowId,
  table: 'coaching_relationships',
  tenantId,
};

test('D21 AES-256-GCM fields round-trip and use a fresh IV', () => {
  const key = randomBytes(32);
  const first = encryptString('confidential note', key, context);
  const second = encryptString('confidential note', key, context);

  assert.notDeepEqual(first, second);
  assert.equal(decryptString(first, key, context), 'confidential note');
  assert.equal(decryptString(second, key, context), 'confidential note');
});

test('D21 AAD rejects a different tenant, row, table, field, key version, or key', () => {
  const key = randomBytes(32);
  const encrypted = encryptString('confidential note', key, context);
  const alternateContexts: EncryptedFieldContext[] = [
    { ...context, tenantId: '00000000-0000-7000-8000-000000000002' },
    { ...context, rowId: '00000000-0000-7000-8000-000000000302' },
    { ...context, table: 'session_notes' },
    { ...context, field: 'transcript_enc' },
  ];

  for (const alternateContext of alternateContexts) {
    assert.throws(() => decryptString(encrypted, key, alternateContext));
  }
  assert.throws(
    () => decryptString(encrypted, key, { ...context, keyVersion: 2 }),
    /key version does not match/,
  );
  assert.throws(() => decryptString(encrypted, randomBytes(32), context));
});

test('D21 authentication rejects modified ciphertext', () => {
  const key = randomBytes(32);
  const encrypted = encryptString('confidential note', key, context);
  const modified = Buffer.from(encrypted);
  modified[modified.byteLength - 1] ^= 1;

  assert.throws(() => decryptString(modified, key, context));
});

test('plaintext data keys can be explicitly destroyed', () => {
  const key = randomBytes(32);
  destroyPlaintextKey(key);
  assert.deepEqual(key, Buffer.alloc(32));
});

class FakeKmsClient implements KmsCommandClient {
  readonly plaintextKey = Buffer.alloc(32, 7);
  readonly wrappedDataKey = Buffer.from('wrapped-key');
  decryptInput: DecryptCommand['input'] | undefined;
  generateInput: GenerateDataKeyCommand['input'] | undefined;

  send(command: GenerateDataKeyCommand): Promise<GenerateDataKeyCommandOutput>;
  send(command: DecryptCommand): Promise<DecryptCommandOutput>;
  async send(
    command: GenerateDataKeyCommand | DecryptCommand,
  ): Promise<GenerateDataKeyCommandOutput | DecryptCommandOutput> {
    if (command instanceof GenerateDataKeyCommand) {
      this.generateInput = command.input;
      return {
        $metadata: {},
        CiphertextBlob: this.wrappedDataKey,
        KeyId: 'arn:aws:kms:us-east-1:111122223333:key/test',
        Plaintext: this.plaintextKey,
      };
    }

    this.decryptInput = command.input;
    return { $metadata: {}, Plaintext: this.plaintextKey };
  }
}

test('D21 KMS operations bind wrapped keys to tenant and key version', async () => {
  const client = new FakeKmsClient();
  const keyId = 'alias/traverse-test';
  const generated = await generateTenantDataKey(client, keyId, tenantId, 3);

  assert.deepEqual(generated.plaintextKey, client.plaintextKey);
  assert.deepEqual(generated.wrappedDataKey, client.wrappedDataKey);
  assert.equal(generated.keyVersion, 3);
  assert.equal(generated.kmsKeyId, 'arn:aws:kms:us-east-1:111122223333:key/test');
  assert.deepEqual(client.generateInput, {
    EncryptionContext: {
      application: 'traverse',
      key_version: '3',
      tenant_id: tenantId,
    },
    KeyId: keyId,
    KeySpec: 'AES_256',
  });

  const unwrapped = await unwrapTenantDataKey(
    client,
    generated.kmsKeyId,
    tenantId,
    3,
    generated.wrappedDataKey,
  );
  assert.deepEqual(unwrapped.plaintextKey, client.plaintextKey);
  assert.equal(unwrapped.keyVersion, 3);
  assert.deepEqual(client.decryptInput, {
    CiphertextBlob: generated.wrappedDataKey,
    EncryptionContext: {
      application: 'traverse',
      key_version: '3',
      tenant_id: tenantId,
    },
    KeyId: generated.kmsKeyId,
  });
});

test('D21 rejects invalid key material and encryption context', async () => {
  assert.throws(
    () => encryptString('note', Buffer.alloc(31), context),
    /requires a 32-byte data key/,
  );
  assert.throws(
    () => encryptString('note', Buffer.alloc(32), { ...context, tenantId: 'not-a-uuid' }),
    /must be valid UUIDs/,
  );
  await assert.rejects(
    generateTenantDataKey(new FakeKmsClient(), '', tenantId, 1),
    /kmsKeyId is required/,
  );
});
