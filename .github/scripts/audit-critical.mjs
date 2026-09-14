// Fails the build when `npm audit` reports a critical advisory in the tree this
// script is run from. Used by both audit gates in ci.yml (the root workspace
// tree, and apps/mobile, which is not an npm workspace and so is invisible to
// the root audit).
//
// Why this exists rather than `npm audit --audit-level=critical`:
//
// That command reaches the registry's legacy "quick" audit endpoint, which npm
// now announces is "being retired" and which answered
//
//   400 Bad Request - POST /-/npm/v1/security/audits/quick
//   { message: 'Invalid package tree, run npm install to rebuild your package-lock.json' }
//
// on an unchanged lockfile that `npm ci` had installed cleanly seconds earlier
// in the same job. `npm audit` then exits 1 on the transport error, which the
// gate cannot tell apart from a real critical finding. The message is also
// misleading: the very next step audited the same tree through the bulk
// endpoint and produced a full report, so the package tree was fine.
//
// A security gate that fails on registry mechanics is not a stricter gate — it
// is a gate whose red light stops meaning anything, which is how a real
// critical finding ends up being waved through as "that job is flaky again".
//
// `npm audit --json` uses the bulk advisory endpoint and reports counts by
// severity, so the decision is made here on data rather than on an exit code
// that conflates "found something" with "could not look".
//
// An audit that could not run is a failure, not a pass. Silently succeeding
// when the advisory data never arrived would be the one outcome worse than a
// false red.
import { spawnSync } from 'node:child_process';

const result = spawnSync('npm', ['audit', '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  shell: process.platform === 'win32',
});

// Note: a non-zero exit code is expected here whenever ANY vulnerability is
// found at any severity, so it is not on its own evidence of anything. The
// parsed report is.
let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error('npm audit produced no parseable JSON — the audit did not run.');
  console.error(result.stderr?.trim() || '(no stderr)');
  process.exit(1);
}

if (report.error) {
  console.error('npm audit reported an error rather than a result:');
  console.error(JSON.stringify(report.error, null, 2));
  process.exit(1);
}

const counts = report.metadata?.vulnerabilities;
if (!counts || typeof counts.critical !== 'number') {
  console.error('npm audit returned no severity counts — refusing to call that a pass.');
  console.error(JSON.stringify(report.metadata ?? report, null, 2).slice(0, 2000));
  process.exit(1);
}

const summary = ['critical', 'high', 'moderate', 'low', 'info']
  .map((level) => `${counts[level] ?? 0} ${level}`)
  .join(', ');

if (counts.critical > 0) {
  console.error(`FAIL: ${counts.critical} critical vulnerability(ies). Full counts: ${summary}`);
  console.error('Run `npm audit` locally for the advisory list.');
  process.exit(1);
}

console.log(`No critical vulnerabilities. Counts: ${summary}`);
