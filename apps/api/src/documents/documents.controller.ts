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
import { DocumentCategory, Permission, PhiProfile } from '@bnp/shared';
import {
  AuthenticatedUser,
  CurrentUser,
  Permissions,
  ScreenForPhi,
} from '../common/decorators';
import { DocumentsService } from './documents.service';
import { ApprovalService } from '../approval/approval.service';
import { InventoryService } from './inventory.service';
import { PAGE_INT } from '../common/pagination';

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
    private readonly inventory: InventoryService,
  ) {}

  @ScreenForPhi({
    body: ['title', 'description', 'changeNote'],
    profile: PhiProfile.METADATA,
  })
  @Post('upload')
  @Permissions(Permission.DOCUMENTS_UPLOAD)
  // 25 MB matches the cap the web upload screen enforces and advertises; the
  // two used to disagree (client 25 MB, server 50 MB), so a 40 MB file was
  // rejected by the browser but would have been accepted by the API.
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }),
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
    @Query('limit', PAGE_INT) limit?: number,
    @Query('offset', PAGE_INT) offset?: number,
  ) {
    return this.documents.findAll({ category, status, search, limit, offset });
  }

  /**
   * The clinical reference inventory: every ACTIVE document with the facts
   * that decide whether the assistant can cite it.
   *
   * Declared before `@Get(':id')` deliberately — Express matches in
   * declaration order, so below it the literal path would be taken as an id.
   *
   * `documents:read` is the right gate: every document fact here is already
   * on the /policies screen for the same holders. What it adds is the
   * indexing state next to them, which is what turns a list into an answer to
   * "can this actually be cited".
   */
  @Get('inventory')
  @Permissions(Permission.DOCUMENTS_READ)
  inventoryReport() {
    return this.inventory.build();
  }

  @Get(':id')
  @Permissions(Permission.DOCUMENTS_READ)
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.toDto(await this.documents.findOne(id));
  }

  @ScreenForPhi({
    body: ['title', 'description'],
    profile: PhiProfile.METADATA,
  })
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

  // The comment lands in two stores — document_approvals.comment and the
  // audit metadata written alongside it — so an identifier here is written
  // twice.
  @ScreenForPhi({ body: ['comment'], profile: PhiProfile.METADATA })
  @Post(':id/submit-review')
  @Permissions(Permission.DOCUMENTS_SUBMIT_REVIEW)
  submitReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.approval.submitReview(id, actor, dto.comment);
  }

  // The comment lands in two stores — document_approvals.comment and the
  // audit metadata written alongside it — so an identifier here is written
  // twice.
  @ScreenForPhi({ body: ['comment'], profile: PhiProfile.METADATA })
  @Post(':id/approve')
  @Permissions(Permission.DOCUMENTS_APPROVE)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.approval.approve(id, actor, dto.comment);
  }

  // The comment lands in two stores — document_approvals.comment and the
  // audit metadata written alongside it — so an identifier here is written
  // twice.
  @ScreenForPhi({ body: ['comment'], profile: PhiProfile.METADATA })
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

  // The comment lands in two stores — document_approvals.comment and the
  // audit metadata written alongside it — so an identifier here is written
  // twice.
  @ScreenForPhi({ body: ['comment'], profile: PhiProfile.METADATA })
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
