import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import helmet from 'helmet';
import * as express from 'express';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { Permission, ROLE_PERMISSIONS, RoleName } from '@bnp/shared';

import { AppModule } from '../../src/app.module';
import { loadEnv } from '../../src/config/env';
import { buildDataSourceOptions } from '../../src/config/data-source';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { AuditService } from '../../src/audit/audit.service';
import { StorageService } from '../../src/storage/storage.service';
import { MailService, MailMessage } from '../../src/mail/mail.service';
import {
  ExtractedPage,
  PdfExtractionService,
} from '../../src/rag/pdf-extraction.service';

/**
 * In-memory stand-in for S3/MinIO. Object storage is a genuinely external
 * dependency; faking it keeps the suite hermetic while leaving the whole
 * upload -> extract -> chunk -> embed -> pgvector path real.
 */
export class InMemoryStorageService {
  readonly bucket = 'bnp-e2e';
  readonly objects = new Map<string, Buffer>();

  async ensureBucket(): Promise<void> {}

  async upload(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, body);
  }

  async download(key: string): Promise<Buffer> {
    const found = this.objects.get(key);
    if (!found) throw new Error(`e2e storage: missing key ${key}`);
    return found;
  }

  async presignedDownloadUrl(key: string): Promise<string> {
    return `https://e2e.invalid/${encodeURIComponent(key)}`;
  }
}

/**
 * Stand-in for PDF text extraction.
 *
 * NOT a design preference — a hard environment constraint. `pdf-parse`'s
 * bundled pdf.js v1.10.100 throws an empty `UnknownErrorException` during
 * parsing whenever it runs inside a jest process, however it is loaded
 * (verified: plain `require`, and `module.createRequire` to escape jest's
 * module registry, both fail; the identical call succeeds in bare node).
 *
 * So the extraction step is the one link of the ingestion chain these tests
 * cannot execute. Everything downstream of it — chunking, embedding, the
 * pgvector write, vector retrieval, reranking, the refusal gate and citation
 * assembly — runs for real against real Postgres.
 *
 * Consequence worth stating plainly: **PDF text extraction has no automated
 * coverage at all**, here or in the unit suite, for the same reason. It is
 * exercised only by `npm run seed` and by manual upload.
 *
 * Specs set `pages` to the same text they rendered into the uploaded PDF, so
 * the content flowing through the rest of the pipeline still matches the
 * document under test.
 */
export class StubPdfExtractionService {
  pages: ExtractedPage[] = [];

  async extractPages(): Promise<ExtractedPage[]> {
    if (this.pages.length === 0) {
      throw new Error(
        'e2e: StubPdfExtractionService.pages was not set before indexing',
      );
    }
    return this.pages;
  }
}

/** Captures mail instead of sending it, so specs can read the reset link. */
export class CapturingMailService {
  readonly sent: MailMessage[] = [];
  get name() {
    return 'e2e-capture';
  }
  onApplicationBootstrap(): void {}
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
  async sendQuietly(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
  lastTo(to: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to);
  }
  clear(): void {
    this.sent.length = 0;
  }
}

export interface E2eContext {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  dataSource: DataSource;
  storage: InMemoryStorageService;
  mail: CapturingMailService;
  pdf: StubPdfExtractionService;
  close: () => Promise<void>;
}

/** Every table the suites touch, ordered so CASCADE has nothing left to chase. */
const TABLES = [
  'citations',
  'ai_answers',
  'ai_questions',
  'document_chunks',
  'document_approvals',
  'document_versions',
  'documents',
  'dose_calculations',
  'dose_formulas',
  'audit_logs',
  'notifications',
  'settings',
  'user_roles',
  'role_permissions',
  'users',
  'roles',
  'permissions',
];

/**
 * Runs migrations once against the e2e database, using a throwaway connection
 * so the application's own pool starts clean.
 */
export async function migrateE2eDatabase(): Promise<void> {
  const ds = new DataSource(buildDataSourceOptions());
  await ds.initialize();
  try {
    await ds.runMigrations();
  } finally {
    await ds.destroy();
  }
}

export async function truncateAll(ds: DataSource): Promise<void> {
  await ds.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

export interface SeededUser {
  email: string;
  password: string;
  role: RoleName;
}

/**
 * Minimal role/permission/user seed — deliberately not the demo seeder, which
 * also uploads sample PDFs through S3 and would couple these tests to it.
 */
export async function seedRolesAndUsers(
  ds: DataSource,
  users: SeededUser[],
): Promise<void> {
  const permIds = new Map<string, string>();
  for (const code of Object.values(Permission)) {
    const [row] = await ds.query(
      `INSERT INTO permissions (code) VALUES ($1) RETURNING id`,
      [code],
    );
    permIds.set(code, row.id);
  }

  const roleIds = new Map<string, string>();
  for (const roleName of Object.values(RoleName)) {
    const [row] = await ds.query(
      `INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id`,
      [roleName, `${roleName} (e2e)`],
    );
    roleIds.set(roleName, row.id);
    for (const perm of ROLE_PERMISSIONS[roleName]) {
      await ds.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
        [row.id, permIds.get(perm)],
      );
    }
  }

  for (const user of users) {
    // Cost 4: these hashes are created and compared many times per run and the
    // work factor is not what is under test.
    const hash = await bcrypt.hash(user.password, 4);
    const [row] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id`,
      [user.email.toLowerCase(), hash, `E2E ${user.role}`],
    );
    await ds.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
      [row.id, roleIds.get(user.role)],
    );
  }
}

/**
 * Boots the real AppModule with the same global pipeline main.ts installs —
 * helmet, the JSON body cap, ValidationPipe(whitelist+transform) and the
 * exception filter — so the suite exercises the wiring a request actually
 * meets in production, not a reduced test harness.
 */
export async function createE2eApp(): Promise<E2eContext> {
  const storage = new InMemoryStorageService();
  const mail = new CapturingMailService();
  const pdf = new StubPdfExtractionService();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(StorageService)
    .useValue(storage)
    .overrideProvider(MailService)
    .useValue(mail)
    .overrideProvider(PdfExtractionService)
    .useValue(pdf)
    .compile();

  const app = moduleRef.createNestApplication();
  const env = loadEnv();

  app.use(helmet());
  app.use(express.json({ limit: env.bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: env.bodyLimit }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter(app.get(AuditService)));

  await app.init();

  const dataSource = app.get<DataSource>(getDataSourceToken());

  return {
    app,
    http: () => request(app.getHttpServer()),
    dataSource,
    storage,
    mail,
    pdf,
    close: async () => {
      // AuditService.record() is deliberately fire-and-forget, so a request
      // can return before its audit row lands. Give those inserts a moment,
      // or tearing the pool down logs "Connection terminated" for writes that
      // were perfectly fine.
      await new Promise((resolve) => setTimeout(resolve, 150));
      await app.close();
    },
  };
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; roles: string[]; permissions: string[] };
}

export async function login(
  ctx: E2eContext,
  email: string,
  password: string,
): Promise<LoginResult> {
  const res = await ctx.http().post('/auth/login').send({ email, password }).expect(201);
  if (!res.body.accessToken) {
    throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
