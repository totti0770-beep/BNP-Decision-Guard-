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
}
