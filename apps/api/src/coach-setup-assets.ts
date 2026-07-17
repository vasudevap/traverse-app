import { BadRequestException } from '@nestjs/common';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import type { CoachProfileAssetStore, ProfilePhotoUpload } from './coach-setup.service.js';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;

export class S3CoachProfileAssetStore implements CoachProfileAssetStore {
  private readonly client: S3Client;

  constructor(
    private readonly config: { bucket: string; kmsKeyId: string },
    client?: S3Client,
  ) {
    this.client = client ?? new S3Client({});
  }

  async prepareUpload(input: {
    coachId: string;
    contentType: string;
    size: number;
    tenantId: string;
  }): Promise<ProfilePhotoUpload> {
    const extension = EXTENSIONS[input.contentType];
    if (extension === undefined) {
      throw new BadRequestException('Unsupported profile photo content type.');
    }
    const objectKey =
      `tenants/${input.tenantId}/coaches/${input.coachId}/profile/` +
      `${randomUUID()}.${extension}`;
    const command = new PutObjectCommand({
      Body: undefined,
      Bucket: this.config.bucket,
      ContentLength: input.size,
      ContentType: input.contentType,
      Key: objectKey,
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: this.config.kmsKeyId,
    });
    return {
      headers: {
        'content-type': input.contentType,
        'x-amz-server-side-encryption': 'aws:kms',
        'x-amz-server-side-encryption-aws-kms-key-id': this.config.kmsKeyId,
      },
      objectKey,
      uploadUrl: await getSignedUrl(this.client, command, { expiresIn: 300 }),
    };
  }

  async confirmUpload(objectKey: string): Promise<void> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: objectKey }),
      );
      if (
        result.ContentType === undefined ||
        EXTENSIONS[result.ContentType] === undefined ||
        result.ContentLength === undefined ||
        result.ContentLength < 1 ||
        result.ContentLength > MAX_PROFILE_PHOTO_BYTES ||
        result.ServerSideEncryption !== 'aws:kms'
      ) {
        throw new BadRequestException('Uploaded profile photo failed validation.');
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Uploaded profile photo could not be verified.');
    }
  }

  async createReadUrl(objectKey: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: objectKey }),
      { expiresIn: 900 },
    );
  }
}
