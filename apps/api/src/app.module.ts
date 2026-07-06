import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDataSourceOptions } from './config/data-source';
import { loadEnv } from './config/env';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { StorageModule } from './storage/storage.module';
import { DocumentsModule } from './documents/documents.module';
import { RagModule } from './rag/rag.module';
import { ChatModule } from './chat/chat.module';
import { DoseCalculatorModule } from './dose/dose.module';
import { AuditLogModule } from './audit/audit.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { SettingsModule } from './settings/settings.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(buildDataSourceOptions()),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: loadEnv().rateLimit.ttlSeconds * 1000,
        limit: loadEnv().rateLimit.limit,
      },
    ]),
    AuditLogModule,
    StorageModule,
    AuthModule,
    UsersModule,
    RolesModule,
    DocumentsModule,
    RagModule,
    ChatModule,
    DoseCalculatorModule,
    AnalyticsModule,
    SettingsModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Rate limiting runs before auth so unauthenticated floods (e.g. login
    // brute-force) are throttled at the edge.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
