import { DOSE_SAFETY_WARNING_AR, DoseFormulaType, RoleName } from '@bnp/shared';
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
const PHARMACIST = {
  email: 'pharmacist@e2e.health',
  password: 'Pharmacist123!',
  role: RoleName.PHARMACIST_REVIEWER,
};
const MANAGER = {
  email: 'knowledge@e2e.health',
  password: 'Knowledge123!',
  role: RoleName.NURSING_KNOWLEDGE_MANAGER,
};
const AUDITOR = { email: 'auditor@e2e.health', password: 'Auditor123!', role: RoleName.AUDITOR };
const ADMIN = { email: 'admin@e2e.health', password: 'HospAdmin123!', role: RoleName.HOSPITAL_ADMIN };

/**
 * The unit suite proves PermissionsGuard computes the right answer from a
 * fabricated context. This proves the guard is actually mounted on the real
 * routes, with permissions derived from a real JWT — the wiring the unit test
 * cannot see.
 */
describe('RBAC enforced on real routes', () => {
  let ctx: E2eContext;
  const t: Record<string, string> = {};

  beforeAll(async () => {
    await migrateE2eDatabase();
    ctx = await createE2eApp();
    await truncateAll(ctx.dataSource);
    await seedRolesAndUsers(ctx.dataSource, [NURSE, PHARMACIST, MANAGER, AUDITOR, ADMIN]);
    for (const u of [NURSE, PHARMACIST, MANAGER, AUDITOR, ADMIN]) {
      t[u.role] = (await login(ctx, u.email, u.password)).accessToken;
    }
  }, 120_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('lets a nurse ask the AI but not read the governance surfaces', async () => {
    await ctx
      .http()
      .post('/chat/ask')
      .set(auth(t[RoleName.NURSE_USER]))
      .send({ question: 'anything' })
      .expect(201);

    await ctx.http().get('/users').set(auth(t[RoleName.NURSE_USER])).expect(403);
    await ctx.http().get('/audit-logs').set(auth(t[RoleName.NURSE_USER])).expect(403);
    await ctx.http().get('/analytics/overview').set(auth(t[RoleName.NURSE_USER])).expect(403);
    // Answer review is a committee surface; nurses must not see other nurses' answers.
    await ctx.http().get('/chat/answers').set(auth(t[RoleName.NURSE_USER])).expect(403);
  });

  it('makes the auditor read-only: audit yes, clinical AI no', async () => {
    await ctx.http().get('/audit-logs').set(auth(t[RoleName.AUDITOR])).expect(200);
    await ctx.http().get('/analytics/overview').set(auth(t[RoleName.AUDITOR])).expect(200);

    await ctx
      .http()
      .post('/chat/ask')
      .set(auth(t[RoleName.AUDITOR]))
      .send({ question: 'anything' })
      .expect(403);
    await ctx
      .http()
      .post('/dose/calculate')
      .set(auth(t[RoleName.AUDITOR]))
      .send({ formulaId: '00000000-0000-0000-0000-000000000000', weightKg: 10 })
      .expect(403);
  });

  it('withholds source-PDF download from nurses and auditors (copy protection)', async () => {
    // 403 from the guard, not 404 — the permission check happens first.
    const id = '00000000-0000-0000-0000-000000000000';
    await ctx.http().get(`/documents/${id}/download-url`).set(auth(t[RoleName.NURSE_USER])).expect(403);
    await ctx.http().get(`/documents/${id}/download-url`).set(auth(t[RoleName.AUDITOR])).expect(403);
  });

  it('exposes roles as read-only — no runtime permission editing', async () => {
    const list = await ctx.http().get('/roles').set(auth(t[RoleName.HOSPITAL_ADMIN])).expect(200);
    expect(list.body.length).toBe(Object.values(RoleName).length);

    // The mutation endpoints are gone: rbac.ts is the only authorization input,
    // so an endpoint that appeared to edit permissions could only mislead.
    const roleId = list.body[0].id;
    expect(
      (await ctx.http().post('/roles').set(auth(t[RoleName.HOSPITAL_ADMIN])).send({ name: 'X', permissions: [] })).status,
    ).toBe(404);
    expect(
      (await ctx.http().patch(`/roles/${roleId}`).set(auth(t[RoleName.HOSPITAL_ADMIN])).send({ permissions: [] })).status,
    ).toBe(404);
  });

  it('still lets an admin manage users, which is genuinely enforced', async () => {
    const created = await ctx
      .http()
      .post('/users')
      .set(auth(t[RoleName.HOSPITAL_ADMIN]))
      .send({
        email: 'newnurse@e2e.health',
        password: 'Password123!',
        fullName: 'New Nurse',
        roles: [RoleName.NURSE_USER],
      })
      .expect(201);
    expect(created.body.roles).toEqual([RoleName.NURSE_USER]);

    // Role assignment takes effect because roles travel in the JWT.
    const session = await login(ctx, 'newnurse@e2e.health', 'Password123!');
    expect(session.user.permissions).toContain('ai:ask');
    expect(session.user.permissions).not.toContain('audit:read');

    await ctx
      .http()
      .post('/users')
      .set(auth(t[RoleName.NURSE_USER]))
      .send({ email: 'x@e2e.health', password: 'Password123!', fullName: 'X', roles: [] })
      .expect(403);
  });

  /**
   * AllExceptionsFilter used to emit the reason under `error` only, while the
   * web and mobile fetch wrappers — and Nest's own convention — read `message`.
   * Every rejection therefore reached the user as "Request failed (400)" with
   * the actual reason silently dropped. A browser test found this and no API
   * test could, because the API tests read the response body directly rather
   * than through a client. Both keys now carry the reason; this pins that.
   */
  it('puts the client-safe reason under `message`, not only `error`', async () => {
    const validation = await ctx
      .http()
      .post('/users')
      .set(auth(t[RoleName.HOSPITAL_ADMIN]))
      .send({
        email: 'not-an-email',
        password: 'x',
        fullName: 'Bad Input',
        roles: [RoleName.NURSE_USER],
      })
      .expect(400);
    expect(validation.body.message).toBeDefined();
    expect(JSON.stringify(validation.body.message)).toMatch(/email/i);
    expect(validation.body.error).toEqual(validation.body.message);

    const domain = await ctx
      .http()
      .post('/users')
      .set(auth(t[RoleName.HOSPITAL_ADMIN]))
      .send({
        email: ADMIN.email,
        password: 'Password123!',
        fullName: 'Duplicate',
        roles: [RoleName.NURSE_USER],
      })
      .expect(400);
    expect(domain.body.message).toBe('Email already registered');
  });
});

describe('Dose calculator safety gates over real HTTP', () => {
  let ctx: E2eContext;
  const t: Record<string, string> = {};
  let draftFormulaId: string;
  let approvedFormulaId: string;

  beforeAll(async () => {
    await migrateE2eDatabase();
    ctx = await createE2eApp();
    await truncateAll(ctx.dataSource);
    await seedRolesAndUsers(ctx.dataSource, [NURSE, PHARMACIST, MANAGER]);
    for (const u of [NURSE, PHARMACIST, MANAGER]) {
      t[u.role] = (await login(ctx, u.email, u.password)).accessToken;
    }

    const created = await ctx
      .http()
      .post('/dose/formulas')
      .set(auth(t[RoleName.PHARMACIST_REVIEWER]))
      .send({
        name: 'Paracetamol IV (pediatric, per dose)',
        drugName: 'Paracetamol',
        formulaType: DoseFormulaType.MG_PER_KG_PER_DOSE,
        dosePerKg: 15,
        maxSingleDose: 1000,
        unit: 'mg',
      })
      .expect(201);
    draftFormulaId = created.body.id;
  }, 120_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('refuses to calculate with a formula no pharmacist has approved', async () => {
    const res = await ctx
      .http()
      .post('/dose/calculate')
      .set(auth(t[RoleName.NURSE_USER]))
      .send({ formulaId: draftFormulaId, weightKg: 20 })
      .expect(400);
    expect(JSON.stringify(res.body)).toMatch(/not been approved/i);
  });

  it('lets only the pharmacist approve a formula', async () => {
    await ctx
      .http()
      .post(`/dose/formulas/${draftFormulaId}/approve`)
      .set(auth(t[RoleName.NURSING_KNOWLEDGE_MANAGER]))
      .expect(403);
    await ctx
      .http()
      .post(`/dose/formulas/${draftFormulaId}/approve`)
      .set(auth(t[RoleName.NURSE_USER]))
      .expect(403);

    const approved = await ctx
      .http()
      .post(`/dose/formulas/${draftFormulaId}/approve`)
      .set(auth(t[RoleName.PHARMACIST_REVIEWER]))
      .expect(201);
    expect(approved.body.status).toBe('APPROVED');
    approvedFormulaId = draftFormulaId;
  });

  it('calculates with step-by-step math and the verbatim Arabic safety warning', async () => {
    const res = await ctx
      .http()
      .post('/dose/calculate')
      .set(auth(t[RoleName.NURSE_USER]))
      .send({ formulaId: approvedFormulaId, weightKg: 20, concentrationMgPerMl: 10 })
      .expect(201);

    expect(res.body.finalDoseMg).toBe(300); // 15 mg/kg x 20 kg
    expect(res.body.volumeMl).toBe(30); // 300 mg / 10 mg/mL
    expect(res.body.steps.length).toBeGreaterThan(0);
    // Contractual string — asserted verbatim, not merely "contains Arabic".
    expect(res.body.safetyWarning).toBe(DOSE_SAFETY_WARNING_AR);
    expect(res.body.safetyWarning).toBe('لا يعتمد هذا الحساب دون مراجعة سريرية من المختص.');
  });

  it('caps at the maximum single dose and says so', async () => {
    const res = await ctx
      .http()
      .post('/dose/calculate')
      .set(auth(t[RoleName.NURSE_USER]))
      .send({ formulaId: approvedFormulaId, weightKg: 100 })
      .expect(201);

    expect(res.body.finalDoseMg).toBe(1000); // capped, not 1500
    expect(res.body.warnings.join(' ')).toMatch(/maximum single dose/i);
  });

  it('rejects an implausible weight through the validation pipe and the service', async () => {
    await ctx
      .http()
      .post('/dose/calculate')
      .set(auth(t[RoleName.NURSE_USER]))
      .send({ formulaId: approvedFormulaId, weightKg: -5 })
      .expect(400);
    await ctx
      .http()
      .post('/dose/calculate')
      .set(auth(t[RoleName.NURSE_USER]))
      .send({ formulaId: approvedFormulaId, weightKg: 900 })
      .expect(400);
  });

});
