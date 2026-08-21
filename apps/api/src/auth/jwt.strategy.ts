import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { permissionsForRoles } from '@bnp/shared';
import { AuthenticatedUser } from '../common/decorators';
import { loadEnv } from '../config/env';
import { JwtPayload } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Through loadEnv(), not process.env directly. The inline fallback here
      // resolved to the well-known literal from this public repository
      // whenever JWT_SECRET was unset — and unset never fails the boot outside
      // production, so any environment not exactly labelled `production` had a
      // forgeable token system. loadEnv() is the single resolution path and
      // the only one that fail-fasts.
      secretOrKey: loadEnv().jwt.secret,
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
