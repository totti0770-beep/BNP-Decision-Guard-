import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DocumentStatus, FindingSeverity, FindingStatus } from '@bnp/shared';
import { LiveScanService } from './live-scan.service';
import { AuthenticatedUser } from '../common/decorators';

const ACTOR: AuthenticatedUser = {
  userId: 'actor-1',
  email: 'pharmacist@hospital.test',
  fullName: 'Reviewer',
  roles: ['PHARMACIST_REVIEWER'],
  permissions: [],
};

function finding(versionNumber: number, severity: FindingSeverity) {
  return {
    id: `f-${versionNumber}-${severity}`,
    documentId: 'doc-1',
    versionNumber,
    ruleCode: 'ISMP_TRAILING_ZERO',
    layer: 'L1',
    severity,
    status: FindingStatus.OPEN,
    title: 't',
    detail: null,
    supersededByVersion: null,
    detectedAt: new Date(),
    evidence: [],
    resolutions: [],
    waiverRolesOutstanding: [],
  };
}

function harness(status: DocumentStatus | null, listed = [finding(3, FindingSeverity.MAJOR)]) {
  const doc = status === null ? null : { id: 'doc-1', status, versionNumber: 3 };
  // Every write a repository can make is a spy, so "the document was never
  // written" is asserted against all of them rather than against the one a
  // regression happened to pick.
  const documents = {
    findOne: jest.fn(async () => doc),
    save: jest.fn(),
    update: jest.fn(),
    insert: jest.fn(),
  };
  const scan = { scanDocument: jest.fn(async () => undefined) };
  const findings = { listForDocument: jest.fn(async () => listed) };
  const audit = { record: jest.fn() };
  const service = new LiveScanService(
    documents as never,
    scan as never,
    findings as never,
    audit as never,
  );
  return { service, doc, documents, scan, findings, audit };
}

describe('LiveScanService.scanActive', () => {
  it('scans an ACTIVE document and returns its findings', async () => {
    const h = harness(DocumentStatus.ACTIVE);
    const result = await h.service.scanActive('doc-1', ACTOR);
    expect(h.scan.scanDocument).toHaveBeenCalledWith(h.doc);
    expect(result).toHaveLength(1);
  });

  /**
   * The property the whole endpoint rests on. A scan that could move a live
   * document — offline on a blocking finding, or anywhere else — would turn
   * "look at this document" into a governance action with no approval trail.
   */
  it('never writes the document it scans', async () => {
    const h = harness(DocumentStatus.ACTIVE, [finding(3, FindingSeverity.BLOCKING)]);
    await h.service.scanActive('doc-1', ACTOR);
    expect(h.documents.save).not.toHaveBeenCalled();
    expect(h.documents.update).not.toHaveBeenCalled();
    expect(h.documents.insert).not.toHaveBeenCalled();
    expect(h.doc?.status).toBe(DocumentStatus.ACTIVE);
  });

  /**
   * DRAFT and REJECTED are scanned by submit-review, where a blocking finding
   * gates approval. Scanning them here would record findings that look the
   * same but were raised outside that path.
   */
  it.each([
    DocumentStatus.DRAFT,
    DocumentStatus.IN_REVIEW,
    DocumentStatus.APPROVED,
    DocumentStatus.REJECTED,
    DocumentStatus.EXPIRED,
    DocumentStatus.INACTIVE,
  ])('refuses a %s document without scanning it', async (status) => {
    const h = harness(status);
    await expect(h.service.scanActive('doc-1', ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(h.scan.scanDocument).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
  });

  it('404s for a document that does not exist', async () => {
    const h = harness(null);
    await expect(h.service.scanActive('doc-1', ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(h.scan.scanDocument).not.toHaveBeenCalled();
  });

  /**
   * The audit row reports the current version only. A finding left over from
   * v1 is not a statement about the bytes that are live now, and counting it
   * would make a clean scan of v3 read as though it found something.
   */
  it('audits the scan with counts for the current version only', async () => {
    const h = harness(DocumentStatus.ACTIVE, [
      finding(3, FindingSeverity.MAJOR),
      finding(3, FindingSeverity.MINOR),
      finding(1, FindingSeverity.BLOCKING),
    ]);
    await h.service.scanActive('doc-1', ACTOR);
    expect(h.audit.record).toHaveBeenCalledTimes(1);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FINDINGS:RETRO_SCAN',
        actorId: 'actor-1',
        resourceType: 'document',
        resourceId: 'doc-1',
        metadata: {
          version: 3,
          currentVersionFindings: { blocking: 0, major: 1, minor: 1 },
        },
      }),
    );
  });
});
