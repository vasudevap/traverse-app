import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { VideoObjectStore } from './transcode.js';

/** S3 adapter kept inside the video worker to avoid coupling this spike to API contracts. */
export class S3VideoObjectStore implements VideoObjectStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async download(key: string): Promise<Uint8Array> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (response.Body === undefined) throw new Error(`Video source ${key} had no body.`);
    return response.Body.transformToByteArray();
  }

  async upload(input: { body: Uint8Array; contentType: string; key: string }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Body: input.body,
        Bucket: this.bucket,
        ContentType: input.contentType,
        Key: input.key,
      }),
    );
  }
}
