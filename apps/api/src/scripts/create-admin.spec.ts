import { assertStrongPassword } from './create-admin';
import { DEMO_ACCOUNTS } from '../seed/demo-accounts';

/**
 * The break-glass script is the one credential that exists specifically
 * because the demo passwords were weak and public. Letting it accept a weak
 * or published password would reintroduce the hole it was written to close.
 */
describe('create-admin password policy', () => {
  it('accepts a strong password', () => {
    expect(() => assertStrongPassword('Kh4lid-Recovery!2026')).not.toThrow();
  });

  it.each([
    ['too short', 'Ab1!xyz'],
    ['no uppercase', 'lowercase-only-1!'],
    ['no lowercase', 'UPPERCASE-ONLY-1!'],
    ['no digit', 'NoDigitsInHere!!'],
    ['no symbol', 'NoSymbolsInHere1'],
  ])('rejects a password with %s', (_reason, password) => {
    expect(() => assertStrongPassword(password)).toThrow(/ADMIN_PASSWORD/);
  });

  // Every one of these is in README.md. A recovery account using one would be
  // no better than the account it is recovering.
  it.each(DEMO_ACCOUNTS.map((a) => [a.role, a.defaultPassword]))(
    'rejects the published %s demo password',
    (_role, password) => {
      expect(() => assertStrongPassword(password)).toThrow(/published in this repository/);
    },
  );

  it('reports every failed rule at once rather than one per attempt', () => {
    expect(() => assertStrongPassword('short')).toThrow(
      /at least 12 characters.*uppercase.*digit.*symbol/s,
    );
  });
});
