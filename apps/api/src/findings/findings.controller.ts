import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { Permission, PhiProfile } from '@bnp/shared';
import {
  AuthenticatedUser,
  CurrentUser,
  Permissions,
  ScreenForPhi,
} from '../common/decorators';
import { FindingsService } from './findings.service';

class JustificationDto {
  /**
   * Required, and required to say something. A waiver whose reason is "ok" is
   * a governance record that records nothing; the column is NOT NULL for the
   * same reason.
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(2000)
  justification: string;
}

/**
 * Read and settle pre-activation conflict findings.
 *
 * Mounted on its own path rather than inside DocumentsController: a route
 * under `documents/` would have to be declared above `@Get(':id')` to avoid
 * being parsed as a document id, and a second literal path competing for that
 * position is a trap the next person would have to rediscover.
 *
 * `justification` is free text that lands in the database, which is exactly
 * what PHI screening exists for. FREE_TEXT rather than METADATA because this
 * field invites a reviewer to explain a clinical judgement, and that is where
 * a patient identifier gets typed.
 */
@Controller()
export class FindingsController {
  constructor(private readonly findings: FindingsService) {}

  @Get('documents/:id/findings')
  @Permissions(Permission.FINDINGS_READ)
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.findings.listForDocument(id);
  }

  @ScreenForPhi({ body: ['justification'], profile: PhiProfile.FREE_TEXT })
  @Post('findings/:findingId/resolve')
  @Permissions(Permission.FINDINGS_RESOLVE)
  resolve(
    @Param('findingId', ParseUUIDPipe) findingId: string,
    @Body() dto: JustificationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.findings.resolve(findingId, actor, dto.justification);
  }

  @ScreenForPhi({ body: ['justification'], profile: PhiProfile.FREE_TEXT })
  @Post('findings/:findingId/dismiss')
  @Permissions(Permission.FINDINGS_RESOLVE)
  dismiss(
    @Param('findingId', ParseUUIDPipe) findingId: string,
    @Body() dto: JustificationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.findings.dismiss(findingId, actor, dto.justification);
  }

  /**
   * One of the two signatures a blocking waiver needs. Holding
   * FINDINGS_WAIVE_BLOCKING gets a caller to this handler; whether the
   * signature counts, and whether it completes the waiver, is decided on role
   * membership inside the service.
   */
  @ScreenForPhi({ body: ['justification'], profile: PhiProfile.FREE_TEXT })
  @Post('findings/:findingId/waive')
  @Permissions(Permission.FINDINGS_WAIVE_BLOCKING)
  waive(
    @Param('findingId', ParseUUIDPipe) findingId: string,
    @Body() dto: JustificationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.findings.waive(findingId, actor, dto.justification);
  }
}
