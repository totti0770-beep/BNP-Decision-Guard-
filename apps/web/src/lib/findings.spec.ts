import {
  blocksApproval,
  emptyFindingsKey,
  Finding,
  isSettled,
  MIN_JUSTIFICATION,
  offeredActions,
  offersLiveScan,
} from './findings';

/**
 * These mirror decisions the API enforces. The API's own specs are what stop a
 * document going live wrongly; nothing here can, and nothing here should be
 * read as a second line of defence. What they stop is the screen offering a
 * reviewer a button whose only possible outcome is a 400, or colouring a
 * superseded finding as though it still gates an approval.
 */

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    versionNumber: 3,
    ruleCode: 'ZERO_EXTRACTION',
    severity: 'BLOCKING',
    status: 'OPEN',
    title: 'The document yields no extractable text',
    detail: null,
    supersededByVersion: null,
    evidence: [],
    resolutions: [],
    waiverRolesOutstanding: ['PHARMACIST_REVIEWER', 'CBAHI_QUALITY_OFFICER'],
    ...over,
  };
}

const ALL = { resolve: true, waive: true };

describe('blocksApproval', () => {
  it('is true for an open blocking finding on the current version', () => {
    expect(blocksApproval(finding(), 3)).toBe(true);
  });

  /**
   * Supersession. Re-uploading bumps the version, and the server's gate
   * compares against the document's *current* version — so a v1 blocker must
   * stop reading as a blocker the moment v2 exists, or the screen warns about
   * something the API will happily approve.
   */
  it('is false for a blocking finding raised on an earlier version', () => {
    expect(blocksApproval(finding({ versionNumber: 1 }), 3)).toBe(false);
  });

  /** Half a waiver is not a waiver: one signature still blocks. */
  it('is true while a waiver has only its first signature', () => {
    expect(blocksApproval(finding({ status: 'WAIVER_PENDING' }), 3)).toBe(true);
  });

  it('is false once the waiver is complete', () => {
    expect(blocksApproval(finding({ status: 'WAIVED' }), 3)).toBe(false);
  });

  it('is false for MAJOR and MINOR, which are recorded and enforce nothing', () => {
    expect(blocksApproval(finding({ severity: 'MAJOR' }), 3)).toBe(false);
    expect(blocksApproval(finding({ severity: 'MINOR' }), 3)).toBe(false);
  });
});

describe('offeredActions', () => {
  /**
   * The API refuses resolve and dismiss on a BLOCKING finding outright — it
   * takes two signatures from two authorities. Offering either would be a
   * button that can only ever produce a 400.
   */
  it('offers only waive for a blocking finding', () => {
    expect(offeredActions(finding(), 3, ALL)).toEqual(['waive']);
  });

  it('offers resolve and dismiss, but never waive, for a non-blocking finding', () => {
    expect(offeredActions(finding({ severity: 'MAJOR' }), 3, ALL)).toEqual([
      'resolve',
      'dismiss',
    ]);
    expect(offeredActions(finding({ severity: 'MINOR' }), 3, ALL)).not.toContain('waive');
  });

  it('offers nothing without the matching permission', () => {
    expect(offeredActions(finding(), 3, { resolve: true, waive: false })).toEqual([]);
    expect(
      offeredActions(finding({ severity: 'MAJOR' }), 3, { resolve: false, waive: true }),
    ).toEqual([]);
  });

  it('offers nothing on a finding that is already settled', () => {
    for (const status of ['RESOLVED', 'WAIVED', 'DISMISSED', 'SUPERSEDED'] as const) {
      expect(offeredActions(finding({ status }), 3, ALL)).toEqual([]);
    }
  });

  /**
   * A finding against bytes that are no longer under review gates nothing, and
   * settling it would record a decision about the wrong version.
   */
  it('offers nothing on a finding from an earlier version', () => {
    expect(offeredActions(finding({ versionNumber: 1 }), 3, ALL)).toEqual([]);
    expect(offeredActions(finding({ versionNumber: 1, severity: 'MAJOR' }), 3, ALL)).toEqual(
      [],
    );
  });

  it('still offers waive while a waiver is pending its second signature', () => {
    expect(offeredActions(finding({ status: 'WAIVER_PENDING' }), 3, ALL)).toEqual(['waive']);
  });
});

describe('isSettled', () => {
  it('counts every terminal status', () => {
    for (const status of ['RESOLVED', 'WAIVED', 'DISMISSED', 'SUPERSEDED'] as const) {
      expect(isSettled(status)).toBe(true);
    }
  });

  it('does not count OPEN or WAIVER_PENDING', () => {
    expect(isSettled('OPEN')).toBe(false);
    expect(isSettled('WAIVER_PENDING')).toBe(false);
  });
});

describe('MIN_JUSTIFICATION', () => {
  /**
   * Matches `@MinLength(10)` on the API's JustificationDto. If the screen let a
   * shorter reason through, the user would lose what they typed to a 400.
   */
  it('matches the floor the API enforces', () => {
    expect(MIN_JUSTIFICATION).toBe(10);
  });
});

describe('offersLiveScan', () => {
  it('offers a scan on a live document to someone who may scan', () => {
    expect(offersLiveScan('ACTIVE', true)).toBe(true);
  });

  it('offers nothing without the permission', () => {
    expect(offersLiveScan('ACTIVE', false)).toBe(false);
  });

  /** The API answers 400 for every other status; a button there only fails. */
  it('offers nothing on a document that is not live', () => {
    for (const status of ['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED', 'INACTIVE']) {
      expect(offersLiveScan(status, true)).toBe(false);
    }
  });
});

describe('emptyFindingsKey', () => {
  /**
   * An empty list on a live document is not a clean scan: every document
   * approved before the scan shipped has one. The screen must not say
   * otherwise.
   */
  it('does not call an empty list on a live document clean', () => {
    expect(emptyFindingsKey('ACTIVE')).toBe('noFindingsLive');
  });

  it('keeps the plain message where submit-review has already scanned', () => {
    expect(emptyFindingsKey('IN_REVIEW')).toBe('noFindings');
    expect(emptyFindingsKey('APPROVED')).toBe('noFindings');
  });
});
