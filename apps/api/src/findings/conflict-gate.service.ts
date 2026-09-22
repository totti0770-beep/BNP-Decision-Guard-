import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { FindingSeverity, FindingStatus } from '@bnp/shared';
import { Document, ReviewFinding } from '../entities';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators';

@Injectable()
export class ConflictGateService {
  constructor(
    @InjectRepository(ReviewFinding)
    private readonly findings: Repository<ReviewFinding>,
    private readonly audit: AuditService,
  ) {}

  /**
   * Refuses approval while an unresolved BLOCKING finding stands against the
   * version being approved.
   *
   * Three parts of the query are load-bearing:
   *
   * - `versionNumber` is compared against the document's *current* version.
   *   This is the whole supersession mechanism: re-uploading bumps the version
   *   and resets the document to DRAFT, so a v1 finding stops blocking v2 with
   *   no sweep and no stored flag to fall out of step. The `SUPERSEDED` status
   *   that ScanService stamps is for the reviewer's history view; do not
   *   rewrite this clause to read it.
   *
   * - `WAIVER_PENDING` blocks exactly as `OPEN` does. It marks a finding with
   *   one of the two required signatures, and half a waiver is not a waiver.
   *
   * - Only `BLOCKING` blocks. MAJOR and MINOR findings are recorded for the
   *   reviewer to read and stop nothing; a gate that held approval for every
   *   trailing zero would be switched off within a week.
   *
   * This is a service-level check, not a Nest guard, because `seed.ts` calls
   * `ApprovalService.approve()` directly with no HTTP request in sight. A
   * route guard would leave that path ungated.
   */
  async assertApprovable(doc: Document, actor?: AuthenticatedUser): Promise<void> {
    const blocking = await this.findings.find({
      where: {
        documentId: doc.id,
        versionNumber: doc.versionNumber,
        severity: FindingSeverity.BLOCKING,
        status: In([FindingStatus.OPEN, FindingStatus.WAIVER_PENDING]),
      },
      order: { ruleCode: 'ASC' },
    });

    if (blocking.length === 0) return;

    // The refusal happens before `transition()`, so no DOCUMENTS:* row is
    // written for this attempt. Without this event the block leaves no trace
    // in the audit log at all.
    this.audit.record({
      actorId: actor?.userId ?? null,
      actorEmail: actor?.email ?? null,
      action: 'DOCUMENTS:APPROVE_BLOCKED',
      resourceType: 'document',
      resourceId: doc.id,
      metadata: {
        version: doc.versionNumber,
        findings: blocking.map((f) => ({
          id: f.id,
          ruleCode: f.ruleCode,
          status: f.status,
        })),
      },
    });

    const summary = blocking.map((f) => `${f.ruleCode}: ${f.title}`).join('; ');
    throw new BadRequestException(
      `Approval is blocked by ${blocking.length} unresolved finding(s) on version ${doc.versionNumber} — ${summary}`,
    );
  }
}
