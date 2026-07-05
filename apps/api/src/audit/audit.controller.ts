import { Controller, Get, Query } from '@nestjs/common';
import { Permission } from '@bnp/shared';
import { Permissions } from '../common/decorators';
import { AuditService } from './audit.service';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Permissions(Permission.AUDIT_READ)
  find(
    @Query('action') action?: string,
    @Query('actorEmail') actorEmail?: string,
    @Query('resourceType') resourceType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.audit.find({
      action,
      actorEmail,
      resourceType,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }
}
