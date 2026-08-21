import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities';
import { loadEnv } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { DemoAccountGuardService } from './demo-account-guard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    PassportModule,
    // Registered lazily so the secret resolves through loadEnv() — the same
    // path JwtStrategy verifies with. A second inline `?? 'change-me-…'`
    // fallback here meant signing and verifying could disagree about which
    // secret was in force.
    JwtModule.registerAsync({ useFactory: () => ({ secret: loadEnv().jwt.secret }) }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, DemoAccountGuardService],
  exports: [AuthService],
})
export class AuthModule {}
