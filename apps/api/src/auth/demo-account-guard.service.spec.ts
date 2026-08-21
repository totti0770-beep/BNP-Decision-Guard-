import * as bcrypt from 'bcryptjs';
import { DEMO_ACCOUNTS } from '../seed/demo-accounts';

// `isProduction` is a module-load constant derived from NODE_ENV, so the
// environment has to be decided before the guard is imported. Each test
// re-imports through an isolated registry with the flag it needs.
function loadGuard(nodeEnv: string) {
  let service: {
    sweep: () => Promise<{ disabled: string[]; skipped: boolean }>;
    onApplicationBootstrap: () => Promise<void>;
  };
  const users = {
    rows: new Map<string, Record<string, unknown>>(),
    findOne: jest.fn(),
    save: jest.fn(),
    count: jest.fn().mockResolvedValue(1),
  };
  const audit = { record: jest.fn() };

  jest.isolateModules(() => {
    jest.doMock('../config/env', () => ({ isProduction: nodeEnv === 'production' }));
    const { DemoAccountGuardService } = require('./demo-account-guard.service');
    service = new DemoAccountGuardService(users, audit);
  });

  users.findOne.mockImplementation(async ({ where }: { where: { email: string } }) =>
    users.rows.get(where.email) ?? null,
  );
  users.save.mockImplementation(async (u: Record<string, unknown>) => u);

  return { service: service!, users, audit };
}

/** A stored user whose password really is the shipped default. */
async function defaultPasswordUser(email: string) {
  const account = DEMO_ACCOUNTS.find((a) => a.email === email)!;
  return {
    id: `id-${email}`,
    email,
    passwordHash: await bcrypt.hash(account.defaultPassword, 4),
    isActive: true,
    tokenVersion: 3,
  };
}

describe('DemoAccountGuardService', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ALLOW_DEMO_ACCOUNTS;
  });
  afterAll(() => {
    process.env = originalEnv;
  });

  it('disables a production account still using the published demo password', async () => {
    const { service, users, audit } = loadGuard('production');
    const user = await defaultPasswordUser('superadmin@bnp.health');
    users.rows.set(user.email, user);

    const { disabled } = await service.sweep();

    expect(disabled).toEqual(['superadmin@bnp.health']);
    expect(user.isActive).toBe(false);
    // Bumping token_version is what stops a session established before the
    // sweep from being silently extended past it.
    expect(user.tokenVersion).toBe(4);
    expect(users.save).toHaveBeenCalledWith(user);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SECURITY:DEMO_ACCOUNT_DISABLED',
        resourceId: 'id-superadmin@bnp.health',
      }),
    );
  });

  // The important one. A guard that disables correctly-provisioned accounts
  // is worse than no guard at all — it is an outage with a security label on
  // it, and it would fire on every boot.
  it('leaves an account whose password was rotated completely untouched', async () => {
    const { service, users, audit } = loadGuard('production');
    const user = {
      id: 'id-rotated',
      email: 'superadmin@bnp.health',
      passwordHash: await bcrypt.hash('a-real-rotated-secret-8Kd!', 4),
      isActive: true,
      tokenVersion: 3,
    };
    users.rows.set(user.email, user);

    const { disabled } = await service.sweep();

    expect(disabled).toEqual([]);
    expect(user.isActive).toBe(true);
    expect(user.tokenVersion).toBe(3);
    expect(users.save).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  // Same guarantee for the documented mitigation: an operator who set
  // SEED_PASSWORD_<ROLE> chose a real secret, and the guard must not treat
  // that account as compromised.
  it('does not disable an account seeded from a SEED_PASSWORD_ override', async () => {
    const { service, users } = loadGuard('production');
    users.rows.set('nurse@bnp.health', {
      id: 'id-nurse',
      email: 'nurse@bnp.health',
      passwordHash: await bcrypt.hash('operator-chosen-Passw0rd!', 4),
      isActive: true,
      tokenVersion: 0,
    });

    expect((await service.sweep()).disabled).toEqual([]);
  });

  it('does nothing outside production, where these accounts are the point', async () => {
    const { service, users } = loadGuard('development');
    const user = await defaultPasswordUser('nurse@bnp.health');
    users.rows.set(user.email, user);

    expect(await service.sweep()).toEqual({ disabled: [], skipped: true });
    expect(user.isActive).toBe(true);
  });

  it('honours ALLOW_DEMO_ACCOUNTS=true but leaves the account enabled', async () => {
    process.env.ALLOW_DEMO_ACCOUNTS = 'true';
    const { service, users } = loadGuard('production');
    const user = await defaultPasswordUser('nurse@bnp.health');
    users.rows.set(user.email, user);

    expect(await service.sweep()).toEqual({ disabled: [], skipped: true });
    expect(user.isActive).toBe(true);
  });

  it('skips an account that is already disabled rather than re-auditing it', async () => {
    const { service, users, audit } = loadGuard('production');
    const user = { ...(await defaultPasswordUser('nurse@bnp.health')), isActive: false };
    users.rows.set(user.email, user);

    expect((await service.sweep()).disabled).toEqual([]);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('sweeps every demo account, not just the first', async () => {
    const { service, users } = loadGuard('production');
    for (const account of DEMO_ACCOUNTS) {
      users.rows.set(account.email, await defaultPasswordUser(account.email));
    }

    const { disabled } = await service.sweep();

    expect(disabled).toEqual(DEMO_ACCOUNTS.map((a) => a.email));
  });

  // A failure in this control must not take the clinical API offline: that
  // would turn the protection into a denial of service against itself.
  it('never lets a database failure block startup', async () => {
    const { service, users } = loadGuard('production');
    users.findOne.mockRejectedValue(new Error('relation "users" does not exist'));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
