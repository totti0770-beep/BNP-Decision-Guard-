// Pin lockout threshold before AuthService first calls loadEnv().
process.env.AUTH_MAX_FAILED_ATTEMPTS = '3';
process.env.AUTH_LOCKOUT_MINUTES = '15';
delete process.env.NODE_ENV;
delete process.env.AUTH_DEV_RETURN_RESET_TOKEN;

import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
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
  const roles = { findOne: jest.fn() };
  const jwt = {
    sign: jest.fn(() => 'signed.jwt.token'),
    verify: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const service = new AuthService(
    users as never,
    roles as never,
    jwt as never,
    audit as never,
  );
  return { service, users, jwt, audit };
}

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
    try {
      let res: unknown;
      await jest.isolateModulesAsync(async () => {
        const { AuthService: ProdAuthService } = require('./auth.service');
        const user = makeUser();
        const service = new ProdAuthService(
          { findOne: jest.fn().mockResolvedValue(user), save: jest.fn(async (u: User) => u) },
          { findOne: jest.fn() },
          { sign: jest.fn(() => 'signed.jwt.token'), verify: jest.fn() },
          { record: jest.fn() },
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
    }
  });

  it('forgot-password on an unknown email still returns requested:true with no token', async () => {
    const { service } = makeService(null);
    const res = await service.forgotPassword('ghost@bnp.health');
    expect(res).toEqual({ requested: true });
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
