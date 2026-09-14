import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadedFile } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { isPdf } from './documents.service';

/**
 * This spec exists because of a regression that every other check missed.
 *
 * A dependency change left multer's `type-is` resolving `media-typer@1.x` and
 * `mime-types@3.x` — Express 5's versions — instead of the `0.3.0` and `~2.1.24`
 * it pins. `type-is` then failed to recognise a valid multipart request, and
 * multer's `if (!is(req, ['multipart'])) return next()` silently skipped parsing.
 * No error, no log line: the handler simply received `undefined` for the file,
 * `isPdf(undefined)` returned false, and every upload 400'd.
 *
 * The unit suite, lint and the web build were all green while document upload
 * was completely broken. Only the integration suite caught it, and that needs a
 * PostgreSQL this project's contributors do not always have to hand.
 *
 * So this covers the multer *wiring* and nothing else — no database, no S3, no
 * auth. It boots the real `FileInterceptor` with the same options as
 * `documents.controller.ts` and drives it with a real multipart body. It fails
 * against the broken dependency tree and passes against a correct one, which is
 * the only property that makes it worth having.
 */

const FILE_SIZE_LIMIT = 25 * 1024 * 1024;

@Controller()
class UploadProbeController {
  @Post('probe')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: FILE_SIZE_LIMIT } }))
  probe(@UploadedFile() file: Express.Multer.File, @Body() body: Record<string, string>) {
    return {
      fileDefined: !!file,
      isBuffer: Buffer.isBuffer(file?.buffer),
      originalname: file?.originalname ?? null,
      size: file?.buffer?.length ?? null,
      // The exact call the upload path makes before anything is stored.
      passesPdfCheck: file?.buffer ? isPdf(file.buffer) : false,
      title: body?.title ?? null,
    };
  }
}

describe('upload wiring — FileInterceptor through to isPdf()', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UploadProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('delivers the uploaded part to the handler as a Buffer', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe')
      .attach('file', Buffer.from('%PDF-1.7\nhello world\n'), {
        filename: 'policy.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    // The assertion that would have caught the regression: multer silently
    // skipping leaves this false, with no other visible symptom.
    expect(res.body.fileDefined).toBe(true);
    expect(res.body.isBuffer).toBe(true);
    expect(res.body.originalname).toBe('policy.pdf');
    expect(res.body.size).toBeGreaterThan(0);
  });

  it('accepts a %PDF- payload and rejects one without the signature', async () => {
    const good = await request(app.getHttpServer())
      .post('/probe')
      .attach('file', Buffer.from('%PDF-1.7\nreal enough\n'), {
        filename: 'policy.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    expect(good.body.passesPdfCheck).toBe(true);

    // A client-declared PDF content type must not be enough on its own.
    const bad = await request(app.getHttpServer())
      .post('/probe')
      .attach('file', Buffer.from('PK not a pdf at all'), {
        filename: 'policy.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    expect(bad.body.fileDefined).toBe(true);
    expect(bad.body.passesPdfCheck).toBe(false);
  });

  it('carries the text fields alongside the file', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe')
      .field('title', 'Vancomycin dilution')
      .attach('file', Buffer.from('%PDF-1.7\n'), {
        filename: 'policy.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    expect(res.body.title).toBe('Vancomycin dilution');
    expect(res.body.fileDefined).toBe(true);
  });

  it('enforces the 25 MB cap rather than accepting an oversized part', async () => {
    const oversized = Buffer.alloc(FILE_SIZE_LIMIT + 1024, 0x41);
    oversized.write('%PDF-1.7\n');

    const res = await request(app.getHttpServer())
      .post('/probe')
      .attach('file', oversized, { filename: 'huge.pdf', contentType: 'application/pdf' });

    // Multer raises LIMIT_FILE_SIZE; what matters is that it is not a success
    // with a silently truncated buffer.
    expect(res.status).not.toBe(201);
  }, 30_000);
});
