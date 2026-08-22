import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../entities';
import { AuditService } from '../audit/audit.service';
import { isProduction } from '../config/env';
import { DEMO_ACCOUNTS } from '../seed/demo-accounts';

/** Set to `true` to keep published demo passwords usable in production. */
export const ALLOW_DEMO_ACCOUNTS_VAR = 'ALLOW_DEMO_ACCOUNTS';

/**
 * Disables, at every production boot, any account still using one of the
 * demo passwords published in this repository.
 *
 * The problem it solves is real rather than theoretical: the seed is
 * skip-if-present, so an environment that was seeded once keeps those accounts
 * — including `superadmin@bnp.health` — for the lifetime of the database, and
 * their passwords are in `README.md`.
 *
 * Two alternatives were considered and rejected:
 *
 * - *Refuse to boot.* Takes a live clinical assistant offline, which has its
 *   own patient-safety cost, and does so on every deploy until someone with
 *   database access intervenes.
 * - *Warn only.* Leaves the hole open and adds a line to a log nobody reads.
 *
 * Disabling the specific accounts is the narrowest action that actually closes
 * it, and it **cannot false-positive**: the comparison is against the shipped
 * literal, so an account whose password was rotated — including one seeded
 * from a `SEED_PASSWORD_*` override — simply does not match and is untouched.
 *
 * It runs in production only. Development and test environments seed and use
 * these accounts by design.
 */
@Injectable()
export class DemoAccountGuardService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoAccountGuardService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.sweep();
    } catch (err) {
      // A failure here must not take the API down — that would hand an
      // attacker a denial of service via the very control meant to protect
      // the accounts. Loudly logged instead, so it is visibly unenforced.
      this.logger.error(
        `Demo-account check did not complete: ${err}. Published demo ` +
          `passwords may still be usable — verify manually.`,
      );
    }
  }

  /** Exposed for tests; `onApplicationBootstrap` is the only production caller. */
  async sweep(): Promise<{ disabled: string[]; skipped: boolean }> {
    if (!isProduction) return { disabled: [], skipped: true };

    if (process.env[ALLOW_DEMO_ACCOUNTS_VAR] === 'true') {
      this.logger.error(
        `${ALLOW_DEMO_ACCOUNTS_VAR}=true — accounts using the published demo ` +
          `passwords are being left ENABLED in production. Anyone who can read ` +
          `this repository can sign in, including as SUPER_ADMIN. Unset this ` +
          `variable unless this deployment holds no real patient data.`,
      );
      return { disabled: [], skipped: true };
    }

    const disabled: string[] = [];
    for (const account of DEMO_ACCOUNTS) {
      const user = await this.users.findOne({ where: { email: account.email } });
      if (!user || !user.isActive) continue;
      if (!(await bcrypt.compare(account.defaultPassword, user.passwordHash))) {
        continue; // rotated — this is a legitimately provisioned account
      }

      user.isActive = false;
      // Revokes every outstanding refresh token for this account, so a session
      // established before the sweep cannot be silently extended past it.
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
      await this.users.save(user);
      disabled.push(user.email);

      this.audit.record({
        actorId: null,
        actorEmail: null,
        action: 'SECURITY:DEMO_ACCOUNT_DISABLED',
        resourceType: 'User',
        resourceId: user.id,
        // The password is never recorded — only that it matched a default.
        metadata: { email: user.email, reason: 'default demo password in production' },
      });
      this.logger.error(
        `Disabled "${user.email}": it was still using the demo password ` +
          `published in this repository.`,
      );
    }

    if (disabled.length > 0) {
      const remaining = await this.users.count({ where: { isActive: true } });
      this.logger.error(
        `Disabled ${disabled.length} demo account(s) in production. ` +
          `${remaining} active account(s) remain. ` +
          (remaining === 0
            ? 'NO ONE CAN SIGN IN — provision a real administrator with ' +
              '`node dist/scripts/create-admin.js`.'
            : 'Provision replacements with `node dist/scripts/create-admin.js` ' +
              'if any of these were in use.'),
      );
    }
    return { disabled, skipped: false };
  }
}
