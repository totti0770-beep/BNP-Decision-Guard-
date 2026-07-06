import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { permissionsForRoles, RoleName } from '@bnp/shared';
import { Role, User } from '../entities';
import { AuditService } from '../audit/audit.service';
import { loadEnv } from '../config/env';

export interface JwtPayload {
  sub: string;
  email: string;
  fullName: string;
  roles: string[];
  type: 'access' | 'refresh' | 'mfa' | 'reset';
  /** Present on refresh and reset tokens; must match the user's token_version. */
  tv?: number;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  private async validateUser(
    email: string,
    password: string,
    ip?: string,
  ): Promise<User> {
    const user = await this.users.findOne({ where: { email: email.toLowerCase() } });
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');

    // Per-account lockout gate: blocks even a correct password while active.
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      this.audit.record({
        actorId: user.id,
        actorEmail: user.email,
        action: 'AUTH:LOGIN_BLOCKED_LOCKED',
        ip,
      });
      throw new UnauthorizedException(
        'Account temporarily locked due to repeated failed logins. Try again later.',
      );
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      await this.registerFailedAttempt(user, ip);
      throw new UnauthorizedException('Invalid credentials');
    }
    return user;
  }

  /** Increments the failure counter and locks the account at the threshold. */
  private async registerFailedAttempt(user: User, ip?: string): Promise<void> {
    const { maxFailedAttempts, lockoutMinutes } = loadEnv().lockout;
    user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
    if (user.failedLoginAttempts >= maxFailedAttempts) {
      user.lockedUntil = new Date(Date.now() + lockoutMinutes * 60_000);
      user.failedLoginAttempts = 0;
      this.audit.record({
        actorId: user.id,
        actorEmail: user.email,
        action: 'AUTH:ACCOUNT_LOCKED',
        metadata: { lockoutMinutes },
        ip,
      });
    }
    await this.users.save(user);
  }

  /** Clears lockout state on any successful authentication. */
  private async clearLockout(user: User): Promise<void> {
    if (user.failedLoginAttempts !== 0 || user.lockedUntil !== null) {
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
    }
  }

  private issueTokens(user: User) {
    const roles = user.roles.map((r) => r.name);
    const base = {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      roles,
    };
    return {
      accessToken: this.jwt.sign(
        { ...base, type: 'access' },
        { expiresIn: process.env.JWT_EXPIRES_IN ?? '1h' },
      ),
      refreshToken: this.jwt.sign(
        { ...base, type: 'refresh', tv: user.tokenVersion ?? 0 },
        {
          secret: process.env.JWT_REFRESH_SECRET ?? 'change-me-too-in-production',
          expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
        },
      ),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        roles,
        permissions: permissionsForRoles(roles),
      },
    };
  }

  async login(email: string, password: string, ip?: string) {
    const user = await this.validateUser(email, password, ip);

    if (user.mfaEnabled) {
      // Correct password consumed the lockout risk; clear counters before the
      // second factor so a locked-out account isn't stuck after recovering.
      await this.clearLockout(user);
      await this.users.save(user);
      // Half-authenticated token; only exchangeable at /auth/mfa/verify.
      const mfaToken = this.jwt.sign(
        { sub: user.id, email: user.email, type: 'mfa' },
        { expiresIn: '5m' },
      );
      this.audit.record({
        actorId: user.id,
        actorEmail: user.email,
        action: 'AUTH:LOGIN_MFA_CHALLENGE',
        ip,
      });
      return { mfaRequired: true, mfaToken };
    }

    await this.clearLockout(user);
    user.lastLoginAt = new Date();
    await this.users.save(user);
    this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'AUTH:LOGIN',
      ip,
    });
    return { mfaRequired: false, ...this.issueTokens(user) };
  }

  async verifyMfa(mfaToken: string, code: string, ip?: string) {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(mfaToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA token');
    }
    if (payload.type !== 'mfa') throw new UnauthorizedException('Invalid MFA token');

    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user || !user.isActive || !user.mfaSecret)
      throw new UnauthorizedException('Invalid MFA state');

    if (!authenticator.verify({ token: code, secret: user.mfaSecret })) {
      this.audit.record({
        actorId: user.id,
        actorEmail: user.email,
        action: 'AUTH:MFA_FAILED',
        ip,
      });
      throw new UnauthorizedException('Invalid MFA code');
    }

    user.lastLoginAt = new Date();
    await this.users.save(user);
    this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'AUTH:LOGIN_MFA',
      ip,
    });
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET ?? 'change-me-too-in-production',
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.type !== 'refresh')
      throw new UnauthorizedException('Not a refresh token');
    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw new UnauthorizedException('User disabled');
    // Reject tokens issued before the latest logout / credential change.
    if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0))
      throw new UnauthorizedException('Refresh token has been revoked');
    return this.issueTokens(user);
  }

  /**
   * Revokes all outstanding refresh tokens for a user by bumping token_version.
   * Access tokens remain valid until their short expiry; refresh is blocked
   * immediately, so the session cannot be silently extended.
   */
  async logout(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) return { revoked: false };
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await this.users.save(user);
    this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'AUTH:LOGOUT',
    });
    return { revoked: true };
  }

  /**
   * Starts a password reset. Always returns the same shape regardless of
   * whether the email exists (no account enumeration). When the account does
   * exist, a short-lived reset token bound to the current token_version is
   * signed; outside production it is returned directly so the flow works
   * without an email provider. In production, wire an email sender here and
   * never return the token to the caller.
   */
  async forgotPassword(email: string, ip?: string) {
    const user = await this.users.findOne({
      where: { email: email.toLowerCase() },
    });
    if (user && user.isActive) {
      const resetToken = this.jwt.sign(
        { sub: user.id, email: user.email, type: 'reset', tv: user.tokenVersion ?? 0 },
        { expiresIn: `${loadEnv().passwordResetTokenMinutes}m` },
      );
      this.audit.record({
        actorId: user.id,
        actorEmail: user.email,
        action: 'AUTH:PASSWORD_RESET_REQUESTED',
        ip,
      });
      // TODO(prod): email the reset link instead of returning the token.
      const includeToken = process.env.NODE_ENV !== 'production';
      return { requested: true, ...(includeToken ? { resetToken } : {}) };
    }
    return { requested: true };
  }

  /**
   * Completes a password reset. The reset token must match the user's current
   * token_version, so a link is void once superseded by a logout, a prior
   * reset, or another password change. Completing the reset bumps
   * token_version again (invalidating the used token and all sessions) and
   * clears any lockout.
   */
  async resetPassword(token: string, newPassword: string, ip?: string) {
    if (newPassword.length < 8)
      throw new BadRequestException('Password must be at least 8 characters');

    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
    if (payload.type !== 'reset')
      throw new UnauthorizedException('Not a reset token');

    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user || !user.isActive)
      throw new UnauthorizedException('Invalid reset state');
    if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0))
      throw new UnauthorizedException('Reset token has been superseded');

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    await this.users.save(user);
    this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'AUTH:PASSWORD_RESET_COMPLETED',
      ip,
    });
    return { reset: true };
  }

  /** Self-registration always lands in the least-privileged NURSE_USER role. */
  async register(email: string, password: string, fullName: string, ip?: string) {
    const existing = await this.users.findOne({
      where: { email: email.toLowerCase() },
    });
    if (existing) throw new BadRequestException('Email already registered');
    if (password.length < 8)
      throw new BadRequestException('Password must be at least 8 characters');

    const nurseRole = await this.roles.findOne({
      where: { name: RoleName.NURSE_USER },
    });
    const user = await this.users.save(
      this.users.create({
        email: email.toLowerCase(),
        fullName,
        passwordHash: await bcrypt.hash(password, 10),
        roles: nurseRole ? [nurseRole] : [],
      }),
    );
    this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'AUTH:REGISTER',
      ip,
    });
    return this.issueTokens(user);
  }
}
