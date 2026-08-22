import * as bcrypt from 'bcryptjs';
import { RoleName } from '@bnp/shared';
import { provisionAdmin } from '../src/scripts/create-admin';
import { User } from '../src/entities';
import {
  createE2eApp,
  E2eContext,
  migrateE2eDatabase,
  seedRolesAndUsers,
  truncateAll,
} from './support/e2e-app';

const EMAIL = 'admin@bnp.health';
const PASSWORD = 'Br3ak-Glass-Recovery!';

/**
 * The container runs create-admin at every boot while ADMIN_EMAIL and
 * ADMIN_PASSWORD are set, so its idempotency is not a nicety — without it,
 * every deploy revokes the administrator's sessions (token_version bump) as
 * a side effect of releasing unrelated code. These run against the real
 * database because the role/permission bootstrap and the eager roles
 * relation are exactly the parts a mocked repository would fake away.
 */
describe('provisionAdmin (break-glass)', () => {
  let ctx: E2eContext;

  const load = () =>
    ctx.dataSource.getRepository(User).findOneOrFail({ where: { email: EMAIL } });

  beforeAll(async () => {
    await migrateE2eDatabase();
    ctx = await createE2eApp();
  });

  beforeEach(async () => {
    await truncateAll(ctx.dataSource);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('creates a SUPER_ADMIN, bootstrapping the role rows on an empty database', async () => {
    const result = await provisionAdmin(ctx.dataSource, {
      email: EMAIL,
      password: PASSWORD,
    });

    expect(result.outcome).toBe('CREATED');
    const user = await load();
    expect(user.isActive).toBe(true);
    expect(user.roles.map((r) => r.name)).toEqual([RoleName.SUPER_ADMIN]);
    expect(await bcrypt.compare(PASSWORD, user.passwordHash)).toBe(true);
  });

  it('is a no-op on the boot after the one that provisioned', async () => {
    await provisionAdmin(ctx.dataSource, { email: EMAIL, password: PASSWORD });
    const before = await load();

    const again = await provisionAdmin(ctx.dataSource, {
      email: EMAIL,
      password: PASSWORD,
    });

    expect(again.outcome).toBe('ALREADY_PROVISIONED');
    const after = await load();
    // The load-bearing assertion: no token revocation, no re-hash.
    expect(after.tokenVersion).toBe(before.tokenVersion);
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it('rescues a demo account the sweep disabled', async () => {
    await seedRolesAndUsers(ctx.dataSource, [
      { email: EMAIL, password: 'HospAdmin123!', role: RoleName.HOSPITAL_ADMIN },
    ]);
    const users = ctx.dataSource.getRepository(User);
    const seeded = await users.findOneOrFail({ where: { email: EMAIL } });
    seeded.isActive = false; // what DemoAccountGuardService leaves behind
    seeded.tokenVersion = 5;
    await users.save(seeded);

    const result = await provisionAdmin(ctx.dataSource, {
      email: EMAIL,
      password: PASSWORD,
    });

    expect(result.outcome).toBe('RESET');
    const user = await load();
    expect(user.isActive).toBe(true);
    expect(user.roles.map((r) => r.name)).toEqual([RoleName.SUPER_ADMIN]);
    // Outstanding tokens from before the rescue stay revoked.
    expect(user.tokenVersion).toBe(6);
    expect(await bcrypt.compare(PASSWORD, user.passwordHash)).toBe(true);
    expect(await bcrypt.compare('HospAdmin123!', user.passwordHash)).toBe(false);
  });

  it('refuses a published demo password even here', async () => {
    await expect(
      provisionAdmin(ctx.dataSource, { email: EMAIL, password: 'SuperAdmin123!' }),
    ).rejects.toThrow(/published in this repository/);
  });
});
