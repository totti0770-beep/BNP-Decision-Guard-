/**
 * Centralised environment access with production fail-fast.
 *
 * In production (`NODE_ENV=production`) the API refuses to boot if any secret
 * is missing or still set to a shipped default. This closes the most common
 * healthcare-platform footgun: deploying with `change-me` JWT secrets or the
 * demo database password. In non-production it fills sane local defaults so
 * `docker compose up` and tests work with zero configuration.
 */

const DEFAULT_JWT_SECRET = 'change-me-in-production';
const DEFAULT_JWT_REFRESH_SECRET = 'change-me-too-in-production';
const DEMO_DB_PASSWORD = 'bnp_secret';
const DEMO_S3_SECRET = 'bnp_minio_secret';

export const isProduction = process.env.NODE_ENV === 'production';

function required(name: string, demoValue?: string): string {
  const value = process.env[name];
  if (!value || (demoValue !== undefined && value === demoValue)) {
    if (isProduction) {
      throw new Error(
        `[env] ${name} must be set to a non-default value in production. ` +
          `Refusing to start with a missing or demo value.`,
      );
    }
  }
  return value ?? '';
}

export interface AppEnv {
  nodeEnv: string;
  port: number;
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  jwt: {
    secret: string;
    refreshSecret: string;
    expiresIn: string;
    refreshExpiresIn: string;
  };
  s3: {
    endpoint: string;
    region: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    forcePathStyle: boolean;
  };
  cors: { origins: string[] };
  bodyLimit: string;
  rateLimit: { ttlSeconds: number; limit: number; authLimit: number };
  lockout: { maxFailedAttempts: number; lockoutMinutes: number };
  passwordResetTokenMinutes: number;
  /** Public base URL of the web app, used to build links inside emails. */
  appBaseUrl: string;
  mail: {
    provider: 'log' | 'smtp';
    from: string;
    host: string;
    port: number;
    user: string;
    pass: string;
  };
}

let cached: AppEnv | null = null;

export function loadEnv(): AppEnv {
  if (cached) return cached;

  // Fail-fast on secrets before anything else initialises.
  required('JWT_SECRET', DEFAULT_JWT_SECRET);
  required('JWT_REFRESH_SECRET', DEFAULT_JWT_REFRESH_SECRET);
  required('POSTGRES_PASSWORD', DEMO_DB_PASSWORD);
  required('S3_SECRET_KEY', DEMO_S3_SECRET);

  // Mail is deliberately NOT part of the secret fail-fast. A missing secret is
  // a security hole that must stop the boot; log-only mail is a degraded
  // feature. Refusing to start would take the whole clinical assistant offline
  // over undelivered password-reset links — the wrong trade for a hospital.
  // An explicitly chosen smtp provider with no host IS a hard config error.
  const mailProvider = process.env.MAIL_PROVIDER === 'smtp' ? 'smtp' : 'log';
  if (mailProvider === 'smtp' && !process.env.MAIL_HOST?.trim()) {
    throw new Error('[env] MAIL_HOST must be set when MAIL_PROVIDER=smtp.');
  }
  if (isProduction && mailProvider !== 'smtp') {
    console.warn(
      '[env] MAIL_PROVIDER is "log" in production: password-reset emails are ' +
        'written to the application log instead of being delivered. Set ' +
        'MAIL_PROVIDER=smtp with MAIL_HOST before onboarding real users.',
    );
  }

  const corsRaw = process.env.CORS_ORIGINS?.trim();
  const origins = corsRaw
    ? corsRaw.split(',').map((o) => o.trim()).filter(Boolean)
    : isProduction
      ? [] // production must declare origins explicitly
      : ['http://localhost:3000'];

  cached = {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.API_PORT ?? '4000', 10),
    db: {
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
      user: process.env.POSTGRES_USER ?? 'bnp',
      password: process.env.POSTGRES_PASSWORD ?? DEMO_DB_PASSWORD,
      database: process.env.POSTGRES_DB ?? 'bnp_decision_guard',
    },
    jwt: {
      secret: process.env.JWT_SECRET ?? DEFAULT_JWT_SECRET,
      refreshSecret: process.env.JWT_REFRESH_SECRET ?? DEFAULT_JWT_REFRESH_SECRET,
      expiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    },
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
      region: process.env.S3_REGION ?? 'us-east-1',
      accessKey: process.env.S3_ACCESS_KEY ?? 'bnp_minio',
      secretKey: process.env.S3_SECRET_KEY ?? DEMO_S3_SECRET,
      bucket: process.env.S3_BUCKET ?? 'bnp-documents',
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    },
    cors: { origins },
    bodyLimit: process.env.REQUEST_BODY_LIMIT ?? '25mb',
    rateLimit: {
      ttlSeconds: parseInt(process.env.RATE_LIMIT_TTL ?? '60', 10),
      limit: parseInt(process.env.RATE_LIMIT_MAX ?? '120', 10),
      authLimit: parseInt(process.env.AUTH_RATE_LIMIT_MAX ?? '10', 10),
    },
    lockout: {
      maxFailedAttempts: parseInt(process.env.AUTH_MAX_FAILED_ATTEMPTS ?? '5', 10),
      lockoutMinutes: parseInt(process.env.AUTH_LOCKOUT_MINUTES ?? '15', 10),
    },
    passwordResetTokenMinutes: parseInt(
      process.env.PASSWORD_RESET_TOKEN_MINUTES ?? '30',
      10,
    ),
    // Falls back to the first configured CORS origin — that is by definition
    // the web app allowed to call this API, so reset links resolve correctly
    // on an existing deployment without introducing another variable.
    appBaseUrl: (
      process.env.APP_BASE_URL ??
      origins[0] ??
      'http://localhost:3000'
    ).replace(/\/+$/, ''),
    mail: {
      provider: mailProvider,
      from: process.env.MAIL_FROM ?? 'BNP Decision Guard <no-reply@bnp.health>',
      host: process.env.MAIL_HOST ?? '',
      port: parseInt(process.env.MAIL_PORT ?? '587', 10),
      user: process.env.MAIL_USER ?? '',
      pass: process.env.MAIL_PASSWORD ?? '',
    },
  };
  return cached;
}
