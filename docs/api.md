# REST API reference

Base URL: `http://localhost:4000`. Every endpoint requires
`Authorization: Bearer <accessToken>` and the listed permission, except these
seven, which carry `@Public()`:

`GET /health` · `GET /health/ready` · `POST /auth/login` ·
`POST /auth/refresh` · `POST /auth/mfa/verify` · `POST /auth/forgot-password` ·
`POST /auth/reset-password`

Note that **not all of `/auth/*` is public**: `logout`, `mfa/enroll`,
`mfa/enable` and `mfa/disable` all require a token — each acts on the caller's
own account, taken from the JWT rather than the request body.

## Error envelope

Every failure — validation, permission, domain rejection, unhandled — comes
back through one filter in the same shape:

```json
{
  "statusCode": 400,
  "message": ["email must be an email"],
  "error":   ["email must be an email"],
  "timestamp": "2026-08-21T08:07:25.718Z",
  "path": "/users"
}
```

`message` is what clients should read; it holds a string for a domain
rejection and an array of strings for a validation failure. `error` carries
the same value and exists only because this API has always returned that key.
5xx responses are logged in full server-side and recorded in the audit trail;
under `NODE_ENV=production` the client sees only `Internal server error`.

Also documented in the audit filter table below: `action` matches **exactly**,
`actorEmail` matches as a case-insensitive substring.

## Auth

| Method & path | Body | Notes |
| --- | --- | --- |
| `POST /auth/login` | `{email, password}` | → tokens + user, or `{mfaRequired, mfaToken}` |
| `POST /auth/mfa/verify` | `{mfaToken, code}` | TOTP verification → tokens |
| `POST /auth/refresh` | `{refreshToken}` | → new token pair |
| `POST /auth/logout` | — | bumps `token_version`, revoking every outstanding refresh token |
| `POST /auth/forgot-password` | `{email}` | always `{requested: true}`; emails a reset link, never returns the token, never reveals whether the email exists |
| `POST /auth/reset-password` | `{token, newPassword}` | single-use, bound to `token_version` |
| `POST /auth/mfa/enroll` | — | **authenticated.** Mints a TOTP secret → `{secret, otpauthUrl}`. Does *not* turn MFA on. Refused if MFA is already enabled — disable first. |
| `POST /auth/mfa/enable` | `{code}` | **authenticated.** Verifies a live code against the enrolled secret, then turns MFA on. |
| `POST /auth/mfa/disable` | `{password}` | **authenticated.** Requires the account password (a stolen session alone must not strip the second factor); clears both the flag and the secret. |

There is **no public self-registration**. Accounts are provisioned by an
administrator via `POST /users`, which assigns roles explicitly.

MFA enrolment is deliberately two-step: `enroll` stores the secret but leaves
`mfa_enabled` false, and only `enable` — which proves the authenticator app
actually holds that secret — starts gating logins. A one-step design would lock
out any user whose QR scan silently failed.

## Users & roles

| Endpoint | Permission |
| --- | --- |
| `GET /users` | `users:read` |
| `GET /users/me` | (any authenticated) |
| `POST /users` `{email, password, fullName, roles[]}` | `users:manage` |
| `PATCH /users/:id` `{fullName?, password?, isActive?, roles?}` | `users:manage` |
| `DELETE /users/:id` (soft deactivate) | `users:manage` |
| `GET /roles` | `roles:read` (read-only — see below) |

Roles are **read-only over the API**. What a role may do is defined in
`packages/shared/src/rbac.ts`, which is what `PermissionsGuard` actually
enforces — the `role_permissions` table is a projection for display, never an
input to authorization. Editing it would change nothing, so `POST /roles` and
`PATCH /roles/:id` no longer exist. Change permissions in `rbac.ts`.

Assigning *users* to roles is unaffected and takes effect immediately, because
roles travel in the JWT: use `POST /users` and `PATCH /users/:id`.

## Documents & approval workflow

| Endpoint | Permission |
| --- | --- |
| `POST /documents/upload` (multipart: `file` PDF + `title`, `category`, `description?`, `expiryDate?`, `documentId?` for a new version) | `documents:upload` |
| `GET /documents?category=&status=&search=&limit=&offset=` | `documents:read` |
| `GET /documents/:id` · `GET /documents/:id/versions` · `GET /documents/:id/approval-history` | `documents:read` |
| `PATCH /documents/:id` `{title?, description?, expiryDate?}` | `documents:manage` |
| `GET /documents/:id/download-url` (5-min presigned URL, audited) | `documents:download` |
| `POST /documents/:id/submit-review` `{comment?}` | `documents:submit-review` |
| `POST /documents/:id/approve` / `.../reject` `{comment?}` | `documents:approve` |
| `POST /documents/:id/index` (extract→chunk→embed→ACTIVE) | `documents:index` |
| `POST /documents/:id/deactivate` `{comment?}` (removes from AI) | `documents:deactivate` |

## RAG & chat

| Endpoint | Permission |
| --- | --- |
| `POST /rag/query` `{question, category?}` — raw governed answer, no persistence | `ai:ask` |
| `GET /rag/search?q=&category=` — semantic search, returns chunks | `ai:search` |
| `POST /chat/ask` `{question, assistantType?: NURSING\|DRUG_PREPARATION\|CBAHI, category?, channel?}` — persisted + audited | `ai:ask` |
| `GET /chat/history?limit=` — own Q&A history | `ai:ask` |
| `POST /chat/answers/:id/review` `{status: APPROVED\|FLAGGED}` — committee review | `ai:review-answers` |
| `POST /rag/reindex` — re-embed every ACTIVE document with the current provider | `documents:index` |
| `POST /rag/reindex/stale` — re-embed only documents whose chunks retrieval cannot currently see | `documents:index` |
| `POST /rag/reindex/:documentId` — re-embed one document in place, no approval transition | `documents:index` |
| `POST /rag/provider-check` — one-vector probe of the embeddings provider | `documents:index` |

Answer shape:

```json
{
  "refused": false,
  "shortAnswer": "...",
  "steps": ["..."],
  "warnings": ["..."],
  "confidence": "HIGH|MEDIUM|LOW|NONE",
  "citations": [{
    "documentTitle": "...", "pageNumber": 1,
    "approvalDate": "2026-07-05T...", "similarity": 0.68, "snippet": "..."
  }]
}
```

When refused, `shortAnswer` is exactly
`لا توجد وثيقة معتمدة كافية للإجابة. الرجاء الرجوع للمسؤول المختص.` with
`confidence: "NONE"` and zero citations.

### Diagnosing a failing embeddings provider

`POST /rag/provider-check` embeds one throwaway string and reports the result.
The probe is compared against the width the `document_chunks.embedding` column
is *actually declared with*, read from `pg_attribute` — not against
`EMBEDDING_DIM`. The column width is fixed by the initial migration, which
carries its own copy of that constant, so the two can disagree: with
`EMBEDDING_DIM=1536` and a genuine 1536-dimension provider, comparing against
the env var reports success while every INSERT fails against `vector(384)`.
A disagreement between the column and `EMBEDDING_DIM` is reported separately as
`dimensionConfigMismatch`, because it is a different thing to fix.

`corpus` splits stale chunks two ways. `staleRetrievable` counts chunks from
another provider on documents that are ACTIVE, unexpired and current-version —
the ones the assistant would otherwise be able to cite. **That is the number
that should be zero, and the only one reindexing can move.** `staleOrphaned`
counts chunks on expired or superseded documents: retrieval already excludes
them for unrelated reasons and `reindexAll()` never visits them, so they stay
counted forever. Setting a target against the combined total made "stale
chunks = 0" unreachable on any corpus containing one expired document.
It writes nothing and changes no document state, so it is safe to run against
a live corpus — unlike indexing a test document, which would put that document
where the assistant can cite it.

```json
{
  "provider": "openai-embedding",
  "ok": false,
  "probe": { "dimensions": null, "expectedDimensions": 384, "durationMs": 412 },
  "error": "AI provider returned 400 for /embeddings",
  "corpus": {
    "activeProvider": "openai-embedding",
    "byProvider": [{ "provider": "mock-hash-embedding", "chunks": 128 }],
    "staleChunks": 128
  }
}
```

`error` is the API's own message, never the provider's response body — that is
logged server-side (already redacted) as `[OpenAiHttp] WARN /embeddings → 400`.
`ok` is false on a dimension mismatch too, because the `vector(384)` column is
fixed-width and a differently-sized vector fails at INSERT rather than here.

`corpus` is reported even when the probe fails, because "the assistant refuses
everything" has two unrelated causes: a provider that is down, or a corpus
embedded by a *different* provider (`staleChunks` above zero), which retrieval
filters out until `POST /rag/reindex` runs. Deliberately not part of
`/health/ready`: that is polled continuously and would bill an API call per
poll for a dependency that only affects ingestion.

## Dose calculator

| Endpoint | Permission |
| --- | --- |
| `POST /dose/calculate` `{formulaId, weightKg, ageYears?, concentrationMgPerMl?, requiredDoseMg?, route?, frequencyPerDay?}` | `dose:calculate` |
| `GET /dose/formulas` (approved only; `?all=true` for managers) | `dose:calculate` |
| `POST /dose/formulas` | `dose:formulas-manage` |
| `POST /dose/formulas/:id/approve` | `dose:formulas-approve` (Pharmacist Reviewer) |

Calculations with non-APPROVED formulas are rejected (400). Every result
includes step-by-step math, max-dose capping and the verbatim Arabic safety
warning.

## Governance

| Endpoint | Permission |
| --- | --- |
| `GET /audit-logs?action=&actorEmail=&resourceType=&limit=&offset=` | `audit:read` |
| `GET /analytics/overview` | `analytics:read` |
| `GET /settings` | `settings:read` |
| `PUT /settings/:key` `{value}` | `settings:manage` |
| `GET /notifications` · `POST /notifications/:id/read` | `notifications:read` |
| `GET /health` | public — liveness only, no dependency checks |
| `GET /health/ready` | public — checks Postgres and object storage; 503 if either is unreachable |
