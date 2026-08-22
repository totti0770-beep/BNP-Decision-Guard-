import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadPolicy(nodeEnv: string) {
  let assertSeedingAllowed: () => void;
  jest.isolateModules(() => {
    jest.doMock('../config/env', () => ({ isProduction: nodeEnv === 'production' }));
    ({ assertSeedingAllowed } = require('./seed-policy'));
  });
  return assertSeedingAllowed!;
}

describe('assertSeedingAllowed', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SEED_ALLOW_PRODUCTION;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => {
    process.env = originalEnv;
  });

  it('refuses to seed a production database', () => {
    // The demo accounts carry passwords published in README.md, so creating
    // them in production is the credential exposure, not a step towards it.
    expect(() => loadPolicy('production')()).toThrow(/NODE_ENV=production/);
  });

  it('names the supported alternative in the refusal', () => {
    expect(() => loadPolicy('production')()).toThrow(/create-admin/);
  });

  it('seeds normally outside production', () => {
    expect(() => loadPolicy('development')()).not.toThrow();
    expect(() => loadPolicy('test')()).not.toThrow();
  });

  it('allows an explicit production opt-in, loudly', () => {
    process.env.SEED_ALLOW_PRODUCTION = 'true';
    expect(() => loadPolicy('production')()).not.toThrow();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('SEED_ALLOW_PRODUCTION=true'),
    );
  });

  it('treats any value other than "true" as not opted in', () => {
    for (const value of ['1', 'yes', 'TRUE', '']) {
      process.env.SEED_ALLOW_PRODUCTION = value;
      expect(() => loadPolicy('production')()).toThrow();
    }
  });
});

/**
 * The ordering is load-bearing and invisible: `assertSeedingAllowed()` has to
 * run before `app.module` is loaded, or `config/env.ts`'s secret fail-fast
 * throws first and the operator is told to set `JWT_SECRET` instead of being
 * told not to seed production at all. Nothing about the source makes that
 * obvious, and an import sorter would happily break it — so it is pinned here.
 */
describe('seed entrypoint ordering', () => {
  const source = readFileSync(join(__dirname, 'seed.ts'), 'utf8');
  const imports = [...source.matchAll(/^import .*?from '(.*?)';|^import '(.*?)';/gm)].map(
    (m) => m[1] ?? m[2],
  );

  it('refuses production before anything that can fail-fast on secrets', () => {
    expect(imports.indexOf('./refuse-in-production')).toBeLessThan(
      imports.indexOf('../app.module'),
    );
  });

  it('imports nothing but reflect-metadata ahead of the refusal', () => {
    expect(imports.slice(0, 2)).toEqual(['reflect-metadata', './refuse-in-production']);
  });
});
