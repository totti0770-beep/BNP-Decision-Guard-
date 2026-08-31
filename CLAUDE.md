# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**BNP Decision Guard** — a clinical knowledge-governance platform. Nurses get AI answers drawn **only** from hospital PDFs that have passed a governed approval workflow. When no approved source sufficiently supports an answer, the assistant **refuses** rather than guessing.

## Commands

```bash
npm install
npm run build:shared          # ALWAYS first after a clean install (see gotchas)

npm test                      # API unit tests (213), mocked repositories, no I/O
npm run test:e2e -w @bnp/api  # API integration tests (69), real HTTP + real Postgres
npm run lint                  # ESLint 9 flat config, whole monorepo (see gotchas)
npm run build:api             # builds shared + api
npm run build:web             # builds shared + web
npm run dev:api               # API on :4000
npm run dev:web               # web on :3000
npm run seed                  # migrations + idempotent demo data
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

Mobile (separate install, not an npm workspace):

```bash
cd apps/mobile && npm install && npx tsc --noEmit && npm test && npm start
```

`npm test` there is a third, independent jest project (32 tests) covering
`src/api.ts` and `src/i18n.ts` — session storage, refresh-on-401, and the
bilingual helpers. It runs on `testEnvironment: node` rather than the
`jest-expo` preset, because neither module imports a React Native component;
the two native storage modules are mapped to fakes in `apps/mobile/test/mocks/`
via `moduleNameMapper`. Keeping those two fakes separate is deliberate — it is
what lets a test assert that tokens reach SecureStore and never AsyncStorage.
The screens have no runtime coverage; that would need `jest-expo` plus
`@testing-library/react-native`.

Full stack via Docker (`docker compose up --build`) → web :3000, API :4000, MinIO console :9001. Infra only: `docker compose up -d postgres minio minio-init`.

Migrations run automatically on API container boot; standalone: `node apps/api/dist/scripts/migrate.js`.

## Architecture

npm workspaces monorepo: `apps/api` (NestJS 11), `apps/web` (Next.js 16 App Router), `apps/mobile` (Expo 57 / React Native 0.86 / React 19, **not** a workspace), `packages/shared`.

### The clinical safety contract

`packages/shared/src/constants.ts` holds two Arabic strings returned **verbatim** — tests assert exact string equality. Never reword, translate, or reformat them:
- `REFUSAL_MESSAGE_AR` — returned whenever no approved source qualifies
- `DOSE_SAFETY_WARNING_AR` — attached to every dose calculation result

### Refusal-first RAG chain (`apps/api/src/rag/`)

`RagQueryService.ask()` orchestrates: `RetrievalService` → `RerankService` → threshold → `LlmService`. It returns the exact refusal at **three** independent points: no candidates, nothing above `RAG_MIN_SIMILARITY`, or the LLM produced an empty answer. Non-refused answers always carry citations (document, page, approval date, confidence).

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
Arabic pins the `latn` numbering system (`localeTag()`) so doses, versions, page numbers and timestamps stay comparable against English source PDFs. The two governed clinical strings are never in the dictionary — they come verbatim from `@bnp/shared`.

## Gotchas

- **`npm run build:shared` before anything else.** API and web import `@bnp/shared` from its compiled `dist/`, so on a fresh clone `npm test` fails with `Cannot find module '@bnp/shared'` until shared is built. The `build:api` / `dev:api` scripts chain it for you; bare `npm test` does not.
- **Migrations are registered explicitly** in `apps/api/src/config/data-source.ts` (no glob). A new migration file is silently ignored until you import it and add it to the `migrations` array.
- **`npm run lint` needs `build:shared` first**, same as `npm test` — typescript-eslint resolves `@bnp/shared` from its compiled `dist/`. CI's lint job runs `build:shared` for this reason. The config is ESLint 9 flat (`eslint.config.js`) and deliberately does **not** use `eslint-config-next`, which still peer-depends on ESLint ≤8; React coverage comes from `eslint-plugin-react-hooks` instead. Errors block CI; the ~11 `no-explicit-any` warnings are known and non-blocking.
- **The `embedding` column is raw SQL, not TypeORM-managed.** pgvector inserts/queries in `indexing.service.ts` and `retrieval.service.ts` use parameterized raw SQL with a `[...]::vector` literal.
- **TypeORM QueryBuilder takes entity property names, not DB column names** — `a.createdAt`, not `a.created_at`. Using the column name throws a confusing `Cannot read properties of undefined (reading 'databaseName')` at runtime, not compile time.
- **Production fail-fast**: with `NODE_ENV=production`, `config/env.ts` refuses to boot if `JWT_SECRET`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`, `S3_ACCESS_KEY` or `S3_SECRET_KEY` is missing or left at its shipped default. This is intended — supply real secrets.
- **`loadEnv()` is the only secret-resolution path.** Don't reintroduce `process.env.X ?? '<literal>'` at a call site: a fallback there resolves to a value published in this repository whenever the variable is unset, and unset only fail-fasts in production. `data-source.ts` matters most — the container runs `dist/scripts/migrate.js` before `main.js`, so it is the earliest code that touches production secrets.
- **`NODE_ENV` is validated.** Only `production`, `development` and `test` are accepted; unset means development. An unrecognised value used to select the development security posture silently, taking the secret fail-fast, CORS fail-closed, 5xx suppression, the reset-token refusal and the seed refusal down together.
- **`RAG_MIN_SIMILARITY` is validated on every read** (`ragMinSimilarity()`), not `parseFloat`-ed. It must be a finite number in `[0, 1]`. It is read per `ask()` rather than cached so the answer-quality harness can sweep it; `loadEnv()` calls it too so a bad value fails the boot.
- **Demo accounts are neutralised in production.** The seed refuses under `NODE_ENV=production` (in `seed-policy.ts` *and* in the container CMD), and `DemoAccountGuardService` disables any account still using a README-published password at boot. It compares against the shipped literal only, never `SEED_PASSWORD_*`, so it cannot false-positive on a rotated account. `scripts/create-admin.ts` is the break-glass.
- **`MAIL_PROVIDER` deliberately does NOT fail-fast.** It is `log` (default) or `smtp`; `smtp` requires `MAIL_HOST` or boot fails, but a production deploy left on `log` only warns. Mail is a degraded feature, not a security hole, and refusing to boot would take the whole clinical assistant offline over undelivered reset links. `log` writes the reset link into the application log, so it must not serve real users.
- **`CORS_ORIGINS` must be set in production.** Empty means block all cross-origin browser calls, so the web app silently fails against the API.
- **`NEXT_PUBLIC_API_URL` is baked in at Docker build time** (an `ARG` in `Dockerfile.web`), not read at runtime. Changing it requires a rebuild.

## Docs

`README.md` (setup, demo credentials, walkthroughs), `SECURITY.md` (control list + operational requirements), `docs/production-readiness.md` (pilot/production checklist and known gaps), `docs/architecture.md`, `docs/database-schema.md`, `docs/api.md`, `infra/railway/README.md` (the actual live deployment — auto-deploys `main`).

CI (`.github/workflows/ci.yml`) runs dependency-audit gates (root and mobile, both hard-fail on critical), API build+test+migrations against a real pgvector service, web build, browser smoke, and mobile typecheck+tests.
