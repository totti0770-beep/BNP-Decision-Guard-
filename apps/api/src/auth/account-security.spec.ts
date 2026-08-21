// Pin lockout threshold before AuthService first calls loadEnv().
process.env.AUTH_MAX_FAILED_ATTEMPTS = '3';
process.env.AUTH_LOCKOUT_MINUTES = '15';
delete process.env.NODE_ENV;
delete process.env.AUTH_DEV_RETURN_RESET_TOKEN;

import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { AuthService } from './auth.service';
import { User } from '../entities';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    email: 'nurse@bnp.health',
    fullName: 'Nurse',
    passwordHash: bcrypt.hashSync('correct-password', 8),
    isActive: true,
    mfaEnabled: false,
    mfaSecret: null,
    tokenVersion: 0,
    failedLoginAttempts: 0,
    lockedUntil: null,
    roles: [{ id: 'r1', name: 'NURSE_USER', description: null } as never],
    ...overrides,
  } as User;
}

function makeService(user: User | null) {
  const users = {
    findOne: jest.fn().mockResolvedValue(user),
    save: jest.fn(async (u: User) => u),
  };
  const jwt = {
    sign: jest.fn(() => 'signed.jwt.token'),
    verify: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const mail = {
    name: 'smtp',
    sendQuietly: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AuthService(
    users as never,
    jwt as never,
    audit as never,
    mail as never,
  );
  return { service, users, jwt, audit, mail };
}

/** Delivery is fire-and-forget, so let its promise chain settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('Account lockout', () => {
  it('locks the account after the configured number of failed attempts', async () => {
    const user = makeUser();
    const { service, users } = makeService(user);

    // 3 wrong-password attempts (threshold = 3)
    for (let i = 0; i < 3; i++) {
      await expect(service.login('nurse@bnp.health', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
    }
    expect(user.lockedUntil).toBeInstanceOf(Date);
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    // counter resets to 0 once locked
    expect(user.failedLoginAttempts).toBe(0);
    expect(users.save).toHaveBeenCalled();
  });

  it('blocks even a correct password while locked', async () => {
    const user = makeUser({ lockedUntil: new Date(Date.now() + 60_000) });
    const { service } = makeService(user);
    await expect(
      service.login('nurse@bnp.health', 'correct-password'),
    ).rejects.toThrow(/locked/i);
  });

  it('clears lockout state on a successful login', async () => {
    const user = makeUser({ failedLoginAttempts: 2 });
    const { service } = makeService(user);
    const res = await service.login('nurse@bnp.health', 'correct-password');
    expect(res).toHaveProperty('accessToken');
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lockedUntil).toBeNull();
  });
});

describe('Password reset', () => {
  it('forgot-password NEVER returns the reset token by default', async () => {
    // Regression: the token used to be returned whenever NODE_ENV !== 'production'.
    // NODE_ENV is unset here — exactly the shipped-k8s case — and the public
    // endpoint must still disclose nothing, or knowing an email is enough to
    // take over the account.
    const user = makeUser();
    const { service } = makeService(user);
    const res = await service.forgotPassword('nurse@bnp.health');
    expect(res).toEqual({ requested: true });
    expect((res as any).resetToken).toBeUndefined();
  });

  it('returns the token only under the explicit local-demo opt-in', async () => {
    process.env.AUTH_DEV_RETURN_RESET_TOKEN = 'true';
    try {
      const { service } = makeService(makeUser());
      const res = await service.forgotPassword('nurse@bnp.health');
      expect((res as any).resetToken).toBe('signed.jwt.token');
    } finally {
      delete process.env.AUTH_DEV_RETURN_RESET_TOKEN;
    }
  });

  it('refuses the opt-in in production even when the flag is set', async () => {
    // `isProduction` is bound at module load, so reload the module graph with
    // NODE_ENV=production to exercise the second half of the guard.
    process.env.AUTH_DEV_RETURN_RESET_TOKEN = 'true';
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'test-non-default-secret';
    process.env.JWT_REFRESH_SECRET = 'test-non-default-refresh';
    process.env.POSTGRES_PASSWORD = 'test-non-default-db';
    process.env.S3_SECRET_KEY = 'test-non-default-s3';
    process.env.MAIL_PROVIDER = 'none'; // production must declare one
    try {
      let res: unknown;
      await jest.isolateModulesAsync(async () => {
        const { AuthService: ProdAuthService } = require('./auth.service');
        const user = makeUser();
        const service = new ProdAuthService(
          { findOne: jest.fn().mockResolvedValue(user), save: jest.fn(async (u: User) => u) },
          { sign: jest.fn(() => 'signed.jwt.token'), verify: jest.fn() },
          { record: jest.fn() },
          { name: 'smtp', sendQuietly: jest.fn().mockResolvedValue(undefined) },
        );
        res = await service.forgotPassword('nurse@bnp.health');
      });
      expect(res).toEqual({ requested: true });
    } finally {
      delete process.env.AUTH_DEV_RETURN_RESET_TOKEN;
      delete process.env.NODE_ENV;
      delete process.env.JWT_SECRET;
      delete process.env.JWT_REFRESH_SECRET;
      delete process.env.POSTGRES_PASSWORD;
      delete process.env.S3_SECRET_KEY;
      delete process.env.MAIL_PROVIDER;
    }
  });

  it('forgot-password on an unknown email still returns requested:true with no token', async () => {
    const { service, mail } = makeService(null);
    const res = await service.forgotPassword('ghost@bnp.health');
    expect(res).toEqual({ requested: true });
    await flush();
    expect(mail.sendQuietly).not.toHaveBeenCalled();
  });

  it('emails a reset link carrying the token to the account holder', async () => {
    const user = makeUser();
    const { service, mail } = makeService(user);
    await service.forgotPassword('nurse@bnp.health');
    await flush();

    expect(mail.sendQuietly).toHaveBeenCalledTimes(1);
    const message = mail.sendQuietly.mock.calls[0][0];
    expect(message.to).toBe('nurse@bnp.health');
    expect(message.text).toContain('/login/forgot?token=signed.jwt.token');
  });

  it('does not await delivery, so a slow relay cannot time the response', async () => {
    // sendQuietly already keeps the *status* uniform, but awaiting it would
    // still make a request for a real account take an SMTP round trip longer
    // than one for an address that does not exist — an enumeration oracle in
    // the timing rather than the body.
    const user = makeUser();
    const { service, mail } = makeService(user);
    let release: () => void = () => undefined;
    mail.sendQuietly.mockReturnValue(new Promise<void>((r) => { release = r; }));

    await expect(service.forgotPassword('nurse@bnp.health')).resolves.toEqual({
      requested: true,
    });
    release();
  });

  it('emails a reset link containing the token when the account exists', async () => {
    const { service, mail } = makeService(makeUser());
    await service.forgotPassword('nurse@bnp.health');
    expect(mail.sendQuietly).toHaveBeenCalledTimes(1);
    const sent = mail.sendQuietly.mock.calls[0][0];
    expect(sent.to).toBe('nurse@bnp.health');
    expect(sent.text).toContain('/login/forgot?token=signed.jwt.token');
  });

  it('sends no mail for an unknown account (no enumeration side channel)', async () => {
    const { service, mail } = makeService(null);
    await service.forgotPassword('ghost@bnp.health');
    expect(mail.sendQuietly).not.toHaveBeenCalled();
  });

  it('reset-password rejects a token whose token_version is stale', async () => {
    const user = makeUser({ tokenVersion: 2 });
    const { service, jwt } = makeService(user);
    jwt.verify.mockReturnValue({ sub: 'u1', type: 'reset', tv: 1 });
    await expect(
      service.resetPassword('token', 'new-strong-password'),
    ).rejects.toThrow(/superseded/i);
  });

  it('reset-password rotates the hash and bumps token_version, invalidating sessions', async () => {
    const user = makeUser({ tokenVersion: 3, lockedUntil: new Date(Date.now() + 60_000) });
    const { service, jwt } = makeService(user);
    jwt.verify.mockReturnValue({ sub: 'u1', type: 'reset', tv: 3 });
    const res = await service.resetPassword('token', 'new-strong-password');
    expect(res).toEqual({ reset: true });
    expect(user.tokenVersion).toBe(4); // bumped → old refresh/reset tokens void
    expect(user.lockedUntil).toBeNull();
    expect(bcrypt.compareSync('new-strong-password', user.passwordHash)).toBe(true);
  });
});

describe('MFA enrolment', () => {
  /** Derives a currently-valid TOTP code for a secret, like a real app would. */
  function currentCode(secret: string): string {
    return authenticator.generate(secret);
  }

  it('enroll stores a secret but leaves MFA off until a code is verified', async () => {
    const user = makeUser();
    const { service } = makeService(user);

    const res = await service.enrollMfa('u1');

    expect(res.secret).toEqual(expect.any(String));
    expect(res.otpauthUrl).toContain('otpauth://totp/');
    expect(res.otpauthUrl).toContain('BNP%20Decision%20Guard');
    expect(user.mfaSecret).toBe(res.secret);
    // The point of the two-step flow: a scanned-but-unconfirmed secret must
    // not start gating logins, or a bad scan locks the user out.
    expect(user.mfaEnabled).toBe(false);
  });

  it('refuses to re-enroll while MFA is on, which would lock the user out', async () => {
    // Overwriting the secret while mfaEnabled stays true would leave login
    // verifying against a secret the user's app has never seen.
    const user = makeUser({ mfaEnabled: true, mfaSecret: 'EXISTINGSECRET234' });
    const { service } = makeService(user);

    await expect(service.enrollMfa('u1')).rejects.toThrow(/already enabled/i);
    expect(user.mfaSecret).toBe('EXISTINGSECRET234');
  });

  it('enable turns MFA on when the code matches the enrolled secret', async () => {
    const user = makeUser();
    const { service, audit } = makeService(user);
    const { secret } = await service.enrollMfa('u1');

    const res = await service.enableMfa('u1', currentCode(secret));

    expect(res).toEqual({ mfaEnabled: true });
    expect(user.mfaEnabled).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH:MFA_ENABLED' }),
    );
  });

  it('enable rejects a wrong code and leaves MFA off', async () => {
    const user = makeUser();
    const { service } = makeService(user);
    await service.enrollMfa('u1');

    await expect(service.enableMfa('u1', '000000')).rejects.toThrow(/invalid mfa code/i);
    expect(user.mfaEnabled).toBe(false);
  });

  it('enable refuses when no enrolment has been started', async () => {
    const { service } = makeService(makeUser());
    await expect(service.enableMfa('u1', '123456')).rejects.toThrow(/enrol/i);
  });

  it('disable requires the account password, not just a session', async () => {
    const user = makeUser({ mfaEnabled: true, mfaSecret: 'EXISTINGSECRET234' });
    const { service } = makeService(user);

    // A stolen access token alone must not be enough to strip the 2nd factor.
    await expect(service.disableMfa('u1', 'wrong-password')).rejects.toThrow(
      /invalid password/i,
    );
    expect(user.mfaEnabled).toBe(true);
    expect(user.mfaSecret).toBe('EXISTINGSECRET234');
  });

  it('disable clears both the flag and the secret with the right password', async () => {
    const user = makeUser({ mfaEnabled: true, mfaSecret: 'EXISTINGSECRET234' });
    const { service } = makeService(user);

    const res = await service.disableMfa('u1', 'correct-password');

    expect(res).toEqual({ mfaEnabled: false });
    expect(user.mfaEnabled).toBe(false);
    expect(user.mfaSecret).toBeNull();
  });

  it('a full enroll -> enable cycle makes login demand the second factor', async () => {
    const user = makeUser();
    const { service } = makeService(user);
    const { secret } = await service.enrollMfa('u1');
    await service.enableMfa('u1', currentCode(secret));

    const result = await service.login('nurse@bnp.health', 'correct-password');

    expect(result).toMatchObject({ mfaRequired: true });
    expect(result).not.toHaveProperty('accessToken');
  });
});
