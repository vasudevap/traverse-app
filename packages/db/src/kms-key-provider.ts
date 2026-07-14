import {
  DecryptCommand,
  type DecryptCommandOutput,
  GenerateDataKeyCommand,
  type GenerateDataKeyCommandOutput,
} from '@aws-sdk/client-kms';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface KmsCommandClient {
  send(command: GenerateDataKeyCommand): Promise<GenerateDataKeyCommandOutput>;
  send(command: DecryptCommand): Promise<DecryptCommandOutput>;
}

export interface GeneratedTenantDataKey {
  plaintextKey: Buffer;
  wrappedDataKey: Buffer;
  kmsKeyId: string;
  keyVersion: number;
}

export interface UnwrappedTenantDataKey {
  plaintextKey: Buffer;
  keyVersion: number;
}

function assertInput(tenantId: string, keyVersion: number): void {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new Error('tenantId must be a valid UUID.');
  }
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) {
    throw new Error('keyVersion must be a positive integer.');
  }
}

function encryptionContext(tenantId: string, keyVersion: number): Record<string, string> {
  return {
    application: 'traverse',
    key_version: String(keyVersion),
    tenant_id: tenantId,
  };
}

function requiredBytes(value: Uint8Array | undefined, label: string): Buffer {
  if (value === undefined || value.byteLength === 0) {
    throw new Error(`AWS KMS did not return ${label}.`);
  }
  return Buffer.from(value);
}

export async function generateTenantDataKey(
  client: KmsCommandClient,
  kmsKeyId: string,
  tenantId: string,
  keyVersion: number,
): Promise<GeneratedTenantDataKey> {
  assertInput(tenantId, keyVersion);
  if (kmsKeyId.trim() === '') {
    throw new Error('kmsKeyId is required.');
  }

  const result = await client.send(
    new GenerateDataKeyCommand({
      EncryptionContext: encryptionContext(tenantId, keyVersion),
      KeyId: kmsKeyId,
      KeySpec: 'AES_256',
    }),
  );
  const plaintextKey = requiredBytes(result.Plaintext, 'a plaintext data key');
  if (plaintextKey.byteLength !== 32) {
    plaintextKey.fill(0);
    throw new Error('AWS KMS returned a data key that is not 256 bits.');
  }
  let wrappedDataKey: Buffer;
  try {
    wrappedDataKey = requiredBytes(result.CiphertextBlob, 'a wrapped data key');
  } catch (error) {
    plaintextKey.fill(0);
    throw error;
  }

  return {
    plaintextKey,
    wrappedDataKey,
    kmsKeyId: result.KeyId ?? kmsKeyId,
    keyVersion,
  };
}

export async function unwrapTenantDataKey(
  client: KmsCommandClient,
  kmsKeyId: string,
  tenantId: string,
  keyVersion: number,
  wrappedDataKey: Uint8Array,
): Promise<UnwrappedTenantDataKey> {
  assertInput(tenantId, keyVersion);
  if (kmsKeyId.trim() === '' || wrappedDataKey.byteLength === 0) {
    throw new Error('kmsKeyId and wrappedDataKey are required.');
  }

  const result = await client.send(
    new DecryptCommand({
      CiphertextBlob: wrappedDataKey,
      EncryptionContext: encryptionContext(tenantId, keyVersion),
      KeyId: kmsKeyId,
    }),
  );
  const plaintextKey = requiredBytes(result.Plaintext, 'a plaintext data key');
  if (plaintextKey.byteLength !== 32) {
    plaintextKey.fill(0);
    throw new Error('AWS KMS returned a data key that is not 256 bits.');
  }

  return { plaintextKey, keyVersion };
}
