import { Body, Controller, Ip, Post } from '@nestjs/common';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { Public } from '../common/decorators';
import { AuthService } from './auth.service';

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
  @Post('login')
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto.email, dto.password, ip);
  }

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto, @Ip() ip: string) {
    return this.auth.register(dto.email, dto.password, dto.fullName, ip);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('mfa/verify')
  verifyMfa(@Body() dto: MfaVerifyDto, @Ip() ip: string) {
    return this.auth.verifyMfa(dto.mfaToken, dto.code, ip);
  }
}
