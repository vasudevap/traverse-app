import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const FORMAT_VERSION = 1;
const DATA_KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const HEADER_BYTES = 1 + 4 + IV_BYTES + AUTH_TAG_BYTES;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface EncryptedFieldContext {
  tenantId: string;
  rowId: string;
  table: string;
  field: string;
  keyVersion: number;
}

function assertContext(context: EncryptedFieldContext): void {
  if (!UUID_PATTERN.test(context.tenantId) || !UUID_PATTERN.test(context.rowId)) {
    throw new Error('Encryption context tenantId and rowId must be valid UUIDs.');
  }
  if (!/^[a-z][a-z0-9_]*$/.test(context.table) || !/^[a-z][a-z0-9_]*$/.test(context.field)) {
    throw new Error('Encryption context table and field must be snake_case identifiers.');
  }
  if (!Number.isSafeInteger(context.keyVersion) || context.keyVersion < 1) {
    throw new Error('Encryption context keyVersion must be a positive integer.');
  }
}

function copyKey(dataKey: Uint8Array): Buffer {
  if (dataKey.byteLength !== DATA_KEY_BYTES) {
    throw new Error('AES-256-GCM requires a 32-byte data key.');
  }
  return Buffer.from(dataKey);
}

function buildAad(context: EncryptedFieldContext): Buffer {
  return Buffer.from(
    [
      'traverse-field-v1',
      `tenant=${context.tenantId}`,
      `table=${context.table}`,
      `row=${context.rowId}`,
      `field=${context.field}`,
      `key=${context.keyVersion}`,
    ].join('|'),
    'utf8',
  );
}

export function encryptField(
  plaintext: Uint8Array,
  dataKey: Uint8Array,
  context: EncryptedFieldContext,
): Buffer {
  assertContext(context);
  const key = copyKey(dataKey);
  const iv = randomBytes(IV_BYTES);

  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES });
    cipher.setAAD(buildAad(context));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const output = Buffer.allocUnsafe(HEADER_BYTES + ciphertext.byteLength);

    output.writeUInt8(FORMAT_VERSION, 0);
    output.writeUInt32BE(context.keyVersion, 1);
    iv.copy(output, 5);
    authTag.copy(output, 5 + IV_BYTES);
    ciphertext.copy(output, HEADER_BYTES);
    return output;
  } finally {
    key.fill(0);
  }
}

export function decryptField(
  encrypted: Uint8Array,
  dataKey: Uint8Array,
  context: EncryptedFieldContext,
): Buffer {
  assertContext(context);
  const payload = Buffer.from(encrypted);
  if (payload.byteLength < HEADER_BYTES) {
    throw new Error('Encrypted field payload is truncated.');
  }
  if (payload.readUInt8(0) !== FORMAT_VERSION) {
    throw new Error('Encrypted field format version is unsupported.');
  }

  const encodedKeyVersion = payload.readUInt32BE(1);
  const expectedVersion = Buffer.allocUnsafe(4);
  const encodedVersion = Buffer.allocUnsafe(4);
  expectedVersion.writeUInt32BE(context.keyVersion);
  encodedVersion.writeUInt32BE(encodedKeyVersion);
  if (!timingSafeEqual(encodedVersion, expectedVersion)) {
    throw new Error('Encrypted field key version does not match the requested key.');
  }

  const key = copyKey(dataKey);
  const iv = payload.subarray(5, 5 + IV_BYTES);
  const authTag = payload.subarray(5 + IV_BYTES, HEADER_BYTES);
  const ciphertext = payload.subarray(HEADER_BYTES);

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(buildAad(context));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } finally {
    key.fill(0);
  }
}

export function encryptString(
  plaintext: string,
  dataKey: Uint8Array,
  context: EncryptedFieldContext,
): Buffer {
  return encryptField(Buffer.from(plaintext, 'utf8'), dataKey, context);
}

export function decryptString(
  encrypted: Uint8Array,
  dataKey: Uint8Array,
  context: EncryptedFieldContext,
): string {
  return decryptField(encrypted, dataKey, context).toString('utf8');
}

export function destroyPlaintextKey(dataKey: Uint8Array): void {
  dataKey.fill(0);
}
