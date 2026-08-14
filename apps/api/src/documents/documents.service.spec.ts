import { BadRequestException } from '@nestjs/common';
import { DocumentCategory } from '@bnp/shared';
import { DocumentsService, isPdf } from './documents.service';
import { AuthenticatedUser } from '../common/decorators';

const actor: AuthenticatedUser = {
  userId: 'u1',
  email: 'knowledge@bnp.health',
  fullName: 'Knowledge Manager',
  roles: ['NURSING_KNOWLEDGE_MANAGER'],
  permissions: [],
};

function makeService() {
  const storage = {
    ensureBucket: jest.fn().mockResolvedValue(undefined),
    upload: jest.fn().mockResolvedValue(undefined),
  };
  const service = new DocumentsService(
    { findOne: jest.fn(), save: jest.fn(async (d: unknown) => d), create: jest.fn((d) => d) } as never,
    { save: jest.fn(async (v: unknown) => v), create: jest.fn((v) => v) } as never,
    storage as never,
    { record: jest.fn() } as never,
  );
  return { service, storage };
}

const upload = (buffer: Buffer, mimetype = 'application/pdf') => ({
  originalname: 'policy.pdf',
  mimetype,
  size: buffer.length,
  buffer,
});

describe('isPdf (upload content validation)', () => {
  it('accepts a real PDF signature', () => {
    expect(isPdf(Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj'))).toBe(true);
  });

  it('accepts a PDF preceded by a few junk bytes, as readers do', () => {
    expect(isPdf(Buffer.concat([Buffer.from('\n\r\n'), Buffer.from('%PDF-1.4')]))).toBe(true);
  });

  it('rejects content that merely claims to be a PDF', () => {
    expect(isPdf(Buffer.from('<?php system($_GET["c"]); ?>'))).toBe(false);
    expect(isPdf(Buffer.from('MZ\x90\x00'))).toBe(false); // Windows executable
    expect(isPdf(Buffer.from(''))).toBe(false);
  });

  it('rejects a PDF signature buried past the scanned prefix', () => {
    const buried = Buffer.concat([Buffer.alloc(2048, 0x41), Buffer.from('%PDF-1.7')]);
    expect(isPdf(buried)).toBe(false);
  });
});

describe('DocumentsService.upload content gate', () => {
  it('rejects a non-PDF that spoofs the PDF Content-Type header', async () => {
    // The mimetype comes from the client's multipart header, so it proves
    // nothing on its own — the bytes have to agree.
    const { service, storage } = makeService();
    await expect(
      service.upload(
        upload(Buffer.from('not a pdf at all')),
        { title: 'Spoofed', category: DocumentCategory.NURSING_POLICIES },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects a genuine PDF sent under a non-PDF Content-Type', async () => {
    const { service, storage } = makeService();
    await expect(
      service.upload(
        upload(Buffer.from('%PDF-1.7 real'), 'image/png'),
        { title: 'Wrong type', category: DocumentCategory.NURSING_POLICIES },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('stores a document whose header and bytes both say PDF', async () => {
    const { service, storage } = makeService();
    const result = await service.upload(
      upload(Buffer.from('%PDF-1.7\n1 0 obj')),
      { title: 'IV Paracetamol Guide', category: DocumentCategory.MEDICATIONS },
      actor,
    );
    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(result.title).toBe('IV Paracetamol Guide');
    expect(result.status).toBe('DRAFT');
  });
});
