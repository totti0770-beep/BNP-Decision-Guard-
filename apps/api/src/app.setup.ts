import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as express from 'express';
import type { AppEnv } from './config/env';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditService } from './audit/audit.service';

/**
 * The HTTP edge every request meets: security headers, the JSON body cap, the
 * CORS allowlist, the validation pipe and the uniform error envelope.
 *
 * This exists as one function because `main.ts` and the integration harness
 * used to each install the list by hand, and the two copies drifted: the
 * harness had no `enableCors()` at all, so the CORS allowlist — a control
 * `SECURITY.md` lists — was configured in production and exercised by nothing.
 * A test that boots a *copy* of the bootstrap proves the copy. Both callers
 * now run this, so what the suite exercises is what production installs, and
 * a middleware added here is covered the moment it lands.
 *
 * Deliberately not called from `AppModule`: it needs `app.use()` and
 * `enableCors()`, which are application-level, and the harness needs to
 * override providers *before* this runs.
 */
export function configureApp(app: INestApplication, env: AppEnv): void {
  app.use(helmet());
  // Nest's default body parser is disabled at `NestFactory.create` so this cap
  // is the only one. Uploads are multipart and parsed by multer, not here.
  app.use(express.json({ limit: env.bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: env.bodyLimit }));

  // Explicit allowlist. In production an empty CORS_ORIGINS blocks every
  // cross-origin browser call rather than silently allowing all of them.
  app.enableCors({
    origin: env.cors.origins.length ? env.cors.origins : false,
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter(app.get(AuditService)));
}
