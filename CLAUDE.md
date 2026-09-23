# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**BNP Decision Guard** — a clinical knowledge-governance platform. Nurses get AI answers drawn **only** from hospital PDFs that have passed a governed approval workflow. When no approved source sufficiently supports an answer, the assistant **refuses** rather than guessing.

## Commands

```bash
npm install
npm run build:shared          # ALWAYS first after a clean install (see gotchas)

npm test                      # API unit tests (527), mocked repositories, no I/O
npm run test:e2e -w @bnp/api  # API integration tests (285), real HTTP + real Postgres
npm test -w @bnp/web          # web unit tests (45) — src/lib only, see below
npm run lint                  # ESLint 9 flat config, whole monorepo (see gotchas)
npm run build:api             # builds shared + api
npm run build:web             # builds shared + web
npm run dev:api               # API on :4000
npm run dev:web               # web on :3000
npm run seed                  # migrations + idempotent demo data
npm run inventory             # prints the clinical reference inventory
```

Single test (run from repo root):

```bash
npm test -w @bnp/api -- --testPathPattern=dose   # one spec file
npm test -w @bnp/api -- -t "refus"               # tests matching a name
```

### The two test suites are deliberately separate

`apps/api/src/**/*.spec.ts` are unit tests: every repository is a `jest.fn()`,
nothing touches the network or a database. Config lives in `package.json`
(`rootDir: src`).

`apps/api/test/**/*.e2e-spec.ts` are integration tests: real HTTP through the
real `AppModule` — guards, `ValidationPipe`, exception filter and all — against
a real PostgreSQL + pgvector. Config is `apps/api/jest-e2e.config.js`. They live
*outside* `src/` on purpose: `.e2e-spec.ts` also matches the unit suite's
`.*\.spec\.ts$` pattern, so keeping them out of `rootDir` is what stops the unit
run from trying to execute them.

They need a database. Point them at one with `E2E_POSTGRES_*` (host, port, user,
password, db — defaults to `bnp_e2e`):

```bash
docker compose up -d postgres
E2E_POSTGRES_DB=bnp_e2e npm run test:e2e -w @bnp/api
```

### The answer-quality gold set

`apps/api/test/answer-quality.e2e-spec.ts` runs a gold set of questions
through the whole governed chain — real PDFs, chunking, embeddings, pgvector,
reranking, threshold, refusal gate — and asserts each reaches the document
that actually holds its answer, and that questions no approved source covers
are refused. It runs inside the normal e2e job, so a retrieval regression
fails the build.

Two boundaries are deliberate and worth keeping straight:

- **Routing is gated; answer content is only measured.** Whether the extract
  surfaced the specific figure depends on the *mock* LLM's sentence-picking,
  which is a stand-in — gating on it would fail builds over behaviour that
  never ships.
- **A green run is not clinical approval.** It says the plumbing routes
  correctly. Whether the answers are clinically sound is a reviewer's
  judgement on real questions.

`npm run test:eval` additionally writes `apps/api/eval-report.md` with a
scored breakdown and a `RAG_MIN_SIMILARITY` sweep showing the
answer-vs-refuse trade-off. The report is gitignored on purpose: a committed
copy goes stale silently, which is the failure mode it exists to catch.

### The field set — the evaluation set that is *not* derived from the corpus

The gold set above is circular by construction: its questions were written by
reading the four demo documents they retrieve from, and its assertions name
those documents. That makes it a good regression detector and a poor
measurement.

`apps/api/eval/field-set.starter.jsonl` is the other half. Cases live in JSONL
so a nurse educator can replace the whole set without touching code, and the
loader **rejects** `expectSource` / `expectAnswerContains` / `expectRefusal`:
a field set records no expected document and no expected answer, because
whoever collects what staff actually look up does not know which page holds the
answer — and if they did, they wrote the question from the page.

So nothing clinical is gated. What is gated are five invariants that hold on
*any* corpus (`src/eval/field-eval.ts`): a refusal returns `REFUSAL_MESSAGE_AR`
verbatim with no citations and `NONE` confidence; an answer carries a citation
with a title and an approval date; `refusedAt` names one of the four gates;
`MODEL_ERROR` never counts as governance; nothing 400s or 5xx's. Everything
else — coverage, which document was cited, paraphrase agreement, the simulated
threshold sweep — is measured into a report and asserted nowhere.

Two runners, one scoring core:

```bash
npm run test:eval:field -w @bnp/api   # CI/demo corpus; EVAL_REPORT=1 writes the sheet
EVAL_PASSWORD=… npm run eval:field -w @bnp/api -- \
  --base-url https://… --email nurse@… --cases eval/field-set.starter.jsonl
```

The script is plain `fetch` — no Nest context, no database — so it runs against
a container with no shell, as a `NURSE_USER` and nothing else (a manager sees
what a nurse cannot, so a review run as a manager measures a different
product). It writes nothing to the target: `/rag/query` persists no answer, and
the threshold sweep is simulated from the scores the run already returned
rather than by changing a live setting.

The output is the `docs/clinical-validation.md` §5.2 scoring sheet with the
machine columns filled and the four clinical judgement columns left blank.
**The runner produces the paperwork, not the verdict** — and the shipped starter
cases are `engineering-authored`, which the report says at the top, because
questions an engineer imagines are not evidence about what nurses ask.

`apps/api/eval/README.md` is the staff-facing guide; rule one there is *never
write a question by reading a policy*.

Only three things are faked, and each is a genuinely external boundary: S3
storage (in-memory), SMTP (captured so specs can read the reset link), and PDF
text extraction. The extraction stub is a convenience for the *integration*
suite — it lets a spec choose the text a document yields — not a limitation.

An earlier version of this file claimed extraction could not be tested at all,
because "`pdf-parse`'s bundled pdf.js throws inside any jest process however it
is loaded". That was wrong, and it hid a real bug: pdf.js clones its input via
`new value.constructor(value)`, which for a `Buffer` allocates out of Node's
shared pool and then gets misread, so extraction failed intermittently for any
document small enough to be pooled. Passing a plain `Uint8Array` fixes it, and
`apps/api/src/rag/pdf-extraction.service.spec.ts` now covers extraction
directly using real pdfkit-generated PDFs.

### The web suite — `src/lib` only, and it says so

`npm test -w @bnp/web` is a fourth jest project (45 tests) over `src/lib/api.ts`,
`src/lib/i18n.ts`, and the pure decisions the governance screens make
(`src/lib/findings.ts`, `src/lib/documents.ts`). Like mobile's it runs on
`testEnvironment: node` rather than jsdom, because none of these imports React: `test/setup.ts` installs
stand-ins for the only two browser globals `api.ts` touches — `localStorage`
and `window.location` — so a test can assert what was stored and where the page
was sent. `tsconfig.spec.json` overrides the app's `moduleResolution: 'bundler'`,
which ts-jest's CommonJS output cannot use.

It exists because refresh-on-401 is the web app's session layer and nothing ran
it. The browser smoke drives a logged-in flow but never lets a token expire, so
"the token refreshes" was an untested claim about the code every screen depends
on. The five refresh assertions are mutation-verified: dropping the retry,
dropping the session clear, or ignoring `retryOn401: false` each fails them.

**The screens still have no runtime coverage** — that needs jsdom plus
`@testing-library/react`, and this suite does not claim it.

Mobile (separate install, not an npm workspace):

```bash
cd apps/mobile && npm install && npx tsc --noEmit && npm test && npm start
```

`npm test` there is its own independent jest project (32 tests) covering
`src/api.ts` and `src/i18n.ts` — session storage, refresh-on-401, and the
bilingual helpers. It runs on `testEnvironment: node` rather than the
`jest-expo` preset, because neither module imports a React Native component;
the two native storage modules are mapped to fakes in `apps/mobile/test/mocks/`
via `moduleNameMapper`. Keeping those two fakes separate is deliberate — it is
what lets a test assert that tokens reach SecureStore and never AsyncStorage.
The screens have no runtime coverage; that would need `jest-expo` plus
`@testing-library/react-native`.

Full stack via Docker (`docker compose up --build`) → web :3000, API :4000, MinIO console :9001. Infra only: `docker compose up -d postgres minio`.

**MinIO comes from `quay.io`, not Docker Hub.** `minio/minio` and `minio/mc` were
withdrawn from Docker Hub — both answer 404 on the repository API while
`pgvector/pgvector` beside them answers 200 — so every `docker compose up` and
every CI browser-smoke run died at image resolution with `pull access denied for
minio/minio`, before any container existed. `quay.io/minio/minio` is MinIO's own
registry, so this is a registry change, not a change of software. The
`minio-init` service was deleted rather than repointed: its only job was
`mc mb`, and `StorageService.ensureBucket()` (`storage.service.ts:53-64`) already
creates the bucket, called from `documents.service.ts:85` on every upload and
from `seed.ts:160` on boot.

Migrations run automatically on API container boot; standalone: `node apps/api/dist/scripts/migrate.js`.

## Architecture

npm workspaces monorepo: `apps/api` (NestJS 11), `apps/web` (Next.js 16 App Router), `apps/mobile` (Expo 57 / React Native 0.86 / React 19, **not** a workspace), `packages/shared`.

### The clinical safety contract

`packages/shared/src/constants.ts` holds three Arabic strings returned **verbatim** — tests assert exact string equality. Never reword, translate, or reformat them:
- `REFUSAL_MESSAGE_AR` — returned whenever no approved source qualifies
- `DOSE_SAFETY_WARNING_AR` — attached to every dose calculation result
- `PHI_REJECTION_MESSAGE_AR` — thrown by `PhiScreenGuard` when a request carries patient-identifying data (`phi-screen.guard.ts:105`)

This section listed only the first two until an audit compared it against the
file. The third is under exactly the same contract, not a lesser one: nine
tests assert it with `toBe` — `phi-screen.guard.spec.ts:100` and
`phi-screening.e2e-spec.ts:137,273,299,331,385,421,454,467` — so rewording it
fails the build the same way rewording a refusal does.

### PHI screening runs as a guard, so it only sees a body middleware parsed

`@ScreenForPhi({ body: [...] })` is enforced by `PhiScreenGuard`, and Nest runs
**middleware → guards → interceptors → pipes → handler**. Running before the
interceptor chain is the point: a rejected request never reaches
`AuditInterceptor`, so "rejected text is written to no store" is a property of
the ordering rather than a promise about what each call site avoids logging.

The corollary is the trap. The guard reads `req.body`, so it screens only what
something earlier already parsed. JSON routes are fine — `express.json()` is
middleware. **Multipart is not**, and `POST /documents/upload` is the only
multipart route. Parsing it with `FileInterceptor` put the parse one stage too
late: `req.body` was `undefined` at guard time, the guard scanned nothing, and a
national ID in a document title was stored while the route still read as
screened. That is why the upload's multer lives in `DocumentUploadMiddleware`
and is registered in `DocumentsModule.configure()`, **not** in a
`@UseInterceptors(FileInterceptor(...))` on the controller. Do not move it back;
`upload-wiring.spec.ts` fails if you do, and it also asserts the 413 mapping,
which `FileInterceptor` used to provide for free.

### Refusal-first RAG chain (`apps/api/src/rag/`)

`RagQueryService.ask()` orchestrates: `RetrievalService` → `RerankService` → threshold → `LlmService`. It returns the exact refusal at **four** independent points, which `RagDiagnostics.refusedAt` names (`rag-query.service.ts:57-62`):

1. `NO_CANDIDATES` — retrieval returned nothing (`:131`)
2. `BELOW_THRESHOLD` — nothing scored above `RAG_MIN_SIMILARITY` (`:162`)
3. `MODEL_ERROR` — the LLM call itself failed (`:173`)
4. `MODEL_FOUND_NOTHING` — the LLM produced an empty answer (`:184`)

Three of those are governance and one is not, and the difference is
load-bearing: `MODEL_ERROR` is an infrastructure failure wearing a refusal's
clothes, which is why `src/eval/field-eval.ts` refuses to score it as
governance. This section used to say "three", silently folding `MODEL_ERROR`
into the same list — while the field-set section further up already said
"one of the four gates". Non-refused answers always carry citations (document, page, approval date, confidence).

`RetrievalService.search()` applies four hard SQL filters — all four are load-bearing safety constraints, don't relax them:
1. `status = ACTIVE` (only fully approved+indexed docs)
2. not expired
3. chunk version matches the document's current version
4. `embedding_provider` equals the **currently configured** provider

### Embedding-provider consistency (non-obvious, important)

Vectors from different embedding providers occupy incompatible spaces. Every chunk is stamped with the provider that embedded it, and retrieval filters on the active one. So switching `EMBEDDING_PROVIDER` makes the assistant **refuse everything** (safe) rather than return junk-similarity answers, until `POST /rag/reindex` (permission `documents:index`) re-embeds the corpus. A startup check in `IndexingService.onApplicationBootstrap` warns when stored chunks are stale.

`providerCoverage()` splits the mismatch in two, and the distinction matters: **`staleRetrievable`** counts chunks from another provider on ACTIVE, unexpired, current-version documents — the number that should be zero and the only one a reindex can move — while **`staleOrphaned`** counts chunks on expired or superseded documents, which retrieval already excludes for unrelated reasons and `reindexAll()` (ACTIVE-only) can never fix. Warning on the combined total meant one expired document produced a permanent alarm no action could clear. Repair with `POST /rag/reindex/stale` (only the affected documents) or `POST /rag/reindex/:documentId` — the latter exists because `POST /documents/:id/index` refuses an ACTIVE document, so the only previous route to fixing one live document was deactivate → re-approve → re-index, three approval-history events for an infrastructure operation.

**Chunk writes are serialised.** `indexDocument` takes `pg_advisory_xact_lock` on the document id inside its transaction, and migration `1720000004000` adds `UNIQUE (document_id, version_number, chunk_index)`. Both are needed and they do different jobs: DELETE-then-INSERT under READ COMMITTED lets two concurrent index calls each miss the other's uncommitted rows, so both chunk sets survive. The constraint turns that silent duplication into an error; the lock is what makes the concurrent case actually succeed. Verified by reverting each one separately against a real database.

**A query-side dimension mismatch refuses rather than 500s.** `RetrievalService.search()` catches pgvector's `different vector dimensions` specifically and returns no candidates, so the question routes through the `NO_CANDIDATES` gate and the nurse gets the governed refusal instead of a generic 500. The catch is deliberately narrow — every other database failure still raises, because a refusal that hides a broken database is worse than an error.

Both LLM and embeddings are pluggable via `LLM_PROVIDER` / `EMBEDDING_PROVIDER` (`mock` | `openai`). The **mock LLM is extractive** — it composes answers only from retrieved chunk text and structurally cannot hallucinate, which is why the whole system works offline with no API key. OpenAI-compatible calls share `openai-http.ts` (timeout + one retry on 429/5xx).

### Document lifecycle (`apps/api/src/approval/approval.service.ts`)

`DRAFT → IN_REVIEW → APPROVED → INDEXED → ACTIVE`, plus `REJECTED`, `EXPIRED`, `INACTIVE`. A `TRANSITIONS` map rejects illegal moves. Notes:
- The `index` action performs INDEX **and** ACTIVATE in one call — one click takes an approved doc live.
- Re-uploading bumps `versionNumber` and resets status to `DRAFT`; a new version must be re-approved before the AI can cite it.
- A daily cron (`notifications.service.ts`) expires stale documents, removing them from retrieval immediately.
- `submitReview()` runs the pre-activation conflict scan **before** `transition()`, and `approve()` consults the conflict gate **before** assigning `approvedBy`/`approvalDate`. Both orderings are mutation-tested in `approval.service.spec.ts`; see the next section for why.

### Pre-activation conflict detection (`apps/api/src/findings/`)

A deterministic scan runs over a document's text on `submit-review` and writes
`review_findings`; `approve()` refuses (400, audited as
`DOCUMENTS:APPROVE_BLOCKED`) while a `BLOCKING` finding stands against the
version being approved. Layer 1 only — no model, no corpus, no formulary. The
rules are pure functions in `findings/l1/structural-rules.ts`, following
`packages/shared/src/phi.ts`; the ISMP abbreviation table is data in
`findings/l1/ismp-abbreviations.ts` so a pharmacist can edit it without touching
matching logic.

Five things here are load-bearing and easy to undo by accident:

- **The scan never throws, and a failure is a `BLOCKING` finding.** An
  extraction error or timeout becomes `SCAN_FAILED`/`SCAN_TIMEOUT`. If it
  propagated, `submit-review` would error and reviewers would retry until it
  passed (`phi-screening.e2e-spec.ts:319-323` is the canary: it submits with
  no stub text set and expects 201); if it were swallowed, the gate would see zero findings on a
  document nobody could read. It is awaited, not dispatched — there is no job
  queue, and `seed.ts:187-190` calls `submitReview()` then `approve()` in the
  same process with nothing in between.
- **Scan before transition, gate before mutation.** `transition()` is not
  transactional. Scan-after would leave a bug's victim `IN_REVIEW` with no
  findings — fail-open. The status check is hoisted and read from
  `TRANSITIONS`, exactly as `index()` does, so the scan never runs on a move
  the state machine is about to refuse.
- **The gate is service-level, not a route guard**, because `seed.ts:189`
  calls `approve()` with no HTTP request.
- **Supersession is the version predicate, not the `SUPERSEDED` status.**
  `ConflictGateService` reads `version_number = doc.versionNumber`; the stamp
  `ScanService` writes is for the reviewer's history and is *not* what the gate
  consults. `UNIQUE (document_id, version_number, fingerprint)` +
  `ON CONFLICT DO NOTHING` makes a `REJECTED → IN_REVIEW` re-scan idempotent
  and leaves a `WAIVED` row untouched.
- **Dual control is enforced on role membership read from the database.** A
  `BLOCKING` waiver needs two different users covering both
  `PHARMACIST_REVIEWER` and `CBAHI_QUALITY_OFFICER` (set cover, not a count:
  two pharmacists fail, one dual-role user fails). Not on the permission —
  `ROLE_PERMISSIONS[SUPER_ADMIN] = ALL_PERMISSIONS` would let one admin sign
  both halves — and not on `actor.roles`, a login-time JWT snapshot. Separation
  of duties anchors on `document_versions.created_by_id` for the current
  version, **not** `documents.uploaded_by_id`, which re-upload never rewrites.
  `WAIVER_PENDING` still blocks.

`MAJOR` and `MINOR` findings are recorded and enforce nothing. Rules are held
to a false-positive bar, not a detection bar: bare `GP` is glycoprotein in this
corpus, bare `MS` is multiple sclerosis, `03/04/2026` is undecidable — each is
deliberately not matched, and each has a test that fails if someone widens it.
`RagModule` exports `PdfExtractionService` and `ChunkingService` for the
scanner, which reads text without indexing and so spends no embedding quota.
`AUDITOR` lacks `findings:read` because evidence is verbatim source text.

**A live document is scanned in place, never through the workflow.**
`SUBMIT_REVIEW` accepts only DRAFT and REJECTED, so every document that went
ACTIVE before the scan existed could otherwise be scanned only by re-uploading
it — which resets it to DRAFT and takes it out of retrieval. On production that
was the formulary, 77% of the citable corpus. `POST /documents/:id/findings/scan`
(`findings/live-scan.service.ts`, permission `findings:scan`) runs the same
`scanDocument` on an ACTIVE document and **writes nothing to the document**: a
BLOCKING finding there is shown, not enforced, because the gate lives in
`approve()` and taking a live document offline is the deactivate action's job.
It refuses every other status. The corollary for the screen: on an ACTIVE
document an empty findings list is *not* a clean result, and the panel must not
say it is (`emptyFindingsKey` in `apps/web/src/lib/findings.ts`). No table
records a scan that found nothing, so "never scanned" and "scanned clean" are
indistinguishable in the data — see `docs/production-corpus-audit.md` §7.

### Document provenance and the inventory

**`issuing_authority` lives on two tables, and the duplication is the point.**
Migration `1720000005000` adds `issuing_authority varchar(255)`, nullable, to
both. `documents.issuing_authority` (`document.entity.ts:28`) is the governed
value, edited by `documents:manage`. `citations.issuing_authority`
(`ai.entity.ts:106`) is a **snapshot taken at answer time**, exactly as
`document_title` and `approval_date` already are on that table: the record of
what a nurse was told must survive a later edit to the document — the same
reason `citations.document_id` is `ON DELETE SET NULL` rather than `CASCADE`.
Do not "normalise" the citation copy away.

No default and no backfill, on purpose. Every pre-existing row genuinely has no
recorded authority, and inferring one from a title or filename would produce a
provenance column right often enough to be trusted and wrong often enough to
mislead. `update()` audits the field **by value** (from → to); an empty string
clears it.

**`GET /documents/inventory`** answers *"what can the assistant actually cite
right now"*, which is not the same question as *"what has been uploaded"*. Per
document it reports chunk counts, superseded chunks, embedding providers, the
indexing window and a `notRetrievableReason` that is non-null whenever a
nominally ACTIVE document is excluded by one of the four retrieval filters. Two
constraints when touching it:

- The route is declared **before** `@Get(':id')` (`documents.controller.ts:96`
  vs `:102`). Express matches in declaration order, so below it the literal
  path would be parsed as a document id and rejected by `ParseUUIDPipe`.
- The payload carries a version, `INVENTORY_SCHEMA_VERSION`
  (`inventory.service.ts:41`). Tests assert against the constant, never a
  literal — a literal goes stale on a bump and fails the build for the change
  that was the point.

### RBAC

`packages/shared/src/rbac.ts` is the single source of truth: 7 roles × permission matrix. `PermissionsGuard` enforces the permissions `JwtStrategy` derives from that matrix and **never reads the database** — the seeded `roles`/`role_permissions` rows are a projection for the UI, not an input to authorization. That is why the roles API is read-only (`GET /roles` only): editing `role_permissions` would change nothing, so endpoints that appeared to do so were removed. Change permissions in `rbac.ts`, not in the DB and not in controllers. A role that exists only in the database grants nothing, since it has no entry in the matrix. Assigning *users* to roles (`POST /users`, `PATCH /users/:id`) is genuinely enforced, because roles travel in the JWT.

There is no public self-registration; accounts are provisioned via `POST /users`. Guard order is deliberate — Throttler → JwtAuth → Permissions — so unauthenticated floods are throttled before hitting auth. Use `@Public()` to opt out of auth and `@Permissions(...)` to require capabilities (both from `common/decorators.ts`).

`DOCUMENTS_DOWNLOAD` is deliberately withheld from `NURSE_USER` and `AUDITOR`: nurses read cited answers, they don't copy source PDFs.

### Auth

JWT access + refresh. `users.token_version` makes stateless refresh tokens revocable — `POST /auth/logout` and any password change increment it, invalidating every outstanding refresh token. Password-reset tokens are bound to the same counter, making them single-use. Per-account lockout (`locked_until`) blocks even a correct password and complements the per-IP rate limiter.

### Audit

Two layers: a global `AuditInterceptor` logging every mutating HTTP request (it skips `/auth`, whose service audits itself to avoid recording credentials), plus richer semantic events emitted by domain services (`AI:ANSWER_REFUSED`, `DOSE:CALCULATE`, `RAG:REINDEX`, …).

### Web app

Session lives in `localStorage`; `apps/web/src/lib/api.ts` wraps fetch with automatic refresh-on-401 then redirect to login. Navigation is permission-filtered in `components/shell.tsx`.

**i18n (EN/AR).** `lib/i18n.ts` holds the dictionary + `t()`/`isRtl()`/`localeTag()`; `lib/language.tsx` is the provider and `useT()` hook. Deliberately **not** next-intl and **not** locale-routed: routes stay language-independent so URLs, the browser smoke test and the Railway `/login` healthcheck are unaffected, and every route stays statically prerendered. Language persists in `localStorage` under `bnp.lang` and is applied to `<html lang|dir>` by the `LANG_INIT` script in `app/layout.tsx` **before first paint** — same trick as `THEME_INIT`, and for a stronger reason: a direction flip on hydration moves every element on the page. Two rules when touching web UI:
- Use logical Tailwind classes (`start-*`/`end-*`, `ps-`/`pe-`, `border-s`/`border-e`, `text-start`/`text-end`), never `left`/`right`/`pl`/`pr`/`text-left`. Physical classes do not mirror, which is how you get `dir="rtl"` with a sidebar still pinned left.
- Put `dir="auto"` on anything rendered from API data (document titles, citations, answers, warnings). It takes direction from its own content, which matters because an assistant answer comes back in the language of the question, not of the UI.
Arabic pins the `latn` numbering system (`localeTag()`) so doses, versions, page numbers and timestamps stay comparable against English source PDFs. The three governed clinical strings are never in the dictionary — they come verbatim from `@bnp/shared`.

## Gotchas

- **The HTTP edge lives in `app.setup.ts`, not `main.ts`.** `configureApp()` installs helmet, the JSON body cap, the CORS allowlist, the `ValidationPipe` and the exception filter, and **both** `main.ts` and the integration harness call it. Add middleware there, never to `main.ts` directly: the harness used to carry its own copy of that list, and from the day it was added (2026-08-17) that copy had no `enableCors()`, so the CORS allowlist was a control the suite could not have exercised. `test/edge-controls.e2e-spec.ts` provokes each edge control (foreign origin, oversized body, one request too many) — a control with only a configuration is a decoration until a test does that.
- **`npm run build:shared` before anything else.** API and web import `@bnp/shared` from its compiled `dist/`, so on a fresh clone `npm test` fails with `Cannot find module '@bnp/shared'` until shared is built. The `build:api` / `dev:api` scripts chain it for you; bare `npm test` does not.
- **Migrations are registered explicitly** in `apps/api/src/config/data-source.ts` (no glob). A new migration file is silently ignored until you import it and add it to the `migrations` array.
- **`npm run lint` needs `build:shared` first**, same as `npm test` — typescript-eslint resolves `@bnp/shared` from its compiled `dist/`. CI's lint job runs `build:shared` for this reason. The config is ESLint 9 flat (`eslint.config.js`) and deliberately does **not** use `eslint-config-next`, which still peer-depends on ESLint ≤8; React coverage comes from `eslint-plugin-react-hooks` instead. Errors block CI; the ~10 `no-explicit-any` warnings are known and non-blocking.
- **The `embedding` column is raw SQL, not TypeORM-managed.** pgvector inserts/queries in `indexing.service.ts` and `retrieval.service.ts` use parameterized raw SQL with a `[...]::vector` literal.
- **TypeORM QueryBuilder takes entity property names, not DB column names** — `a.createdAt`, not `a.created_at`. Using the column name throws a confusing `Cannot read properties of undefined (reading 'databaseName')` at runtime, not compile time.
- **Production fail-fast**: with `NODE_ENV=production`, `config/env.ts` refuses to boot if `JWT_SECRET`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`, `S3_ACCESS_KEY` or `S3_SECRET_KEY` is missing or left at its shipped default. This is intended — supply real secrets.
- **`loadEnv()` is the only secret-resolution path.** Don't reintroduce `process.env.X ?? '<literal>'` at a call site: a fallback there resolves to a value published in this repository whenever the variable is unset, and unset only fail-fasts in production. `data-source.ts` matters most — the container runs `dist/scripts/migrate.js` before `main.js`, so it is the earliest code that touches production secrets.
- **`NODE_ENV` is validated.** Only `production`, `development` and `test` are accepted; unset means development. An unrecognised value used to select the development security posture silently, taking the secret fail-fast, CORS fail-closed, 5xx suppression, the reset-token refusal and the seed refusal down together.
- **Every RAG knob is validated, not `parseInt`-ed.** `ragMinSimilarity()`, `ragTopK()`, `ragFinalK()` and `ragMaxPerDocument()` all live in `config/env.ts` and all run from `loadEnv()`, so a typo stops the boot in front of an operator rather than degrading retrieval in front of a nurse. The one that mattered was `RAG_MAX_PER_DOCUMENT`: it was read as `Math.max(1, parseInt(...))`, and `Math.max(1, NaN)` is `NaN` while `used >= NaN` is always false — so a typo silently switched the per-document cap **off**, with no error and no log line, undoing the fix that exists because a live vancomycin-dilution question was answered from a compatibility manual. `RAG_TOP_K` failed louder (`LIMIT NaN`, every question erroring) and `RAG_FINAL_K` in between.
- **`RAG_MIN_SIMILARITY` is validated on every read** (`ragMinSimilarity()`), not `parseFloat`-ed. It must be a finite number in `[0, 1]`. It is read per `ask()` rather than cached so the answer-quality harness can sweep it; `loadEnv()` calls it too so a bad value fails the boot.
- **Demo accounts are neutralised in production.** The seed refuses under `NODE_ENV=production` (in `seed-policy.ts` *and* in the container CMD), and `DemoAccountGuardService` disables any account still using a README-published password at boot. It compares against the shipped literal only, never `SEED_PASSWORD_*`, so it cannot false-positive on a rotated account. `scripts/create-admin.ts` is the break-glass.
- **`MAIL_PROVIDER` deliberately does NOT fail-fast.** It is `log` (default) or `smtp`; `smtp` requires `MAIL_HOST` or boot fails, but a production deploy left on `log` only warns. Mail is a degraded feature, not a security hole, and refusing to boot would take the whole clinical assistant offline over undelivered reset links. `log` writes the reset link into the application log, so it must not serve real users.
- **`CORS_ORIGINS` must be set in production.** Empty means block all cross-origin browser calls, so the web app silently fails against the API.
- **A nested lockfile entry can silently defeat a dependency upgrade.** `next` was pinned at `apps/web/node_modules/next` rather than hoisted, and npm kept reusing that node: raising the declared range and running `npm install next@<newer> -w @bnp/web` printed `up to date` and left the older version on disk — npm resolving *below* its own declared floor, with no error. Deleting the stale `apps/web/node_modules/{next,@next/*}` entries from `package-lock.json` let npm re-resolve and hoist them. Any dependency bump can fail this way, and a security bump failing this way looks like success: `package.json` reads fixed while the vulnerable code is still installed. **After any upgrade, verify the resolved version, not the declared range** — `npm ci` then `node -e "console.log(require(require.resolve('next/package.json',{paths:['./apps/web']})).version)"`. `npm ci` is the reference because it is what CI runs and it installs the lockfile exactly.
- **`edge-controls.e2e-spec.ts` imports `./support/edge-env` first, and that ordering is load-bearing.** `loadEnv()` caches on its first call, and both `ThrottlerModule.forRoot` and the auth controller's `@Throttle` read it at module load — so the spec's low rate limits, CORS origin and body cap must be in `process.env` before anything pulls in `AppModule`. Move that import down and the spec fails with an error that explains none of this. Each jest file has its own module registry, so those values do not leak into the other suites, which keep the ceilings `test/support/env.ts` raises.
- **`AllExceptionsFilter` honours an `http-errors` 4xx.** Express middleware does not throw `HttpException`: `express.json()` rejects an oversized body with `status: 413, expose: true`, and the same shape covers malformed JSON (400) and a bad charset (415). `clientFaultOf()` maps those to their own status. Without it every oversized request answered **500** and was audited as `ERROR:UNHANDLED` — a client fault reported as a server fault. If you add middleware that throws this way, that is why it surfaces correctly.
- **`NEXT_PUBLIC_API_URL` is baked in at Docker build time** (an `ARG` in `Dockerfile.web`), not read at runtime. Changing it requires a rebuild.

## Docs

`README.md` (setup, demo credentials, walkthroughs), `SECURITY.md` (control list + operational requirements), `docs/production-readiness.md` (pilot/production checklist and known gaps), `docs/architecture.md`, `docs/database-schema.md`, `docs/api.md`, `infra/railway/README.md` (the actual live deployment — auto-deploys `main`), `docs/clinical-validation.md` (the reviewer's protocol and the unsigned attestation block), `docs/production-corpus-audit.md` (what the live assistant can cite, reconciled chunk by chunk, 2026-09-23), `docs/audit/` (15 forensic reports plus the coverage ledger) and `REPO-DISCOVERY.md` (an earlier discovery report, pinned to its own commit).

CI (`.github/workflows/ci.yml`) runs six jobs: dependency-audit gates (root and mobile, both hard-fail on critical), lint, API build+unit+migrations+integration against a real pgvector service, web **unit tests then build**, browser smoke against the composed stack, and mobile typecheck+tests. The web job runs `npm test -w @bnp/web` before `next build`, so a broken session-layer test fails the build.
