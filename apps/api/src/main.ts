import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import * as express from 'express';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditService } from './audit/audit.service';
import { JsonLogger } from './common/logging/json-logger.service';

async function bootstrap() {
  // Validates required secrets and fails fast in production before any
  // network listener is opened.
  const env = loadEnv();

  // Disable Nest's default body parser so we control the JSON size cap; file
  // uploads go through multer (multipart) and are unaffected by this.
  // JSON-line logging (JsonLogger) is used everywhere so `docker logs`/kubectl
  // output can be parsed by a log aggregator instead of scraped as free text.
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: new JsonLogger(),
  });

  app.use(helmet());
  app.use(express.json({ limit: env.bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: env.bodyLimit }));

  // Explicit CORS allowlist. In production an empty CORS_ORIGINS list blocks
  // all cross-origin browser calls rather than silently allowing everything.
  app.enableCors({
    origin: env.cors.origins.length ? env.cors.origins : false,
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter(app.get(AuditService)));

  app.enableShutdownHooks();
  await app.listen(env.port);
  new Logger('Bootstrap').log(
    `BNP Decision Guard API listening on :${env.port} (env=${env.nodeEnv}, ` +
      `cors=${env.cors.origins.join(',') || 'none'})`,
  );
}

bootstrap();
