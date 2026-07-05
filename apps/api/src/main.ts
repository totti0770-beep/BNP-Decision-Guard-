import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  const port = parseInt(process.env.API_PORT ?? '4000', 10);
  await app.listen(port);
  console.log(`BNP Decision Guard API listening on :${port}`);
}

bootstrap();
