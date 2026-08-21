import { isProduction } from '../config/env';

/**
 * Refuse to create published demo credentials in a production database.
 *
 * The container gate is a raw shell compare on SEED_ON_BOOT
 * (`infra/docker/Dockerfile.api`) that never consults NODE_ENV, and the
 * compose default is `true` — so the only thing standing between the shipped
 * image and seven accounts with README-published passwords was an operator
 * remembering a flag. This is the second gate, in the code that does the
 * damage. `SEED_ALLOW_PRODUCTION=true` is the deliberate escape hatch for a
 * throwaway demo deployment holding no real data.
 */
export function assertSeedingAllowed(): void {
  if (!isProduction) return;
  if (process.env.SEED_ALLOW_PRODUCTION === 'true') {
    console.warn(
      '[seed] SEED_ALLOW_PRODUCTION=true: creating demo accounts in a ' +
        'production environment. Their passwords are published in README ' +
        'unless SEED_PASSWORD_<ROLE> overrides are set.',
    );
    return;
  }
  throw new Error(
    'Refusing to seed with NODE_ENV=production. The demo accounts this ' +
      'creates use passwords published in README.md. Provision a real ' +
      'administrator with `node dist/scripts/create-admin.js` instead, or ' +
      'set SEED_ALLOW_PRODUCTION=true if this deployment holds no real data.',
  );
}
