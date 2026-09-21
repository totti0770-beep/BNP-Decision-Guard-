import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadEnv } from './config/env';
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

  // Helmet, body cap, CORS allowlist, validation pipe, error envelope — shared
  // with the integration harness so the suite exercises this exact edge.
  configureApp(app, env);

  app.enableShutdownHooks();
  await app.listen(env.port);
  new Logger('Bootstrap').log(
    `BNP Decision Guard API listening on :${env.port} (env=${env.nodeEnv}, ` +
      `cors=${env.cors.origins.join(',') || 'none'})`,
  );
}

bootstrap();
