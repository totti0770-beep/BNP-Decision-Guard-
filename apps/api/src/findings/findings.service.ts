import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { FindingAction, FindingSeverity, FindingStatus, RoleName } from '@bnp/shared';
import {
  Document,
  DocumentVersion,
  FindingEvidence,
  FindingResolution,
  ReviewFinding,
  User,
} from '../entities';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators';

/**
 * The two authorities a blocking waiver needs, one signature each.
 *
 * This is a set, not a count, and the difference is the whole control. Two
 * pharmacists are two people and no second opinion; one person holding both
 * roles is one person however many hats they wear. Requiring *coverage* of
 * this set by *distinct* signatories is what makes the waiver a second pair of
 * eyes rather than a second click.
 *
 * NURSING_KNOWLEDGE_MANAGER is deliberately not here although it holds
 * DOCUMENTS_APPROVE: the role that can approve the document is not one of the
 * roles that can excuse a blocking finding on it, so a blocking finding always
 * forces the decision outside the approving desk.
 */
const WAIVER_AUTHORITIES: readonly string[] = [
  RoleName.PHARMACIST_REVIEWER,
  RoleName.CBAHI_QUALITY_OFFICER,
];

export interface FindingDto {
  id: string;
  documentId: string;
  versionNumber: number;
  ruleCode: string;
  layer: string;
  severity: FindingSeverity;
  status: FindingStatus;
  title: string;
  detail: string | null;
  supersededByVersion: number | null;
  detectedAt: Date;
  evidence: { pageNumber: number | null; locusIndex: number; snippet: string }[];
  resolutions: {
    action: FindingAction;
    actorRole: string;
    actorName: string | null;
    justification: string;
    createdAt: Date;
  }[];
  /** Roles still needed before a blocking waiver completes. */
  waiverRolesOutstanding: string[];
}

@Injectable()
export class FindingsService {
  private readonly logger = new Logger(FindingsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ReviewFinding)
    private readonly findings: Repository<ReviewFinding>,
    @InjectRepository(FindingEvidence)
    private readonly evidence: Repository<FindingEvidence>,
    @InjectRepository(FindingResolution)
    private readonly resolutions: Repository<FindingResolution>,
    @InjectRepository(Document)
    private readonly documents: Repository<Document>,
    @InjectRepository(DocumentVersion)
    private readonly versions: Repository<DocumentVersion>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly audit: AuditService,
  ) {}

  async listForDocument(documentId: string): Promise<FindingDto[]> {
    const doc = await this.documents.findOne({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Document not found');

    const rows = await this.findings.find({
      where: { documentId },
      order: { versionNumber: 'DESC', severity: 'ASC', ruleCode: 'ASC' },
    });
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const [evidence, resolutions] = await Promise.all([
      this.evidence.find({ where: ids.map((id) => ({ findingId: id })) }),
      this.resolutions.find({ where: ids.map((id) => ({ findingId: id })) }),
    ]);

    return rows.map((row) => {
      const mine = resolutions.filter((r) => r.findingId === row.id);
      return {
        id: row.id,
        documentId: row.documentId,
        versionNumber: row.versionNumber,
        ruleCode: row.ruleCode,
        layer: row.layer,
        severity: row.severity,
        status: row.status,
        title: row.title,
        detail: row.detail,
        supersededByVersion: row.supersededByVersion,
        detectedAt: row.detectedAt,
        evidence: evidence
          .filter((e) => e.findingId === row.id)
          .sort((a, b) => a.locusIndex - b.locusIndex)
          .map((e) => ({
            pageNumber: e.pageNumber,
            locusIndex: e.locusIndex,
            snippet: e.snippet,
          })),
        resolutions: mine
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((r) => ({
            action: r.action,
            actorRole: r.actorRole,
            actorName: r.actor?.fullName ?? null,
            justification: r.justification,
            createdAt: r.createdAt,
          })),
        waiverRolesOutstanding:
          row.severity === FindingSeverity.BLOCKING
            ? outstandingAuthorities(mine)
            : [],
      };
    });
  }

  /** Marks a finding addressed. One signature; never valid for BLOCKING. */
  async resolve(id: string, actor: AuthenticatedUser, justification: string) {
    return this.settle(id, actor, justification, FindingAction.RESOLVE, FindingStatus.RESOLVED);
  }

  /** Marks a finding a false positive. One signature; never valid for BLOCKING. */
  async dismiss(id: string, actor: AuthenticatedUser, justification: string) {
    return this.settle(id, actor, justification, FindingAction.DISMISS, FindingStatus.DISMISSED);
  }

  private async settle(
    id: string,
    actor: AuthenticatedUser,
    justification: string,
    action: FindingAction,
    target: FindingStatus,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const finding = await this.lock(manager, id);
      if (finding.severity === FindingSeverity.BLOCKING) {
        throw new BadRequestException(
          'A BLOCKING finding cannot be resolved by one person. Correct the document and re-upload, or waive it with two signatures from different authorities.',
        );
      }
      if (isSettled(finding.status)) {
        throw new BadRequestException(`Finding is already ${finding.status}`);
      }

      await this.assertSeparationOfDuties(finding, actor);
      const role = await this.resolvingRole(actor.userId);
      await manager.insert(FindingResolution, {
        findingId: finding.id,
        action,
        actorId: actor.userId,
        actorRole: role,
        justification,
      });
      await manager.update(ReviewFinding, { id: finding.id }, { status: target });

      this.audit.record({
        actorId: actor.userId,
        actorEmail: actor.email,
        action: `FINDINGS:${action}`,
        resourceType: 'review_finding',
        resourceId: finding.id,
        metadata: {
          documentId: finding.documentId,
          version: finding.versionNumber,
          ruleCode: finding.ruleCode,
          actorRole: role,
        },
      });
      return { id: finding.id, status: target };
    });
  }

  /**
   * Records one of the two signatures a blocking waiver needs.
   *
   * Authorisation here reads roles from the **database**, not from
   * `actor.roles`. The JWT carries a login-time snapshot (jwt.strategy.ts), so
   * a reviewer whose authority was withdrawn an hour ago still presents a
   * token that says otherwise until it expires. For an ordinary read that is
   * an acceptable staleness window; for the signature that lets a blocking
   * clinical finding through it is not.
   *
   * It also reads roles rather than permissions, and that is not a style
   * choice. SUPER_ADMIN holds ALL_PERMISSIONS, so a permission-based check
   * would let one administrator satisfy both halves of a dual control by
   * themselves — the exact failure this whole mechanism exists to prevent.
   */
  async waive(id: string, actor: AuthenticatedUser, justification: string) {
    return this.dataSource.transaction(async (manager) => {
      const finding = await this.lock(manager, id);

      if (finding.severity !== FindingSeverity.BLOCKING) {
        throw new BadRequestException(
          'Only a BLOCKING finding is waived. Use resolve or dismiss for the rest.',
        );
      }
      if (isSettled(finding.status)) {
        throw new BadRequestException(`Finding is already ${finding.status}`);
      }

      await this.assertSeparationOfDuties(finding, actor);

      const existing = await manager.find(FindingResolution, {
        where: { findingId: finding.id, action: FindingAction.WAIVE },
      });
      if (existing.some((r) => r.actorId === actor.userId)) {
        throw new BadRequestException('You have already signed this waiver.');
      }

      const outstanding = outstandingAuthorities(existing);
      const held = await this.rolesFromDatabase(actor.userId);
      const eligible = outstanding.filter((role) => held.includes(role)).sort();

      if (eligible.length === 0) {
        throw new ForbiddenException(
          `Waiving this finding needs a signature from: ${outstanding.join(' or ')}. Your account does not currently hold ${
            outstanding.length === 1 ? 'that role' : 'either role'
          }.`,
        );
      }

      // Deterministic: the signature counts as exactly one authority, and
      // which one is frozen into the row rather than derived later.
      const actorRole = eligible[0];
      await manager.insert(FindingResolution, {
        findingId: finding.id,
        action: FindingAction.WAIVE,
        actorId: actor.userId,
        actorRole,
        justification,
      });

      const remaining = outstanding.filter((role) => role !== actorRole);
      const status = remaining.length === 0 ? FindingStatus.WAIVED : FindingStatus.WAIVER_PENDING;
      await manager.update(ReviewFinding, { id: finding.id }, { status });

      this.audit.record({
        actorId: actor.userId,
        actorEmail: actor.email,
        action: status === FindingStatus.WAIVED ? 'FINDINGS:WAIVED' : 'FINDINGS:WAIVER_SIGNED',
        resourceType: 'review_finding',
        resourceId: finding.id,
        metadata: {
          documentId: finding.documentId,
          version: finding.versionNumber,
          ruleCode: finding.ruleCode,
          actorRole,
          rolesOutstanding: remaining,
        },
      });

      return { id: finding.id, status, rolesOutstanding: remaining };
    });
  }

  /**
   * Takes a row lock for the duration of the transaction.
   *
   * Two reviewers signing the last two halves of a waiver at the same instant
   * would otherwise both read zero existing signatures, both insert, and
   * neither flip the status to WAIVED — leaving a fully signed waiver stuck at
   * WAIVER_PENDING. The repository already reaches for a lock in the same
   * shape when concurrent writes would interleave (indexing.service.ts).
   */
  private async lock(manager: EntityManager, id: string): Promise<ReviewFinding> {
    const finding = await manager.findOne(ReviewFinding, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!finding) throw new NotFoundException('Finding not found');
    return finding;
  }

  private async rolesFromDatabase(userId: string): Promise<string[]> {
    const user = await this.users.findOne({ where: { id: userId } });
    return (user?.roles ?? []).map((r) => r.name);
  }

  /**
   * Whoever uploaded the version under review does not get to clear findings
   * against it.
   *
   * The anchor is `document_versions.created_by_id` for the current version,
   * not `documents.uploaded_by_id`. Re-uploading never rewrites the latter
   * (documents.service.ts), so anchoring there would let the person who
   * actually submitted v3 sign off their own blocking finding whenever someone
   * else happened to upload v1.
   *
   * A version with no recorded uploader — direct inserts do occur, and the
   * column is nullable — passes vacuously and says so in the log. There is
   * nobody to exclude, and refusing every reviewer would be worse.
   */
  private async assertSeparationOfDuties(
    finding: ReviewFinding,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const version = await this.versions.findOne({
      where: { documentId: finding.documentId, versionNumber: finding.versionNumber },
      order: { createdAt: 'DESC' },
    });
    const doc = await this.documents.findOne({ where: { id: finding.documentId } });
    const submitter = version?.createdById ?? doc?.uploadedBy?.id ?? null;

    if (submitter === null) {
      this.logger.warn(
        `No recorded uploader for document ${finding.documentId} v${finding.versionNumber}; separation of duties not enforced for finding ${finding.id}`,
      );
    } else if (submitter === actor.userId) {
      throw new ForbiddenException(
        'You submitted this version, so you cannot clear findings against it. A different reviewer must.',
      );
    }
  }

  /**
   * The single authority recorded against a non-blocking resolution, chosen
   * deterministically from the roles the database says the actor holds.
   *
   * One role, not a list: `actor_role` records the authority that was
   * exercised, and a comma-joined set of everything the person happened to
   * hold answers a different question and would overflow the column.
   */
  private async resolvingRole(userId: string): Promise<string> {
    const held = (await this.rolesFromDatabase(userId)).sort();
    const authority = held.find((role) => WAIVER_AUTHORITIES.includes(role));
    return authority ?? held[0] ?? 'UNKNOWN';
  }
}

function isSettled(status: FindingStatus): boolean {
  return (
    status === FindingStatus.RESOLVED ||
    status === FindingStatus.DISMISSED ||
    status === FindingStatus.WAIVED ||
    status === FindingStatus.SUPERSEDED
  );
}

/** Which of the two required authorities have not yet signed. */
function outstandingAuthorities(resolutions: { action: FindingAction; actorRole: string }[]): string[] {
  const covered = new Set(
    resolutions.filter((r) => r.action === FindingAction.WAIVE).map((r) => r.actorRole),
  );
  return WAIVER_AUTHORITIES.filter((role) => !covered.has(role));
}
