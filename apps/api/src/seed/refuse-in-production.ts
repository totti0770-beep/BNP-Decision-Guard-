import { assertSeedingAllowed } from './seed-policy';

/**
 * Imported for its side effect, and imported **first** by `seed.ts`.
 *
 * The policy check has to run before `AppModule` is loaded, because loading
 * that pulls in `config/env.ts`, whose production secret fail-fast throws
 * first. An operator who asked to seed a production database was therefore
 * told `JWT_SECRET must be set to a non-default value` — so they would supply
 * the secrets, run it again, and seed seven accounts with published passwords
 * into a live clinical system. The refusal has to be the first thing that
 * happens, not the second.
 *
 * Keep this import at the top of `seed.ts`, above `app.module`. It is why the
 * check lives in a module of its own rather than inside `main()`.
 */
assertSeedingAllowed();
