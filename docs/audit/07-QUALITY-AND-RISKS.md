# 07 — Quality and risks

Ordered by what would hurt a patient or a deployment first, not by how
interesting it is. Everything here is either measured on this commit or cited
to a file; nothing is inferred from a filename.

## What is genuinely strong, and why it holds

Stated first because a risk register without it is not a measurement.

**The clinical safety properties are structural rather than procedural.** Each
of the five is a consequence of where code sits, so it cannot be forgotten at a
call site:

- Retrieval cannot see unapproved content — four hard SQL filters in one query.
- The model cannot invent a citation — `LlmAnswer` has no citation field.
- Refusal has four gates converging on one verbatim string, and exactly one
  `refused: false` return exists in the service.
- Authorization never reads the database — the matrix is compiled.
- Rejected PHI is never stored — the check is a guard, and guards run before
  the audit interceptor.

**The comments carry incidents, not descriptions.** A reader learns *why* from
the source: the `Math.max(1, NaN)` that silently disabled the per-document cap,
the 9-character `ADMIN_PASSWORD` that left zero active users, the `Buffer`
pooling bug that made PDF extraction fail intermittently for small documents,
the withdrawn MinIO image. `grep -rnE '\b(TODO|FIXME|HACK|XXX)\b'` across all
four source trees returns **0**.

**Several controls were verified by mutation**, not by reading: dictionary
parity (delete an Arabic key, watch `tsc` fail with `TS7053`), the advisory lock
and the UNIQUE constraint (revert each separately against a real database), the
audit gate (stub a critical, stub an error, remove the lockfile), and every
mobile assertion (checked against a deliberately broken copy of the module).

**Measured on this commit:** 416 unit tests across 29 suites, 0 failures; lint 0
errors / 10 warnings, all `no-explicit-any`; `next build` producing 20/20 static
pages; `npm audit` 0 critical.

---

## Risks

### 🔴 1. Nothing establishes that the answers are clinically sound

The platform routes correctly. Whether what it says is right for a patient has
never been assessed, and cannot be assessed by engineering.

The only automated quality harness — the 15-case gold set — is **circular by
construction**: its questions were written by reading the four seeded demo
documents they retrieve from, and its assertions name those documents. It runs
the *mock* embedder (a hashed bag-of-words) over four *synthetic* documents. It
is a good regression detector and not a measurement, and the repository says so
itself in three places.

`docs/clinical-validation.md` is the protocol, and it is unusually honest: it
opens by stating it is a procedure for obtaining sign-off and is not itself one.
The field set and `npm run eval:field` now produce the §5.2 scoring sheet with
the machine columns filled and the four clinical judgement columns blank — the
instrument exists; the verdict does not.

**Mitigation: none available here.** A qualified reviewer must fill four columns
on questions ward staff actually asked. `docs/production-readiness.md` keeps this
🔴 for pilot and production, correctly.

### 🔴 2. The production corpus has never been inspected

Roughly 725 chunks are indexed in production — a figure from a boot log quoted
at `docs/production-readiness.md:343`, dated 2026-08-22. Nobody in this audit has
seen those documents, their titles, their sources, or their approval history.
Whether they passed through `DRAFT → … → ACTIVE` with real reviewers is unknown.

This audit found the readiness scorecard marking that corpus ✅ "real, governed"
for the pilot column while the same document's runbook listed the real corpus as
still outstanding. That contradiction is corrected; the underlying uncertainty
is not.

**Mitigation available today, in five minutes:** `GET /documents/inventory`
(permission `documents:read`) reports per document whether the assistant can
actually cite it, and names the reason when it cannot. It has not been run
against production. It was also, until this audit, **absent from
`docs/api.md`** — which is part of why nobody ran it.

### ✅ 3. The stale advisory count — and the explanation underneath it was also wrong

**Closed.** `npm audit` on this commit reports **0 findings at every severity**.

The original finding stands as written: four statements across three documents
carried a stale count, two of them claiming zero findings when there were nine.
The risk named was that *a count that ages cannot be maintained by remembering
to maintain it.*

What the fix revealed is worse than a stale count, and it is worth keeping
visible. Every one of those documents also explained **why** the nine stood — a
NestJS 12 major for the highs, an unfixable `js-yaml` split for the build-time
pair. Both explanations were wrong:

- Six of the seven packages in the "NestJS 12 chain" had **no advisory of their
  own**. `npm audit --json` lists a package when a *dependency* is vulnerable,
  and all six traced to `multer`, fixed in 2.3.0. One override bump closed
  seven entries.
- The `js-yaml` claim — that forcing one version would break the 3.x consumer —
  was true and beside the point. Neither copy had to move version *lines*:
  4.3.2 sits inside ESLint's declared `^4.3.0`, and 3.15.2 inside jest's
  `^3.13.1`. Both had shipped weeks earlier. `qs` was the same.

So three of four advisories were held open by a stale lockfile pinning packages
below floors their own parents allowed — **the failure mode `CLAUDE.md` already
documents from the `next` upgrade**, occurring again in a security context
without being recognised as the same thing.

**And this audit repeated the explanation rather than testing it.**
`06-DEPENDENCIES.md` restated the NestJS-12 framing and the `js-yaml` reasoning
as established fact. Both are corrected there, and the correction is recorded
rather than swapped in quietly.

The generalisable lesson is narrower than "verify claims": **a documented reason
why something cannot be fixed ages exactly like the count it explains, and is
re-read far less often.** A stale number looks stale. A stale rationale looks
like understanding.

The original mitigation still stands, and is still not built: either CI writes
these numbers or the documents stop stating them. It would have caught the
count. It would *not* have caught the rationale.

### 🟠 4. The web app has no tests, and one defect class is caught by nothing

Zero spec files, no test runner, no coverage instrumentation. The only automated
checks are `next build` (which typechecks) and the Playwright browser smoke.

That smoke is good — role-visibility is asserted in **both** directions, so a
locator matching nothing can no longer make a check pass vacuously — but it is
one flow, not a suite, and it reports no test count.

One class of defect is caught by nothing at all: **a hardcoded English literal.**
It never enters the dictionary, so compiler-enforced parity cannot see it; the
smoke asserts `dir`/`lang` and one Arabic nav label but nothing about shared
chrome. `ErrorState` and `Pagination` rendered English on 14 and 3 surfaces
respectively while every screen around them translated, and `genericError` had
been in the dictionary the whole time.

No test was added, and the honest reasons are recorded: a browser assertion
would pass vacuously whenever `Pagination` does not render (the demo corpus is
four documents against a limit of 50), and a grep-based lint rule is too fragile
to trust. The class is caught by review, and saying so is better than a check
that looks like coverage.

### 🟠 5. `storage/` is executed by no test — and a sibling gap that has now bitten

**The sibling bit first, so it is no longer hypothetical.** The multer wiring
between `@UseInterceptors(FileInterceptor(...))` and `isPdf()` had no coverage
that runs without a database. A dependency change silently stopped multipart
parsing, and 412 unit tests, lint and `next build` all stayed green while every
document upload returned 400. Only CI's integration job — which needs a real
PostgreSQL — caught it. That specific hole is now closed by
`apps/api/src/documents/upload-wiring.spec.ts`, verified by mutation in both
directions; see `09-GAPS.md`.

The `storage/` hole is the same shape and still open.

`StorageService` — S3 client construction, `ensureBucket()`, presigned-URL
generation, `isHealthy()` — has no unit spec, and the integration suite cannot
reach it either: `test/support/e2e-app.ts` substitutes S3 with an in-memory
fake. That substitution is the right call for a test boundary, but it means the
real code path runs only when the full stack runs, which is CI's browser-smoke
job and nothing else.

`ensureBucket()` is the piece that matters: since `minio-init` was deleted, it
is the **only** thing that creates the bucket.

### 🟡 6. Observability stops at the integration point

Application logs are structured JSON on stdout, `/health` is liveness-only and
`/health/ready` checks Postgres and object storage. That is the correct shape.

Nothing collects it. There is no log shipping, no metrics, no tracing, no error
tracking, no alerting, and no frontend error reporting. Searched: `prom-client`,
`opentelemetry`, `@sentry`, `datadog`, `newrelic` — zero hits in any manifest or
source.

The specific consequence for this product: **an embedding-provider mismatch
makes the assistant refuse every question, safely and silently.** The boot
summary logs `staleRetrievable`, and nobody is watching the log. A refusal-rate
alert is the single highest-value observability item here, and it does not
exist.

### 🟡 7. Two operational blanks with no engineering fix

- **Backups and a rehearsed restore.** Nothing here has ever backed anything up.
- **MFA is enrollable but not enforceable.** A user can turn TOTP on for
  themselves; no administrator can *require* it for a role. Adoption is
  voluntary, which for a clinical system holding an audit trail is a policy gap
  rather than a plumbing one.

### 🟡 8. Known, accepted, and worth re-reading before pilot

- **`PUT /settings/:key` takes `{ value: unknown }` and is not PHI-screened.**
  Documented as a known limitation, reachable only by `settings:manage` holders.
  Revisit if free-text settings are ever exposed more widely.
- **`PHI_MRN_PATTERN` ships disabled.** The mechanism is complete; one
  environment variable turns the MRN check on with no code change. It is unset
  because the hospital has no institutional MRN format yet. A malformed pattern
  fails the boot rather than silently disabling the check.
- **One accepted false positive**: a ten-digit batch or catalogue number
  starting with 1 or 2 is rejected as a national ID. Pinned by a test so it
  stays a decision on record.
- **No per-record ownership gate** on documents, answers or dose calculations.
  Access is permission-based only, so `NURSE_USER` can read every approved
  document rather than a subset. Whether that is intended is a design question
  this audit does not answer.
- **`audit_logs` has no append-only enforcement at the database level.** No hash
  chain, no trigger, no REVOKE. No UPDATE or DELETE against it exists in the
  source — so immutability rests on there being no such code, not on the
  database refusing one. The mobile audit screen *deliberately omits* a
  "tamper-proof SHA-256 chain" badge for exactly this reason, which is the right
  call and worth preserving.
- **The expiry cron runs in-process.** Under `replicas: 2` it runs twice. The
  k8s README names this; the Railway deployment is single-replica, so it is not
  currently biting.

### 🟡 9. The browser-smoke gate can go red with no finding behind it

Observed during this audit, across the seven heads pushed to this branch. The
`Browser smoke` job failed on three of them and passed on the other four, with
the same failure each time and at the same point — image resolution, before any
container existed:

```
minio Error received unexpected HTTP status: 504 Gateway Time-out
Error response from daemon: received unexpected HTTP status: 504 Gateway Time-out
##[error]Process completed with exit code 1.
```

(`actions/runs/34882434274/job/104104741252`, head `cee8103`.) The commits that
failed changed markdown only, and the same job passed on later markdown-only
commits — so this is `quay.io` being briefly unavailable, not a defect.

The reason it belongs in a risk register is that **this repository already
solved exactly this problem once, for a different gate, and wrote down why.**
`.github/scripts/audit-critical.mjs` exists because `npm audit --audit-level=critical`
could fail on registry mechanics, and its header states the argument plainly:

> a security gate that fails on registry mechanics is not a stricter gate — it
> is a gate whose red light stops meaning anything, which is how a real critical
> finding ends up being waved through as "that job is flaky again".

The smoke job has the same shape and no equivalent guard: it pulls three images
from two registries at run time, and a 504 from either is indistinguishable, in
the check list, from a broken quickstart or a failed Playwright assertion. It is
also the **only** automated check that exercises the web app beyond compilation,
and the only thing that executes `StorageService` at all (risk 5) — so a red
light nobody reads costs more here than on most jobs.

Not fixed in this branch, and the reason is the same one given for the advisory
count: this is a CI change rather than a documentation correction, and nothing
in this audit establishes it was asked for. A retry with backoff around
`docker compose up -d --build`, or a pre-pull step that distinguishes a pull
failure from a test failure in the job's own output, would be the minimal shape.

### 🟢 10. Technical debt that is real but not urgent

- **Genuine duplication between web and mobile**: two i18n dictionaries, two API
  clients. It follows from `apps/mobile` deliberately not being a workspace, and
  the duplicated surface is small and stable.
- **Ten `no-explicit-any` warnings**, five of them in test files. Of the five in
  source, three sit at genuine type boundaries — an exception filter handling an
  unknown thrown value, an interceptor reading an untyped request, and a raw-SQL
  row from pgvector.
- **No OCR.** `pdf-parse` reads the text layer only, so a scanned Arabic PDF
  indexes zero chunks. This is the one item on the open list that is squarely
  engineering work in this codebase.

---

## The cross-cutting risk this audit is most confident about

**Documentation drift is this repository's most frequent defect, and it is
concentrated in exactly one kind of statement: a number or an invariant restated
away from the code that defines it.**

Every instance found:

| Drift | Where | Correct |
| --- | --- | --- |
| Retrieval invariant missing the 4th filter | `database-schema.md`, `architecture.md`, `README.md` ×2 | four filters |
| Advisory count, **and the reason given for it** | `SECURITY.md` ×2, `production-readiness.md` ×2, `README.md` | 0 at every severity — the nine were closed without the framework major all four documents said they needed |
| Contractual Arabic strings | `CLAUDE.md` | three, not two |
| Refusal gates | `CLAUDE.md` | four, not three |
| `GET /audit?action=` | `SECURITY.md` ×2 | `GET /audit-logs` |
| `PATCH /settings/:key`, `settings:write` | `SECURITY.md` | `PUT`, `settings:manage` |
| Two undocumented routes | `docs/api.md` | inventory, chat answers |
| Database tables / permissions | `REPO-DISCOVERY.md` | 17 tables, 22 permissions |
| Test counts | `production-readiness.md` | 416 unit |

Two of those had **operational consequences** rather than cosmetic ones: the
missing retrieval filter would have led a reader to remove a load-bearing
predicate, and `GET /audit?action=` is the documented way to verify that two
security controls fired — an operator following it gets a 404 and cannot
distinguish that from the control not having fired.

The pattern underneath them is narrow enough to act on: **a count written above
a list, and an invariant summarised away from its query.** `REPO-DISCOVERY.md`
enumerated all 17 tables directly beneath a heading saying 14, and all 22
permissions beneath a heading saying 21. Nothing recomputed the number from the
list it had just produced.

And the same failure appeared in this audit's own work three times — an index
row that read a service out of a comment explaining its deletion, a scan that
reported zero for a construct it could not see, and an uncited production chunk
count repeated five times until it read like a fact. The common lesson is not
"be careful": it is that **"measured by command" is not evidence the command
measured the right thing**, and the cheapest guard is to have two methods
disagree.
