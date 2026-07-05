import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { DocumentCategory, DocumentStatus } from '@bnp/shared';
import { Document, DocumentVersion } from '../entities';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators';

export interface UploadDocumentInput {
  title: string;
  description?: string;
  category: DocumentCategory;
  expiryDate?: string;
  changeNote?: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document) private readonly documents: Repository<Document>,
    @InjectRepository(DocumentVersion)
    private readonly versions: Repository<DocumentVersion>,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  toDto(doc: Document) {
    return {
      id: doc.id,
      title: doc.title,
      description: doc.description,
      category: doc.category,
      status: doc.status,
      versionNumber: doc.versionNumber,
      fileName: doc.fileName,
      sizeBytes: Number(doc.sizeBytes),
      uploadedBy: doc.uploadedBy
        ? { id: doc.uploadedBy.id, fullName: doc.uploadedBy.fullName }
        : null,
      approvedBy: doc.approvedBy
        ? { id: doc.approvedBy.id, fullName: doc.approvedBy.fullName }
        : null,
      approvalDate: doc.approvalDate,
      expiryDate: doc.expiryDate,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async upload(
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    input: UploadDocumentInput,
    actor: AuthenticatedUser,
    existingDocumentId?: string,
  ) {
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Only PDF documents are accepted');
    }
    if (!Object.values(DocumentCategory).includes(input.category)) {
      throw new BadRequestException('Invalid document category');
    }

    await this.storage.ensureBucket();

    // Re-upload to an existing document creates a new version and resets the
    // lifecycle to DRAFT — a new version must be re-approved before the AI
    // can ever cite it.
    if (existingDocumentId) {
      const doc = await this.documents.findOne({ where: { id: existingDocumentId } });
      if (!doc) throw new NotFoundException('Document not found');
      const newVersion = doc.versionNumber + 1;
      const key = `documents/${doc.id}/v${newVersion}/${randomUUID()}.pdf`;
      await this.storage.upload(key, file.buffer, file.mimetype);

      doc.versionNumber = newVersion;
      doc.fileName = file.originalname;
      doc.sizeBytes = String(file.size);
      doc.storageKey = key;
      doc.status = DocumentStatus.DRAFT;
      doc.approvalDate = null;
      doc.approvedBy = null;
      if (input.title) doc.title = input.title;
      if (input.description !== undefined) doc.description = input.description;
      if (input.expiryDate !== undefined)
        doc.expiryDate = input.expiryDate ? new Date(input.expiryDate) : null;
      const saved = await this.documents.save(doc);

      await this.versions.save(
        this.versions.create({
          documentId: doc.id,
          versionNumber: newVersion,
          fileName: file.originalname,
          sizeBytes: String(file.size),
          storageKey: key,
          changeNote: input.changeNote ?? null,
          createdById: actor.userId,
        }),
      );
      this.audit.record({
        actorId: actor.userId,
        actorEmail: actor.email,
        action: 'DOCUMENTS:UPLOAD_NEW_VERSION',
        resourceType: 'document',
        resourceId: doc.id,
        metadata: { version: newVersion, fileName: file.originalname },
      });
      return this.toDto(saved);
    }

    const id = randomUUID();
    const key = `documents/${id}/v1/${randomUUID()}.pdf`;
    await this.storage.upload(key, file.buffer, file.mimetype);

    const doc = await this.documents.save(
      this.documents.create({
        id,
        title: input.title,
        description: input.description ?? null,
        category: input.category,
        status: DocumentStatus.DRAFT,
        versionNumber: 1,
        fileName: file.originalname,
        sizeBytes: String(file.size),
        storageKey: key,
        uploadedBy: { id: actor.userId } as never,
        expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
      }),
    );
    await this.versions.save(
      this.versions.create({
        documentId: doc.id,
        versionNumber: 1,
        fileName: file.originalname,
        sizeBytes: String(file.size),
        storageKey: key,
        changeNote: input.changeNote ?? 'Initial upload',
        createdById: actor.userId,
      }),
    );
    this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'DOCUMENTS:UPLOAD',
      resourceType: 'document',
      resourceId: doc.id,
      metadata: { title: doc.title, category: doc.category },
    });
    return this.toDto(doc);
  }

  async findAll(filter: {
    category?: string;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const qb = this.documents
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.uploadedBy', 'u')
      .leftJoinAndSelect('d.approvedBy', 'a')
      .orderBy('d.updatedAt', 'DESC');
    if (filter.category) qb.andWhere('d.category = :c', { c: filter.category });
    if (filter.status) qb.andWhere('d.status = :s', { s: filter.status });
    if (filter.search)
      qb.andWhere('(d.title ILIKE :q OR d.description ILIKE :q)', {
        q: `%${filter.search}%`,
      });
    qb.take(Math.min(filter.limit ?? 50, 200)).skip(filter.offset ?? 0);
    const [items, total] = await qb.getManyAndCount();
    return { items: items.map((d) => this.toDto(d)), total };
  }

  async findOne(id: string): Promise<Document> {
    const doc = await this.documents.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async update(
    id: string,
    input: { title?: string; description?: string; expiryDate?: string | null },
    actor: AuthenticatedUser,
  ) {
    const doc = await this.findOne(id);
    const changes: Record<string, unknown> = {};
    if (input.title !== undefined) {
      changes.title = { from: doc.title, to: input.title };
      doc.title = input.title;
    }
    if (input.description !== undefined) {
      changes.description = 'updated';
      doc.description = input.description;
    }
    if (input.expiryDate !== undefined) {
      changes.expiryDate = { from: doc.expiryDate, to: input.expiryDate };
      doc.expiryDate = input.expiryDate ? new Date(input.expiryDate) : null;
    }
    const saved = await this.documents.save(doc);
    this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'DOCUMENTS:UPDATE',
      resourceType: 'document',
      resourceId: id,
      metadata: changes,
    });
    return this.toDto(saved);
  }

  async listVersions(id: string) {
    await this.findOne(id);
    return this.versions.find({
      where: { documentId: id },
      order: { versionNumber: 'DESC' },
    });
  }

  async downloadUrl(id: string, actor: AuthenticatedUser) {
    const doc = await this.findOne(id);
    const url = await this.storage.presignedDownloadUrl(doc.storageKey);
    this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'DOCUMENTS:DOWNLOAD',
      resourceType: 'document',
      resourceId: id,
    });
    return { url, expiresInSeconds: 300 };
  }
}
