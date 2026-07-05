import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Permission } from '@bnp/shared';
import {
  AuthenticatedUser,
  CurrentUser,
  Permissions,
} from '../common/decorators';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Permissions(Permission.NOTIFICATIONS_READ)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.listForUser(user.userId);
  }

  @Post(':id/read')
  @Permissions(Permission.NOTIFICATIONS_READ)
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notifications.markRead(id, user.userId);
  }
}
