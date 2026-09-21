import './support/edge-env';
import { RoleName } from '@bnp/shared';
import {
  createE2eApp,
  E2eContext,
  migrateE2eDatabase,
  seedRolesAndUsers,
  truncateAll,
} from './support/e2e-app';

const NURSE = { email: 'nurse@e2e.health', password: 'NurseUser123!', role: RoleName.NURSE_USER };
const ALLOWED = 'https://allowed.example.health';
const FOREIGN = 'https://attacker.example';

/**
 * The four edge controls `SECURITY.md` lists that no other spec sends a bad
 * request at: security headers, the CORS allowlist, the JSON body cap and
 * rate limiting. Each is asserted by *provoking* it — a foreign origin, an
 * oversized body, one request too many — not by reading its configuration.
 *
 * Why this spec exists. Every one of these was installed in `main.ts` and
 * proven by nothing. Rate limiting is the sharpest case: `support/env.ts`
 * raises the ceiling to 10,000 for the functional suites, citing a "dedicated
 * spec", and `SECURITY.md` said "Verified: 6th rapid login returns HTTP 429".
 * There was no such spec and no such assertion. The CORS allowlist was worse
 * off — the harness did not even call `enableCors()`, so the control could not
 * have been tested here whatever anyone wrote. The PHI screen on upload had
 * just been found configured-and-inert from the day it was added; these are
 * the other controls of that shape.
 *
 * Limits are set low by `support/edge-env.ts` before AppModule loads. The
 * throttle tests use routes no other test here touches, because the counter
 * is per (route, IP) and shared for the file.
 */
describe('Edge controls, provoked rather than inspected', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    await migrateE2eDatabase();
    ctx = await createE2eApp();
    await truncateAll(ctx.dataSource);
    await seedRolesAndUsers(ctx.dataSource, [NURSE]);
  }, 120_000);

  afterAll(async () => {
    await ctx?.close();
  });

  describe('security headers (helmet)', () => {
    it('sets the headers on a real response and drops the framework banner', async () => {
      const res = await ctx.http().get('/health').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['strict-transport-security']).toBeDefined();
      // Express advertises itself by default; helmet removes it.
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CORS allowlist', () => {
    it('echoes an allowed origin, with credentials', async () => {
      const res = await ctx.http().get('/health').set('Origin', ALLOWED).expect(200);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('grants nothing to a foreign origin', async () => {
      const res = await ctx.http().get('/health').set('Origin', FOREIGN).expect(200);
      // The response still goes out — CORS is enforced by the browser — but
      // without this header the browser refuses to hand it to the page.
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      // `access-control-allow-credentials: true` IS still emitted here: the
      // `cors` package sets it from `credentials: true` regardless of origin
      // match. On its own it grants nothing — a browser only honours it next
      // to a matching allow-origin — so it is not asserted absent.
    });

    it('refuses a preflight from a foreign origin', async () => {
      const res = await ctx
        .http()
        .options('/auth/login')
        .set('Origin', FOREIGN)
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('never falls back to a wildcard', async () => {
      const res = await ctx.http().get('/health').set('Origin', ALLOWED).expect(200);
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
    });
  });

  describe('JSON body cap', () => {
    it('rejects a body over REQUEST_BODY_LIMIT as 413, not as a server error', async () => {
      const res = await ctx
        .http()
        .post('/auth/login')
        .set('content-type', 'application/json')
        .send({ email: 'x@y.z', password: 'p'.repeat(2048) });
      // 500 here would mean the cap is enforced but reported as our fault —
      // and audited as an unhandled error on every oversized request.
      expect(res.status).toBe(413);
      expect(res.body.statusCode).toBe(413);
    });

    it('still accepts a body under the cap', async () => {
      // Wrong credentials, right size, and a well-formed address so the
      // ValidationPipe is not what answers: 401 proves the parser let it
      // through to the auth service.
      await ctx
        .http()
        .post('/auth/login')
        .send({ email: 'nobody@e2e.health', password: 'wrong-password' })
        .expect(401);
    });
  });

  describe('rate limiting', () => {
    it('throttles the credential endpoints at AUTH_RATE_LIMIT_MAX', async () => {
      // An address that does not exist, so account lockout — a separate
      // control with its own spec — cannot be what produces the rejection.
      const attempt = () =>
        ctx.http().post('/auth/forgot-password').send({ email: 'nobody@e2e.health' });
      for (let i = 0; i < 3; i++) {
        const r = await attempt();
        expect(r.status).toBe(201);
      }
      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      expect(blocked.body.statusCode).toBe(429);
    });

    it('throttles every other route at RATE_LIMIT_MAX, before authentication', async () => {
      // Unauthenticated: the throttler runs ahead of the JWT guard, so an
      // anonymous flood is counted and cut off without touching auth.
      const attempt = () => ctx.http().get('/documents');
      for (let i = 0; i < 8; i++) {
        const r = await attempt();
        expect(r.status).toBe(401);
      }
      expect((await attempt()).status).toBe(429);
    });

    it('keeps the counters per route, so one flooded route does not take down another', async () => {
      // /documents is exhausted above; a different route still answers.
      await ctx.http().get('/notifications').expect(401);
    });
  });
});
