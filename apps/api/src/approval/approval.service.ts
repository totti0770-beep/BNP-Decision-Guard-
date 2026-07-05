import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApprovalAction, DocumentStatus } from '@bnp/shared';
import { Document, DocumentApproval } from '../entities';
import { DocumentsService } from '../documents/documents.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators';
import { IndexingService } from '../rag/indexing.service';

/**
 * Document lifecycle state machine:
 * DRAFT -> IN_REVIEW -> APPROVED -> (index) -> ACTIVE
 * Any state -> REJECTED / INACTIVE; expiry cron moves ACTIVE -> EXPIRED.
 * Only ACTIVE documents are visible to AI retrieval.
 */
const TRANSITIONS: Record<ApprovalAction, DocumentStatus[]> = {
  [ApprovalAction.SUBMIT_REVIEW]: [DocumentStatus.DRAFT, DocumentStatus.REJECTED],
  [ApprovalAction.APPROVE]: [DocumentStatus.IN_REVIEW],
  [ApprovalAction.REJECT]: [DocumentStatus.IN_REVIEW],
  [ApprovalAction.INDEX]: [DocumentStatus.APPROVED, DocumentStatus.INDEXED],
  [ApprovalAction.ACTIVATE]: [DocumentStatus.INDEXED],
  [ApprovalAction.DEACTIVATE]: [
    DocumentStatus.ACTIVE,
    DocumentStatus.APPROVED,
    DocumentStatus.INDEXED,
    DocumentStatus.EXPIRED,
  ],
  [ApprovalAction.EXPIRE]: [DocumentStatus.ACTIVE],
};

@Injectable()
export class ApprovalService {
  constructor(
    @InjectRepository(Document) private readonly documents: Repository<Document>,
    @InjectRepository(DocumentApproval)
    private readonly approvals: Repository<DocumentApproval>,
    private readonly documentsService: DocumentsService,
    private readonly indexing: IndexingService,
    private readonly audit: AuditService,
  ) {}

  private async transition(
    doc: Document,
    action: ApprovalAction,
    toStatus: DocumentStatus,
    actor: AuthenticatedUser,
    comment?: string,
  ) {
    const allowedFrom = TRANSITIONS[action];
    if (!allowedFrom.includes(doc.status)) {
      throw new BadRequestException(
        `Cannot ${action} a document in status ${doc.status}`,
      );
    }
    const fromStatus = doc.status;
    doc.status = toStatus;
    await this.documents.save(doc);
    await this.approvals.save(
      this.approvals.create({
        documentId: doc.id,
        action,
        fromStatus,
        toStatus,
        actor: { id: actor.userId } as never,
        comment: comment ?? null,
      }),
    );
    this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: `DOCUMENTS:${action}`,
      resourceType: 'document',
      resourceId: doc.id,
      metadata: { fromStatus, toStatus, comment },
    });
  }

  async submitReview(id: string, actor: AuthenticatedUser, comment?: string) {
    const doc = await this.documentsService.findOne(id);
    await this.transition(doc, ApprovalAction.SUBMIT_REVIEW, DocumentStatus.IN_REVIEW, actor, comment);
    return this.documentsService.toDto(doc);
  }

  async approve(id: string, actor: AuthenticatedUser, comment?: string) {
    const doc = await this.documentsService.findOne(id);
    doc.approvedBy = { id: actor.userId } as never;
    doc.approvalDate = new Date();
    await this.transition(doc, ApprovalAction.APPROVE, DocumentStatus.APPROVED, actor, comment);
    return this.documentsService.toDto(doc);
  }

  async reject(id: string, actor: AuthenticatedUser, comment?: string) {
    const doc = await this.documentsService.findOne(id);
    await this.transition(doc, ApprovalAction.REJECT, DocumentStatus.REJECTED, actor, comment);
    return this.documentsService.toDto(doc);
  }

  /**
   * Runs the RAG ingestion pipeline (extract -> chunk -> embed -> pgvector)
   * and activates the document so it becomes retrievable.
   */
  async index(id: string, actor: AuthenticatedUser) {
    const doc = await this.documentsService.findOne(id);
    if (![DocumentStatus.APPROVED, DocumentStatus.INDEXED].includes(doc.status)) {
      throw new BadRequestException(
        `Only APPROVED documents can be indexed (current: ${doc.status})`,
      );
    }
    const { chunkCount } = await this.indexing.indexDocument(doc);
    await this.transition(doc, ApprovalAction.INDEX, DocumentStatus.INDEXED, actor);
    await this.transition(doc, ApprovalAction.ACTIVATE, DocumentStatus.ACTIVE, actor);
    return { ...this.documentsService.toDto(doc), chunkCount };
  }

  /** Removes the document from AI retrieval and deletes its vector index. */
  async deactivate(id: string, actor: AuthenticatedUser, comment?: string) {
    const doc = await this.documentsService.findOne(id);
    await this.transition(doc, ApprovalAction.DEACTIVATE, DocumentStatus.INACTIVE, actor, comment);
    await this.indexing.removeDocumentChunks(id);
    return this.documentsService.toDto(doc);
  }

  async history(id: string) {
    await this.documentsService.findOne(id);
    const items = await this.approvals.find({
      where: { documentId: id },
      order: { createdAt: 'ASC' },
    });
    return items.map((a) => ({
      id: a.id,
      action: a.action,
      fromStatus: a.fromStatus,
      toStatus: a.toStatus,
      actor: a.actor ? { id: a.actor.id, fullName: a.actor.fullName } : null,
      comment: a.comment,
      createdAt: a.createdAt,
    }));
  }
}
