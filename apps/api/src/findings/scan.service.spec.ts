import { FindingSeverity, FindingStatus } from '@bnp/shared';
import { ScanService, SCAN_TIMEOUT_MS } from './scan.service';
import { Document } from '../entities';
import { ExtractedPage } from '../rag/pdf-extraction.service';
import { ChunkingService } from '../rag/chunking.service';

const DOC = { id: 'doc-1', versionNumber: 2, storageKey: 'k', title: 'Policy' } as Document;

interface InsertedFinding {
  ruleCode: string;
  severity: FindingSeverity;
  status: FindingStatus;
  fingerprint: string;
  version: number;
}

/**
 * A fake query runner that understands just enough SQL to distinguish the
 * three statements ScanService issues, and that honours
 * `ON CONFLICT DO NOTHING` the way Postgres would — returning no row, which is
 * the signal the service uses to skip the evidence insert.
 */
function harness(
  extract: () => Promise<ExtractedPage[]>,
  options: { existingFingerprints?: string[] } = {},
) {
  const findings: InsertedFinding[] = [];
  const evidence: { findingId: string; locusIndex: number; snippet: string }[] = [];
  const supersedes: unknown[][] = [];
  const existing = new Set(options.existingFingerprints ?? []);

  const manager = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('INSERT INTO review_findings')) {
        const fingerprint = params[7] as string;
        if (existing.has(fingerprint)) return [];
        existing.add(fingerprint);
        findings.push({
          version: params[1] as number,
          ruleCode: params[2] as string,
          severity: params[3] as FindingSeverity,
          status: params[4] as FindingStatus,
          fingerprint,
        });
        return [{ id: `f-${findings.length}` }];
      }
      if (sql.includes('INSERT INTO finding_evidence')) {
        evidence.push({
          findingId: params[0] as string,
          locusIndex: params[2] as number,
          snippet: params[3] as string,
        });
        return [];
      }
      if (sql.includes('UPDATE review_findings')) {
        supersedes.push(params);
        return [];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  };

  const service = new ScanService(
    { transaction: (cb: (m: unknown) => unknown) => cb(manager) } as never,
    { download: jest.fn(async () => Buffer.from('%PDF-1.4')) } as never,
    { extractPages: jest.fn(extract) } as never,
    new ChunkingService(),
  );

  return { service, findings, evidence, supersedes, manager };
}

const GOOD_PAGE: ExtractedPage[] = [
  {
    pageNumber: 1,
    text: 'Administer insulin 10 U subcutaneously and review the chart every shift as required.',
  },
];

describe('ScanService', () => {
  it('records the findings the rules produced', async () => {
    const { service, findings, evidence } = harness(async () => GOOD_PAGE);
    await service.scanDocument(DOC);
    expect(findings.map((f) => f.ruleCode)).toContain('ISMP_ABBREVIATION');
    expect(findings[0].version).toBe(2);
    expect(findings[0].status).toBe(FindingStatus.OPEN);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0].locusIndex).toBe(0);
  });

  /**
   * The safety property the whole design rests on.
   *
   * If the failure propagated, `submitReview` would error and the reviewer
   * would retry until it passed. If it were swallowed silently, the approval
   * gate would see zero blocking findings on a document nobody could read and
   * approve it — indistinguishable from a document that scanned clean. Turning
   * the failure into a blocking finding is the only shape where "the scanner
   * did not run" cannot be mistaken for "the scanner found nothing".
   */
  it('turns an extraction failure into a BLOCKING finding and still resolves', async () => {
    const { service, findings } = harness(async () => {
      throw new Error('bad XRef entry');
    });

    await expect(service.scanDocument(DOC)).resolves.toBeUndefined();

    expect(findings).toHaveLength(1);
    expect(findings[0].ruleCode).toBe('SCAN_FAILED');
    expect(findings[0].severity).toBe(FindingSeverity.BLOCKING);
  });

  it('keeps the reported cause as evidence', async () => {
    const { service, evidence } = harness(async () => {
      throw new Error('bad XRef entry');
    });
    await service.scanDocument(DOC);
    expect(evidence[0].snippet).toContain('bad XRef entry');
  });

  /**
   * Submit-review has no other bound, so an adversarial or malformed PDF would
   * otherwise hold an HTTP worker open indefinitely.
   */
  it('gives up after the timeout and records SCAN_TIMEOUT as BLOCKING', async () => {
    jest.useFakeTimers();
    try {
      const { service, findings } = harness(() => new Promise<ExtractedPage[]>(() => {}));
      const done = service.scanDocument(DOC);
      await jest.advanceTimersByTimeAsync(SCAN_TIMEOUT_MS + 1);
      await done;
      expect(findings).toHaveLength(1);
      expect(findings[0].ruleCode).toBe('SCAN_TIMEOUT');
      expect(findings[0].severity).toBe(FindingSeverity.BLOCKING);
    } finally {
      jest.useRealTimers();
    }
  });

  it('records a blocking ZERO_EXTRACTION when the PDF yields no chunks', async () => {
    const { service, findings } = harness(async () => [{ pageNumber: 1, text: 'ﬁ' }]);
    await service.scanDocument(DOC);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleCode).toBe('ZERO_EXTRACTION');
    expect(findings[0].severity).toBe(FindingSeverity.BLOCKING);
  });

  /**
   * A document goes DRAFT → IN_REVIEW → REJECTED → IN_REVIEW on the same bytes
   * routinely, and every pass re-scans. Without the conflict clause the
   * reviewer sees each issue once per attempt.
   */
  it('writes no duplicate when the same version is scanned twice', async () => {
    const { service, findings, evidence } = harness(async () => GOOD_PAGE);
    await service.scanDocument(DOC);
    const afterFirst = findings.length;
    const evidenceAfterFirst = evidence.length;

    await service.scanDocument(DOC);

    expect(findings).toHaveLength(afterFirst);
    expect(evidence).toHaveLength(evidenceAfterFirst);
  });

  it('asks Postgres to ignore the conflict rather than overwrite the row', async () => {
    const { service, manager } = harness(async () => GOOD_PAGE);
    await service.scanDocument(DOC);
    const insert = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO review_findings'),
    );
    expect(String(insert?.[0])).toMatch(
      /ON CONFLICT \(document_id, version_number, fingerprint\) DO NOTHING/,
    );
  });

  it('stamps still-open findings from earlier versions as superseded', async () => {
    const { service, supersedes } = harness(async () => GOOD_PAGE);
    await service.scanDocument(DOC);
    expect(supersedes).toHaveLength(1);
    expect(supersedes[0]).toEqual([
      FindingStatus.SUPERSEDED,
      2,
      'doc-1',
      FindingStatus.OPEN,
      FindingStatus.WAIVER_PENDING,
    ]);
  });

  /**
   * Scanning must not run the indexing pipeline. Extraction and chunking alone
   * answer every L1 question, so a scan spends no embedding quota and writes
   * nothing to `document_chunks` — which is what makes it safe to run on every
   * submit, including submissions that will be rejected.
   */
  it('writes only to the findings tables', async () => {
    const { service, manager } = harness(async () => GOOD_PAGE);
    await service.scanDocument(DOC);
    for (const [sql] of manager.query.mock.calls) {
      expect(String(sql)).toMatch(/review_findings|finding_evidence/);
    }
  });

  it('does not throw when the findings cannot be written', async () => {
    const { service } = harness(async () => GOOD_PAGE);
    const broken = new ScanService(
      {
        transaction: () => {
          throw new Error('database is gone');
        },
      } as never,
      { download: jest.fn(async () => Buffer.from('%PDF')) } as never,
      { extractPages: jest.fn(async () => GOOD_PAGE) } as never,
      new ChunkingService(),
    );
    await expect(broken.scanDocument(DOC)).resolves.toBeUndefined();
    void service;
  });
});
