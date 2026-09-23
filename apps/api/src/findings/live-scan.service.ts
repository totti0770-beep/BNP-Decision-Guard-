import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentStatus, FindingSeverity } from '@bnp/shared';
import { Document } from '../entities';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators';
import { ScanService } from './scan.service';
import { FindingDto, FindingsService } from './findings.service';

/**
 * Runs the L1 scan on a document that is already live.
 *
 * The scan normally runs inside `submitReview()`, and SUBMIT_REVIEW accepts
 * only DRAFT and REJECTED. So every document that went ACTIVE before the scan
 * shipped had no way to be scanned except re-uploading it — and re-uploading
 * resets the document to DRAFT, which takes it out of retrieval until someone
 * approves it again. On the production corpus that meant choosing between an
 * unscanned formulary and removing 77% of the citable text for the length of a
 * review.
 *
 * This scans in place, and what it deliberately does NOT do is the point:
 *
 * - **It changes no status.** The document is read, never saved. A BLOCKING
 *   finding on a live document is shown, not enforced: the approval gate runs
 *   at `approve()`, which an ACTIVE document never reaches. Whether a finding
 *   is serious enough to take a document offline is a human decision, made
 *   with the existing deactivate action, and never a side effect of looking.
 * - **It accepts ACTIVE only.** DRAFT and REJECTED documents are scanned by
 *   submit-review, where a blocking finding does gate approval. Scanning them
 *   here would record findings that look identical but gate at a different
 *   moment.
 *
 * Re-running is safe: `ScanService.persist` inserts with
 * `ON CONFLICT (document_id, version_number, fingerprint) DO NOTHING`, so a
 * second scan of unchanged bytes adds nothing and leaves any resolution or
 * waiver on the existing rows untouched.
 */
@Injectable()
export class LiveScanService {
  constructor(
    @InjectRepository(Document)
    private readonly documents: Repository<Document>,
    private readonly scan: ScanService,
    private readonly findings: FindingsService,
    private readonly audit: AuditService,
  ) {}

  async scanActive(documentId: string, actor: AuthenticatedUser): Promise<FindingDto[]> {
    const doc = await this.documents.findOne({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.status !== DocumentStatus.ACTIVE) {
      throw new BadRequestException(
        `Only ACTIVE documents can be scanned in place (current: ${doc.status}). ` +
          `DRAFT and REJECTED documents are scanned when submitted for review.`,
      );
    }

    // Never throws: a document it cannot read becomes a BLOCKING SCAN_FAILED
    // finding rather than an error.
    await this.scan.scanDocument(doc);

    const all = await this.findings.listForDocument(doc.id);
    const current = all.filter((f) => f.versionNumber === doc.versionNumber);
    const count = (severity: FindingSeverity) =>
      current.filter((f) => f.severity === severity).length;

    this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'FINDINGS:RETRO_SCAN',
      resourceType: 'document',
      resourceId: doc.id,
      metadata: {
        version: doc.versionNumber,
        // Totals on this version after the scan, not findings new to it: a
        // re-scan of unchanged bytes adds nothing and still reports them.
        currentVersionFindings: {
          blocking: count(FindingSeverity.BLOCKING),
          major: count(FindingSeverity.MAJOR),
          minor: count(FindingSeverity.MINOR),
        },
      },
    });

    return all;
  }
}
