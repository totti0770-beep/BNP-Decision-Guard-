/**
 * Imported FIRST by `edge-controls.e2e-spec.ts`, before anything that pulls in
 * `AppModule`. `loadEnv()` caches on first call, and `ThrottlerModule.forRoot`
 * and the auth controller's `@Throttle` both read it at module load, so these
 * have to be in place before that import graph is evaluated. Each jest file
 * has its own module registry, so nothing here leaks into the other specs —
 * which keep the ceilings `support/env.ts` raises for them.
 */
process.env.RATE_LIMIT_TTL = '60';
process.env.RATE_LIMIT_MAX = '8';
process.env.AUTH_RATE_LIMIT_MAX = '3';
process.env.CORS_ORIGINS = 'https://allowed.example.health';
process.env.REQUEST_BODY_LIMIT = '1kb';
