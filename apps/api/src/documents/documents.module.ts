import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document, DocumentApproval, DocumentVersion } from '../entities';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ApprovalService } from '../approval/approval.service';
import { RagModule } from '../rag/rag.module';

/** DocumentsModule also hosts the approval-workflow endpoints/services. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Document, DocumentVersion, DocumentApproval]),
    RagModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, ApprovalService],
  exports: [DocumentsService, ApprovalService],
})
export class DocumentsModule {}
