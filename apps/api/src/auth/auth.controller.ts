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

class RegisterDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsString() @IsNotEmpty() fullName: string;
}

class RefreshDto {
  @IsString() @IsNotEmpty() refreshToken: string;
}

class MfaVerifyDto {
  @IsString() @IsNotEmpty() mfaToken: string;
  @IsString() @IsNotEmpty() code: string;
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

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  register(@Body() dto: RegisterDto, @Ip() ip: string) {
    return this.auth.register(dto.email, dto.password, dto.fullName, ip);
  }

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

  @Post('logout')
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logout(user.userId);
  }
}
