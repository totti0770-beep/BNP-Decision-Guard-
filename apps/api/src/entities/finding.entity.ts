import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FindingAction, FindingSeverity, FindingStatus } from '@bnp/shared';
import { User } from './user.entity';

/**
 * Something a deterministic check noticed in a document while it sat in
 * review. See migration 1720000006000 for why `versionNumber` and
 * `fingerprint` are shaped the way they are.
 */
@Entity('review_findings')
export class ReviewFinding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id' })
  documentId: string;

  /**
   * The document version this was found in. Whether the finding still blocks
   * approval is this column compared against `documents.version_number` in
   * ConflictGateService's WHERE clause — not the `status` below.
   */
  @Column({ name: 'version_number' })
  versionNumber: number;

  @Column({ name: 'rule_code' })
  ruleCode: string;

  @Column({ default: 'L1' })
  layer: string;

  @Column({ type: 'varchar' })
  severity: FindingSeverity;

  @Column({ type: 'varchar', default: FindingStatus.OPEN })
  status: FindingStatus;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  detail: string | null;

  /** Rule code plus normalised locus; makes re-scanning a version idempotent. */
  @Column()
  fingerprint: string;

  @Column({ name: 'superseded_by_version', type: 'int', nullable: true })
  supersededByVersion: number | null;

  @Column({ name: 'detected_at', type: 'timestamptz', default: () => 'now()' })
  detectedAt: Date;

  @OneToMany(() => FindingEvidence, (e) => e.finding)
  evidence: FindingEvidence[];

  @OneToMany(() => FindingResolution, (r) => r.finding)
  resolutions: FindingResolution[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

/**
 * Where in the document the finding was seen. A table rather than a jsonb
 * column because several rules compare two places in a document — a page
 * count against its footer, a cover version against a trailer — and the
 * finding is inherently "here *and* here". `locusIndex` orders them.
 */
@Entity('finding_evidence')
export class FindingEvidence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ReviewFinding, (f) => f.evidence, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'finding_id' })
  finding: ReviewFinding;

  @Column({ name: 'finding_id' })
  findingId: string;

  @Column({ name: 'page_number', type: 'int', nullable: true })
  pageNumber: number | null;

  @Column({ name: 'locus_index', default: 0 })
  locusIndex: number;

  /**
   * Verbatim text lifted out of the PDF, capped at 240 characters by the
   * column. PhiScreenGuard screens request bodies only, so nothing screens
   * what the scanner copies out of a document into this new store.
   */
  @Column()
  snippet: string;

  @Column({ name: 'char_start', type: 'int', nullable: true })
  charStart: number | null;

  @Column({ name: 'char_end', type: 'int', nullable: true })
  charEnd: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

/**
 * One signature on one finding. Waiving a BLOCKING finding needs two of these
 * covering two different roles; see FindingsService.waive().
 */
@Entity('finding_resolutions')
export class FindingResolution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ReviewFinding, (f) => f.resolutions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'finding_id' })
  finding: ReviewFinding;

  @Column({ name: 'finding_id' })
  findingId: string;

  @Column({ type: 'varchar' })
  action: FindingAction;

  @ManyToOne(() => User, { nullable: false, eager: true })
  @JoinColumn({ name: 'actor_id' })
  actor: User;

  @Column({ name: 'actor_id' })
  actorId: string;

  /**
   * The authority actually exercised, resolved from the database at signing
   * time and frozen here. Deriving it later would let a role change rewrite
   * who was authorised to sign what.
   */
  @Column({ name: 'actor_role' })
  actorRole: string;

  @Column({ type: 'text' })
  justification: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
