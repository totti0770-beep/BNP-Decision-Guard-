# 05 — API Surface

Every HTTP route the NestJS application serves, with the file and line that declares it, what
authorises it, what it accepts, what it returns, and how it fails. Nothing here is inferred from a
route name: each row was produced from the decorator on disk and each handler file was opened.

## How the route list was produced

The table below is not hand-collected. A script parsed every non-spec `.ts` file under
`apps/api/src`, tracked the `@Controller('…')` prefix in scope, attached the decorator run that
belongs to each `@Get/@Post/@Patch/@Put/@Delete`, and classified the route by whether that run
contains `@Permissions(...)`, `@Public()` or neither. Its output:

```
Counter({'Permissions': 38, 'Public': 7, 'AUTH-ONLY': 5}) total routes: 50
```

So: **50 routes**, of which **38** require a named permission, **7** are unauthenticated, and **5**
require a valid access token but no permission. The five are listed under "Authenticated, no
permission" below, and each is justified in the code.

One caveat on the script itself, recorded because it changed an answer: an earlier version scanned
a fixed number of lines *after* the method decorator, which attached the next handler's
`@Permissions` to the previous handler and reported `GET /users/me` as permission-gated and
`GET /documents/:id` as PHI-screened. Both were wrong. The corrected pass stops at the method
signature. Multi-line `@ScreenForPhi({ … })` decorators are likewise invisible to a line-wise
"decorator immediately above" rule, so the PHI column below was built from a separate
`grep -rn "@ScreenForPhi"` (10 route sites) and mapped by reading each file.

## The request pipeline every route passes through

Set up in `apps/api/src/main.ts` before the listener opens:

| Stage | Where | Effect |
|---|---|---|
| Secret validation | `main.ts:15` (`loadEnv()`) | Production fail-fast before any port is bound |
| Body parsing | `main.ts:22`, `main.ts:27-28` | Nest's parser disabled, `express.json` with `env.bodyLimit` (`REQUEST_BODY_LIMIT`, default `25mb`, `config/env.ts:354`) |
| `helmet()` | `main.ts:26` | Standard security headers |
| CORS | `main.ts:32-35` | Explicit allowlist; an empty list evaluates to `origin: false` — blocked, not open |
| `ValidationPipe` | `main.ts:37` | `whitelist: true, transform: true` — unknown body properties are stripped, DTO violations are 400 |
| `AllExceptionsFilter` | `main.ts:38` | Uniform error envelope (below) |

Guards and the interceptor are registered in `apps/api/src/app.module.ts:52-65`, in this order:

1. `ThrottlerGuard` (`app.module.ts:55`) — rate limiting first, so unauthenticated floods are
   refused before authentication work is done (`app.module.ts:53-54`).
2. `JwtAuthGuard` (`app.module.ts:56`).
3. `PermissionsGuard` (`app.module.ts:57`).
4. `PhiScreenGuard` (`app.module.ts:63`) — deliberately last among the guards, with the reason
   written at `app.module.ts:58-62`: the interception record needs the actor, and a caller who is
   not allowed on the route should be refused for that reason rather than told what the PHI screen
   made of their payload. It still runs before the interceptors and the `ValidationPipe`, so a
   rejected body reaches no store.
5. `AuditInterceptor` (`app.module.ts:64`).

Throttling limits come from `ThrottlerModule.forRoot` at `app.module.ts:31-36`
(`RATE_LIMIT_TTL`, `RATE_LIMIT_MAX`). Credential routes override it with a stricter per-IP limit
declared at `auth.controller.ts:13-18` (`AUTH_RATE_LIMIT_MAX`).

## Error handling, shared by every route

`apps/api/src/common/filters/all-exceptions.filter.ts` catches everything (`:18` `@Catch()`) and
writes one envelope (`:70-76`):

```
{ statusCode, message, error, timestamp, path }
```

- `message` and `error` carry the same value, deliberately (`:61-69`): the filter originally emitted
  only `error`, while Nest's own envelope — and therefore this repo's web and mobile fetch wrappers —
  reads `message`, so no client-safe error ever reached a user.
- Status ≥ 500 is logged with its stack (`:41-44`) and written to the audit trail as
  `ERROR:UNHANDLED` (`:45-57`); in production the client message is replaced with
  `Internal server error` (`:58`).
- `HttpException`s keep their own client-safe message (`:35-38`).

Two pipes appear across the table:

- `ParseUUIDPipe` on every `:id` path parameter — a malformed id is a 400 before the handler runs.
- `PAGE_INT` (`apps/api/src/common/pagination.ts:23`), a shared
  `new ParseIntPipe({ optional: true })`, on every `limit`/`offset`. Its docblock records why it
  exists: `parseInt('abc')` is `NaN` and `qb.take(NaN)` reaches Postgres as an invalid LIMIT, so
  `?limit=abc` answered **500** on five endpoints and wrote an `ERROR:UNHANDLED` row on the way out
  (`pagination.ts:6-12`). `optional: true` keeps an absent parameter absent rather than 0, because
  each service supplies its own default (`pagination.ts:14-18`).

`GET /health/ready` is the one deliberate exception to the filter: it sets its own status via
`@Res({ passthrough: true })` rather than throwing (`health.controller.ts:38`, `:44`), because a
5xx there would write an `ERROR:UNHANDLED` audit row on every probe poll and, in production,
redact the dependency detail an operator needs (`health.controller.ts:16-21`).

## The 50 routes

`Auth` is the permission required by `@Permissions(...)`; **public** means `@Public()`;
**token only** means authenticated with no permission check. `PHI` marks a route carrying
`@ScreenForPhi(...)`.

### `auth` — `apps/api/src/auth/auth.controller.ts`

| Method | Path | Handler | Auth | Request | Response | Errors |
|---|---|---|---|---|---|---|
| POST | `/auth/login` | `:57` | public, throttled `:56` | `LoginDto` `:20-23` — `email` (IsEmail), `password` (non-empty) | `{ mfaRequired: true, mfaToken }` (`auth.service.ts:143`) or `{ mfaRequired: false, accessToken, refreshToken }` (`auth.service.ts:155`, `:102-112`) | 400 validation; auth failures from `auth.service.ts` |
| POST | `/auth/refresh` | `:71` | public, throttled `:70` | `RefreshDto` `:25-27` — `refreshToken` | `{ accessToken, refreshToken }` (`auth.service.ts:192`→`:102`) | 400 validation; 401 on a token whose `tv` no longer matches |
| POST | `/auth/mfa/verify` | `:78` | public, throttled `:77` | `MfaVerifyDto` `:29-32` — `mfaToken`, `code` | `{ accessToken, refreshToken }` (`auth.service.ts:189`) | 400 validation |
| POST | `/auth/forgot-password` | `:85` | public, throttled `:84` | `ForgotPasswordDto` `:42-44` — `email` | `{ requested: true }`, plus `resetToken` only under the dev escape hatch (`auth.service.ts:281`, `:283`) | 400 validation |
| POST | `/auth/reset-password` | `:92` | public, throttled `:91` | `ResetPasswordDto` `:46-49` — `token`, `newPassword` (min 8) | `{ reset: true }` (`auth.service.ts:323`) | 400 validation |
| POST | `/auth/logout` | `:97` | token only | — (acts on `user.userId` from the JWT) | `{ revoked: true }` (`auth.service.ts:229`) | 401 without a token |
| POST | `/auth/mfa/enroll` | `:109` | token only, throttled `:108` | — | `{ secret, otpauthUrl }` (`auth.service.ts:360-363`) | 401 without a token |
| POST | `/auth/mfa/enable` | `:115` | token only, throttled `:114` | `MfaEnableDto` `:34-36` — `code` | `{ mfaEnabled: true }` (`auth.service.ts:394`) | 400 validation |
| POST | `/auth/mfa/disable` | `:125` | token only, throttled `:124` | `MfaDisableDto` `:38-40` — `password` | `{ mfaEnabled: false }` (`auth.service.ts:429`) | 400 validation |

There is deliberately **no** public registration route; the reasoning is written into the file at
`auth.controller.ts:62-67`. The four MFA/logout routes need no `@Permissions()` because each acts
only on the caller's own id taken from the JWT, never an id from the body (`auth.controller.ts:102-106`).

### `users` — `apps/api/src/users/users.controller.ts`

| Method | Path | Handler | Auth | Request | Response | Errors |
|---|---|---|---|---|---|---|
| GET | `/users` | `:46` | `USERS_READ` | — | `[{ id, email, fullName, isActive, mfaEnabled, roles[], lastLoginAt, createdAt }]` (`users.service.ts:35-46`, `:48-51`) | 403 |
| GET | `/users/me` | `:52` | token only | — | the same DTO plus `permissions` from the JWT (`users.controller.ts:56`) | 404 if the user row is gone (`users.service.ts:61`) |
| POST | `/users` | `:59` | `USERS_MANAGE` | `CreateUserDto` `:28-33` — `email`, `password` (min 8), `fullName`, `roles: string[]` | user DTO (`users.service.ts:95`) | 400 `Email already registered` (`users.service.ts:77`); 400 `One or more roles do not exist` (`:68`) |
| PATCH | `/users/:id` | `:65` | `USERS_MANAGE` | `UpdateUserDto` `:35-40` — all optional: `fullName`, `password` (min 8), `isActive`, `roles` | user DTO (`users.service.ts:134`) | 400 on a non-UUID id; 404 (`users.service.ts:100`) |
| DELETE | `/users/:id` | `:75` | `USERS_MANAGE` | — | `{ deactivated: true }` — soft delete, so audit history stays intact (`users.service.ts:137-151`) | 400 non-UUID; 404 |

A password change through `PATCH /users/:id` increments `tokenVersion` (`users.service.ts:115`),
revoking every outstanding refresh token for that account.

### `documents` — `apps/api/src/documents/documents.controller.ts`

| Method | Path | Handler | Auth | Request | Response | Errors |
|---|---|---|---|---|---|---|
| POST | `/documents/upload` | `:58` | `DOCUMENTS_UPLOAD` · **PHI** (`:54-57`, METADATA profile, fields `title`/`description`/`changeNote`) | multipart `file` + `UploadDto` `:27-34` — `title`, `category` (enum), optional `description`/`expiryDate`/`changeNote`/`documentId` | document DTO (`documents.service.ts:42-63`) | 413 over 25 MB (`:63-65`, matched to the web upload screen's advertised cap — the two used to disagree, `:60-62`) |
| GET | `/documents` | `:74` | `DOCUMENTS_READ` | query `category`, `status`, `search`, `limit`/`offset` via `PAGE_INT` (`:80-81`) | `{ items: [documentDto], total }` (`documents.service.ts:190`) | 400 on a non-integer `limit`/`offset` |
| GET | `/documents/inventory` | `:98` | `DOCUMENTS_READ` | — | `InventoryReport` — `{ schema, fieldsNotInSchema[], totals{…}, documents[] }` (`inventory.service.ts:67-85`) | — |
| GET | `/documents/:id` | `:104` | `DOCUMENTS_READ` | — | document DTO | 400 non-UUID; 404 |
| PATCH | `/documents/:id` | `:114` | `DOCUMENTS_MANAGE` · **PHI** (`:110-113`) | `UpdateDocumentDto` `:36-40` | document DTO | 400; 404 |
| GET | `/documents/:id/versions` | `:124` | `DOCUMENTS_READ` | — | `document_versions` rows, newest first (`documents.service.ts:230-236`) | 400; 404 |
| GET | `/documents/:id/download-url` | `:130` | `DOCUMENTS_DOWNLOAD` | — | `{ url, expiresInSeconds: 300 }` (`documents.service.ts:248`) | 400; 404; 403 for roles without the permission |
| GET | `/documents/:id/approval-history` | `:139` | `DOCUMENTS_READ` | — | `[{ id, action, fromStatus, toStatus, actor, comment, … }]` (`approval.service.ts:165-171`) | 400; 404 |
| POST | `/documents/:id/submit-review` | `:149` | `DOCUMENTS_SUBMIT_REVIEW` · **PHI** (`:148`) | `CommentDto` `:42-44` | updated document | 400 on an illegal transition (`TRANSITIONS`, `approval.service.ts`) |
| POST | `/documents/:id/approve` | `:163` | `DOCUMENTS_APPROVE` · **PHI** (`:162`) | `CommentDto` | updated document | as above |
| POST | `/documents/:id/reject` | `:177` | `DOCUMENTS_APPROVE` · **PHI** (`:176`) | `CommentDto` | updated document | as above |
| POST | `/documents/:id/index` | `:187` | `DOCUMENTS_INDEX` | — | indexing outcome | refuses an already-ACTIVE document (see `/rag/reindex/:documentId`) |
| POST | `/documents/:id/deactivate` | `:200` | `DOCUMENTS_DEACTIVATE` · **PHI** (`:199`) | `CommentDto` | updated document | as above |

`GET /documents/inventory` is declared *before* `@Get(':id')` on purpose — Express matches in
declaration order, so below it the literal path would be captured as an id (`:90-92`). The comment
on each `CommentDto` route (`:145-147`, `:159-161`, `:173-175`, `:196-198`) records why it is
screened: the comment lands in two stores — `document_approvals.comment` and the audit metadata
written beside it — so an identifier typed there is written twice.

`DOCUMENTS_DOWNLOAD` is withheld from `NURSE_USER` and `AUDITOR` by the RBAC matrix; the route
itself does not special-case them.

### `chat` — `apps/api/src/chat/chat.controller.ts`

| Method | Path | Handler | Auth | Request | Response | Errors |
|---|---|---|---|---|---|---|
| POST | `/chat/ask` | `:36` | `AI_ASK` · **PHI** (`:40`, default profile, field `question`) | `AskDto` `:21-26` — `question`, optional `assistantType`, `category`, `channel` | `{ questionId, answerId, refused, shortAnswer, steps, warnings, confidence, citations }`, plus `diagnostics` only for holders of `ANALYTICS_READ` (`chat.service.ts:91-106`) | 400 validation; 400 from the PHI guard |
| GET | `/chat/history` | `:45` | `AI_ASK` | `limit` via `PAGE_INT` (`:49`) | `{ items: [...] }` (`chat.service.ts:146`) | 400 on a non-integer limit |
| GET | `/chat/answers` | `:54` | `AI_REVIEW_ANSWERS` | `reviewStatus`, `limit`/`offset` via `PAGE_INT` | `{ total, items: [{ answerId, questionId, question, assistantType, askedBy, shortAnswer, steps, warnings, confidence, … }] }` (`chat.service.ts:167-…`) | 400 |
| POST | `/chat/answers/:id/review` | `:64` | `AI_REVIEW_ANSWERS` | `ReviewDto` `:28-30` — `status` ∈ `APPROVED`/`FLAGGED` | `{ ok: true }` (`chat.service.ts:212`) | 400 non-UUID or bad status |

The field `question` is described at `chat.controller.ts:38-39` as the one this control exists for:
free text a nurse types at the bedside, persisted verbatim to `ai_questions.question`.

### `rag` — `apps/api/src/rag/rag.controller.ts`

| Method | Path | Handler | Auth | Request | Response | Errors |
|---|---|---|---|---|---|---|
| POST | `/rag/provider-check` | `:71` | `DOCUMENTS_INDEX` | — | `{ provider, ok, probe{ dimensions, expectedDimensions, columnDimensions, configuredDimensions, durationMs }, error, dimensionConfigMismatch, corpus }` (`:134-148`) | never throws: a provider failure is caught (`:99-101`) and returned as a redacted `error` string |
| POST | `/rag/reindex` | `:157` | `DOCUMENTS_INDEX` | — | `reindexAll()` outcome — `{ provider, results[] }` (`:160`, `:167-169`) | — |
| POST | `/rag/reindex/stale` | `:180` | `DOCUMENTS_INDEX` | — | `reindexStale()` outcome, same shape (`:183`) | — |
| POST | `/rag/reindex/:documentId` | `:208` | `DOCUMENTS_INDEX` | — | `{ status, chunkCount, … }` (`:214`, `:222-224`) | 400 non-UUID |
| POST | `/rag/query` | `:231` | `AI_ASK` · **PHI** (`:236`) | `RagQueryDto` `:26-29` — `question`, optional `category` | the governed answer, unpersisted (`:238`) | 400 validation or PHI |
| GET | `/rag/search` | `:242` | `AI_SEARCH` · **PHI** on the *query string* (`:247`) | `?q=`, optional `?category=` | `{ items: [{ documentId, documentTitle, category, pageNumber, approvalDate, similarity, snippet }] }` (`:252-262`); `{ items: [] }` for a blank `q` (`:249`) | 400 from the PHI guard |

Three of these carry reasoning worth preserving verbatim in an audit:

- `/rag/provider-check` exists because the only previous way to learn why indexing was failing was
  to index something, which on a live system means pushing a document through the approval workflow
  and into the corpus just to read an error (`:46-49`). It is deliberately **not** part of
  `/health/ready` — readiness is polled every few seconds and billing an embeddings call per poll,
  or pulling a pod out of rotation over a dependency that only affects ingestion, would both be
  wrong (`:56-59`). It never returns the provider's raw body (`:60-63`).
- `/rag/query` persists nothing and is screened anyway, because the text reaches the LLM provider:
  under `LLM_PROVIDER=openai` it leaves the hospital, and "stored text can be redacted later; sent
  text cannot be recalled" (`:233-235`).
- `/rag/search` screens the *query string* rather than a body because `AllExceptionsFilter` logs
  `req.url` on a 5xx, making an unscreened `?q=` the one path by which free text reaches the
  application log (`:244-246`).

`POST /rag/reindex/:documentId` is on `rag` rather than `documents` deliberately:
`POST /documents/:id/index` is an approval-workflow transition that refuses an ACTIVE document, so
repairing one live document previously meant deactivate → re-approve → re-index — three
approval-history events for an infrastructure operation, and a window where the document is out of
the corpus (`:201-206`).

### `dose` — `apps/api/src/dose/dose.controller.ts`

| Method | Path | Handler | Auth | Request | Response | Errors |
|---|---|---|---|---|---|---|
| POST | `/dose/calculate` | `:56` | `DOSE_CALCULATE` | `CalculateDto` `:28-36` — `formulaId` (UUID), `weightKg` (positive), optional `ageYears`, `concentrationMgPerMl`, `requiredDoseMg`, `route`, `frequencyPerDay` | `{ calculationId, formulaName, drugName, route, frequencyPerDay, steps, finalDoseMg, unit, volumeMl, warnings, sourceDocument }` + the contractual safety warning (`dose.service.ts:206-220`) | 400 validation |
| GET | `/dose/formulas` | `:62` | `DOSE_CALCULATE` | `?all=true` | formula rows (`dose.service.ts:39-45`) | — |
| POST | `/dose/formulas` | `:78` | `DOSE_FORMULAS_MANAGE` · **PHI** (`:74-77`, METADATA) | `CreateFormulaDto` `:38-50` | the created formula (`dose.service.ts:65`) | 400 validation |
| POST | `/dose/formulas/:id/approve` | `:87` | `DOSE_FORMULAS_APPROVE` | — | the approved formula (`dose.service.ts:84`) | 400 non-UUID |

`?all=true` is honoured only for callers who also hold `DOSE_FORMULAS_MANAGE`
(`dose.controller.ts:68-71`) — the permission check is in the handler, not only in the guard, so a
`DOSE_CALCULATE`-only caller cannot see unapproved formulas by adding a query parameter.

### The single-route controllers

| Method | Path | Handler | Auth | Request | Response | Errors |
|---|---|---|---|---|---|---|
| GET | `/audit-logs` | `audit.controller.ts:11` | `AUDIT_READ` | `action`, `actorEmail`, `resourceType`, `limit`/`offset` via `PAGE_INT` (`:17-18`) | `{ items, total }` (`audit.service.ts:59`) | 400 on a non-integer limit/offset |
| GET | `/analytics/overview` | `analytics.module.ts:64` | `ANALYTICS_READ` | — | `{ counters{12 counts}, refusalRate, questionsByDay[], documentsByCategory[] }` (`analytics.module.ts:46-56`) | — |
| GET | `/roles` | `roles.controller.ts:31` | `ROLES_READ` | — | `[{ id, name, description, permissions[] }]` (`roles.service.ts:19-24`) | — |
| GET | `/settings` | `settings.module.ts:58` | `SETTINGS_READ` | — | `Setting` rows ordered by key (`settings.module.ts:29`) | — |
| PUT | `/settings/:key` | `settings.module.ts:64` | `SETTINGS_MANAGE` | `{ value: unknown }` (`settings.module.ts:68`) | the saved `Setting` (`settings.module.ts:34-41`) | — |
| GET | `/notifications` | `notifications.controller.ts:14` | `NOTIFICATIONS_READ` | — | the caller's notification rows (`notifications.service.ts:38-45`) | — |
| POST | `/notifications/:id/read` | `notifications.controller.ts:20` | `NOTIFICATIONS_READ` | — | `{ ok: true }` (`notifications.service.ts:48`) | 400 non-UUID |
| GET | `/health` | `health.controller.ts:31` | public | — | `{ status: 'ok', platform, time }` (`:33`) | none — dependency-free by design (`:10-13`) |
| GET | `/health/ready` | `health.controller.ts:37` | public | — | `{ status, dependencies: { database, objectStorage }, time }` (`:45-52`) | 503 when either dependency is down, set on the response rather than thrown (`:44`) |

`GET /roles` is the whole roles API. `POST /roles` and `PATCH /roles/:id` were removed: both wrote
to `role_permissions`, returned success and emitted an audit entry while changing nothing a user
could actually do, because `PermissionsGuard` reads the matrix in `packages/shared/src/rbac.ts` and
never the database (`roles.controller.ts:6-26`).

`PUT /settings/:key` takes `@Body() body: { value: unknown }` — a plain interface, not a
`class-validator` DTO (`settings.module.ts:68`), so `ValidationPipe` has no metadata to check it
against. See "Reviewer items" below.

## Authorisation summary

**Public (7):** `POST /auth/login`, `/auth/refresh`, `/auth/mfa/verify`, `/auth/forgot-password`,
`/auth/reset-password`, `GET /health`, `GET /health/ready`. The five `auth` routes are all
throttled at the stricter credential limit; the two health routes are not.

**Authenticated, no permission (5):** `GET /users/me` (`users.controller.ts:52`),
`POST /auth/logout` (`auth.controller.ts:97`), `POST /auth/mfa/enroll` (`:109`),
`POST /auth/mfa/enable` (`:115`), `POST /auth/mfa/disable` (`:125`). Each acts only on the caller's
own id from the JWT.

**Permission-gated (38):** every remaining route. Permissions used, with the number of routes each
gates: `DOCUMENTS_READ` 5, `DOCUMENTS_INDEX` 5, `USERS_MANAGE` 3, `AI_ASK` 3, `DOCUMENTS_APPROVE` 2,
`AI_REVIEW_ANSWERS` 2, `DOSE_CALCULATE` 2, `NOTIFICATIONS_READ` 2, and one route each for
`DOCUMENTS_UPLOAD`, `DOCUMENTS_MANAGE`, `DOCUMENTS_DOWNLOAD`, `DOCUMENTS_SUBMIT_REVIEW`,
`DOCUMENTS_DEACTIVATE`, `DOSE_FORMULAS_MANAGE`, `DOSE_FORMULAS_APPROVE`, `AI_SEARCH`, `AUDIT_READ`,
`ANALYTICS_READ`, `ROLES_READ`, `SETTINGS_READ`, `SETTINGS_MANAGE`, `USERS_READ`.

**PHI-screened (10 routes, from `grep -rn "@ScreenForPhi"`):** `POST /chat/ask`, `POST /rag/query`,
`GET /rag/search`, `POST /documents/upload`, `PATCH /documents/:id`,
`POST /documents/:id/submit-review`, `POST /documents/:id/approve`, `POST /documents/:id/reject`,
`POST /documents/:id/deactivate`, `POST /dose/formulas`. The three free-text clinical surfaces
(`/chat/ask`, `/rag/query`, `/rag/search`) use the default profile; the seven metadata surfaces use
`PhiProfile.METADATA`.

## Environment variables consumed

Extracted with `grep -rno "process\.env\.[A-Z_0-9]*" apps/api/src --include=*.ts`, excluding
`.spec.ts` files, then read in context. Line references are to the read site.

**Resolved through `loadEnv()` (`apps/api/src/config/env.ts`)** — the only secret-resolution path:

| Group | Variables (line in `config/env.ts`) |
|---|---|
| Environment | `NODE_ENV` (`:17`, validated `:34-46` against `production`/`development`/`test`) |
| Database | `POSTGRES_HOST` `:332`, `POSTGRES_PORT` `:333`, `POSTGRES_USER` `:334`, `POSTGRES_PASSWORD` `:335`, `POSTGRES_DB` `:336` |
| JWT | `JWT_SECRET` `:339`, `JWT_REFRESH_SECRET` `:340`, `JWT_EXPIRES_IN` `:341`, `JWT_REFRESH_EXPIRES_IN` `:342` |
| Object storage | `S3_ENDPOINT` `:345`, `S3_REGION` `:346`, `S3_ACCESS_KEY` `:347`, `S3_SECRET_KEY` `:348`, `S3_BUCKET` `:349`, `S3_FORCE_PATH_STYLE` `:350` |
| HTTP | `API_PORT` `:330`, `CORS_ORIGINS` `:321`, `REQUEST_BODY_LIMIT` `:354`, `APP_BASE_URL` `:372` |
| Rate limiting / lockout | `RATE_LIMIT_TTL` `:356`, `RATE_LIMIT_MAX` `:357`, `AUTH_RATE_LIMIT_MAX` `:358`, `AUTH_MAX_FAILED_ATTEMPTS` `:361`, `AUTH_LOCKOUT_MINUTES` `:362`, `PASSWORD_RESET_TOKEN_MINUTES` `:365` |
| Mail | `MAIL_PROVIDER` `:274`, `MAIL_HOST` `:275`, `MAIL_FROM` `:378`, `MAIL_PORT` `:380`, `MAIL_USER` `:381`, `MAIL_PASSWORD` `:382` |
| RAG tuning | `RAG_MIN_SIMILARITY` `:108`, `RAG_TOP_K` `:103`, `RAG_FINAL_K` `:104`, `RAG_MAX_PER_DOCUMENT` `:105` |
| PHI | `PHI_MRN_PATTERN` `:162` |
| Providers | `LLM_PROVIDER`, `EMBEDDING_PROVIDER`, `OPENAI_API_KEY` — checked together at `:299-308` |

Five are hard fail-fasts in production, checked before anything else initialises (`:260-267`):
`JWT_SECRET`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`, `S3_SECRET_KEY`, `S3_ACCESS_KEY`. Each
fails on a missing *or* still-default value (`required()`, `:190-201`). Four more fail on a
malformed value in **every** environment because they are called unconditionally from `loadEnv()`
(`:312-315`, `:319`): the three RAG integers, `RAG_MIN_SIMILARITY`, and `PHI_MRN_PATTERN`.

`MAIL_PROVIDER` deliberately does not fail-fast: `smtp` without `MAIL_HOST` throws (`:275-277`), but
a production deploy left on `log` only warns (`:278-284`), on the stated reasoning that refusing to
boot would take the clinical assistant offline over undelivered reset links (`:271-273`).

**Read outside `loadEnv()`** — every remaining site, named in full:

| File | Variables |
|---|---|
| `apps/api/src/config/data-source.ts` | `TYPEORM_LOGGING` (`:42`) |
| `apps/api/src/auth/auth.service.ts` | `AUTH_DEV_RETURN_RESET_TOKEN` (`:280`) |
| `apps/api/src/auth/demo-account-guard.service.ts` | `ALLOW_DEMO_ACCOUNTS` (`:11`, read at `:64`) |
| `apps/api/src/rag/embedding.service.ts` | `EMBEDDING_DIM` (`:4`), `EMBEDDING_BATCH_SIZE` (`:93`), `EMBEDDING_BATCH_CHARS` (`:97`), `OPENAI_EMBEDDING_MODEL` (`:146`), `EMBEDDING_PROVIDER` + `OPENAI_API_KEY` (`:169`) |
| `apps/api/src/rag/llm.service.ts` | `OPENAI_CHAT_MODEL` (`:85`), `LLM_PROVIDER` + `OPENAI_API_KEY` (`:153`) |
| `apps/api/src/rag/openai-http.ts` | `OPENAI_BASE_URL` (`:47`), `OPENAI_TIMEOUT_MS` (`:48`), `OPENAI_API_KEY` (`:57`) |
| `apps/api/src/seed/seed-policy.ts` | `SEED_ALLOW_PRODUCTION` (`:16`) |
| `apps/api/src/seed/demo-accounts.ts` | `SEED_PASSWORD_<ROLE>`, built by `seedPasswordEnvVar()` (`:53`) |
| `apps/api/src/scripts/create-admin.ts` | `ADMIN_NAME` (`:156`) and others read through a helper (`:30`) |
| `apps/api/src/scripts/field-eval.ts` | `EVAL_MFA_CODE` (`:110`), `EVAL_PASSWORD` (`:132`) |

(One apparent match, `process.env.X` at `config/env.ts:72`, is inside a docblock describing the
pattern this file replaced — not a read.)

## External services called

| Service | Client | Configured by | Failure behaviour |
|---|---|---|---|
| PostgreSQL + pgvector | TypeORM, via `buildDataSourceOptions()` (`app.module.ts:29`) | `POSTGRES_*` | `GET /health/ready` reports `database: down` and answers 503 (`health.controller.ts:55-61`) |
| S3-compatible object storage | `@aws-sdk` `S3Client` (`storage.service.ts:30-31`) — MinIO locally, any S3 endpoint in production (`storage.service.ts:13`) | `S3_*` | `GET /health/ready` reports `objectStorage: down` |
| SMTP | `mail.service.ts` | `MAIL_*`; `log` provider writes the reset link to the application log instead of sending | Degraded, never fatal |
| OpenAI-compatible HTTP API | `openAiPost()` (`openai-http.ts:46`), `POST {OPENAI_BASE_URL}{path}`, default `https://api.openai.com/v1` (`:47`), bearer `OPENAI_API_KEY` (`:57`), `AbortSignal.timeout` (`:60`), one retry | `OPENAI_*`, `LLM_PROVIDER`, `EMBEDDING_PROVIDER` | `POST /rag/provider-check` exercises it without touching the corpus; a boot with `…=openai` and no key now refuses (`config/env.ts:299-308`) |

Under the default `mock` providers the API makes **no** outbound calls: the mock LLM is extractive
and the mock embedder is a deterministic hashed bag-of-words (`embedding.service.ts:53-74`).

## Reviewer items

Findings from this pass, stated as what was observed:

1. **`PUT /settings/:key` has no validated DTO.** Its body is typed as `{ value: unknown }`
   (`settings.module.ts:68`) rather than a `class-validator` class, so the global `ValidationPipe`
   has no metadata for it and neither `key` nor `value` is constrained. `key` is also a free path
   segment with no pipe (`settings.module.ts:67`), and `upsert()` writes it straight into the
   primary key (`settings.module.ts:34-41`). The route is gated on `SETTINGS_MANAGE`, so this is
   not an unauthenticated surface; it is an unvalidated one behind a high privilege.
2. **The two health routes are not throttled.** Every other public route carries
   `@Throttle(AUTH_THROTTLE)`; `GET /health` and `GET /health/ready` carry no override, so they fall
   back to the global limit (`app.module.ts:31-36`). `/health/ready` performs a database query and
   a storage call per request (`health.controller.ts:39-42`). Noted rather than asserted as a
   defect: a readiness endpoint is normally reachable only from inside the cluster, and whether it
   is exposed publicly is a deployment question this file cannot answer.
3. **A duplicated comment block in `config/env.ts` — found and removed.** Three comment lines
   repeating `:264-266` verbatim sat immediately after `required('S3_ACCESS_KEY', …)` with no code
   between them, followed by two blank lines — a leftover from an earlier edit in this audit's own
   fix track. Deleted in this commit; `config/env.ts` is now 386 lines and every `config/env.ts`
   citation in this file is against that version. Cosmetic, no behavioural effect, and the unit
   suite was re-run to confirm it.

## ⚠️ Unverified assumptions

- Response shapes are stated from the `return` expression of the handler or of the service method
  it delegates to. Where a handler returns an entity directly (`GET /documents/:id/versions`,
  `GET /settings`, `POST /dose/formulas`), the serialised shape is the TypeORM entity's columns; I
  have read those entities, but I have not asserted the shape against a live response for every
  such route.
- The per-permission route counts in "Authorisation summary" come from the same script output, via
  `grep -o "|Permissions|[A-Z_]*|" … | sort | uniq -c`; they sum to 38, matching the split.
- `apps/api/src/mail/mail.service.ts` and `apps/api/src/storage/storage.service.ts` were read in an
  earlier batch; the specific lines cited here were re-checked, but their full contents are
  summarised in `03-MODULES-backend.md` (not yet written) rather than restated here.
