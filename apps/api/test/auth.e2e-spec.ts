import { RoleName } from '@bnp/shared';
import {
  auth,
  createE2eApp,
  E2eContext,
  login,
  migrateE2eDatabase,
  seedRolesAndUsers,
  truncateAll,
} from './support/e2e-app';

const NURSE = { email: 'nurse@e2e.health', password: 'NurseUser123!', role: RoleName.NURSE_USER };

describe('Auth over real HTTP', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    await migrateE2eDatabase();
    ctx = await createE2eApp();
    await truncateAll(ctx.dataSource);
    await seedRolesAndUsers(ctx.dataSource, [NURSE]);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(() => ctx.mail.clear());

  it('issues a working access token that the guards accept', async () => {
    const session = await login(ctx, NURSE.email, NURSE.password);
    expect(session.user.roles).toEqual([RoleName.NURSE_USER]);

    const me = await ctx
      .http()
      .get('/users/me')
      .set(auth(session.accessToken))
      .expect(200);
    expect(me.body.email).toBe(NURSE.email);
    // Permissions are derived from the rbac.ts matrix, not the database.
    expect(me.body.permissions).toContain('ai:ask');
    expect(me.body.permissions).not.toContain('documents:download');
  });

  it('rejects an unauthenticated request to a protected route', async () => {
    await ctx.http().get('/users/me').expect(401);
  });

  it('rejects a refresh token presented as an access token', async () => {
    const session = await login(ctx, NURSE.email, NURSE.password);
    // JwtStrategy checks payload.type — a refresh token must not open a session.
    await ctx
      .http()
      .get('/users/me')
      .set(auth(session.refreshToken))
      .expect(401);
  });

  it('exchanges a refresh token for a new pair, then revokes it on logout', async () => {
    const session = await login(ctx, NURSE.email, NURSE.password);

    const refreshed = await ctx
      .http()
      .post('/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(201);
    expect(refreshed.body.accessToken).toBeTruthy();

    await ctx
      .http()
      .post('/auth/logout')
      .set(auth(refreshed.body.accessToken))
      .expect(201);

    // token_version bumped: every outstanding refresh token is now void.
    await ctx
      .http()
      .post('/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
    await ctx
      .http()
      .post('/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
  });

  it('locks the account after repeated failures, blocking even a correct password', async () => {
    const email = 'lockme@e2e.health';
    await seedRolesAndUsersForExtraUser(ctx, email);

    for (let i = 0; i < 3; i++) {
      await ctx.http().post('/auth/login').send({ email, password: 'wrong' }).expect(401);
    }

    const blocked = await ctx
      .http()
      .post('/auth/login')
      .send({ email, password: 'Correct123!' })
      .expect(401);
    expect(JSON.stringify(blocked.body)).toMatch(/locked/i);
  });

  it('validates the request body through the global ValidationPipe', async () => {
    // Not an email -> 400 from class-validator, not a 500 from deeper code.
    await ctx
      .http()
      .post('/auth/login')
      .send({ email: 'not-an-email', password: 'x' })
      .expect(400);
  });

  describe('password reset', () => {
    it('never returns the token, mails a working link, and rotates the password', async () => {
      const forgot = await ctx
        .http()
        .post('/auth/forgot-password')
        .send({ email: NURSE.email })
        .expect(201);

      // The P0 this branch closed: a public endpoint must not hand out a
      // usable reset token, whatever NODE_ENV happens to be.
      expect(forgot.body).toEqual({ requested: true });
      expect(forgot.body.resetToken).toBeUndefined();

      // Delivery is fire-and-forget, so let the microtask queue drain.
      await new Promise((r) => setImmediate(r));

      const message = ctx.mail.lastTo(NURSE.email);
      expect(message).toBeDefined();
      const token = /token=([^\s&]+)/.exec(message!.text)?.[1];
      expect(token).toBeTruthy();

      await ctx
        .http()
        .post('/auth/reset-password')
        .send({ token: decodeURIComponent(token!), newPassword: 'BrandNewPass123!' })
        .expect(201);

      await ctx
        .http()
        .post('/auth/login')
        .send({ email: NURSE.email, password: NURSE.password })
        .expect(401);
      const after = await login(ctx, NURSE.email, 'BrandNewPass123!');
      expect(after.accessToken).toBeTruthy();

      // Single use: the same token cannot be replayed.
      await ctx
        .http()
        .post('/auth/reset-password')
        .send({ token: decodeURIComponent(token!), newPassword: 'YetAnother123!' })
        .expect(401);

      NURSE.password = 'BrandNewPass123!';
    });

    it('does not reveal whether an address exists, and mails nothing', async () => {
      const res = await ctx
        .http()
        .post('/auth/forgot-password')
        .send({ email: 'ghost@e2e.health' })
        .expect(201);
      expect(res.body).toEqual({ requested: true });

      await new Promise((r) => setImmediate(r));
      expect(ctx.mail.lastTo('ghost@e2e.health')).toBeUndefined();
    });
  });

  it('has no public self-registration endpoint', async () => {
    const res = await ctx
      .http()
      .post('/auth/register')
      .send({ email: 'walkin@e2e.health', password: 'Password123!', fullName: 'Walk In' });
    expect(res.status).toBe(404);
  });
});

/** Adds one extra user to the already-seeded roles. */
async function seedRolesAndUsersForExtraUser(ctx: E2eContext, email: string) {
  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.hash('Correct123!', 4);
  const [role] = await ctx.dataSource.query(`SELECT id FROM roles WHERE name = $1`, [
    RoleName.NURSE_USER,
  ]);
  const [user] = await ctx.dataSource.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id`,
    [email, hash, 'Lock Me'],
  );
  await ctx.dataSource.query(
    `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
    [user.id, role.id],
  );
}

describe('MFA enrolment over real HTTP', () => {
  let ctx: E2eContext;
  const MFA_USER = {
    email: 'mfa@e2e.health',
    password: 'MfaUser123!',
    role: RoleName.NURSE_USER,
  };

  beforeAll(async () => {
    await migrateE2eDatabase();
    ctx = await createE2eApp();
    await truncateAll(ctx.dataSource);
    await seedRolesAndUsers(ctx.dataSource, [MFA_USER]);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('drives the full enroll -> enable -> login-challenged -> disable cycle', async () => {
    const { authenticator } = await import('otplib');
    const session = await login(ctx, MFA_USER.email, MFA_USER.password);

    // Enrolment is authenticated: no token, no secret.
    await ctx.http().post('/auth/mfa/enroll').expect(401);

    const enrolled = await ctx
      .http()
      .post('/auth/mfa/enroll')
      .set(auth(session.accessToken))
      .expect(201);
    expect(enrolled.body.secret).toEqual(expect.any(String));
    expect(enrolled.body.otpauthUrl).toContain('otpauth://totp/');

    // Still off until a real code proves the app holds the secret, so login
    // must not be challenged yet.
    const beforeEnable = await ctx
      .http()
      .post('/auth/login')
      .send({ email: MFA_USER.email, password: MFA_USER.password })
      .expect(201);
    expect(beforeEnable.body.mfaRequired).toBe(false);

    // A wrong code must not enable it.
    await ctx
      .http()
      .post('/auth/mfa/enable')
      .set(auth(session.accessToken))
      .send({ code: '000000' })
      .expect(401);

    await ctx
      .http()
      .post('/auth/mfa/enable')
      .set(auth(session.accessToken))
      .send({ code: authenticator.generate(enrolled.body.secret) })
      .expect(201);

    // Now the password alone is no longer a full login.
    const challenged = await ctx
      .http()
      .post('/auth/login')
      .send({ email: MFA_USER.email, password: MFA_USER.password })
      .expect(201);
    expect(challenged.body.mfaRequired).toBe(true);
    expect(challenged.body.mfaToken).toEqual(expect.any(String));
    expect(challenged.body.accessToken).toBeUndefined();

    // The half-authenticated token exchanges for a real session with a code.
    const verified = await ctx
      .http()
      .post('/auth/mfa/verify')
      .send({
        mfaToken: challenged.body.mfaToken,
        code: authenticator.generate(enrolled.body.secret),
      })
      .expect(201);
    expect(verified.body.accessToken).toEqual(expect.any(String));

    // Disabling needs the password, not just the session.
    await ctx
      .http()
      .post('/auth/mfa/disable')
      .set(auth(verified.body.accessToken))
      .send({ password: 'not-the-password' })
      .expect(401);

    await ctx
      .http()
      .post('/auth/mfa/disable')
      .set(auth(verified.body.accessToken))
      .send({ password: MFA_USER.password })
      .expect(201);

    const afterDisable = await ctx
      .http()
      .post('/auth/login')
      .send({ email: MFA_USER.email, password: MFA_USER.password })
      .expect(201);
    expect(afterDisable.body.mfaRequired).toBe(false);
  });
});
