import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { DocumentCategory, Permission } from '@bnp/shared';
import {
  AuthenticatedUser,
  CurrentUser,
  Permissions,
} from '../common/decorators';
import { DocumentsService } from './documents.service';
import { ApprovalService } from '../approval/approval.service';

class UploadDto {
  @IsString() @IsNotEmpty() title: string;
  @IsOptional() @IsString() description?: string;
  @IsEnum(DocumentCategory) category: DocumentCategory;
  @IsOptional() @IsString() expiryDate?: string;
  @IsOptional() @IsString() changeNote?: string;
  @IsOptional() @IsString() documentId?: string;
}

class UpdateDocumentDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() expiryDate?: string | null;
}

class CommentDto {
  @IsOptional() @IsString() comment?: string;
}

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly approval: ApprovalService,
  ) {}

  @Post('upload')
  @Permissions(Permission.DOCUMENTS_UPLOAD)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.documents.upload(file, dto, actor, dto.documentId);
  }

  @Get()
  @Permissions(Permission.DOCUMENTS_READ)
  findAll(
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.documents.findAll({
      category,
      status,
      search,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id')
  @Permissions(Permission.DOCUMENTS_READ)
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.toDto(await this.documents.findOne(id));
  }

  @Patch(':id')
  @Permissions(Permission.DOCUMENTS_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.documents.update(id, dto, actor);
  }

  @Get(':id/versions')
  @Permissions(Permission.DOCUMENTS_READ)
  versions(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.listVersions(id);
  }

  @Get(':id/download-url')
  @Permissions(Permission.DOCUMENTS_DOWNLOAD)
  downloadUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.documents.downloadUrl(id, actor);
  }

  @Get(':id/approval-history')
  @Permissions(Permission.DOCUMENTS_READ)
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.approval.history(id);
  }

  @Post(':id/submit-review')
  @Permissions(Permission.DOCUMENTS_SUBMIT_REVIEW)
  submitReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.approval.submitReview(id, actor, dto.comment);
  }

  @Post(':id/approve')
  @Permissions(Permission.DOCUMENTS_APPROVE)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.approval.approve(id, actor, dto.comment);
  }

  @Post(':id/reject')
  @Permissions(Permission.DOCUMENTS_APPROVE)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.approval.reject(id, actor, dto.comment);
  }

  @Post(':id/index')
  @Permissions(Permission.DOCUMENTS_INDEX)
  index(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.approval.index(id, actor);
  }

  @Post(':id/deactivate')
  @Permissions(Permission.DOCUMENTS_DEACTIVATE)
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.approval.deactivate(id, actor, dto.comment);
  }
}
