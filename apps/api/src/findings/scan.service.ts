import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { FindingSeverity, FindingStatus } from '@bnp/shared';
import { Document } from '../entities';
import { StorageService } from '../storage/storage.service';
import { PdfExtractionService } from '../rag/pdf-extraction.service';
import { ChunkingService } from '../rag/chunking.service';
import { RawFinding, runL1Rules, SNIPPET_MAX } from './l1/structural-rules';

/**
 * A document that takes longer than this to extract is treated as unscannable
 * rather than waited on. Submit-review has no other bound, so without it a
 * malformed PDF holds an HTTP worker open indefinitely.
 */
export const SCAN_TIMEOUT_MS = 30_000;

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly extraction: PdfExtractionService,
    private readonly chunking: ChunkingService,
  ) {}

  /**
   * Runs the L1 checks over a document's text and records what they found.
   *
   * **This method never throws.** Every failure — a missing object, a corrupt
   * PDF, a rule that blows up — is converted into a BLOCKING `SCAN_FAILED`
   * finding and returned normally. That is the whole safety argument: if a
   * scan failure propagated, `submitReview` would 4xx or 5xx and the reviewer
   * would retry until it passed; if it were swallowed silently, the approval
   * gate would see zero blocking findings on a document nobody could read and
   * wave it through, indistinguishable from a document that scanned clean.
   * Turning the failure into a blocking finding is the only shape where "the
   * scanner did not run" cannot be mistaken for "the scanner found nothing".
   *
   * It is also awaited rather than dispatched. There is no job queue in this
   * codebase, and `seed.ts` calls `submitReview()` then `approve()` in the
   * same process with nothing in between — a deferred scan would race the gate
   * it exists to feed.
   *
   * Deliberately does NOT call `IndexingService.indexDocument`: extraction and
   * chunking alone answer every L1 question, so scanning spends no embedding
   * quota and writes nothing to `document_chunks`.
   */
  async scanDocument(doc: Document): Promise<void> {
    let findings: RawFinding[];
    try {
      findings = await this.runRules(doc);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const timedOut = reason === TIMEOUT_MARKER;
      this.logger.error(
        `Conflict scan failed for document ${doc.id} v${doc.versionNumber}: ${reason}`,
      );
      findings = [
        {
          ruleCode: timedOut ? 'SCAN_TIMEOUT' : 'SCAN_FAILED',
          severity: FindingSeverity.BLOCKING,
          title: timedOut
            ? 'The conflict scan timed out'
            : 'The conflict scan could not read this document',
          detail: timedOut
            ? `Extraction did not finish within ${SCAN_TIMEOUT_MS / 1000} seconds. The document cannot be confirmed free of blocking conflicts, so approval stays closed.`
            : `The document could not be scanned, so it cannot be confirmed free of blocking conflicts. Reported cause: ${reason}`,
          fingerprint: timedOut ? 'SCAN_TIMEOUT' : 'SCAN_FAILED',
          evidence: [{ pageNumber: null, snippet: reason.slice(0, SNIPPET_MAX) }],
        },
      ];
    }

    try {
      await this.persist(doc, findings);
    } catch (err) {
      // Persisting is the last step; a failure here leaves the gate with
      // whatever it had before, which for a first submit is nothing. Log
      // loudly rather than 500 the reviewer's submit.
      this.logger.error(
        `Could not record conflict findings for document ${doc.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async runRules(doc: Document): Promise<RawFinding[]> {
    const pdf = await this.storage.download(doc.storageKey);
    const pages = await withTimeout(this.extraction.extractPages(pdf), SCAN_TIMEOUT_MS);
    const chunks = this.chunking.chunkPages(pages);
    return runL1Rules({
      pages,
      extractableChunkCount: chunks.length,
      document: { title: doc.title, versionNumber: doc.versionNumber },
    });
  }

  /**
   * Writes the findings for this version, then stamps still-open findings from
   * earlier versions as SUPERSEDED.
   *
   * `ON CONFLICT DO NOTHING` on `(document_id, version_number, fingerprint)` is
   * what makes a re-scan idempotent. A document moves DRAFT → IN_REVIEW →
   * REJECTED → IN_REVIEW on the same bytes routinely and every pass re-scans;
   * without it the reviewer sees each issue once per attempt. It also protects
   * resolutions: a finding already WAIVED on this version is left exactly as
   * it is, because the conflicting insert is skipped rather than replacing it.
   *
   * The SUPERSEDED stamp is cosmetic — it gives the reviewer a stable history.
   * Whether an old finding blocks is decided by the version predicate in
   * ConflictGateService, not by this status.
   */
  private async persist(doc: Document, findings: RawFinding[]): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      for (const finding of findings) {
        const inserted: { id: string }[] = await manager.query(
          `INSERT INTO review_findings
             (document_id, version_number, rule_code, layer, severity, status,
              title, detail, fingerprint)
           VALUES ($1, $2, $3, 'L1', $4, $5, $6, $7, $8)
           ON CONFLICT (document_id, version_number, fingerprint) DO NOTHING
           RETURNING id`,
          [
            doc.id,
            doc.versionNumber,
            finding.ruleCode,
            finding.severity,
            FindingStatus.OPEN,
            finding.title,
            finding.detail,
            finding.fingerprint,
          ],
        );
        if (inserted.length === 0) continue; // Already recorded on this version.

        const findingId = inserted[0].id;
        let locus = 0;
        for (const ev of finding.evidence) {
          await manager.query(
            `INSERT INTO finding_evidence
               (finding_id, page_number, locus_index, snippet, char_start, char_end)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (finding_id, locus_index) DO NOTHING`,
            [
              findingId,
              ev.pageNumber,
              locus++,
              ev.snippet.slice(0, SNIPPET_MAX),
              ev.charStart ?? null,
              ev.charEnd ?? null,
            ],
          );
        }
      }

      await manager.query(
        `UPDATE review_findings
            SET status = $1, superseded_by_version = $2, updated_at = now()
          WHERE document_id = $3
            AND version_number < $2
            AND status IN ($4, $5)`,
        [
          FindingStatus.SUPERSEDED,
          doc.versionNumber,
          doc.id,
          FindingStatus.OPEN,
          FindingStatus.WAIVER_PENDING,
        ],
      );
    });
  }
}

const TIMEOUT_MARKER = 'conflict-scan-timeout';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(TIMEOUT_MARKER)), ms);
    // Do not hold the event loop open for a scan that already lost the race.
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}
