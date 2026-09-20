import {
  Body,
  Controller,
  MiddlewareConsumer,
  Module,
  NestModule,
  Post,
  RequestMethod,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { isPdf } from './documents.service';
import {
  DocumentUploadMiddleware,
  UPLOAD_FILE_SIZE_LIMIT,
} from './document-upload.middleware';

/**
 * This spec covers the upload route's multipart wiring, and nothing else — no
 * database, no S3, no auth. It exists because of two regressions that every
 * other check missed, and it asserts the property each one violated.
 *
 * **One: a dependency change silently disabled parsing.** multer's `type-is`
 * resolved `media-typer@1.x` and `mime-types@3.x` — Express 5's versions —
 * instead of the `0.3.0` and `~2.1.24` it pins. `type-is` stopped recognising
 * a valid multipart request and multer's
 * `if (!is(req, ['multipart'])) return next()` skipped parsing. No error, no
 * log line: the handler received `undefined` for the file, `isPdf(undefined)`
 * returned false, and every upload 400'd. The unit suite, lint and the web
 * build were all green while document upload was completely broken.
 *
 * **Two: the parse ran one step too late to be screened.** Parsing lived in a
 * `FileInterceptor`, and Nest runs middleware → guards → interceptors. So
 * `PhiScreenGuard` — declared on the route, listing the fields to screen —
 * read `req.body` while it was still `undefined` and scanned nothing. A
 * patient identifier typed into a document title was stored. The last test
 * below is the one that fails against that ordering.
 *
 * Both need only a real multipart request through the real parser, which is
 * why they are here rather than in the integration suite: that one needs a
 * PostgreSQL this project's contributors do not always have to hand.
 */

/** Records what `req.body` looks like at guard time — the ordering question. */
const bodyAtGuardTime: (string[] | null)[] = [];

class RecordingGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    bodyAtGuardTime.push(req.body ? Object.keys(req.body).sort() : null);
    return true;
  }
}

@Controller()
class UploadProbeController {
  @Post('documents/upload')
  @UseGuards(RecordingGuard)
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

/**
 * The same registration `DocumentsModule` makes, against the same path, so
 * this exercises the production wiring rather than a copy of its options.
 */
@Module({ controllers: [UploadProbeController] })
class UploadProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(DocumentUploadMiddleware)
      .forRoutes({ path: 'documents/upload', method: RequestMethod.POST });
  }
}

describe('upload wiring — multipart parsing through to isPdf()', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UploadProbeModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    bodyAtGuardTime.length = 0;
  });

  const post = () => request(app.getHttpServer()).post('/documents/upload');

  it('delivers the uploaded part to the handler as a Buffer', async () => {
    const res = await post()
      .attach('file', Buffer.from('%PDF-1.7\nhello world\n'), {
        filename: 'policy.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    // The assertion that would have caught the first regression: multer
    // silently skipping leaves this false, with no other visible symptom.
    expect(res.body.fileDefined).toBe(true);
    expect(res.body.isBuffer).toBe(true);
    expect(res.body.originalname).toBe('policy.pdf');
    expect(res.body.size).toBeGreaterThan(0);
  });

  it('accepts a %PDF- payload and rejects one without the signature', async () => {
    const good = await post()
      .attach('file', Buffer.from('%PDF-1.7\nreal enough\n'), {
        filename: 'policy.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    expect(good.body.passesPdfCheck).toBe(true);

    // A client-declared PDF content type must not be enough on its own.
    const bad = await post()
      .attach('file', Buffer.from('PK not a pdf at all'), {
        filename: 'policy.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    expect(bad.body.fileDefined).toBe(true);
    expect(bad.body.passesPdfCheck).toBe(false);
  });

  it('carries the text fields alongside the file', async () => {
    const res = await post()
      .field('title', 'Vancomycin dilution')
      .attach('file', Buffer.from('%PDF-1.7\n'), {
        filename: 'policy.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    expect(res.body.title).toBe('Vancomycin dilution');
    expect(res.body.fileDefined).toBe(true);
  });

  it('answers 413 rather than 500 when the part exceeds the 25 MB cap', async () => {
    const oversized = Buffer.alloc(UPLOAD_FILE_SIZE_LIMIT + 1024, 0x41);
    oversized.write('%PDF-1.7\n');

    // Parsing in middleware means nothing maps multer's error for us, so the
    // mapping is the middleware's own and has to be asserted. Unmapped, this
    // is a 500 that reads as a server fault for a request the client got wrong.
    await post()
      .attach('file', oversized, { filename: 'huge.pdf', contentType: 'application/pdf' })
      .expect(413);
  }, 30_000);

  it('has the fields parsed before the guards run — the PHI ordering', async () => {
    await post()
      .field('title', 'Hand Hygiene Policy')
      .field('issuingAuthority', 'Infection Prevention & Control Committee')
      .attach('file', Buffer.from('%PDF-1.7\n'), {
        filename: 'policy.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    // `PhiScreenGuard` can only screen what it can read. Parsed one step later
    // — as a `FileInterceptor` does — this is `null`, the guard scans nothing,
    // and `@ScreenForPhi` on the upload route becomes a decoration.
    expect(bodyAtGuardTime).toEqual([['issuingAuthority', 'title']]);
  });
});
