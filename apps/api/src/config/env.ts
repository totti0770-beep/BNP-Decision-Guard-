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
const DEMO_S3_ACCESS_KEY = 'bnp_minio';

export const isProduction = process.env.NODE_ENV === 'production';

/**
 * `NODE_ENV` is the single input to `isProduction`, and `isProduction` gates
 * the secret fail-fast, the CORS fail-closed default, 5xx suppression, the
 * reset-token refusal, the seed refusal and the demo-account sweep. Every one
 * of those degrades to its permissive form together if the value is unset or
 * misspelled — `NODE_ENV=Production` silently yields a development posture on
 * a production host. Nothing used to notice.
 *
 * Unset is still allowed and still means development: that is the documented
 * local default and failing there would break `npm test` and a bare
 * `ts-node src/main.ts`. An *unrecognised* value is the actual footgun, and
 * that is what this refuses.
 */
const KNOWN_NODE_ENVS = ['production', 'development', 'test'];

function validatedNodeEnv(): string {
  const raw = process.env.NODE_ENV?.trim();
  if (!raw) return 'development';
  if (!KNOWN_NODE_ENVS.includes(raw)) {
    throw new Error(
      `[env] NODE_ENV="${raw}" is not recognised. Use one of ` +
        `${KNOWN_NODE_ENVS.join(', ')}. Anything else silently selects the ` +
        `development security posture — no secret fail-fast, an open CORS ` +
        `default, and internal errors returned to clients.`,
    );
  }
  return raw;
}

export const DEFAULT_RAG_MIN_SIMILARITY = 0.25;

/**
 * The similarity floor a reranked chunk must clear before it can support an
 * answer — the softest control in the clinical safety contract, and the one
 * that was least protected.
 *
 * `parseFloat(process.env.RAG_MIN_SIMILARITY ?? '0.25')` accepted anything.
 * `RAG_MIN_SIMILARITY=abc` produced `NaN`, every `score >= NaN` comparison is
 * false, and the assistant refused **every question** — indistinguishable
 * from an empty corpus, with no error anywhere. A negative value disabled the
 * threshold entirely and let unqualified chunks answer clinical questions.
 * Both failures are silent, and they fail in opposite directions.
 *
 * Deliberately **not** cached, and deliberately read per call rather than
 * bound once: `RagQueryService.ask()` re-reads it so the answer-quality
 * harness can sweep the answer-vs-refuse trade-off in a single process.
 * `loadEnv()` calls this too, so a bad value fails the boot rather than
 * waiting for the first question.
 */
export function ragMinSimilarity(): number {
  const raw = process.env.RAG_MIN_SIMILARITY?.trim();
  if (!raw) return DEFAULT_RAG_MIN_SIMILARITY;
  // `Number` rather than `parseFloat`: parseFloat("0.3-oops") is 0.3, which
  // would silently accept a typo'd threshold.
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `[env] RAG_MIN_SIMILARITY="${raw}" is not a similarity. It must be a ` +
        `number in [0, 1] — cosine similarity cannot fall outside that range. ` +
        `A non-numeric value makes the assistant refuse every question; a ` +
        `negative one disables the refusal threshold.`,
    );
  }
  return value;
}

/**
 * A `jsonwebtoken` lifetime: seconds as a number, or an `ms`-parseable string
 * such as `15m`, `1h`, `7d`.
 *
 * jsonwebtoken 9's types narrow `expiresIn` to a template-literal union that a
 * value read from `process.env` can never satisfy statically. Rather than
 * casting at each call site — which would accept `JWT_EXPIRES_IN="1 hour or
 * so"` and only fail inside the first login of the day — the value is checked
 * here and the cast happens once, behind a validated precondition.
 */
export type JwtLifetime = number | `${number}${'s' | 'm' | 'h' | 'd' | 'w' | 'y'}`;

// Deliberately narrower than everything `ms` accepts. The long forms ("2
// days") are legal there but nobody configures a token lifetime that way, and
// a tight pattern turns a typo into a boot failure instead of a session that
// silently lasts the wrong length of time.
const LIFETIME_PATTERN = /^\d+(?:\.\d+)?[smhdwy]$/;

function jwtLifetime(name: string, fallback: JwtLifetime): JwtLifetime {
  const raw = process.env[name];
  if (!raw) return fallback;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (!LIFETIME_PATTERN.test(raw)) {
    throw new Error(
      `${name}="${raw}" is not a valid token lifetime. Use seconds as a plain ` +
        `number, or a unit suffix: 30s, 15m, 1h, 7d, 2w, 1y.`,
    );
  }
  return raw as JwtLifetime;
}

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
    expiresIn: JwtLifetime;
    refreshExpiresIn: JwtLifetime;
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
  /**
   * Snapshot of the refusal threshold at boot. The query path calls
   * `ragMinSimilarity()` directly so a sweep can move it; this field exists so
   * a bad value fails the boot and so diagnostics can report what was configured.
   */
  rag: { minSimilarity: number };
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

  // NODE_ENV first: every check below keys off it, so validating it after
  // them would let a misspelled value skip the very checks it selects.
  const nodeEnv = validatedNodeEnv();

  // Fail-fast on secrets before anything else initialises.
  required('JWT_SECRET', DEFAULT_JWT_SECRET);
  required('JWT_REFRESH_SECRET', DEFAULT_JWT_REFRESH_SECRET);
  required('POSTGRES_PASSWORD', DEMO_DB_PASSWORD);
  required('S3_SECRET_KEY', DEMO_S3_SECRET);
  // Paired with the secret. A demo access key plus a real secret cannot reach
  // the bucket at all, so leaving it out of the fail-fast only moved the
  // failure from boot to the first document upload.
  required('S3_ACCESS_KEY', DEMO_S3_ACCESS_KEY);
  // Paired with the secret. A demo access key plus a real secret cannot reach
  // the bucket at all, so leaving it out of the fail-fast only moved the
  // failure from boot to the first document upload.


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
    nodeEnv,
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
      expiresIn: jwtLifetime('JWT_EXPIRES_IN', '1h'),
      refreshExpiresIn: jwtLifetime('JWT_REFRESH_EXPIRES_IN', '7d'),
    },
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
      region: process.env.S3_REGION ?? 'us-east-1',
      accessKey: process.env.S3_ACCESS_KEY ?? DEMO_S3_ACCESS_KEY,
      secretKey: process.env.S3_SECRET_KEY ?? DEMO_S3_SECRET,
      bucket: process.env.S3_BUCKET ?? 'bnp-documents',
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    },
    cors: { origins },
    rag: { minSimilarity: ragMinSimilarity() },
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
