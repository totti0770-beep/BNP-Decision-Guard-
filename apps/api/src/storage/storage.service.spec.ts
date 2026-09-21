import type { StorageService as StorageServiceType } from './storage.service';

/**
 * `StorageService` was executed by no test: the integration suite replaces it
 * with `InMemoryStorageService`, and nothing else constructs it. It is the
 * layer the upload regression passed through unobserved. The S3 client is
 * mocked at the module boundary — the real one is a network dependency — and
 * every assertion is about what the service *sends*, which is the whole of
 * its behaviour.
 */
const send = jest.fn();
const getSignedUrl = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  class Cmd {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send })),
    HeadBucketCommand: class extends Cmd {},
    CreateBucketCommand: class extends Cmd {},
    PutObjectCommand: class extends Cmd {},
    GetObjectCommand: class extends Cmd {},
  };
});
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrl(...args),
}));
jest.mock('../config/env', () => ({
  loadEnv: () => ({
    s3: {
      endpoint: 'http://minio.internal:9000',
      region: 'me-south-1',
      accessKey: 'AKIA-spec',
      secretKey: 'spec-secret',
      bucket: 'bnp-spec',
      forcePathStyle: true,
    },
  }),
}));

import { S3Client } from '@aws-sdk/client-s3';
import { StorageService } from './storage.service';

type Sent = { constructor: { name: string }; input: Record<string, unknown> };
const sent = (i = 0): Sent => send.mock.calls[i][0] as Sent;

describe('StorageService', () => {
  let service: StorageServiceType;

  beforeEach(() => {
    send.mockReset();
    getSignedUrl.mockReset();
    (S3Client as unknown as jest.Mock).mockClear();
    service = new StorageService();
  });

  it('builds the client from loadEnv() and nothing else', () => {
    expect(S3Client).toHaveBeenCalledWith({
      endpoint: 'http://minio.internal:9000',
      region: 'me-south-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'AKIA-spec', secretAccessKey: 'spec-secret' },
    });
    expect(service.bucket).toBe('bnp-spec');
  });

  describe('isHealthy()', () => {
    it('is true when the bucket answers HEAD', async () => {
      send.mockResolvedValueOnce({});
      await expect(service.isHealthy()).resolves.toBe(true);
      expect(sent().constructor.name).toBe('HeadBucketCommand');
      expect(sent().input).toEqual({ Bucket: 'bnp-spec' });
    });

    it('is false — not a throw — when it does not, and creates nothing', async () => {
      send.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(service.isHealthy()).resolves.toBe(false);
      // A readiness probe that created the bucket would make a broken
      // deployment look self-healing.
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe('ensureBucket()', () => {
    it('creates nothing when the bucket exists', async () => {
      send.mockResolvedValueOnce({});
      await service.ensureBucket();
      expect(send).toHaveBeenCalledTimes(1);
      expect(sent().constructor.name).toBe('HeadBucketCommand');
    });

    it('creates the bucket when HEAD fails', async () => {
      send.mockRejectedValueOnce(Object.assign(new Error('NotFound'), { name: 'NotFound' }));
      send.mockResolvedValueOnce({});
      await service.ensureBucket();
      expect(send).toHaveBeenCalledTimes(2);
      expect(sent(1).constructor.name).toBe('CreateBucketCommand');
      expect(sent(1).input).toEqual({ Bucket: 'bnp-spec' });
    });

    it('tolerates losing the race to another instance creating the same bucket', async () => {
      send.mockRejectedValueOnce(new Error('NotFound'));
      send.mockRejectedValueOnce(
        Object.assign(new Error('exists'), { name: 'BucketAlreadyOwnedByYou' }),
      );
      await expect(service.ensureBucket()).resolves.toBeUndefined();
    });

    it('rethrows any other creation failure rather than continuing without a bucket', async () => {
      send.mockRejectedValueOnce(new Error('NotFound'));
      send.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'AccessDenied' }));
      await expect(service.ensureBucket()).rejects.toMatchObject({ name: 'AccessDenied' });
    });
  });

  it('upload() sends the key, the bytes and the declared content type to the bucket', async () => {
    send.mockResolvedValueOnce({});
    const body = Buffer.from('%PDF-1.7\n');
    await service.upload('documents/abc/v1.pdf', body, 'application/pdf');
    expect(sent().constructor.name).toBe('PutObjectCommand');
    expect(sent().input).toEqual({
      Bucket: 'bnp-spec',
      Key: 'documents/abc/v1.pdf',
      Body: body,
      ContentType: 'application/pdf',
    });
  });

  it('download() returns the object as a Buffer', async () => {
    send.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => new Uint8Array([37, 80, 68, 70]) },
    });
    const out = await service.download('documents/abc/v1.pdf');
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString()).toBe('%PDF');
    expect(sent().constructor.name).toBe('GetObjectCommand');
    expect(sent().input).toEqual({ Bucket: 'bnp-spec', Key: 'documents/abc/v1.pdf' });
  });

  describe('presignedDownloadUrl()', () => {
    it('signs a GET for the key with the documented five-minute expiry by default', async () => {
      getSignedUrl.mockResolvedValueOnce('https://signed.example/x');
      await expect(service.presignedDownloadUrl('documents/abc/v1.pdf')).resolves.toBe(
        'https://signed.example/x',
      );
      const [, command, options] = getSignedUrl.mock.calls[0] as [unknown, Sent, { expiresIn: number }];
      expect(command.constructor.name).toBe('GetObjectCommand');
      expect(command.input).toEqual({ Bucket: 'bnp-spec', Key: 'documents/abc/v1.pdf' });
      // docs/api.md: "5-min presigned URL". 300 is that promise.
      expect(options).toEqual({ expiresIn: 300 });
    });

    it('honours an explicit expiry', async () => {
      getSignedUrl.mockResolvedValueOnce('u');
      await service.presignedDownloadUrl('k', 60);
      expect((getSignedUrl.mock.calls[0] as unknown[])[2]).toEqual({ expiresIn: 60 });
    });
  });
});
