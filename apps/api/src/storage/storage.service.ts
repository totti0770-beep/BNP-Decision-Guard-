import { Injectable, Logger } from '@nestjs/common';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadEnv } from '../config/env';

/**
 * S3-compatible object storage (MinIO locally, any S3 endpoint in production).
 * Server-side encryption headers are set for providers that support them;
 * MinIO can additionally be configured with encryption-at-rest (KMS).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  readonly bucket: string;

  constructor() {
    // Every value through loadEnv(). Reading S3_SECRET_KEY here with its own
    // `?? 'bnp_minio_secret'` fallback meant the object store quietly used the
    // shipped demo credentials whenever the variable was absent — and outside
    // production absence never fails the boot, so nothing said so.
    const { s3 } = loadEnv();
    this.bucket = s3.bucket;
    this.client = new S3Client({
      endpoint: s3.endpoint,
      region: s3.region,
      forcePathStyle: s3.forcePathStyle,
      credentials: { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey },
    });
  }

  /**
   * Readiness-probe check only: reports whether the bucket is reachable, and
   * deliberately does not create it. `ensureBucket()` creating one on a
   * missing-bucket probe hit would make a broken deployment look self-healing
   * instead of surfacing as a failed readiness check.
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      this.logger.log(`Creating bucket ${this.bucket}`);
      await this.client
        .send(new CreateBucketCommand({ Bucket: this.bucket }))
        .catch((err) => {
          if (err?.name !== 'BucketAlreadyOwnedByYou') throw err;
        });
    }
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async download(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  /** Short-lived link; issued only to roles holding documents:download. */
  presignedDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
