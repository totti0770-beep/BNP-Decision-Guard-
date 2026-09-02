import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document, Notification, User } from '../entities';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  // DocumentsModule exports ApprovalService, which owns every lifecycle
  // transition including the expiry the cron drives. The dependency is one-way:
  // DocumentsModule does not import this module.
  imports: [TypeOrmModule.forFeature([Notification, Document, User]), DocumentsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
