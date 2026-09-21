# 01 — Overview

What this repository contains, stated so that someone who has never opened it
can decide whether it does what they were told it does. Every number below came
from a command on this commit; the command is named where it is not obvious.

## In one paragraph

**BNP Decision Guard is a clinical knowledge-governance platform.** A nurse asks
a question in Arabic or English; the API embeds it, searches a pgvector table of
text chunks under four hard SQL filters that admit only documents a human has
walked through an approval workflow, reranks what survives, compares it against
a similarity threshold, and — if anything qualifies — hands those chunks to a
language model whose response type has **no field for a citation**. Every
citation the nurse sees is copied out of the database row of a chunk that was
actually retrieved. If nothing qualifies, the API returns a fixed Arabic
sentence meaning *"no approved document is sufficient — refer to the responsible
officer"*, with zero citations. There is no fallback branch, no general-knowledge
path, and no "answer anyway".

That is the whole product thesis, and reading the code confirms it is
implemented as described rather than asserted.

## The shape of the thing

One product, built four times over: a shared library, an HTTP API, a web app and
a mobile app.

| Unit | Stack | Size | In the npm workspace? |
| --- | --- | --- | --- |
| `packages/shared` | TypeScript, **zero runtime dependencies** | 4 source files | ✅ |
| `apps/api` | NestJS 11, TypeORM, PostgreSQL 16 + pgvector | 50 routes, 12 controllers, 15 entities, 6 migrations | ✅ |
| `apps/web` | Next.js 16 App Router, Tailwind, React 18 | 15 protected screens + 4 public routes, all statically prerendered | ✅ |
| `apps/mobile` | Expo 57 / React Native 0.86 / React 19 | 6 screens, hand-rolled tab switch, no router | ❌ separate install |

Tracked source, by `git ls-files "*.<ext>" | xargs cat | wc -l`:

| | Files | Lines |
| --- | --- | --- |
| `.ts` | 141 | 19,255 |
| `.tsx` | 37 | 7,171 |
| `.md` | 19 | 6,546 |
| `.mjs` / `.js` / `.css` / `.sql` | 10 | 828 |
| `.yml` / `.yaml` | 6 | 583 |
| `.json` | 16 | 20,246 (dominated by two lockfiles) |

**TypeScript is the only language.** No Python, Go, Java, Swift, Kotlin, Dart or
Rust appears anywhere in the tracked tree.

## What a real user can do today

Each of these is traced to a caller in a client, not inferred from a route
existing: sign in (with a TOTP second factor if the account has one), ask the
nursing assistant, ask a drug-preparation assistant, search CBAHI standards,
calculate a drug dose, browse approved policies, upload a PDF, drive a document
through draft → review → approved → indexed → active, review AI answers as the
scientific committee, manage users, read the audit log, read an analytics
overview, change settings, turn MFA on, read notifications, browse chat history,
author and approve dose formulas, and run two targeted RAG repair operations.

The mobile app covers six of those: login, home, chat, dose calculator, audit,
policies. It has no upload, approvals, answer review, user management, settings,
CBAHI search, drug-prep or password-reset screen.

## The five properties that make it a governance platform rather than a chatbot

Each is structural — a consequence of where code sits, not a rule something
remembers to follow — and each is pinned by a test.

1. **Retrieval cannot see unapproved content.** `RetrievalService.search()`
   applies four hard SQL filters: `status = ACTIVE`, not expired, chunk version
   matches the document's current version, and the chunk was embedded by the
   *currently configured* provider. Draft, in-review, rejected, expired,
   superseded and deactivated documents are unreachable by construction.
2. **The model cannot invent a citation.** `LlmAnswer` is
   `{shortAnswer, steps, warnings}` — there is no citation field for a model to
   fill in. Citations are built from the retrieved rows.
3. **Refusal has four independent gates** — `NO_CANDIDATES`, `BELOW_THRESHOLD`,
   `MODEL_ERROR`, `MODEL_FOUND_NOTHING` — all returning the same verbatim Arabic
   string through one helper, with `NONE` confidence and an empty citation
   array. There is exactly one `refused: false` return in the whole service, and
   it is reachable only past the threshold.
4. **Authorization never reads the database.** `packages/shared/src/rbac.ts` is a
   compiled matrix of 7 roles × 22 permissions; `PermissionsGuard` enforces what
   `JwtStrategy` derived from it. The seeded `roles`/`role_permissions` tables
   are a display projection, which is why the roles API is read-only and a
   database-only role grants nothing.
5. **Patient identifiers are rejected before anything is written.** The PHI
   screen runs as a **guard**, and Nest runs guards before interceptors — so a
   rejected request never reaches `AuditInterceptor`, and there is no code path
   that could carry the body into the audit trail. "Never stored" is therefore a
   property of *where the check runs*.

## Testing, honestly

| Suite | Spec files | Tests | Measured here? |
| --- | --- | --- | --- |
| API unit | 30 | **428** | ✅ run on this commit — 30 suites, 0 failures |
| API integration | 14 | **257** | ✅ run on this commit against a local PostgreSQL 16 + pgvector 0.6.0 — 14 suites, 0 failures. This row said "this container has none" until the cluster was started by hand; see the correction in `08-BUILD-AND-RUN.md` |
| Mobile | 2 | 32 | ❌ separate install, absent here. CI runs it |
| **Web** | **0** | **0** | there is no web test runner at all |
| `packages/shared` | 0 | 0 | exercised only indirectly, through API tests |

Plus a Playwright browser smoke (`apps/web/e2e-smoke.mjs`) driven in CI against
a full Docker Compose stack, and two evaluation harnesses — a gold set that is
circular by construction and gates routing only, and a field set that gates five
corpus-independent invariants and measures everything else without asserting it.

**There is no coverage instrumentation anywhere**, so no coverage percentage can
be quoted. `grep` for `coverage`, `collectCoverage`, `coverageThreshold` across
every jest config, every manifest and the CI workflow returns zero.

## Code hygiene

`grep -rnE '\b(TODO|FIXME|HACK|XXX)\b'` across `apps/api/src`, `apps/web/src`,
`apps/mobile/src` and `packages/shared/src` returns **0**.

That is unusual enough to be worth interpreting rather than praising. This
codebase does not park its unfinished business in markers; it parks it in prose.
The comments are long, they explain *why* rather than *what*, and several of
them record an incident — the 9-character `ADMIN_PASSWORD` that produced zero
active users, the `Math.max(1, NaN)` that silently disabled the per-document
cap, the `Buffer` pooling bug that made PDF extraction fail intermittently, the
`minio/minio` image withdrawn from Docker Hub. A reader looking for what is
incomplete should read `docs/production-readiness.md` and `09-GAPS.md`, not grep
for TODO.

## Where it runs

A Railway project (`bnp-decisionguard`) auto-deploys `main`. There is **no
deploy job in CI**, so a merge to `main` is the deploy action — which is why the
branch carrying this audit has stayed a draft pull request throughout.
`infra/k8s/` holds four reference manifests plus a README; nothing applies them.

## What this audit did not establish

Named here so the overview is not read as a clean bill of health. The production
corpus has never been inspected — the only figure anyone has is **725 chunks**
from a boot log quoted in `docs/production-readiness.md:343`, dated 2026-08-22.
No production system was contacted. The web UI has no unit tests and the mobile
screens have no runtime coverage. And nothing here says whether the answers are
clinically sound: that is a reviewer's judgement on real questions, and
`docs/clinical-validation.md` exists precisely because engineering cannot settle
it. `09-GAPS.md` carries the full list with the reason for each.
