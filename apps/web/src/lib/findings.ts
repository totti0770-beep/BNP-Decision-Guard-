/**
 * The client's view of pre-activation conflict findings.
 *
 * The two functions here mirror decisions the API enforces, and they live in
 * `lib` rather than beside the component so they can be tested without a DOM.
 * Neither is the enforcement — `ConflictGateService` and `FindingsService` are,
 * and they are not reachable from a browser. These decide what the screen
 * *offers*, and being wrong here means putting a reviewer in front of a 400 the
 * screen could have prevented.
 */

/** Mirrors `FindingDto` in the API's `findings.service.ts`. */
export interface Finding {
  id: string;
  versionNumber: number;
  ruleCode: string;
  severity: 'BLOCKING' | 'MAJOR' | 'MINOR';
  status: 'OPEN' | 'WAIVER_PENDING' | 'RESOLVED' | 'WAIVED' | 'SUPERSEDED' | 'DISMISSED';
  title: string;
  detail: string | null;
  supersededByVersion: number | null;
  evidence: { pageNumber: number | null; locusIndex: number; snippet: string }[];
  resolutions: {
    action: 'RESOLVE' | 'WAIVE' | 'DISMISS';
    actorRole: string;
    actorName: string | null;
    justification: string;
    createdAt: string;
  }[];
  waiverRolesOutstanding: string[];
}

export type FindingAction = 'resolve' | 'dismiss' | 'waive';

const SETTLED: ReadonlySet<Finding['status']> = new Set([
  'RESOLVED',
  'WAIVED',
  'DISMISSED',
  'SUPERSEDED',
] as const);

export function isSettled(status: Finding['status']): boolean {
  return SETTLED.has(status);
}

/**
 * Whether this finding is one the approval gate will refuse on.
 *
 * Deliberately the same three-part predicate as the server's WHERE clause:
 * BLOCKING severity, the document's *current* version, and a status of OPEN or
 * WAIVER_PENDING. The version comparison is the part most easily dropped —
 * re-uploading supersedes a finding, so a v1 blocker must stop looking like a
 * blocker the moment v2 exists. And WAIVER_PENDING blocks because half a
 * waiver is not a waiver.
 */
export function blocksApproval(f: Finding, currentVersion: number): boolean {
  return (
    f.severity === 'BLOCKING' &&
    f.versionNumber === currentVersion &&
    (f.status === 'OPEN' || f.status === 'WAIVER_PENDING')
  );
}

/**
 * Which verbs the screen should offer for a finding.
 *
 * A BLOCKING finding takes two signatures from two different authorities, so
 * the API refuses `resolve` and `dismiss` on one outright — offering either
 * would be a button whose only outcome is a 400. Everything else takes one
 * signature and cannot be waived.
 *
 * A finding raised on an earlier version offers nothing: it no longer gates
 * anything, and settling it would record a decision about bytes that are no
 * longer under review.
 */
export function offeredActions(
  f: Finding,
  currentVersion: number,
  can: { resolve: boolean; waive: boolean },
): FindingAction[] {
  if (isSettled(f.status) || f.versionNumber !== currentVersion) return [];
  if (f.severity === 'BLOCKING') return can.waive ? ['waive'] : [];
  return can.resolve ? ['resolve', 'dismiss'] : [];
}

/** The justification floor the API's DTO enforces with `@MinLength(10)`. */
export const MIN_JUSTIFICATION = 10;

/**
 * Whether the screen offers to scan a document in place. ACTIVE only: DRAFT
 * and REJECTED are scanned by submit-review, where a blocking finding gates
 * approval, and the API refuses every other status with a 400.
 */
export function offersLiveScan(status: string, canScan: boolean): boolean {
  return canScan && status === 'ACTIVE';
}

/**
 * What to say when a document has no findings.
 *
 * For a document still in the workflow, an empty list means the submit-time
 * scan ran and found nothing, because submit-review cannot complete without
 * scanning. For a live document it means nothing of the kind: every document
 * approved before the scan shipped has an empty list and was never read by
 * it. Saying "no findings were raised" there reads as a clean result, and on
 * the production corpus at the time of writing it would have said so about
 * all five live documents.
 */
export function emptyFindingsKey(status: string): 'noFindings' | 'noFindingsLive' {
  return status === 'ACTIVE' ? 'noFindingsLive' : 'noFindings';
}
