/**
 * Loaded via jest `setupFiles`, i.e. before any application module is
 * imported. That ordering matters: `config/env.ts` binds `isProduction` at
 * module load, and `config/data-source.ts` reads process.env when it builds
 * connection options.
 *
 * Every value here is overridable from the outside so the same suite runs
 * against the CI service container and against a local cluster.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';

process.env.POSTGRES_HOST = process.env.E2E_POSTGRES_HOST ?? process.env.POSTGRES_HOST ?? 'localhost';
process.env.POSTGRES_PORT = process.env.E2E_POSTGRES_PORT ?? process.env.POSTGRES_PORT ?? '5432';
process.env.POSTGRES_USER = process.env.E2E_POSTGRES_USER ?? process.env.POSTGRES_USER ?? 'bnp';
process.env.POSTGRES_PASSWORD =
  process.env.E2E_POSTGRES_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? 'bnp_secret';
process.env.POSTGRES_DB = process.env.E2E_POSTGRES_DB ?? 'bnp_e2e';

process.env.JWT_SECRET = 'e2e-jwt-secret-not-a-default';
process.env.JWT_REFRESH_SECRET = 'e2e-jwt-refresh-secret-not-a-default';

// Throttling is a real control with its own dedicated spec; the functional
// suites raise the ceiling so unrelated assertions don't trip it.
process.env.RATE_LIMIT_MAX = '10000';
process.env.AUTH_RATE_LIMIT_MAX = '10000';

// Lock after 3 rather than 5 so the lockout spec stays short.
process.env.AUTH_MAX_FAILED_ATTEMPTS = '3';
process.env.AUTH_LOCKOUT_MINUTES = '15';

// Deterministic, dependency-free AI providers — the point of these tests is
// the governance wiring, not model quality.
process.env.LLM_PROVIDER = 'mock';
process.env.EMBEDDING_PROVIDER = 'mock';

// Mail is captured in-process by a fake provider; this keeps env.ts happy.
process.env.MAIL_PROVIDER = 'log';
process.env.APP_BASE_URL = 'http://localhost:3000';

// The reset token must never appear in an HTTP response. Left explicitly off
// so the suite asserts the shipped default, not a test-only relaxation.
delete process.env.AUTH_DEV_RETURN_RESET_TOKEN;
