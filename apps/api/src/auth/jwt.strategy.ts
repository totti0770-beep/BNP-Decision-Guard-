import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { permissionsForRoles } from '@bnp/shared';
import { AuthenticatedUser } from '../common/decorators';
import { JwtPayload } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? 'change-me-in-production',
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Access token required');
    }
    return {
      userId: payload.sub,
      email: payload.email,
      fullName: payload.fullName,
      roles: payload.roles ?? [],
      permissions: permissionsForRoles(payload.roles ?? []),
    };
  }
}
