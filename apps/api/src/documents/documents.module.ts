import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document, DocumentApproval, DocumentVersion } from '../entities';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentUploadMiddleware } from './document-upload.middleware';
import { InventoryService } from './inventory.service';
import { ApprovalService } from '../approval/approval.service';
import { RagModule } from '../rag/rag.module';
import { FindingsModule } from '../findings/findings.module';

/** DocumentsModule also hosts the approval-workflow endpoints/services. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Document, DocumentVersion, DocumentApproval]),
    RagModule,
    FindingsModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, ApprovalService, InventoryService],
  exports: [DocumentsService, ApprovalService, InventoryService],
})
export class DocumentsModule implements NestModule {
  /**
   * The upload's multipart body is parsed here rather than by a
   * `FileInterceptor` on the route, because middleware runs before guards and
   * interceptors run after them — and `PhiScreenGuard` has to see the fields
   * it is declared to screen. See `document-upload.middleware.ts`.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(DocumentUploadMiddleware)
      .forRoutes({ path: 'documents/upload', method: RequestMethod.POST });
  }
}
