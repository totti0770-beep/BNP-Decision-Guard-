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

export interface JwtPayload {
  sub: string;
  email: string;
  fullName: string;
  roles: string[];
  type: 'access' | 'refresh' | 'mfa';
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  private async validateUser(email: string, password: string): Promise<User> {
    const user = await this.users.findOne({ where: { email: email.toLowerCase() } });
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    return user;
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
        { ...base, type: 'refresh' },
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
    const user = await this.validateUser(email, password);

    if (user.mfaEnabled) {
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
    return this.issueTokens(user);
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
