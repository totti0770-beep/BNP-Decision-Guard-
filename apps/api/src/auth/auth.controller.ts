import { Body, Controller, Ip, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
import {
  AuthenticatedUser,
  CurrentUser,
  Public,
} from '../common/decorators';
import { loadEnv } from '../config/env';
import { AuthService } from './auth.service';

// Stricter per-IP limit on credential endpoints to blunt brute-force attacks.
const AUTH_THROTTLE = {
  default: {
    ttl: loadEnv().rateLimit.ttlSeconds * 1000,
    limit: loadEnv().rateLimit.authLimit,
  },
};

class LoginDto {
  @IsEmail() email: string;
  @IsString() @IsNotEmpty() password: string;
}

class RefreshDto {
  @IsString() @IsNotEmpty() refreshToken: string;
}

class MfaVerifyDto {
  @IsString() @IsNotEmpty() mfaToken: string;
  @IsString() @IsNotEmpty() code: string;
}

class MfaEnableDto {
  @IsString() @IsNotEmpty() code: string;
}

class MfaDisableDto {
  @IsString() @IsNotEmpty() password: string;
}

class ForgotPasswordDto {
  @IsEmail() email: string;
}

class ResetPasswordDto {
  @IsString() @IsNotEmpty() token: string;
  @IsString() @MinLength(8) newPassword: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto.email, dto.password, ip);
  }

  // There is deliberately no public self-registration. This is a governed
  // clinical platform: accounts are provisioned by an administrator through
  // POST /users, which assigns roles explicitly. A public register endpoint
  // handed anyone who could reach the API a NURSE_USER account, and with it
  // ai:ask, ai:search, documents:read and dose:calculate over the hospital's
  // approved corpus.

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('mfa/verify')
  verifyMfa(@Body() dto: MfaVerifyDto, @Ip() ip: string) {
    return this.auth.verifyMfa(dto.mfaToken, dto.code, ip);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto, @Ip() ip: string) {
    return this.auth.forgotPassword(dto.email, ip);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto, @Ip() ip: string) {
    return this.auth.resetPassword(dto.token, dto.newPassword, ip);
  }

  @Post('logout')
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logout(user.userId);
  }

  // MFA enrolment is authenticated (no @Public()) and needs no @Permissions():
  // every signed-in user manages their own second factor, and each handler
  // acts only on the caller's own id from the JWT, never an id from the body.
  // Throttled like the credential endpoints — /mfa/enable and /mfa/disable
  // both check a secret, so they are guessable surfaces.

  @Throttle(AUTH_THROTTLE)
  @Post('mfa/enroll')
  enrollMfa(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    return this.auth.enrollMfa(user.userId, ip);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('mfa/enable')
  enableMfa(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MfaEnableDto,
    @Ip() ip: string,
  ) {
    return this.auth.enableMfa(user.userId, dto.code, ip);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('mfa/disable')
  disableMfa(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MfaDisableDto,
    @Ip() ip: string,
  ) {
    return this.auth.disableMfa(user.userId, dto.password, ip);
  }
}
