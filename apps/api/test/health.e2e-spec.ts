import { createE2eApp, E2eContext, migrateE2eDatabase } from './support/e2e-app';

describe('Health endpoints over real HTTP', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    await migrateE2eDatabase();
    ctx = await createE2eApp();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('liveness is public and dependency-free', async () => {
    const res = await ctx.http().get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('readiness reports database and object storage as ok against a real stack', async () => {
    const res = await ctx.http().get('/health/ready').expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      dependencies: { database: 'ok', objectStorage: 'ok' },
      time: expect.any(String),
    });
  });
});
