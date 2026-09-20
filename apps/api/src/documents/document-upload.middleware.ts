import {
  BadRequestException,
  Injectable,
  NestMiddleware,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';

/**
 * Parses the upload's multipart body **before** the guards run.
 *
 * This exists because of an ordering bug that made a security control a
 * decoration. Nest runs middleware → guards → interceptors → pipes → handler.
 * `POST /documents/upload` carried `@ScreenForPhi({ body: ['title',
 * 'description', 'changeNote'] })`, but the body was parsed by
 * `FileInterceptor` — an *interceptor*, so one step too late. At guard time
 * `req.body` was `undefined`, `PhiScreenGuard` found no string to scan, and
 * every patient identifier typed into a document title was stored.
 *
 * It failed silently in the worst direction: the decorator was present, the
 * route read as screened, and nothing anywhere returned an error. The gap was
 * found by writing a test that put an identifier in an upload field and
 * expected a 400; it got a 201.
 *
 * Running multer as middleware is the fix, and it is the *only* fix that keeps
 * the guard's real guarantee. Screening later — in a second interceptor, in
 * the `ValidationPipe`, or in `DocumentsService` — would leave the rejection
 * inside `AuditInterceptor`'s scope, so a rejected request would start
 * writing rows again. A guard throws before the interceptor chain, which is
 * why "rejected text is never written to any store" is a property of the
 * ordering rather than a promise about what the code remembers to avoid.
 *
 * The 25 MB cap matches what the web upload screen enforces and advertises.
 * The error mapping below reproduces what `FileInterceptor` did via
 * `transformException`, which is not exported from
 * `@nestjs/platform-express`: without it a too-large file raises a raw
 * `MulterError` and Nest's exception handler reports `500 Internal server
 * error` instead of `413`.
 */
export const UPLOAD_FILE_SIZE_LIMIT = 25 * 1024 * 1024;

@Injectable()
export class DocumentUploadMiddleware implements NestMiddleware {
  private readonly parse = multer({
    limits: { fileSize: UPLOAD_FILE_SIZE_LIMIT },
  }).single('file');

  use(req: Request, res: Response, next: NextFunction): void {
    this.parse(req, res, (err: unknown) => {
      if (!err) return next();
      next(toHttpException(err));
    });
  }
}

/**
 * Mirrors `@nestjs/platform-express`'s own multer error mapping. Only the
 * shape matters: a client that sends something multer refuses gets a 4xx
 * naming the limit, never a 5xx that looks like the server broke.
 */
function toHttpException(err: unknown): unknown {
  const e = err as { code?: string; message?: string; field?: string };
  if (e?.code === 'LIMIT_FILE_SIZE') {
    return new PayloadTooLargeException(e.message ?? 'File too large');
  }
  if (typeof e?.code === 'string' && e.code.startsWith('LIMIT_')) {
    return new BadRequestException(
      e.field ? `${e.message} - ${e.field}` : (e.message ?? e.code),
    );
  }
  // Busboy's own failures (a missing or malformed boundary) arrive without a
  // multer code. They are still the client's request being wrong.
  if (typeof e?.message === 'string' && /multipart|boundary/i.test(e.message)) {
    return new BadRequestException(e.message);
  }
  return err;
}
