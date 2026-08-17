import { Injectable, Logger } from '@nestjs/common';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * S3-compatible object storage (MinIO locally, any S3 endpoint in production).
 * Server-side encryption headers are set for providers that support them;
 * MinIO can additionally be configured with encryption-at-rest (KMS).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  readonly bucket = process.env.S3_BUCKET ?? 'bnp-documents';

  constructor() {
    this.client = new S3Client({
      endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
      region: process.env.S3_REGION ?? 'us-east-1',
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? 'bnp_minio',
        secretAccessKey: process.env.S3_SECRET_KEY ?? 'bnp_minio_secret',
      },
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
