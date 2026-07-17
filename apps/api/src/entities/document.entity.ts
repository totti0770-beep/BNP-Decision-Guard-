import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DocumentCategory, DocumentStatus, ApprovalAction } from '@bnp/shared';
import { User } from './user.entity';

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar' })
  category: DocumentCategory;

  @Column({ type: 'varchar', default: DocumentStatus.DRAFT })
  status: DocumentStatus;

  @Column({ name: 'version_number', default: 1 })
  versionNumber: number;

  @Column({ name: 'file_name' })
  fileName: string;

  @Column({ name: 'mime_type', default: 'application/pdf' })
  mimeType: string;

  @Column({ name: 'size_bytes', type: 'bigint', default: 0 })
  sizeBytes: string;

  @Column({ name: 'storage_key' })
  storageKey: string;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'uploaded_by_id' })
  uploadedBy: User | null;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'approved_by_id' })
  approvedBy: User | null;

  @Column({ name: 'approval_date', type: 'timestamptz', nullable: true })
  approvalDate: Date | null;

  @Column({ name: 'expiry_date', type: 'timestamptz', nullable: true })
  expiryDate: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('document_versions')
export class DocumentVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Document, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: Document;

  @Column({ name: 'document_id' })
  documentId: string;

  @Column({ name: 'version_number' })
  versionNumber: number;

  @Column({ name: 'file_name' })
  fileName: string;

  @Column({ name: 'size_bytes', type: 'bigint', default: 0 })
  sizeBytes: string;

  @Column({ name: 'storage_key' })
  storageKey: string;

  @Column({ name: 'change_note', type: 'text', nullable: true })
  changeNote: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

/**
 * Chunk rows carry a pgvector `embedding` column that is written and queried
 * via raw SQL in the RAG services; it is intentionally not mapped here.
 */
@Entity('document_chunks')
export class DocumentChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id' })
  documentId: string;

  @Column({ name: 'version_number', default: 1 })
  versionNumber: number;

  @Column({ name: 'chunk_index' })
  chunkIndex: number;

  @Column({ name: 'page_number', type: 'int', nullable: true })
  pageNumber: number | null;

  @Column({ type: 'text' })
  content: string;

  /** Name of the embedding provider that produced this chunk's vector. */
  @Column({ name: 'embedding_provider', default: 'mock-hash-embedding' })
  embeddingProvider: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('document_approvals')
export class DocumentApproval {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id' })
  documentId: string;

  @Column({ type: 'varchar' })
  action: ApprovalAction;

  @Column({ name: 'from_status', type: 'varchar' })
  fromStatus: DocumentStatus;

  @Column({ name: 'to_status', type: 'varchar' })
  toStatus: DocumentStatus;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'actor_id' })
  actor: User | null;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
