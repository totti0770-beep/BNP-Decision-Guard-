import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { RoleName, ROLE_DESCRIPTIONS, ROLE_PERMISSIONS } from '@bnp/shared';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../config/data-source';
import { PermissionEntity, Role, User } from '../entities';
import { DEMO_ACCOUNTS } from '../seed/demo-accounts';

/**
 * Break-glass: provision a real administrator without the seed.
 *
 * This exists because `DemoAccountGuardService` disables every account still
 * carrying a published demo password. On a deployment that was only ever
 * seeded, that is *all seven accounts* — so without a way back in, the fix for
 * the credential exposure would lock the hospital out of its own platform.
 *
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_NAME="..." \
 *     node dist/scripts/create-admin.js
 *
 * Creates a SUPER_ADMIN, or — if the email already exists — resets that
 * account's password, reactivates it and bumps `token_version` (revoking every
 * outstanding refresh token). Both paths are what an operator locked out
 * actually needs, and the reset path is the one that recovers a demo account
 * the guard just disabled.
 */

const MIN_PASSWORD_LENGTH = 12;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. Usage: ADMIN_EMAIL=… ADMIN_PASSWORD=… ADMIN_NAME=… node dist/scripts/create-admin.js`);
  }
  return value;
}

/**
 * Refuses weak or published passwords. A break-glass account is the single
 * most privileged credential in the system and is typically created in a
 * hurry, which is exactly when a weak one gets chosen.
 */
export function assertStrongPassword(password: string): void {
  const failures: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) {
    failures.push(`at least ${MIN_PASSWORD_LENGTH} characters (got ${password.length})`);
  }
  if (!/[a-z]/.test(password)) failures.push('a lowercase letter');
  if (!/[A-Z]/.test(password)) failures.push('an uppercase letter');
  if (!/\d/.test(password)) failures.push('a digit');
  if (!/[^A-Za-z0-9]/.test(password)) failures.push('a symbol');
  if (DEMO_ACCOUNTS.some((a) => a.defaultPassword === password)) {
    failures.push(
      'a password that is not one of the demo defaults published in this repository',
    );
  }
  if (failures.length > 0) {
    throw new Error(`ADMIN_PASSWORD must contain ${failures.join(', ')}.`);
  }
}

export interface ProvisionResult {
  outcome: 'CREATED' | 'RESET' | 'ALREADY_PROVISIONED';
}

/**
 * The actual provisioning, separated from env parsing so it can run against
 * a test database. Exported for the e2e suite; `main()` is the CLI shell.
 */
export async function provisionAdmin(
  ds: DataSource,
  opts: { email: string; password: string; fullName?: string },
): Promise<ProvisionResult> {
  const email = opts.email.toLowerCase();
  const { password } = opts;
  const fullName = opts.fullName?.trim() || 'Break-glass Administrator';
  assertStrongPassword(password);

  {
    const users = ds.getRepository(User);
    const roles = ds.getRepository(Role);
    const permissions = ds.getRepository(PermissionEntity);

    // The roles/permissions rows are a projection for the UI — authorization
    // comes from rbac.ts and the JWT — but a user with no role row has nothing
    // to show, so make sure SUPER_ADMIN exists before attaching it.
    let superAdmin = await roles.findOne({ where: { name: RoleName.SUPER_ADMIN } });
    if (!superAdmin) {
      const codes = ROLE_PERMISSIONS[RoleName.SUPER_ADMIN];
      const perms: PermissionEntity[] = [];
      for (const code of codes) {
        perms.push(
          (await permissions.findOne({ where: { code } })) ??
            (await permissions.save(permissions.create({ code }))),
        );
      }
      superAdmin = await roles.save(
        roles.create({
          name: RoleName.SUPER_ADMIN,
          description: ROLE_DESCRIPTIONS[RoleName.SUPER_ADMIN],
          permissions: perms,
        }),
      );
      console.log('Created the SUPER_ADMIN role.');
    }

    const existing = await users.findOne({ where: { email } });

    // Idempotent when nothing needs doing. The container runs this at every
    // boot while ADMIN_EMAIL/ADMIN_PASSWORD are set, and an unconditional
    // reset would bump token_version each deploy — revoking the
    // administrator's sessions as a side effect of releasing unrelated code.
    // "Nothing needs doing" is strict: same password, active, SUPER_ADMIN
    // attached. Anything else falls through to the reset below.
    if (
      existing &&
      existing.isActive &&
      existing.roles?.some((r) => r.name === RoleName.SUPER_ADMIN) &&
      (await bcrypt.compare(password, existing.passwordHash))
    ) {
      console.log(
        `${email} is already provisioned with this password — nothing to do.`,
      );
      return { outcome: 'ALREADY_PROVISIONED' };
    }

    const passwordHash = await bcrypt.hash(password, 10);
    if (existing) {
      existing.passwordHash = passwordHash;
      existing.isActive = true;
      existing.failedLoginAttempts = 0;
      existing.lockedUntil = null;
      existing.tokenVersion = (existing.tokenVersion ?? 0) + 1;
      existing.roles = [superAdmin];
      await users.save(existing);
      console.log(
        `Reset ${email}: password changed, account reactivated, SUPER_ADMIN ` +
          `attached, and all outstanding refresh tokens revoked.`,
      );
      // The password is never echoed — the operator already has it, and this
      // output goes to the deployment log.
      console.log('Sign in with the password you supplied, then rotate it from /users.');
      return { outcome: 'RESET' };
    }
    await users.save(
      users.create({ email, fullName, passwordHash, roles: [superAdmin], isActive: true }),
    );
    console.log(`Created SUPER_ADMIN ${email}.`);
    console.log('Sign in with the password you supplied, then rotate it from /users.');
    return { outcome: 'CREATED' };
  }
}

async function main() {
  const email = requiredEnv('ADMIN_EMAIL');
  const password = requiredEnv('ADMIN_PASSWORD');
  const fullName = process.env.ADMIN_NAME;

  const ds = await AppDataSource.initialize();
  try {
    await provisionAdmin(ds, { email, password, fullName });
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`create-admin failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
