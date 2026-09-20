# 03 — Modules: backend (`apps/api`)

Twenty-one directories plus four root files. Sizes are `find … -name '*.ts' |
xargs cat | wc -l` on this commit; "specs" counts co-located `*.spec.ts`.

| Directory | Files | Lines | Specs | What it is |
| --- | --: | --: | --: | --- |
| `rag/` | 20 | 2,852 | 9 | the retrieval + LLM pipeline — the product |
| `auth/` | 7 | 1,226 | 2 | login, refresh, revocation, lockout, reset, MFA, demo-account sweep |
| `eval/` | 4 | 1,133 | 2 | the field-set loader and the corpus-independent scoring core |
| `documents/` | 7 | 1,220 | 3 | upload, listing, download URLs, the clinical-reference inventory |
| `common/` | 12 | 1,053 | 4 | decorators, four guards, the exception filter, the audit interceptor, the JSON logger, the pagination pipe |
| `config/` | 3 | 831 | 1 | `env.ts` (the only secret-resolution path) and `data-source.ts` |
| `entities/` | 6 | 616 | 0 | 15 TypeORM entities |
| `seed/` | 7 | 599 | 1 | demo data, the production seed refusal, PDF generation |
| `scripts/` | 5 | 521 | 1 | migrate, create-admin (break-glass), inventory, the field-eval HTTP runner |
| `notifications/` | 4 | 507 | 1 | the daily expiry cron and the notification routes |
| `dose/` | 4 | 440 | 1 | dose maths, formula approval gating, the safety warning |
| `approval/` | 2 | 395 | 1 | the `TRANSITIONS` map and the lifecycle service |
| `migrations/` | 6 | 434 | 0 | six migrations, registered explicitly |
| `chat/` | 4 | 368 | 1 | persisted Q&A, the review queue, diagnostics stripping |
| `users/` | 3 | 249 | 0 | provisioning and role assignment |
| `mail/` | 3 | 231 | 1 | `log` / `smtp` providers |
| `storage/` | 2 | 102 | 0 | S3 client, `ensureBucket`, presigned URLs, health probe |
| `audit/` | 3 | 97 | 0 | the write path and `GET /audit-logs` |
| `settings/` | 1 | 81 | 0 | controller + service + module in one file |
| `analytics/` | 1 | 76 | 0 | same shape; raw-SQL counts |
| `roles/` | 3 | 75 | 0 | read-only `GET /roles` |

Root: `main.ts` (bootstrap), `app.module.ts` (67 lines — the module graph and
the four global guards), `health.controller.ts` + its spec.

## `rag/` — the chain everything else exists to protect

Nine of the twenty files are specs, which is the highest ratio in the codebase
and appropriate: this is where a silent regression is a clinical event.

| File | Role |
| --- | --- |
| `rag-query.service.ts` | orchestrates retrieve → rerank → threshold → answer; holds all four refusal gates and `toCitation()` |
| `retrieval.service.ts` | the four hard SQL filters, the ANN scan, and the narrow dimension-mismatch catch |
| `rerank.service.ts` | promotion-only lexical blend, then `selectDiverse()`'s per-document cap |
| `embedding.service.ts` | `MockEmbeddingProvider` (hashed bag-of-words) and `OpenAiEmbeddingProvider` |
| `llm.service.ts` | `MockLlmProvider` (extractive) and `OpenAiLlmProvider`; `LlmAnswer` has **no citation field** |
| `indexing.service.ts` | extract → chunk → embed → advisory lock → DELETE+INSERT in one transaction; the boot-time coverage summary |
| `chunking.service.ts` | word-boundary chunks with overlap |
| `pdf-extraction.service.ts` | `pdf-parse` over a plain `Uint8Array` |
| `openai-http.ts` | the only `fetch` in the API: timeout, one retry on 429/5xx, credential redaction before logging |
| `rag.controller.ts`, `rag.module.ts` | six routes, all `documents:index` except query and search |

**The mock LLM is extractive, and that is a safety property rather than a
convenience.** It splits retrieved chunk text into sentences, scores each by
token overlap with the question, and returns the top ones verbatim. It has no
generative capability, so it structurally cannot hallucinate — which is why the
entire system runs offline with no API key and why the governance claims are
testable without a provider.

**`rerank.service.ts`'s promotion-only formula has a bilingual reason.** The
blend is `Math.max(similarity, 0.6·similarity + 0.4·coverage)`. An Arabic
question over an English document scores lexical coverage 0; a formula that
could *lower* a score would therefore impose a harsher effective threshold on
cross-language questions than same-language ones. Taking the max means coverage
can only help.

**`selectDiverse()` exists because of a real incident.** It caps how many chunks
one document may contribute (`RAG_MAX_PER_DOCUMENT`, default 3). Without it a
live vancomycin-dilution question was answered out of a compatibility manual
that happened to contain many near-matching chunks.

## `auth/` — where the security properties live

`auth.service.ts` is the largest single file in the module and was read in
consecutive chunks; two mechanisms only become visible that way.

**`users.token_version` makes stateless refresh tokens revocable.** Logout and
any password change increment it, invalidating every outstanding refresh token —
not just the current tab's. **Password-reset tokens are bound to the same
counter**, which is what makes them single-use: completing a reset bumps the
version, so the token that authorised it no longer verifies.

**Per-account lockout complements the per-IP limiter.** `locked_until` blocks
even a correct password, so an attacker rotating IPs past the rate limiter is
still stopped. Cleared on success or on password reset.

**Enumeration safety is two properties, not one.** `forgot-password` always
returns `{requested: true}`, which hides existence in the *body*; and the send
is **not awaited**, which hides it in the *timing* — an awaited SMTP round trip
happens only for accounts that exist, and that is an oracle by itself.

`demo-account-guard.service.ts` runs at boot in production and disables any
account still using a password published in `README.md`. It compares against the
**shipped literal only**, never `SEED_PASSWORD_<ROLE>`, which is what makes it
incapable of a false positive on a rotated account. A database failure inside
the sweep is logged and swallowed rather than blocking startup — a control that
can take the clinical API offline is a denial of service against itself.

## `common/` — four guards, one filter, one interceptor

`phi-screen.guard.ts` is the most consequential file in the directory. Two
profiles: `FREE_TEXT` (all patterns) on the fields a clinician types a question
into, and `METADATA` (identifiers only) on fields describing a *document* —
because dates and names are legitimate in a change note ("supersedes the
2019-03-01 edition", "approved per Dr. Ali") and a control that blocks correct
work is a control that gets switched off.

Three of the screened routes are worth their reasons:

- **`POST /rag/query` persists nothing and is screened anyway**, because it
  forwards the text to the LLM provider. Under `LLM_PROVIDER=openai` that text
  leaves the hospital. Stored text can be redacted afterwards; sent text cannot
  be recalled.
- **`GET /rag/search?q=`** carries free text in the URL, and the exception
  filter logs `req.url` on a 5xx — the one path by which a question could reach
  the application log.
- **The approval-comment routes** write to two stores: `document_approvals.comment`
  and the audit metadata written beside it.

`all-exceptions.filter.ts` returns one envelope for every failure, and carries
the client-safe reason under **both** `message` and `error`. That duplication is
not sloppiness: emitting only `error` meant every rejection reached web users as
"Request failed (400)" with the reason discarded.

`audit.interceptor.ts` logs every mutating HTTP request and **skips `/auth`**,
whose service audits itself — so credentials never reach the audit body.

`pagination.ts` is a shared pipe added during this audit's earlier passes:
`?limit=abc` used to return 500 on five endpoints.

## `config/env.ts` — one path, and everything validated

831 lines across three files, most of it `env.ts`, and most of *that* is
validation with the failure it prevents written into the comment above it.

`loadEnv()` is the **only** secret-resolution path. The rule the file states is
worth repeating because the failure is silent: never reintroduce
`process.env.X ?? '<literal>'` at a call site, because a fallback there resolves
to a value published in this repository whenever the variable is unset — and
unset only fail-fasts in production. `data-source.ts` matters most, since the
container runs `dist/scripts/migrate.js` *before* `main.js` and it is therefore
the earliest code to touch production secrets.

Every RAG knob is validated rather than `parseInt`-ed, and the comment explains
which failure mode each one had: `RAG_TOP_K` failed loudly (`LIMIT NaN`, every
question erroring), `RAG_FINAL_K` in between, and `RAG_MAX_PER_DOCUMENT`
silently — `Math.max(1, NaN)` is `NaN`, `used >= NaN` is always false, so a typo
switched the per-document cap off with no error and no log line.

## `documents/` and `approval/` — the governed workflow

`documents.service.ts` validates uploads by **magic bytes**, not the client's
`Content-Type` header, which the client controls. `inventory.service.ts` answers
the question none of the other endpoints do — *what can the assistant actually
cite right now* — by reporting per document whether it is retrievable and, if
not, which of the four filters excludes it. It reports `issuingBody` and
`effectiveDate` as `null` and names both in `fieldsNotInSchema`, refusing to
infer them from titles: a guess that is right often enough to be trusted and
wrong often enough to mislead is worse than an honest blank.

`approval.service.ts` holds the `TRANSITIONS` map. The `index` action performs
INDEX **and** ACTIVATE in one call.

## `eval/` — the half that is not circular

`field-set.ts`'s loader **rejects** `expectSource`, `expectAnswerContains` and
`expectRefusal`. That is the design: whoever collects what staff actually look
up does not know which page holds the answer — and if they do, they wrote the
question from the page. It also screens every case for PHI before loading, so a
question collected on the ward with a real medical-record number in it is
stopped before it reaches the network.

`field-eval.ts` gates five invariants that hold on *any* corpus and asserts
nothing clinical. Everything else — coverage, which document was cited,
paraphrase agreement, the simulated threshold sweep — is measured into a report
and asserted nowhere.

## What has no co-located spec

`analytics/`, `audit/`, `entities/`, `migrations/`, `roles/`, `settings/`,
`storage/` and `users/`. Most are thin, and most are covered at the HTTP layer
by the integration suite instead: `rbac-and-dose.e2e-spec.ts` drives `POST
/users` and `GET /roles` through real requests, `pagination.e2e-spec.ts` covers
the audit and document listings, and `migrations/` is exercised on every CI run
against a real `pgvector/pgvector:pg16`.

**`storage/` is the genuine hole, and it is a specific one.** It has no unit
spec, and the integration suite cannot cover it either — `test/support/e2e-app.ts`
substitutes S3 with an in-memory fake, which is the right call for a test
boundary but means the real `StorageService` is never executed by any test. The
S3 client construction, `ensureBucket()`, the presigned-URL generation and
`isHealthy()` are covered only by running the stack, which CI's browser-smoke
job does. `settings/` is the other: a controller taking an `unknown`-typed body
that the PHI screen deliberately does not screen, with no test of its own.
Both are carried into `07-QUALITY-AND-RISKS.md` rather than glossed here.
