import { Controller, Get, Query } from '@nestjs/common';
import { Permission } from '@bnp/shared';
import { Permissions } from '../common/decorators';
import { AuditService } from './audit.service';
import { PAGE_INT } from '../common/pagination';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Permissions(Permission.AUDIT_READ)
  find(
    @Query('action') action?: string,
    @Query('actorEmail') actorEmail?: string,
    @Query('resourceType') resourceType?: string,
    @Query('limit', PAGE_INT) limit?: number,
    @Query('offset', PAGE_INT) offset?: number,
  ) {
    return this.audit.find({ action, actorEmail, resourceType, limit, offset });
  }
}
