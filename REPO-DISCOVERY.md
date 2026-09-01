# REPO-DISCOVERY.md

**Forensic repository discovery — evidence-based, read-only.**

Investigation date: 2026-08-31. Commit under investigation:
`114e655f3590ee648dc35ad61c726b44b0713479` (branch `main`, working tree clean).

> ### ⚠ Read §0.1 first — part of this snapshot has been superseded
>
> This report is a **dated snapshot pinned to `114e655`**, and it is kept that
> way on purpose: every claim in it is tied to one commit, so re-pointing it at
> a moving `main` would destroy the audit trail it exists to provide. But two
> commits later, `503cef4` (PR #41) deliberately closed 11 of the gaps this
> report found. **§8, §23.5 and §28 therefore no longer describe current
> `main`.** §0.1 records exactly what changed; the two sections together let a
> reader reconstruct both states.

## 0.1 Addendum — what changed since this snapshot

Added 2026-08-31, after the report itself was merged (PR #40, `e1a1adc`).

`503cef4` — "wire the API's unreachable features into the UI" (PR #41) — was
written **in response to this report**, and it changes the report's central
finding. Of the **15 routes** §8 lists as having no caller in either client,
**11 now have one**:

| Route | Wired at |
| --- | --- |
| `GET /users/me` | `/security` page; also changed server-side to return the DB-backed profile rather than echoing the JWT |
| `POST /auth/mfa/enroll` · `enable` · `disable` | `/security` page — MFA can now be turned on from the product, which §23.5 records it could not |
| `GET /notifications`, `POST /notifications/:id/read` | new `/notifications` page + unread nav badge |
| `GET /chat/history` | collapsible panel on `/assistant` |
| `POST /dose/formulas`, `POST /dose/formulas/:id/approve` | formula-management section on `/dose-calculator` |
| `GET /documents/:id/versions` | version list in the `/approvals` disclosure |
| `POST /rag/provider-check`, `POST /rag/reindex/stale` | two operator actions on `/settings` |

**Four remain unwired, each deliberately** (reasons recorded in the PR #41
description): `DELETE /users/:id` — it is a soft-deactivate and `/users`
already does exactly that via `PATCH {isActive}`; `GET /documents/:id` and
`PATCH /documents/:id` — the list and lifecycle actions cover the workflows;
`POST /rag/reindex/:documentId` — the stale-reindex covers the repair case.
`POST /rag/query` remains test-only, as §8 already recorded.

Other counts this moves:

| Measure | At `114e655` (this report) | At `503cef4` |
| --- | --- | --- |
| Web pages | 16 | **18** (`/security`, `/notifications`) |
| Routes with a web/mobile caller | 31 of 49 | **42 of 49** |
| API e2e tests | 68 | **69** |
| Nav groups | 3 | **4** ("Account") |

Everything else in this report — the RAG chain, the refusal gates, the
governance filters, the security inventory, the dead-code findings in §23.1–23.4,
the git archaeology — was unaffected by `503cef4` and still holds.

## How to read this document

Every substantive claim below carries a `path:line`, a command output, or a
commit SHA. Where something could not be established, it says
**NOT DETERMINED** and names the search performed. Where something was
searched for and does not exist, it says **NOT FOUND** and names the patterns.

Seven statuses are used, and they are deliberately not interchangeable:

| | Meaning |
| --- | --- |
| ✅ | Implemented **and** a runtime caller reaches it |
| 🟡 | Implemented but only partially connected |
| 🔵 | Implemented; reachability not proven |
| 💀 | Exists but no reference found — dead-code candidate |
| 📋 | Documented or configured only; not wired into runtime |
| ❌ | NOT FOUND |
| ❓ | NOT DETERMINED |

No secret values appear anywhere in this document. Variable and file names
only.

---

## 0. Plain-language summary — what is actually inside this project

This repository contains **one product, built four times over**: a shared
type/permission library, an HTTP API, a web app, and a mobile app.

**What it does, per the code:** a nurse types a clinical question. The API
turns the question into a vector, searches a PostgreSQL/pgvector table of text
chunks, and — critically — that search is restricted by four SQL conditions to
chunks belonging to documents a human has walked through an approval workflow
(`retrieval.service.ts:69-73`). The surviving chunks are rescored, cut to a
handful, and compared against a numeric threshold. If nothing clears it, the
API returns a **fixed Arabic sentence** meaning "no approved document is
sufficient — refer to the responsible officer" (`rag-query.service.ts:86`,
string defined at `packages/shared/src/constants.ts`). If chunks do clear it,
they are handed to a language model whose answer structure **has no field for
a citation** (`llm.service.ts:6-19`) — every citation shown to the nurse is
copied out of the database row of a chunk that was actually retrieved
(`rag-query.service.ts:203-213`). That is the whole product thesis, and it is
implemented as described.

**What a real user can do today** (each traced to a caller in §7/§8): sign in
(with a TOTP second factor if their account has one), ask the assistant, ask a
drug-preparation assistant, search CBAHI standards, calculate a drug dose,
browse approved policies, upload a PDF, move a document through
draft → review → approved → indexed → active, review AI answers, manage users,
read the audit log, read an analytics overview, and change settings.

**What exists in the API but no screen calls** (§23): deleting a user,
enrolling in MFA, reading notifications, and four of the six RAG maintenance
endpoints. A daily cron writes notification rows that **no user interface can
display** (`notifications.service.ts:39`, zero hits for `notification` in
either client).

**What is not here at all** (§15, §22): no metrics, no tracing, no error
reporting, no digital signatures, no hash-chained audit log, no encrypted
local storage, no biometric authentication, no queues, no WebSockets, no
webhooks.

---

## 1. Repository identity

| Field | Value | Evidence |
| --- | --- | --- |
| Remote | `https://github.com/totti0770-beep/BNP-Decision-Guard-` | `git remote -v` |
| Current branch | `main` | `git rev-parse --abbrev-ref HEAD` |
| HEAD | `114e655f3590ee648dc35ad61c726b44b0713479` | `git rev-parse HEAD` |
| Working tree | **clean** (0 modified, 0 untracked tracked-path changes) | `git status --porcelain` → empty |
| Tags | **none** | `git tag` → empty |
| Commits | **108** | `git rev-list --count HEAD` |
| Tracked files | **202** | `git ls-files \| wc -l` |
| First commit | `3d1c895ec8370abe59d7ab8a1f27faa9c9b9cc5f` — 2026-07-05 17:27:59 +0000 — "Add BNP Decision Guard backend: NestJS API, RAG pipeline, RBAC, audit, Docker infra" | `git log --reverse` |
| Latest commit | `114e655` — 2026-08-22 22:58:22 +0300 — "Merge pull request #39: report the refusal threshold in the boot summary" | `git log -1` |
| Contributors | 2 — `Claude <noreply@anthropic.com>` (68 commits), `totti0770-beep <totti0770@gmail.com>` (40 commits) | `git shortlog -sne --all` |
| Local branches | 7 (`main` + 6 `claude/*` feature branches) | `git branch` |
| Remote branches | 25 | `git branch -r \| wc -l` |
| Repository visibility | ❓ **NOT DETERMINED** — not readable from the local clone; no API call made for it | — |
| Default branch on the remote | ❓ **NOT DETERMINED** — the local clone's HEAD is `main`, which is not proof of the remote default | — |

Development window: **48 days**, 2026-07-05 → 2026-08-22. There has been no
commit in the 9 days before this investigation.

---

## 2. Complete repository tree

Generated directories (`node_modules`, `dist`, `.next`, `.expo`, `.git`) are
excluded. Everything below is tracked unless marked.

```
.
├── .env.example                     example variable names + shipped defaults
├── .github/workflows/ci.yml         the only workflow (6 jobs)
├── .gitignore
├── CLAUDE.md  README.md  SECURITY.md
├── docker-compose.yml               full local stack
├── eslint.config.js                 ESLint 9 flat config, whole monorepo
├── package.json  package-lock.json  npm workspaces root
│
├── apps/api/                        NestJS 11 HTTP API  ─ the only backend
│   ├── package.json  tsconfig*.json  jest-e2e.config.js
│   ├── eval-report.md               ** UNTRACKED, generated ** (see §18)
│   ├── src/
│   │   ├── main.ts                  process entry point
│   │   ├── app.module.ts            module graph + 3 global guards
│   │   ├── health.controller.ts     liveness + readiness
│   │   ├── analytics/  approval/  audit/  auth/  chat/  documents/
│   │   ├── dose/  entities/  mail/  migrations/  notifications/
│   │   ├── rag/                     the retrieval + LLM pipeline (14 files)
│   │   ├── roles/  settings/  storage/  users/
│   │   ├── common/                  decorators, guards, filter, interceptor,
│   │   │                            JSON logger
│   │   ├── config/                  env.ts (secret resolution), data-source.ts
│   │   ├── scripts/                 migrate.ts, create-admin.ts
│   │   └── seed/                    demo data + production seed refusal
│   └── test/                        e2e suite (real HTTP + real Postgres)
│       └── support/                 e2e-app.ts, env.ts, gold-set.ts
│
├── apps/web/                        Next.js 16 App Router  ─ the web client
│   ├── package.json  next.config.mjs  tailwind.config.ts  postcss.config.mjs
│   ├── e2e-smoke.mjs                Playwright browser smoke (run by CI)
│   └── src/
│       ├── app/                     16 page.tsx files + 2 layouts + globals.css
│       ├── components/              shell, assistant-chat, ui/, toggles
│       └── lib/                     api.ts, auth.tsx, i18n.ts, language.tsx,
│                                    async.ts
│
├── apps/mobile/                     Expo 57 / RN 0.86  ─ NOT an npm workspace
│   ├── package.json  package-lock.json   (its own install)
│   ├── App.tsx                      entry; hand-rolled tab switch, no router
│   ├── app.json  eas.json  babel.config.js  jest.config.js
│   ├── src/  screens/ (6)  components/BottomNav.tsx  api.ts  i18n.ts  theme.ts
│   └── test/mocks/                  async-storage + expo-secure-store fakes
│
├── packages/shared/                 the only internal library
│   └── src/  constants.ts  rbac.ts  types.ts  index.ts
│
├── docs/                            api, architecture, database-schema,
│                                    production-readiness, clinical-validation
│
└── infra/
    ├── docker/                      Dockerfile.api, Dockerfile.web, initdb SQL
    ├── k8s/                         4 manifests + README  ── NOT wired (§23)
    └── railway/README.md            the actual live deployment
```

### Directory roles, and whether each is used

| Directory | Contains | Used by | Status |
| --- | --- | --- | --- |
| `apps/api/src` | The entire backend | Docker `CMD`, CI, both clients | ✅ |
| `apps/api/test` | 7 e2e specs + 3 support files | `npm run test:e2e`, CI job `api` | ✅ |
| `apps/web/src` | 16 pages, 5 components, 5 libs | `next build`, CI jobs `web` + `smoke` | ✅ |
| `apps/mobile/src` | 6 screens, 1 component, 3 libs | `apps/mobile` jest + tsc, CI job `mobile` | 🟡 — typechecked and unit-tested; **no build or deploy step exists** for it in CI or infra |
| `packages/shared/src` | Constants, RBAC matrix, DTO types | api + web import `@bnp/shared` | 🟡 — `constants.ts` and `rbac.ts` are used; `types.ts` is not (§23) |
| `infra/docker` | The two images actually built | `docker-compose.yml`, Railway | ✅ |
| `infra/k8s` | Deployment/Ingress/Secrets manifests | **nothing** | 📋 |
| `infra/railway` | README describing the live deploy | humans | 📋 (documentation) |
| `docs` | 5 markdown documents | humans | 📋 |

---

## 3. Technology DNA

### Languages, by tracked line count

| Extension | Files | Lines | Where |
| --- | --- | --- | --- |
| `.ts` | 121 | **14,261** | API source + specs, shared, mobile logic, web libs |
| `.tsx` | 33 | **6,123** | Web pages/components, mobile screens |
| `.json` | 16 | 20,085 | Dominated by `package-lock.json` files |
| `.md` | 10 | 1,949 | Docs |
| `.yml` | 2 | 362 | `ci.yml`, `docker-compose.yml` |
| `.yaml` | 4 | 198 | k8s manifests |
| `.mjs` | 3 | 392 | `e2e-smoke.mjs`, `next.config.mjs`, `postcss.config.mjs` |
| `.js` | 4 | 157 | jest/eslint/babel configs |
| `.css` | 1 | 164 | `apps/web/src/app/globals.css` |
| `.sql` | 1 | 2 | `infra/docker/initdb/01-pgvector.sql` |

Command: `git ls-files "*.<ext>" | xargs cat | wc -l`.

**Sole language: TypeScript.** There is no Python, Go, Java, Swift, Kotlin,
Dart or Rust anywhere in the tracked tree.

### Frameworks and versions — from manifests, not from documentation

| Layer | Technology | Version | Evidence |
| --- | --- | --- | --- |
| API framework | NestJS | `^11.2.1` | `apps/api/package.json` |
| HTTP platform | `@nestjs/platform-express` (Express 5 types) | `^11.2.1` / `@types/express ^5.0.6` | ibid. |
| ORM | TypeORM | `^0.3.20` | ibid. |
| DB driver | `pg` | `^8.12.0` | ibid. |
| Auth | `@nestjs/jwt`, `passport`, `passport-jwt` | `^11.0.2`, `^0.7.0`, `^4.0.1` | ibid. |
| Password hashing | `bcryptjs` | `^2.4.3` | ibid. |
| TOTP | `otplib` | `^12.0.1` | ibid. |
| Rate limiting | `@nestjs/throttler` | `^6.5.0` | ibid. |
| Scheduling | `@nestjs/schedule` | `^6.1.3` | ibid. |
| Security headers | `helmet` | `^7.1.0` | ibid. |
| Object storage | `@aws-sdk/client-s3` + presigner | `^3.600.0` | ibid. |
| Mail | `nodemailer` | `^9.0.5` | ibid. |
| PDF read | `pdf-parse` | `^1.1.1` | ibid. |
| PDF write (fixtures/seed) | `pdfkit` | `^0.15.0` | ibid. |
| Uploads | `multer` | `^2.0.2` (root override `^2.2.0`) | ibid. + root `package.json` |
| Web framework | Next.js (App Router) | `^16.3.1` | `apps/web/package.json` |
| Web runtime | React / ReactDOM | `^18.3.1` | ibid. |
| Web styling | Tailwind CSS + PostCSS + Autoprefixer | `^3.4.6` | ibid. |
| Browser automation | Playwright | `^1.61.1` (devDependency) | ibid. |
| Mobile framework | Expo | `~57.0.15` | `apps/mobile/package.json` |
| Mobile runtime | React Native / React | `0.86.2` / `19.2.3` | ibid. |
| Mobile native modules | `expo-secure-store`, `@react-native-async-storage/async-storage`, `react-native-safe-area-context` | `~57.0.1`, `2.2.0`, `~5.7.0` | ibid. |
| Tests | Jest + ts-jest (3 independent projects) + supertest | `^29.7.0` / `^7.0.0` | api, mobile manifests |
| Lint | ESLint 9 flat + typescript-eslint + eslint-plugin-react-hooks | `^9.39.5`, `^8.67.0`, `^5.2.0` | root `package.json`, `eslint.config.js` |
| Node engine | `>=20` | | root `package.json` |

**Notable absences, all searched:** no state-management library (no Redux,
Zustand, Jotai, MobX), no form library (no react-hook-form, Formik), no
component library (no MUI, shadcn, Chakra), no data-fetching library (no
react-query/SWR — `apps/web/src/lib/async.ts` is a hand-rolled hook), no
navigation library in mobile (no react-navigation/expo-router — `App.tsx:43`
is a `useState` tab switch), no GraphQL, no ORM other than TypeORM.

React version differs across clients: **React 18.3.1 on web, React 19.2.3 on
mobile.** They are separate installs and never share a runtime.

---

## 4. Package / workspace inventory

**Package manager:** npm. Two lockfiles: `package-lock.json` (root, covers the
three workspaces) and `apps/mobile/package-lock.json` (separate install).

**Workspace declaration** (`package.json`):

```json
"workspaces": ["packages/shared", "apps/api", "apps/web"]
```

**`apps/mobile` is deliberately not a workspace.** It has its own lockfile and
must be installed from its own directory. Evidence: absent from the array
above; `apps/mobile/package-lock.json` exists.

| Package | Name | Role | Entry | Build | Start | Test | Lint | Typecheck |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `packages/shared` | `@bnp/shared` | Constants, RBAC matrix, DTOs | `dist/index.js` (`main`) | `tsc -p tsconfig.json` | — | **none** | root `eslint .` | via build |
| `apps/api` | `@bnp/api` | HTTP API | `src/main.ts` → `dist/main.js` | `tsc -p tsconfig.build.json` | `node dist/main.js` | `jest` (unit), `jest --config jest-e2e.config.js` (e2e) | root `eslint .` | via build |
| `apps/web` | `@bnp/web` | Web client | Next.js App Router | `next build` | `next start` | **none** | root `eslint .` | **only via `next build`** |
| `apps/mobile` | `bnp-mobile` | Mobile client | `expo/AppEntry.js` (`main`) → `App.tsx` | **none** | `expo start` | `jest` | ❌ not covered by the root ESLint run | `tsc --noEmit` |

**Internal dependency graph** — one edge, in two places, no cycles:

```
packages/shared (@bnp/shared)
    ├──> apps/api   ("@bnp/shared": "*")
    └──> apps/web   ("@bnp/shared": "*")

apps/mobile ──> (nothing internal)
```

`apps/mobile` does **not** depend on `@bnp/shared`. Consequence traced in §23:
it redeclares its own i18n dictionary and its own API client rather than
sharing either.

**Consumption is from compiled output, not source.** `packages/shared/package.json`
sets `"main": "dist/index.js"`, so `npm test` and `npm run lint` both fail on a
fresh clone until `npm run build:shared` runs. Confirmed by the root script
chain: `build:api`, `build:web`, `dev:api`, `dev:web` all prepend
`npm run build:shared`; bare `test` and `lint` do not.

**Root overrides** (`package.json`): `lodash ^4.18.1`, `multer ^2.2.0`,
`file-type ^21.3.2`, `@nestjs/common ^11.0.0`, `@nestjs/core ^11.0.0`.
Mobile has its own: `uuid ^11.1.1`.

---

## 5. Entry points

Four processes can start from this repository. Every one was traced from its
entry file through initialization.

### 5.1 API server — `apps/api/src/main.ts`

```
main.ts:1   import 'reflect-metadata'
main.ts:15  loadEnv()          ← validates secrets; fails fast in production
                                 BEFORE any listener opens
main.ts:21  NestFactory.create(AppModule, { bodyParser: false,
                                            logger: new JsonLogger() })
main.ts:26  app.use(helmet())
main.ts:27  express.json({ limit: env.bodyLimit })
main.ts:32  app.enableCors({ origin: env.cors.origins.length
                                     ? env.cors.origins : false })
main.ts:37  ValidationPipe({ whitelist: true, transform: true })
main.ts:38  AllExceptionsFilter(app.get(AuditService))
main.ts:40  app.enableShutdownHooks()
main.ts:41  app.listen(env.port)
```

Services started via `AppModule`: TypeORM connection, `ScheduleModule.forRoot()`
(`app.module.ts:29`), and three global guards plus one global interceptor
(`app.module.ts:54-57`). Two services run work at boot:
`IndexingService.onApplicationBootstrap` (embedding-index summary) and
`DemoAccountGuardService.onApplicationBootstrap` (production demo-account
sweep). External connections opened: PostgreSQL, S3-compatible storage;
OpenAI and SMTP are contacted lazily on first use.

### 5.2 Migration runner — `apps/api/src/scripts/migrate.ts` → `dist/scripts/migrate.js`

Runs **before** `main.js` in the container (`infra/docker/Dockerfile.api`
`CMD`). It resolves credentials through `loadEnv()` via
`config/data-source.ts`, which is why that file is the earliest code in a
deployment to touch production secrets (`data-source.ts:15-21` comment).

### 5.3 Break-glass admin provisioning — `apps/api/src/scripts/create-admin.ts`

Runs in the container `CMD` between `migrate.js` and `main.js`, only when
`ADMIN_EMAIL` **and** `ADMIN_PASSWORD` are both set. Failure is fatal to
container start.

### 5.4 Seed — `apps/api/src/seed/seed.ts`

`seed.ts:5` imports `refuse-in-production.ts` **first**, before `app.module`,
so the production refusal fires ahead of the secret fail-fast.

### 5.5 Web — Next.js App Router

No hand-written server entry. `apps/web/src/app/layout.tsx` is the root
layout; `apps/web/src/app/page.tsx` is `/`. Started by `next dev` / `next start`.

### 5.6 Mobile — `apps/mobile/App.tsx`

Reached through `"main": "expo/AppEntry.js"`. `App.tsx:41-45` holds all app
state in `useState`: session, ready, tab, language, chat scope.

**No CLI, no worker, no desktop app, no serverless/edge function exists.**
Searched: `bin` fields in all manifests, `worker`, `queue`, `lambda`,
`functions/`, `edge` — NOT FOUND.

---

## 6. Runtime architecture

Only connections proven by code or configuration are drawn.

```
┌────────────────────┐        ┌────────────────────┐
│  apps/web          │        │  apps/mobile       │
│  Next.js 16 SPA-   │        │  Expo 57 / RN 0.86 │
│  style App Router  │        │  hand-rolled tabs  │
│  session in        │        │  tokens in         │
│  localStorage      │        │  SecureStore       │
└─────────┬──────────┘        └─────────┬──────────┘
          │  fetch, Bearer JWT          │  fetch, Bearer JWT
          │  NEXT_PUBLIC_API_URL        │  EXPO_PUBLIC_API_URL
          └──────────────┬──────────────┘
                         ▼
        ┌────────────────────────────────────┐
        │  apps/api — NestJS 11 (single      │
        │  process, no workers, no queues)   │
        │                                    │
        │  ThrottlerGuard → JwtAuthGuard →   │
        │  PermissionsGuard → controller     │
        │  + global AuditInterceptor         │
        └──┬─────────┬──────────┬────────────┘
           │         │          │
           ▼         ▼          ▼
   ┌─────────────┐ ┌──────────────┐ ┌──────────────────┐
   │ PostgreSQL  │ │ S3-compatible│ │ OpenAI-compatible│
   │ 16 +pgvector│ │ object store │ │ HTTP  (optional) │
   │ 14 tables   │ │ (MinIO local)│ │ /embeddings      │
   │ HNSW index  │ │ PDFs         │ │ /chat/completions│
   └─────────────┘ └──────────────┘ └──────────────────┘
                                    ┌──────────────────┐
                                    │ SMTP (optional,  │
                                    │ nodemailer)      │
                                    └──────────────────┘
```

Evidence for each edge:

| Edge | Evidence |
| --- | --- |
| web → API | `apps/web/src/lib/api.ts` (`API_URL` from `NEXT_PUBLIC_API_URL`), 30 call sites in §7 |
| mobile → API | `apps/mobile/src/api.ts:44` (`EXPO_PUBLIC_API_URL`, overridable and stored in AsyncStorage) |
| API → PostgreSQL | `TypeOrmModule.forRoot(buildDataSourceOptions())` — `app.module.ts:28`; raw SQL in `retrieval.service.ts`, `indexing.service.ts`, `analytics.module.ts:12` |
| API → object storage | `new S3Client({...})` — `storage.service.ts:30` |
| API → OpenAI-compatible | `fetch(\`${base}${path}\`)` — `openai-http.ts:53`; base `OPENAI_BASE_URL ?? https://api.openai.com/v1` (`:47`) |
| API → SMTP | `nodemailer.createTransport(...)` — `mail.service.ts:56`, dynamic `import('nodemailer')` at `:55` |

**Not present, all searched:** message queue (`bullmq`, `bull`, `amqp`,
`rabbit`, `kafka` → 0 hits), WebSocket/realtime (`socket.io`, `WebSocket`,
`@WebSocketGateway` → 0 hits), webhook receiver (`webhook` → 0 hits in source),
cache layer (see §23 for the unreferenced `redis` compose service),
separate admin service, BFF, or gateway.

### Module graph (`app.module.ts:27-49`)

`TypeOrmModule.forRoot` → `ScheduleModule.forRoot()` → `ThrottlerModule.forRoot`
→ 12 feature modules: `AuditLogModule`, `MailModule`, `StorageModule`,
`AuthModule`, `UsersModule`, `RolesModule`, `DocumentsModule`, `RagModule`,
`ChatModule`, `DoseCalculatorModule`, `AnalyticsModule`, `SettingsModule`,
`NotificationsModule`. `HealthController` is registered directly on the root
module (`app.module.ts:51`).

### Boot-time work (3 `OnApplicationBootstrap` implementors)

| Service | File | What it does at boot |
| --- | --- | --- |
| `IndexingService` | `rag/indexing.service.ts:67` | Logs one summary line: provider, chunk count, `staleRetrievable`, `staleOrphaned`, column dimensions, refusal threshold |
| `DemoAccountGuardService` | `auth/demo-account-guard.service.ts:46` | In production only: deactivates any account still using a shipped demo password |
| `MailService` | `mail/mail.service.ts:101` | Warns (and audits) when `MAIL_PROVIDER` is `log` in production |

---

## 7. Frontend inventory

### 7.1 Web — 16 pages, all statically prerendered

Verified by running `npm run build:web` (§27): 17 routes listed, all marked
`○ (Static)`.

Layout wrapping: `app/layout.tsx` (root, sets `<html lang|dir>` before first
paint) → `app/(app)/layout.tsx` (authenticated shell) → page.

| Page | Route | File | What the user does | API calls | Auth | Permission gate | Reachable |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Root redirect | `/` | `app/page.tsx` | Bounces to `/login` or `/dashboard` | none | — | — | ✅ |
| Login | `/login` | `app/login/page.tsx` | Sign in; enter TOTP code if challenged | `POST /auth/login` (`:48`), `POST /auth/mfa/verify` (`:48`) | public | — | ✅ |
| Forgot / reset | `/login/forgot` | `app/login/forgot/page.tsx` | Request reset link; set new password | `POST /auth/forgot-password` (`:55`), `POST /auth/reset-password` (`:72`) | public | — | ✅ |
| Dashboard | `/dashboard` | `app/(app)/dashboard/page.tsx` | Landing tiles + overview stats | `GET /analytics/overview` (`:67`, only when permitted) | JWT | none (nav item has no `permission`) | ✅ |
| Assistant | `/assistant` | `app/(app)/assistant/page.tsx` → `<AssistantChat>` | Ask a clinical question | `POST /chat/ask` (`assistant-chat.tsx:296`) | JWT | `ai:ask` | ✅ |
| Drug preparation | `/drug-prep` | `app/(app)/drug-prep/page.tsx` → `<AssistantChat assistantType="DRUG_PREPARATION">` | Same chat, different assistant type | `POST /chat/ask` | JWT | `ai:ask` | ✅ |
| Dose calculator | `/dose-calculator` | `app/(app)/dose-calculator/page.tsx` | Pick a formula, enter weight/dose, calculate | `GET /dose/formulas` (`:48`), `POST /dose/calculate` (`:93`) | JWT | `dose:calculate` | ✅ |
| CBAHI search | `/cbahi` | `app/(app)/cbahi/page.tsx` | Keyword search over CBAHI-category chunks | `GET /rag/search?q=…&category=CBAHI` (`:41`) | JWT | `ai:search` | ✅ |
| Policies | `/policies` | `app/(app)/policies/page.tsx` | Browse/paginate documents; request a download URL | `GET /documents?…` (`:73`), `GET /documents/:id/download-url` (`:86`) | JWT | `documents:read` | ✅ |
| Upload | `/upload` | `app/(app)/upload/page.tsx` | Upload a PDF with metadata | `POST /documents/upload` (`:65`) | JWT | `documents:upload` | ✅ |
| Approvals | `/approvals` | `app/(app)/approvals/page.tsx` | Drive a document through its lifecycle; view history | `GET /documents` (`:75`), `POST /documents/:id/{submit-review,approve,reject,index,deactivate}` (`:107` via `act()`, buttons at `:200,212,225,235,243`), `GET /documents/:id/approval-history` (`:126`) | JWT | `documents:read` to view; per-action checks at `:93-95` | ✅ |
| Answer review | `/answer-review` | `app/(app)/answer-review/page.tsx` | Review AI answers, mark reviewed | `GET /chat/answers?reviewStatus=…` (`:76`), `POST /chat/answers/:id/review` (`:87`) | JWT | `ai:review-answers` | ✅ |
| Users | `/users` | `app/(app)/users/page.tsx` | List, create, edit users; read roles | `GET /users` (`:54`), `GET /roles` (`:55`), `POST /users` (`:79`), `PATCH /users/:id` (`:100`) | JWT | `users:read` | ✅ |
| Audit | `/audit` | `app/(app)/audit/page.tsx` | Browse and filter the audit log | `GET /audit-logs?…` (`:57`) | JWT | `audit:read` | ✅ |
| Analytics | `/analytics` | `app/(app)/analytics/page.tsx` | Read the overview metrics | `GET /analytics/overview` (`:101`) | JWT | `analytics:read` | ✅ |
| Settings | `/settings` | `app/(app)/settings/page.tsx` | Read/write settings; trigger a full reindex | `GET /settings` (`:46`), `PUT /settings/:key` (`:96`), `POST /rag/reindex` (`:69`) | JWT | `settings:read` | ✅ |

**Every one of the 13 `(app)` pages is present in the navigation**
(`shell.tsx:30-52`), and `/login`, `/login/forgot` and `/` are all linked. **No
orphan page exists** — verified by comparing the `page.tsx` file list against
every internal `href`/`push` target in `apps/web/src`.

**Navigation is permission-filtered**, not merely styled: `shell.tsx:25` types
each item as `{ href, labelKey, permission? }`, and items whose permission the
session lacks are not rendered. `/dashboard` carries no permission and is
therefore visible to every authenticated role.

### 7.2 Shared web components

| File | Role |
| --- | --- |
| `components/shell.tsx` | App shell, nav, `PageHeader`, skip link, focus-trapped mobile drawer (`:90,104`) |
| `components/assistant-chat.tsx` | The entire chat UI; used by `/assistant` and `/drug-prep` |
| `components/ui/index.tsx` | Primitives: `Alert`, `Button`, `Field`, `Input`, `Panel`, `EmptyState`, `ErrorState`, `SkeletonRows` |
| `components/language-toggle.tsx`, `components/theme-toggle.tsx` | EN/AR and light/dark switches |
| `lib/api.ts` | fetch wrapper: Bearer token, refresh-on-401 (`:47`), redirect to login |
| `lib/auth.tsx` | Session context, `hasPermission`, logout (`:44`) |
| `lib/i18n.ts` | 714-line EN/AR dictionary + `t()`/`isRtl()`/`localeTag()` |
| `lib/language.tsx` | Language provider + `useT()` |
| `lib/async.ts` | Hand-rolled `useAsyncData` hook (this repo's substitute for react-query) |

### 7.3 Mobile — 6 screens, no router

`App.tsx:43` holds `const [tab, setTab] = useState<Tab>('home')`; `:151-164`
renders one screen per tab value. There is **no navigation library**.
`App.tsx:97-98` guards against a stored tab the current role cannot see.

| Screen | File | API calls | Reachable |
| --- | --- | --- | --- |
| Login | `screens/LoginScreen.tsx` | `POST /auth/login`, `POST /auth/mfa/verify` (`:60`) | ✅ — rendered when no session (`App.tsx:81`) |
| Home | `screens/HomeScreen.tsx` | `GET /analytics/overview` (`:48`) | ✅ `App.tsx:151` |
| Chat | `screens/ChatScreen.tsx` | `POST /chat/ask` (`:78`) | ✅ `App.tsx:154` |
| Dose calculator | `screens/DoseCalculatorScreen.tsx` | `GET /dose/formulas` (`:50`), `POST /dose/calculate` (`:73`) | ✅ `App.tsx:162` |
| Audit | `screens/AuditScreen.tsx` | `GET /audit-logs?…` (`:57`) | ✅ `App.tsx:163` |
| Policies | `screens/PoliciesScreen.tsx` | `GET /documents?…` (`:47`) | ✅ `App.tsx:164` |

Mobile covers **6 of the 16 web routes**. It has no upload, approvals,
answer-review, users, settings, CBAHI-search, drug-prep, or forgot-password
screen.

---

## 8. API inventory — all 49 routes

> **Superseded in part by `503cef4` — see §0.1.** The reachability findings
> below describe `114e655`; 11 of the routes called unreachable here now have
> a caller.

12 controllers. Two are declared **inside module files**, so a
`*.controller.ts` glob misses them: `analytics.module.ts:60` and
`settings.module.ts:54`.

**Guard chain, applied globally to every route** (`app.module.ts:52-57`):

```
ThrottlerGuard  →  JwtAuthGuard  →  PermissionsGuard  →  handler
                                                          ↑
                    AuditInterceptor wraps every request (APP_INTERCEPTOR)
```

Order is deliberate — the source comment at `app.module.ts:52-53` states
rate limiting runs before auth so unauthenticated floods are throttled at the
edge. `ValidationPipe({ whitelist: true, transform: true })` is global
(`main.ts:37`), so every `@Body()` DTO is validated and unknown properties are
stripped.

Authentication is **deny-by-default**: a route is public only if it carries
`@Public()`. Exactly **7 routes** do.

### Auth — `apps/api/src/auth/auth.controller.ts`

| Method | Path | Line | Public | Throttle | Input DTO | Frontend caller |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/auth/login` | `:57` | ✅ `@Public()` | `@Throttle(AUTH_THROTTLE)` | `LoginDto` | web `login/page.tsx:48`, mobile `LoginScreen.tsx:60` |
| POST | `/auth/refresh` | `:71` | ✅ | ✅ | `RefreshDto` | web `lib/api.ts:47`, mobile `api.ts:126` |
| POST | `/auth/mfa/verify` | `:78` | ✅ | ✅ | `MfaVerifyDto` | web `login/page.tsx:48`, mobile `LoginScreen.tsx:60` |
| POST | `/auth/forgot-password` | `:85` | ✅ | ✅ | `ForgotPasswordDto` | web `login/forgot/page.tsx:55` |
| POST | `/auth/reset-password` | `:92` | ✅ | ✅ | `ResetPasswordDto` | web `login/forgot/page.tsx:72` |
| POST | `/auth/logout` | `:97` | ❌ JWT | — | — | web `lib/auth.tsx:44`, mobile `api.ts:143` |
| POST | `/auth/mfa/enroll` | `:109` | ❌ JWT | ✅ | — | 💀 **none** |
| POST | `/auth/mfa/enable` | `:115` | ❌ JWT | ✅ | `MfaEnableDto` | 💀 **none** |
| POST | `/auth/mfa/disable` | `:125` | ❌ JWT | ✅ | `MfaDisableDto` | 💀 **none** |

`auth.controller.ts:102-107` records the design intent for the three enrolment
routes: no `@Permissions()` because each handler acts only on
`user.userId` from the JWT, never on an id from the body — verified at
`:110`, `:121`, `:131`.

`auth.controller.ts:62-68` records that **public self-registration was
deliberately removed**; there is no `POST /auth/register`. Confirmed by
commit `648fecc` (§25).

### Users — `users.controller.ts`

| Method | Path | Line | Permission | Frontend caller |
| --- | --- | --- | --- | --- |
| GET | `/users` | `:46` | `USERS_READ` | web `users/page.tsx:54` |
| GET | `/users/me` | `:52` | **none** (any authenticated user) | 💀 **none** — both clients read the user object from the login response instead |
| POST | `/users` | `:57` | `USERS_MANAGE` | web `users/page.tsx:79` |
| PATCH | `/users/:id` | `:63` | `USERS_MANAGE` | web `users/page.tsx:100` |
| DELETE | `/users/:id` | `:73` | `USERS_MANAGE` | 💀 **none** — `grep "method: 'DELETE'"` across `apps/web/src` and `apps/mobile/src` → 0 hits |

### Roles — `roles.controller.ts`

| Method | Path | Line | Permission | Frontend caller |
| --- | --- | --- | --- | --- |
| GET | `/roles` | `:31` | `ROLES_READ` | web `users/page.tsx:55` |

Read-only by design. `packages/shared/src/rbac.ts:14-17` states there is
deliberately no `ROLES_MANAGE` permission, because permissions are compiled
into that file and a runtime edit would authorize nothing.

### Documents — `documents.controller.ts`

| Method | Path | Line | Permission | Frontend caller |
| --- | --- | --- | --- | --- |
| POST | `/documents/upload` | `:50` | `DOCUMENTS_UPLOAD` | web `upload/page.tsx:65` |
| GET | `/documents` | `:66` | `DOCUMENTS_READ` | web `policies/page.tsx:73`, `approvals/page.tsx:75`; mobile `PoliciesScreen.tsx:47` |
| GET | `/documents/:id` | `:84` | `DOCUMENTS_READ` | 💀 **none** |
| PATCH | `/documents/:id` | `:90` | `DOCUMENTS_MANAGE` | 💀 **none** |
| GET | `/documents/:id/versions` | `:100` | `DOCUMENTS_READ` | 💀 **none** |
| GET | `/documents/:id/download-url` | `:106` | `DOCUMENTS_DOWNLOAD` | web `policies/page.tsx:86` |
| GET | `/documents/:id/approval-history` | `:115` | `DOCUMENTS_READ` | web `approvals/page.tsx:126` |
| POST | `/documents/:id/submit-review` | `:121` | `DOCUMENTS_SUBMIT_REVIEW` | web `approvals/page.tsx:200` → `act()` `:107` |
| POST | `/documents/:id/approve` | `:131` | `DOCUMENTS_APPROVE` | web `approvals/page.tsx:212` |
| POST | `/documents/:id/reject` | `:141` | `DOCUMENTS_APPROVE` | web `approvals/page.tsx:225` |
| POST | `/documents/:id/index` | `:151` | `DOCUMENTS_INDEX` | web `approvals/page.tsx:235` |
| POST | `/documents/:id/deactivate` | `:160` | `DOCUMENTS_DEACTIVATE` | web `approvals/page.tsx:243` |

`documents.controller.ts:55` wraps upload in `@UseInterceptors(...)` (multer).
`ParseUUIDPipe` is applied to `:id` on every parameterised route
(`:86`, `:102`, …).

### RAG — `rag.controller.ts`

| Method | Path | Line | Permission | Frontend caller |
| --- | --- | --- | --- | --- |
| POST | `/rag/provider-check` | `:70` | `DOCUMENTS_INDEX` | 💀 **none** |
| POST | `/rag/reindex` | `:156` | `DOCUMENTS_INDEX` | web `settings/page.tsx:69` |
| POST | `/rag/reindex/stale` | `:179` | `DOCUMENTS_INDEX` | 💀 **none** |
| POST | `/rag/reindex/:documentId` | `:207` | `DOCUMENTS_INDEX` | 💀 **none** |
| POST | `/rag/query` | `:230` | `AI_ASK` | 💀 **none** — clients use `/chat/ask`; used by the e2e gold set (`answer-quality.e2e-spec.ts`) because it returns unstripped `diagnostics` |
| GET | `/rag/search` | `:237` | `AI_SEARCH` | web `cbahi/page.tsx:41` |

### Chat — `chat.controller.ts`

| Method | Path | Line | Permission | Frontend caller |
| --- | --- | --- | --- | --- |
| POST | `/chat/ask` | `:34` | `AI_ASK` | web `assistant-chat.tsx:296`, mobile `ChatScreen.tsx:78` |
| GET | `/chat/history` | `:40` | `AI_ASK` | 💀 **none** |
| GET | `/chat/answers` | `:49` | `AI_REVIEW_ANSWERS` | web `answer-review/page.tsx:76` |
| POST | `/chat/answers/:id/review` | `:63` | `AI_REVIEW_ANSWERS` | web `answer-review/page.tsx:87` |

### Dose — `dose.controller.ts`

| Method | Path | Line | Permission | Frontend caller |
| --- | --- | --- | --- | --- |
| POST | `/dose/calculate` | `:55` | `DOSE_CALCULATE` | web `dose-calculator/page.tsx:93`, mobile `DoseCalculatorScreen.tsx:73` |
| GET | `/dose/formulas` | `:61` | `DOSE_CALCULATE` | web `dose-calculator/page.tsx:48`, mobile `DoseCalculatorScreen.tsx:50` |
| POST | `/dose/formulas` | `:73` | `DOSE_FORMULAS_MANAGE` | 💀 **none** |
| POST | `/dose/formulas/:id/approve` | `:82` | `DOSE_FORMULAS_APPROVE` | 💀 **none** |

### Audit, Analytics, Settings, Notifications, Health

| Method | Path | File:line | Permission | Frontend caller |
| --- | --- | --- | --- | --- |
| GET | `/audit-logs` | `audit.controller.ts:10` | `AUDIT_READ` | web `audit/page.tsx:57`, mobile `AuditScreen.tsx:57` |
| GET | `/analytics/overview` | `analytics.module.ts:64` | `ANALYTICS_READ` | web `dashboard/page.tsx:67`, `analytics/page.tsx:101`; mobile `HomeScreen.tsx:48` |
| GET | `/settings` | `settings.module.ts:58` | `SETTINGS_READ` | web `settings/page.tsx:46` |
| PUT | `/settings/:key` | `settings.module.ts:64` | `SETTINGS_MANAGE` | web `settings/page.tsx:96` |
| GET | `/notifications` | `notifications.controller.ts:14` | `NOTIFICATIONS_READ` | 💀 **none** |
| POST | `/notifications/:id/read` | `notifications.controller.ts:20` | `NOTIFICATIONS_READ` | 💀 **none** |
| GET | `/health` | `health.controller.ts:31` | ✅ `@Public()` | CI `ci.yml:143`, k8s liveness `api-deployment.yaml:52`, Railway healthcheck (`infra/railway/README.md:32`) |
| GET | `/health/ready` | `health.controller.ts:37` | ✅ `@Public()` | k8s readiness `api-deployment.yaml:44` |

### Route reachability summary

| | Count |
| --- | --- |
| Total routes | **49** |
| Called by web and/or mobile | **31** |
| Called only by infrastructure (health probes) | **2** |
| Called only by tests (`/rag/query`) | **1** |
| **No caller found anywhere outside the API** | **15** |

The 15: `GET /users/me`, `DELETE /users/:id`, `POST /auth/mfa/enroll`,
`POST /auth/mfa/enable`, `POST /auth/mfa/disable`, `GET /documents/:id`,
`PATCH /documents/:id`, `GET /documents/:id/versions`,
`POST /rag/provider-check`, `POST /rag/reindex/stale`,
`POST /rag/reindex/:documentId`, `GET /chat/history`, `POST /dose/formulas`,
`POST /dose/formulas/:id/approve`, `GET /notifications` +
`POST /notifications/:id/read` (counted as one feature, two routes).

**GraphQL, RPC, tRPC, server actions, Next.js API routes, edge/serverless
functions, Next middleware: NOT FOUND.** Searched `apps` + `packages` for
`graphql`, `@Resolver`, `trpc`, `'use server'`, `pages/api`, `middleware.ts`,
`export const runtime` — **0 hits each**. `app/api` returned exactly 1 hit,
which is a documentation URL inside the generated `apps/web/next-env.d.ts:7`;
the directories `apps/web/src/app/api` and `apps/web/src/middleware.ts` do not
exist. The API in this repository is Nest controllers only.

---

## 9. Authentication

Everything below was traced from definition to caller.

| Mechanism | Status | Implementation | Reached from |
| --- | --- | --- | --- |
| Email + password login | ✅ | `auth.service.ts` `login()`; `bcryptjs` compare | web + mobile login screens |
| JWT access token | ✅ | `@nestjs/jwt`; verified by `jwt.strategy.ts` behind `JwtAuthGuard` | every non-`@Public()` route |
| Refresh token | ✅ | `POST /auth/refresh`; both clients auto-refresh on 401 (`web lib/api.ts:47`, `mobile api.ts:126`) | ✅ |
| Stateless revocation | ✅ | `users.token_version` column (migration `1720000001000`); logout and password change increment it | `POST /auth/logout` (`auth.controller.ts:97`) |
| Password reset | ✅ | `forgot-password` → token → `reset-password`; token bound to `token_version`, making it single-use | web `/login/forgot` |
| TOTP MFA — **verification** | ✅ | `otplib`; `POST /auth/mfa/verify` | web `login/page.tsx:48`, mobile `LoginScreen.tsx:60` |
| TOTP MFA — **enrolment** | 🔵 | `enrollMfa`/`enableMfa`/`disableMfa` implemented (`auth.controller.ts:109,115,125`) | **No UI calls them.** A user cannot turn MFA on from either client |
| Per-account lockout | ✅ | `failed_login_attempts`, `locked_until` (migration `1720000002000`); `AUTH_MAX_FAILED_ATTEMPTS`, `AUTH_LOCKOUT_MINUTES` | enforced inside `login()` |
| Per-IP throttling on credential routes | ✅ | `@Throttle(AUTH_THROTTLE)` on all 5 public auth routes + all 3 MFA routes | global `ThrottlerGuard` |
| Public self-registration | ❌ **NOT FOUND — removed deliberately.** No `POST /auth/register`; see `auth.controller.ts:62-68` and commit `648fecc` |
| OAuth / SSO / SAML / magic link | ❌ **NOT FOUND** — searched `oauth`, `saml`, `sso`, `magic`, `openid` |
| API keys / service accounts | ❌ **NOT FOUND** — searched `api_key`, `apiKey`, `service account`, `x-api-key` |

**Session storage differs by client, and the difference is enforced by the
tests:**

| Client | Access + refresh tokens | User profile |
| --- | --- | --- |
| web | `localStorage` (`lib/api.ts`) | `localStorage` |
| mobile | **`expo-secure-store`** — `SecureStore.setItemAsync` (`api.ts:95-96`) | `AsyncStorage` (`api.ts:97`) |

`apps/mobile/src/api.ts:71-73` performs a one-time migration that deletes any
pre-SecureStore plaintext session from AsyncStorage. The two storage modules
are mocked separately (`apps/mobile/test/mocks/`), which is what allows
`api.spec.ts` to assert tokens reach SecureStore and never AsyncStorage.

**Account provisioning** is administrator-only via `POST /users`, plus the
break-glass script `apps/api/src/scripts/create-admin.ts`, which exports
`assertStrongPassword` (rejects every published demo password) and
`provisionAdmin` returning `CREATED | RESET | ALREADY_PROVISIONED`.

---

## 10. Authorization

**Single source of truth: `packages/shared/src/rbac.ts`.** The guard never
reads the database — `rbac.ts:56-60` states the seeded `roles`/`role_permissions`
rows are a projection for the UI, not an input to authorization.

Chain: `JwtStrategy` derives permissions from the JWT's roles via
`permissionsForRoles()` (`rbac.ts:135`) → `PermissionsGuard` compares against
the `@Permissions(...)` metadata on the handler.

```
USER ──has──> ROLE(s) in JWT
              │
              └─ permissionsForRoles()  (rbac.ts:135)
                     │
                     └─> Permission[]  ──compared by──> PermissionsGuard
                                                            │
                                                            └─> route handler
```

### 7 roles × 21 permissions

Permissions defined at `rbac.ts:11-40`: `users:read`, `users:manage`,
`roles:read`, `documents:read`, `documents:upload`, `documents:manage`,
`documents:download`, `documents:submit-review`, `documents:approve`,
`documents:index`, `documents:deactivate`, `ai:ask`, `ai:search`,
`ai:review-answers`, `dose:calculate`, `dose:formulas-manage`,
`dose:formulas-approve`, `audit:read`, `analytics:read`, `settings:read`,
`settings:manage`, `notifications:read`.

| Role | Permissions | What it can actually reach |
| --- | --- | --- |
| `SUPER_ADMIN` | **all** (`ALL_PERMISSIONS`, `rbac.ts:70`) | every route |
| `HOSPITAL_ADMIN` | `CLINICAL_READ` + users read/manage, roles read, documents upload/manage/download/submit-review/deactivate, audit, analytics, settings read/manage | everything except approving, indexing, reviewing answers, and dose-formula management |
| `NURSING_KNOWLEDGE_MANAGER` | `CLINICAL_READ` + documents upload/manage/download/submit-review/**approve**/**index**/deactivate, `ai:review-answers`, analytics | the full document lifecycle and reindexing |
| `PHARMACIST_REVIEWER` | `CLINICAL_READ` + documents download/approve, dose formulas manage + approve, `ai:review-answers` | approvals and the (UI-less) dose-formula routes |
| `CBAHI_QUALITY_OFFICER` | `CLINICAL_READ` + documents upload/download/submit-review/approve, `ai:review-answers`, analytics | quality-document workflow |
| `NURSE_USER` | `CLINICAL_READ` only = `documents:read`, `ai:ask`, `ai:search`, `dose:calculate`, `notifications:read` | assistant, drug-prep, CBAHI search, dose calculator, policies list |
| `AUDITOR` | `documents:read`, `audit:read`, `analytics:read`, `notifications:read` | audit log and analytics; **no AI access at all** |

**`documents:download` is deliberately withheld from `NURSE_USER` and
`AUDITOR`** — stated at `rbac.ts:63-65`. Consequence, traced: those roles get
403 on `GET /documents/:id/download-url` and the download button on
`/policies` is unusable for them.

### Routes whose authorization is by design not permission-based

| Route | Control instead |
| --- | --- |
| `GET /users/me` | none beyond JWT — returns the caller's own record |
| `POST /auth/logout` | acts on `user.userId` from the JWT |
| `POST /auth/mfa/enroll` \| `enable` \| `disable` | act on `user.userId` from the JWT only (`auth.controller.ts:102-107`) |
| `GET /notifications`, `POST /notifications/:id/read` | carry `NOTIFICATIONS_READ`; `markRead` additionally scopes the UPDATE to `{ id, userId }` (`notifications.service.ts:33`) |
| `GET /health`, `GET /health/ready` | `@Public()` — no auth at all |

**Ownership checks beyond the above: NOT DETERMINED.** Searched
`documents.service.ts`, `chat.service.ts` and `dose.service.ts` for
`uploadedBy ===`, `userId ===`, `ownerId` — no per-record ownership gate was
found on documents, answers or dose calculations. Access to those is
permission-based only, which for a role like `NURSE_USER` means it can read
every approved document, not a subset.

**ABAC / policy engine / ACL library: NOT FOUND** — searched `casl`, `abac`,
`policy`, `Ability`, `oso`, `opa`.

---

## 11. Database / data

### Stores in use

| Store | Purpose | Client | Evidence |
| --- | --- | --- | --- |
| PostgreSQL 16 + pgvector | All application data **and** the vector index | TypeORM + raw SQL | `docker-compose.yml`, `infra/docker/initdb/01-pgvector.sql`, `data-source.ts` |
| S3-compatible object storage | The uploaded PDF bytes | `@aws-sdk/client-s3` | `storage.service.ts:30` |
| Browser `localStorage` | Web session, language (`bnp.lang`), theme | native | `apps/web/src/lib/api.ts`, `app/layout.tsx` |
| `expo-secure-store` | Mobile access + refresh tokens | native module | `apps/mobile/src/api.ts:95-96` |
| `AsyncStorage` | Mobile user profile + API-URL override | native module | `apps/mobile/src/api.ts:37,97` |
| Redis | **📋 declared in compose, referenced by no code** — see §23 | — | `docker-compose.yml:132-137` |

**MongoDB, Supabase, Firebase, DynamoDB, SQLite, IndexedDB, Pinecone, Weaviate,
Qdrant, Chroma: NOT FOUND.** The vector store is pgvector inside the same
PostgreSQL instance.

### Schema — 14 tables, all created in `1720000000000-initial-schema.ts`

| Table | Line | In plain language, this table stores… |
| --- | --- | --- |
| `users` | `:12` | Accounts: email, bcrypt password hash, full name, active flag. Later gains `token_version`, `failed_login_attempts`, `locked_until` |
| `roles` | `:26` | Role names — a **UI projection** of `rbac.ts`, not an authorization input |
| `permissions` | `:34` | Permission names — same projection |
| `role_permissions` | `:42` | Which projected permission belongs to which projected role |
| `user_roles` | `:49` | Which user holds which role. This *is* load-bearing: roles travel in the JWT |
| `documents` | `:56` | One row per clinical document: title, category, status, version number, approval date, expiry date, storage key |
| `document_versions` | `:78` | The history of re-uploads for a document |
| `document_chunks` | `:92` | The retrievable unit: chunk text, page number, version number, and the **`embedding vector(384)`** column at `:99`. Later gains `embedding_provider` |
| `document_approvals` | `:109` | The approval trail: who moved a document from which status to which, with comments |
| `ai_questions` | `:121` | The question a user asked, verbatim |
| `ai_answers` | `:132` | The answer returned, its confidence, whether it was refused, and its review status |
| `citations` | `:148` | Which chunk supported which answer, with similarity. **`ON DELETE CASCADE`** at `:150-152` |
| `dose_formulas` | `:162` | Approved dose formulas: type, route, bounds, status |
| `dose_calculations` | `:185` | Every dose calculated, with inputs and result |
| `audit_logs` | `:198` | Every mutating request and every semantic domain event |
| `notifications` | `:214` | Expiry warnings and governance notices |
| `settings` | `:226` | Key/value application settings |

### Indexes and constraints

| Object | Line | Purpose |
| --- | --- | --- |
| `CREATE EXTENSION vector` | `:9` | pgvector |
| `idx_documents_status` | `:74` | status filter in retrieval |
| `idx_documents_category` | `:75` | category filter |
| `idx_chunks_document` | `:102` | chunk → document joins |
| `idx_chunks_embedding` (HNSW, `vector_cosine_ops`) | `:104` | the ANN index |
| `idx_audit_created` (DESC), `idx_audit_action` | `:210-211` | audit browsing |
| `idx_chunks_embedding_provider` | `1720000003000:24` | provider filter in retrieval |
| `uq_chunk_document_version_index` UNIQUE `(document_id, version_number, chunk_index)` | `1720000004000:42-43` | prevents duplicate chunk sets |

**`EMBEDDING_DIM = 384` is a file-local constant** at
`1720000000000-initial-schema.ts:3`, used at `:99` as `vector(${EMBEDDING_DIM})`.
It is **independent of the `EMBEDDING_DIM` environment variable** — changing
the env var does not change the column width.

**Triggers, stored functions, views, row-level security: NOT FOUND** —
searched all five migration files for `CREATE TRIGGER`, `CREATE FUNCTION`,
`CREATE VIEW`, `ENABLE ROW LEVEL SECURITY`, `REVOKE`. The `audit_logs` table
has **no append-only enforcement** at the database level; append-only is a
convention held by application code, not a constraint.

Verified by grep over `apps/api/src/migrations/`: `CREATE TRIGGER`,
`CREATE FUNCTION`, `CREATE VIEW`, `ROW LEVEL SECURITY`, `REVOKE` → **0 hits**.
Verified over `apps/api/src`: the only code touching `audit_logs` is the
entity declaration (`entities/misc.entity.ts:10`), the write repository
(`audit/audit.service.ts:23`) and a `count(*)` in analytics
(`analytics.module.ts:28`) — **no UPDATE and no DELETE against `audit_logs`
exists in the source.** Immutability therefore rests on there being no such
code, not on the database refusing one.

By contrast, the evidence *about* an answer is mutable and cascading:
`ai_answers.reviewStatus` is UPDATEd in place (`chat.service.ts:202`), and
`citations` rows are declared `ON DELETE CASCADE`
(`1720000000000-initial-schema.ts:150-152`).

---

## 12. Migrations and seeds

### Migrations — 5, chronological, all registered

| # | File | Class | Change |
| --- | --- | --- | --- |
| 1 | `1720000000000-initial-schema.ts` | `InitialSchema1720000000000` | pgvector extension, 14 tables, 6 indexes |
| 2 | `1720000001000-token-version.ts` | `TokenVersion1720000001000` | `users.token_version int NOT NULL DEFAULT 0` |
| 3 | `1720000002000-account-security.ts` | `AccountSecurity1720000002000` | `users.failed_login_attempts`, `users.locked_until` |
| 4 | `1720000003000-embedding-provider.ts` | `EmbeddingProvider1720000003000` | `document_chunks.embedding_provider` + its index |
| 5 | `1720000004000-chunk-uniqueness.ts` | `ChunkUniqueness1720000004000` | dedupe, then `UNIQUE (document_id, version_number, chunk_index)` |

**Registration is explicit, not glob-based** — `config/data-source.ts:34-40`
lists all five classes, imported at `:5-9`. All five files on disk are
registered; **nothing is orphaned**. `synchronize: false` (`:41`), so TypeORM
never alters the schema implicitly.

Every migration has a `down()`. Every additive column uses
`ADD COLUMN IF NOT EXISTS`, and every drop uses `IF EXISTS`.

**No divergence, duplication or pending migration was found.** Confirmed
empirically: the e2e suite ran all five against a real PostgreSQL and passed
(§27).

### Seeds and fixtures

| File | Role |
| --- | --- |
| `seed/seed.ts` | The seed runner: permissions, roles, 7 demo users, settings, 4 sample documents pushed through the **real** upload→approve→index pipeline (`:159-191`), dose formulas |
| `seed/demo-accounts.ts` | Single source of truth for the 7 demo accounts and their **shipped** default passwords; `seedPasswordFor()` prefers `SEED_PASSWORD_<ROLE>` when set |
| `seed/sample-docs.ts` | The 4 demo documents' text (`:17,49,75,93` are the titles) |
| `seed/pdf.ts` | `buildPdf` — renders those texts into real PDFs via pdfkit |
| `seed/seed-policy.ts` | `assertSeedingAllowed()` — throws under `NODE_ENV=production` unless `SEED_ALLOW_PRODUCTION=true` |
| `seed/refuse-in-production.ts` | Imported **first** at `seed.ts:5` so the refusal precedes the secret fail-fast in `env.ts` |

Demo data is **idempotent**: `seed.ts:106` logs
`Seed data already present (…) — skipping.` when the first demo user exists.

The seed prints emails and roles but **not passwords** — `seed.ts:254-256`
prints the header "passwords: see README, or the SEED_PASSWORD_<ROLE> values
you supplied" and then only `role` + `email` per user.

---

## 13. External services

Three, plus zero. Each traced from the call site outward.

### 13.1 OpenAI-compatible HTTP API — 🔵 implemented, off by default

```
embedding.service.ts:144  openAiPost('/embeddings', …)      ← OpenAiEmbeddingProvider
llm.service.ts:95         openAiPost('/chat/completions',…) ← OpenAiLlmProvider
        │
        └─> openai-http.ts:53   fetch(`${base}${path}`)
                base = OPENAI_BASE_URL ?? 'https://api.openai.com/v1'   (:47)
                auth = Bearer OPENAI_API_KEY
                retry = one retry on {429,500,502,503,504}              (:5,:73)
```

**Selection is opt-in and double-gated.** `llm.service.ts:153-156`:

```ts
this.provider =
  process.env.LLM_PROVIDER === 'openai' && process.env.OPENAI_API_KEY
    ? new OpenAiLlmProvider()
    : new MockLlmProvider();
```

`embedding.service.ts:169` follows the same shape. With neither variable set,
**no outbound AI call is ever made** and the system runs entirely offline.

Data sent: the user's question plus the retrieved chunk text
(`llm.service.ts:85-87` builds `[Source n: "title", page p]\n<content>`).
Data returned: a JSON object `{shortAnswer, steps, warnings}`
(`response_format: { type: 'json_object' }`, `:97`). Used by: the API only —
neither client talks to OpenAI.

`openai-http.ts:10` records why the error body is redacted before logging:
`OPENAI_BASE_URL` can point at any host, which may echo credentials.

### 13.2 S3-compatible object storage — ✅ connected

`storage.service.ts:30` constructs `new S3Client({ endpoint, credentials,
forcePathStyle })` from `loadEnv()`. Presigned download URLs via
`@aws-sdk/s3-request-presigner` (`:9`). Stores and retrieves the uploaded PDF
bytes. MinIO locally (`docker-compose.yml`); any S3 endpoint in production
(`:13` comment). `isHealthy()` is called by `GET /health/ready`
(`health.controller.ts:41`).

### 13.3 SMTP — 🟡 implemented, disabled by default

`mail.service.ts:55-56` lazily `import('nodemailer')` and creates a transport.
`MAIL_PROVIDER` is `log` (default) or `smtp`; `smtp` requires `MAIL_HOST` or
boot fails. On `log`, the reset link is written to the application log.
`mail.service.ts:101-109` warns and audits when production is left on `log`.
Used by: password reset, and `notifications.service.ts` governance mail.

### 13.4 Everything else — ❌ NOT FOUND

Searched every manifest and all source for: `anthropic`, `@google`, `azure`,
`stripe`, `twilio`, `sendgrid`, `@sentry`, `datadog`, `newrelic`, `pinecone`,
`huggingface`, `firebase`, `supabase`, `algolia`, `cloudinary`, `posthog`,
`mixpanel`, `amplitude` — **0 hits each**. `segment` returned 15 hits, all the
substring inside the mobile `SegmentedControl` component and Next.js prefetch
keys, not the analytics vendor.

The only `fetch`/HTTP call site in the entire API is `openai-http.ts:53`.
Everything else that leaves the process goes through the AWS SDK or nodemailer.

---

## 14. AI / ML / RAG

The whole chain, stage by stage, with the file and function for each.

```
 (1) UPLOAD          documents.controller.ts:50  POST /documents/upload
       │             documents.service.ts        validate + store to S3
       ▼
 (2) APPROVE         approval.service.ts         DRAFT→IN_REVIEW→APPROVED
       │                                         →INDEXED→ACTIVE
       ▼
 (3) EXTRACT         pdf-extraction.service.ts   pdf-parse over a Uint8Array
       │                                         → per-page text
       ▼
 (4) CHUNK           chunking.service.ts         word-boundary chunks + overlap
       │
       ▼
 (5) EMBED           embedding.service.ts:53 MockEmbeddingProvider
       │                              :134 OpenAiEmbeddingProvider
       ▼
 (6) STORE           indexing.service.ts         raw SQL INSERT with a
       │                                         '[...]::vector' literal;
       │                                         pg_advisory_xact_lock on the
       │                                         document id inside the txn
       ▼
════════ query time ════════
 (7) ASK             chat.controller.ts:34  POST /chat/ask
       │             chat.service.ts        → RagQueryService.ask()
       ▼
 (8) RETRIEVE        retrieval.service.ts:60-77  pgvector ANN + 4 hard filters
       │
       ▼
 (9) RERANK          rerank.service.ts:11        lexical coverage, promotion-only
       │                                :57      selectDiverse() per-document cap
       ▼
(10) THRESHOLD       rag-query.service.ts:159    >= ragMinSimilarity()
       │
       ▼
(11) ANSWER          llm.service.ts:37 Mock | :84 OpenAI
       │
       ▼
(12) CITE            rag-query.service.ts:203-213  toCitation() — from the SQL row
       │
       ▼
(13) PERSIST         chat.service.ts:79  audit AI:ANSWER | AI:ANSWER_REFUSED
                                          ai_questions / ai_answers / citations
```

### Answers to the specific questions

1. **Where does AI start?** `POST /chat/ask` (`chat.controller.ts:34`) for both
   clients; `POST /rag/query` (`rag.controller.ts:230`) for tests.
2. **Input?** A question string, optional category and assistant type.
3. **Document processing?** `pdf-extraction.service.ts` runs `pdf-parse` over a
   plain `Uint8Array` and returns per-page text.
4. **Chunking?** `chunking.service.ts`, with overlap that respects word
   boundaries.
5. **Embeddings?** `embedding.service.ts`. Two providers: `mock-hash-embedding`
   (`:53`) and `openai-embedding` (`:134`).
6. **Stored where?** `document_chunks.embedding`, `vector(384)`, HNSW
   `vector_cosine_ops` index. Written with parameterised raw SQL, not TypeORM.
7. **Retrieval?** `retrieval.service.ts:60-77` — cosine distance `<=>` ordered
   ANN scan, `LIMIT RAG_TOP_K` (default 8), with **four hard SQL filters**:
   ```sql
   WHERE d.status = $2                                    -- ACTIVE only
     AND (d.expiry_date IS NULL OR d.expiry_date > now()) -- not expired
     AND c.version_number = d.version_number              -- current version
     AND c.embedding_provider = $3                        -- active provider
   ```
8. **Reranking?** Yes — `rerank.service.ts:11`. Lexical token coverage blended
   with vector similarity, but **promotion-only**:
   `Math.max(similarity, 0.6*similarity + 0.4*coverage)` (`:30-33`). The
   comment at `:24-29` records why: an Arabic question over an English
   document scores coverage 0, and a non-promotion-only formula would give it
   a harsher effective threshold than a same-language question.
   `selectDiverse()` (`:57`) then caps how many chunks one document may
   contribute (`RAG_MAX_PER_DOCUMENT`), with the reason documented at `:44-56`.
9. **Context assembly?** `llm.service.ts:85-87` —
   `[Source n: "<title>", page <p>]\n<content>` joined by `---`.
10-12. **Model, provider, prompt?** `OPENAI_CHAT_MODEL` (default
   `gpt-4o-mini`), `temperature: 0`, `response_format: json_object`. The system
   prompt is at `llm.service.ts:101-114` and reads, verbatim: *"Answer ONLY
   from the provided approved document excerpts. Never use outside knowledge,
   never guess. Reply in the SAME language as the question."*
13. **Answer returned?** `{shortAnswer, steps, warnings}`.
14. **Citations?** `rag-query.service.ts:203-213`. **`LlmAnswer` has no
   citation field** (`llm.service.ts:6-19`) — the model is structurally unable
   to produce one. Every citation is copied from the retrieved chunk's own row:
   `documentId`, `chunkId`, `documentTitle`, `pageNumber`, `approvalDate`,
   `similarity`, and a 300-character snippet of the chunk text.
15. **Refusal?** Yes — **four independent gates**, all returning
   `REFUSAL_MESSAGE_AR` verbatim with `citations: []` and
   `ConfidenceLevel.NONE` via one `refusal()` helper (`rag-query.service.ts:84-96`):

    | Gate | Line | Fires when |
    | --- | --- | --- |
    | `NO_CANDIDATES` | `:129` | SQL returned nothing |
    | `BELOW_THRESHOLD` | `:160` | nothing scored ≥ `ragMinSimilarity()` (threshold read at `:117`, filter at `:159`) |
    | `MODEL_ERROR` | `:171` | the provider failed technically |
    | `MODEL_FOUND_NOTHING` | `:182` | the model produced no content at all |

    `MODEL_ERROR` is separated deliberately (`:167-169`): an outage must not
    masquerade as "the corpus does not cover this".
16. **Retrieval failure?** A pgvector dimension mismatch is caught
   *specifically* in `retrieval.service.ts` and converted into zero
   candidates, so the question routes through `NO_CANDIDATES` and the nurse
   gets the governed refusal instead of a 500. The catch is narrow — other
   database errors still raise.
17. **Fallback paths?** ❌ **NOT FOUND, and this is the central design
   property.** There is no general-knowledge fallback, no uncited answer path,
   and no "answer anyway" branch. `rag-query.service.ts` has exactly one
   `refused: false` return (`:187`), reachable only after the threshold gate.
18. **Local/offline AI?** ✅ Yes. `MockLlmProvider` (`llm.service.ts:37`) is
   **extractive**: it splits retrieved chunk text into sentences, scores each
   by token overlap with the question, and returns the top ones verbatim
   (`:44-63`). It has no generative capability, so it cannot hallucinate.
   `MockEmbeddingProvider` (`embedding.service.ts:53`) is a hashed
   bag-of-words. Together they are the default, which is why the whole system
   runs with no API key.
19. **Evaluation datasets?** ✅ `apps/api/test/support/gold-set.ts` — 15 cases,
   run by `answer-quality.e2e-spec.ts` inside the normal e2e job. **It is
   circular by construction**: `answer-quality.e2e-spec.ts:4,75-76` imports
   `SAMPLE_DOCS` from `src/seed/sample-docs.ts` and builds the corpus from it,
   and `gold-set.ts:30-33` names the same four titles found at
   `sample-docs.ts:17,49,75,93`. The questions were written from the documents
   being retrieved. The repository discloses this itself at `gold-set.ts:6-26`.
20. **Connected at runtime?** Stages 1–14 all are. The provider pair actually
   used depends on two environment variables; with neither set, every stage
   runs locally.

**OCR: ❌ NOT FOUND** — searched `apps` + `packages` for `tesseract`, `ocr`,
`textract` (**0 hits each**) and `vision` (25 hits, **all** the substring
inside `provisionAdmin`/`provisioned` — verified by extracting the matched
words). Scanned PDFs with no text layer therefore yield nothing to chunk.

### The two contractual clinical strings

`packages/shared/src/constants.ts` defines two Arabic strings returned
verbatim. `REFUSAL_MESSAGE_AR` is hardcoded into `refusal()`
(`rag-query.service.ts:86`); `DOSE_SAFETY_WARNING_AR` is attached to every dose
result. Both are asserted by exact string equality in tests, and neither
appears in either i18n dictionary — they come from `@bnp/shared` directly.

---

## 15. Security mechanisms

An inventory, not an assessment. Each row was traced definition → import →
caller.

| Mechanism | Status | Implementation | Runtime caller |
| --- | --- | --- | --- |
| Password hashing | ✅ | `bcryptjs` — 31 references across source and specs | `auth.service.ts`, `create-admin.ts`, `demo-account-guard.service.ts`, seed |
| JWT signing/verification | ✅ | `@nestjs/jwt` + `passport-jwt` | `jwt.strategy.ts` behind global `JwtAuthGuard` |
| Token revocation | ✅ | `users.token_version` compared on refresh | `auth.service.ts` |
| Authorization | ✅ | `PermissionsGuard` + `rbac.ts` | global `APP_GUARD` |
| Rate limiting | ✅ | `@nestjs/throttler`; global `ThrottlerGuard` first in the chain, plus `@Throttle(AUTH_THROTTLE)` on 8 auth routes | `app.module.ts:54` |
| Security headers | ✅ | `helmet()` | `main.ts:26` |
| CORS allowlist | ✅ | explicit origins; **empty list blocks all cross-origin calls** rather than allowing them | `main.ts:32-35` |
| Request body cap | ✅ | `express.json({ limit: env.bodyLimit })` from `REQUEST_BODY_LIMIT` | `main.ts:27` |
| Input validation | ✅ | global `ValidationPipe({whitelist:true, transform:true})` + `class-validator` DTOs | `main.ts:37` |
| UUID parameter validation | ✅ | `ParseUUIDPipe` on every `:id` route | `documents.controller.ts:86` et al. |
| Audit logging | ✅ | global `AuditInterceptor` (every mutating request) + semantic events from services | `app.module.ts:57` |
| Error redaction in production | ✅ | `AllExceptionsFilter` | `main.ts:38` |
| Provider error-body redaction | ✅ | `openai-http.ts:10` comment + implementation | on every non-2xx |
| Mobile secure token storage | ✅ | `expo-secure-store` (13 references) | `apps/mobile/src/api.ts:95-96,101-102` |
| Account lockout | ✅ | `locked_until`, `failed_login_attempts` | `auth.service.ts` |
| Production secret fail-fast | ✅ | `config/env.ts:186-193` — `required()` for `JWT_SECRET`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`, `S3_SECRET_KEY`, `S3_ACCESS_KEY`; each refuses a missing value **or** the shipped default | `loadEnv()` at `main.ts:15` and in `data-source.ts` |
| `NODE_ENV` validation | ✅ | `validatedNodeEnv()` accepts only `production`/`development`/`test` | `config/env.ts` |
| `RAG_MIN_SIMILARITY` validation | ✅ | `ragMinSimilarity()` — finite number in `[0,1]`, re-read per `ask()` | `rag-query.service.ts:117`, `loadEnv()` |
| Demo-account neutralisation | ✅ | `DemoAccountGuardService.onApplicationBootstrap` compares against the **shipped literal only**, so a rotated account cannot false-positive | boot, production only |
| Seed refusal in production | ✅ | `seed-policy.ts` + `refuse-in-production.ts` (imported first) + a Dockerfile `CMD` gate | seed entry |
| Chunk-write serialisation | ✅ | `pg_advisory_xact_lock` inside the index transaction + `UNIQUE(document_id, version_number, chunk_index)` | `indexing.service.ts` |
| **Encryption at rest (app-level)** | ❌ **NOT FOUND** | searched `AES`, `createCipher`, `crypto.subtle`, `webcrypto` — 0 hits | — |
| **Digital signature / document signing** | ❌ **NOT FOUND** | `ed25519`, `RSA-PSS`, `ECDSA`, `createSign`, `createVerify`, `sha256` — **0 hits each**. The only thing named "signature" is `documents.service.ts:20-21` — `isPdf()`, whose body is `buffer.subarray(0, 1024).includes('%PDF-')`, a file-type magic-number prefix test (comment at `:15-19`), not a cryptographic signature | — |
| **Hash-chained / tamper-evident audit** | ❌ **NOT FOUND** | no hash column, no trigger, no chain. `apps/mobile/src/screens/AuditScreen.tsx:18-21` states in a code comment that the design's "tamper-proof SHA-256 chain" badge **was deliberately omitted because the platform does not implement it** | — |
| **HMAC** | ❌ **NOT FOUND** | `createHmac` — 0 hits | — |
| **Biometric authentication** | ❌ **NOT FOUND** | `expo-local-authentication`, `LocalAuthentication`, `Keychain`, `Keystore` — 0 hits; not in `apps/mobile/package.json` | — |
| **Encrypted local database (SQLCipher)** | ❌ **NOT FOUND** | `SQLCipher`, `op-sqlite`, `expo-sqlite` — 0 hits | — |
| **CSRF protection** | ❌ **NOT FOUND** | `csurf`, `CSRF` — 0 hits. Auth is Bearer-token, not cookie-based, so no cookie is sent ambiently | — |
| Content-Security-Policy | 🔵 **default only** | `Content-Security-Policy` — 0 hits in this repository's source; **no policy is authored here**. `helmet()` is called with **no options** (`main.ts:26`), and the installed `helmet@7.2.0` enables `contentSecurityPolicy` among its 12 default middlewares (verified by reading `node_modules/helmet/index.cjs`), so a default CSP header is sent. Whether the shipped default suits this app was never decided in code | `main.ts:26` |
| **Secret manager integration** | ❌ **NOT FOUND** | no Vault, AWS Secrets Manager, Doppler, SOPS. Secrets arrive as environment variables only | — |

The **only** `crypto` import in the entire repository is
`documents.service.ts:8`, importing `randomUUID`.

---

## 16. Configuration and environment variables

### Configuration sources

| Source | File | Consumed by |
| --- | --- | --- |
| Example env | `.env.example` | humans; no `.env` file exists in the repo |
| Central resolution | `apps/api/src/config/env.ts` — `loadEnv()` | API + migrate script |
| DB connection | `apps/api/src/config/data-source.ts` | Nest + `dist/scripts/migrate.js` |
| Local stack | `docker-compose.yml` | `docker compose up` |
| Images | `infra/docker/Dockerfile.api`, `Dockerfile.web` | compose, Railway |
| Kubernetes | `infra/k8s/*.yaml` | **nothing** (§23) |
| Web build | `apps/web/next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs` | `next build` |
| Mobile | `apps/mobile/app.json`, `eas.json`, `babel.config.js` | Expo / EAS |
| Lint | `eslint.config.js` (ESLint 9 flat) | `npm run lint` |
| TS | 7 `tsconfig*.json` | builds and typechecks |
| Jest | api `package.json` `"jest"` block, `apps/api/jest-e2e.config.js`, `apps/mobile/jest.config.js` | 3 independent test projects |

**24 files read `process.env`.** Variable names below; **no values are
reproduced anywhere in this document.**

| Group | Variables |
| --- | --- |
| Runtime | `NODE_ENV`, `API_PORT`, `APP_BASE_URL`, `REQUEST_BODY_LIMIT`, `CORS_ORIGINS`, `TYPEORM_LOGGING` |
| Database | `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |
| E2E database | `E2E_POSTGRES_HOST`, `E2E_POSTGRES_PORT`, `E2E_POSTGRES_USER`, `E2E_POSTGRES_PASSWORD`, `E2E_POSTGRES_DB` |
| Auth | `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `PASSWORD_RESET_TOKEN_MINUTES`, `AUTH_MAX_FAILED_ATTEMPTS`, `AUTH_LOCKOUT_MINUTES`, `AUTH_RATE_LIMIT_MAX`, `AUTH_DEV_RETURN_RESET_TOKEN` |
| Rate limit | `RATE_LIMIT_TTL`, `RATE_LIMIT_MAX` |
| Storage | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE` |
| Mail | `MAIL_PROVIDER`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM`, `MAIL_SECURE` |
| AI providers | `LLM_PROVIDER`, `EMBEDDING_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_CHAT_MODEL`, `OPENAI_EMBEDDING_MODEL`, `OPENAI_TIMEOUT_MS` |
| RAG tuning | `RAG_MIN_SIMILARITY`, `RAG_TOP_K`, `RAG_FINAL_K`, `RAG_MAX_PER_DOCUMENT`, `EMBEDDING_DIM`, `EMBEDDING_BATCH_SIZE`, `EMBEDDING_BATCH_CHARS` |
| Ops / seeding | `SEED_ON_BOOT`, `SEED_ALLOW_PRODUCTION`, `SEED_PASSWORD_<ROLE>`, `ALLOW_DEMO_ACCOUNTS`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` |
| Eval | `EVAL_REPORT` |
| Client build-time | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_DEMO_EMAIL`, `EXPO_PUBLIC_API_URL` |

### Configuration behaviours worth recording, each verified in source

- **`loadEnv()` is the single resolution path.** `data-source.ts:15-21`
  documents why it matters most there: the container runs
  `dist/scripts/migrate.js` before `main.js`, so it is the earliest code to
  touch production secrets.
- **Production fail-fast** covers 5 variables (§15). `MAIL_PROVIDER`
  deliberately does **not** fail-fast — `mail.service.ts:101-109` warns and
  audits instead.
- **`NEXT_PUBLIC_*` is inlined into the client bundle.** `login/page.tsx:10-24`
  records the consequence explicitly: a demo credential behind an `if` is
  still shipped to every browser, which is why `DEMO_EMAIL` is sourced from
  `NEXT_PUBLIC_DEMO_EMAIL` (`:25`) rather than being a gated literal. No
  password appears in that file in any form.
- **`NEXT_PUBLIC_API_URL` is baked in at Docker build time** as an `ARG` in
  `Dockerfile.web`, not read at runtime.
- **Feature flags: ❌ NOT FOUND.** There is no flag system. The nearest
  equivalents are the provider switches (`LLM_PROVIDER`,
  `EMBEDDING_PROVIDER`), `MAIL_PROVIDER`, `SEED_ON_BOOT`,
  `ALLOW_DEMO_ACCOUNTS`, and the compose profile `redis`.

---

## 17. Testing

### Three independent Jest projects

| Project | Config | Root | Pattern | Environment |
| --- | --- | --- | --- | --- |
| API unit | `apps/api/package.json` `"jest"` block | `src` | `.*\.spec\.ts$` | node |
| API e2e | `apps/api/jest-e2e.config.js` | `test/` | `.e2e-spec.ts` | node, real HTTP + real Postgres |
| Mobile | `apps/mobile/jest.config.js` | mobile | `.spec.ts` | node (**not** `jest-expo`) |

The suites are kept separate on purpose: `.e2e-spec.ts` also matches the unit
suite's `.*\.spec\.ts$` pattern, so keeping the e2e files outside `rootDir:
src` is what stops the unit run from executing them.

### Counts — measured this session

| Suite | Spec files | Suites | Tests | Result |
| --- | --- | --- | --- | --- |
| API unit | 20 | **21** | **213** | all passed |
| API e2e | 7 | **7** | **68** | all passed |
| Mobile | 2 | 2 | **32** | all passed |
| **Web** | **0** | — | **0** | ❌ no test runner configured |
| **`packages/shared`** | **0** | — | **0** | ❌ no test script |

Totals: **29 spec files, 313 tests.** (21 unit suites from 20 files because
one file declares two top-level suites.)

### Coverage instrumentation — ❌ NOT FOUND

Searched `package.json` (root and all apps), `jest-e2e.config.js`,
`apps/mobile/jest.config.js` and `.github/workflows/ci.yml` for `coverage`,
`collectCoverage`, `coverageThreshold` — **0 hits**. There is no coverage
measurement anywhere, and therefore no coverage number can be reported.

### What each e2e spec actually exercises

| Spec | Covers |
| --- | --- |
| `auth.e2e-spec.ts` | Login, refresh, logout, lockout, password reset over real HTTP |
| `rbac-and-dose.e2e-spec.ts` | Role→permission enforcement across roles; dose calculation and its safety warning |
| `document-lifecycle.e2e-spec.ts` | DRAFT→IN_REVIEW→APPROVED→INDEXED→ACTIVE and the illegal-transition rejections |
| `rag-integrity.e2e-spec.ts` | Provider stamping, stale-chunk accounting, reindex paths |
| `answer-quality.e2e-spec.ts` | The 15-case gold set through the whole chain; **gates routing**, only measures answer content |
| `create-admin.e2e-spec.ts` | `provisionAdmin` outcomes: CREATED / RESET / ALREADY_PROVISIONED |
| `health.e2e-spec.ts` | Liveness and readiness including the degraded path |

Only three things are substituted, and each is a genuine external boundary:
S3 (in-memory), SMTP (captured so a spec can read the reset link), and PDF text
extraction (so a spec can choose the text a document yields). Guards,
`ValidationPipe`, the exception filter, PostgreSQL and pgvector are all real
(`test/support/e2e-app.ts`).

### Coverage by capability — what has a test, and what does not

| Capability | Tested | Where |
| --- | --- | --- |
| Auth (login, refresh, lockout, reset) | ✅ | `account-security.spec.ts`, `auth.e2e-spec.ts` |
| Authorization / RBAC | ✅ | `permissions.guard.spec.ts`, `rbac-and-dose.e2e-spec.ts` |
| Refusal-by-Design (4 gates) | ✅ | `rag-query.service.spec.ts`, `answer-quality.e2e-spec.ts` |
| Citations | ✅ | `rag-query.service.spec.ts` |
| Retrieval + dimension mismatch | ✅ | `retrieval-dimension-mismatch.spec.ts` |
| Reranking | ✅ | `rerank.service.spec.ts` |
| Chunking | ✅ | `chunking.service.spec.ts` |
| Embeddings + provider consistency | ✅ | `embedding.service.spec.ts`, `provider-consistency.spec.ts`, `rag-provider-check.spec.ts` |
| PDF text extraction | ✅ | `pdf-extraction.service.spec.ts` (real pdfkit-generated PDFs) |
| Provider HTTP retry/redaction | ✅ | `openai-http.spec.ts` |
| Document lifecycle | ✅ | `document-lifecycle.e2e-spec.ts` |
| Dose calculation + safety warning | ✅ | `dose.service.spec.ts`, `rbac-and-dose.e2e-spec.ts` |
| Env validation / secret fail-fast | ✅ | `env.spec.ts` |
| Seed refusal in production | ✅ | `seed-policy.spec.ts` |
| Demo-account sweep (incl. the no-false-positive case) | ✅ | `demo-account-guard.service.spec.ts` |
| Break-glass admin | ✅ | `create-admin.spec.ts`, `create-admin.e2e-spec.ts` |
| Health endpoints | ✅ | `health.controller.spec.ts`, `health.e2e-spec.ts` |
| Structured logging | ✅ | `json-logger.service.spec.ts` |
| Mail | ✅ | `mail.service.spec.ts` |
| Chat diagnostics stripping | ✅ | `chat-diagnostics.spec.ts` |
| Mobile session storage + i18n | ✅ | `apps/mobile/src/api.spec.ts`, `i18n.spec.ts` |
| **Web UI (any component or page)** | ❌ | no test file exists |
| **Mobile screens (any)** | ❌ | only `api.ts` and `i18n.ts` are covered |
| **`packages/shared`** | ❌ | indirectly exercised by API tests only |
| **Analytics, approval, audit, notifications, roles, settings, storage, users modules** | ❌ | **no co-located `.spec.ts`** — 10 API directories have none |
| **Browser end-to-end** | 🟡 | `apps/web/e2e-smoke.mjs` (Playwright) runs in CI against the composed stack; it is a smoke script, not a test suite, and reports no test count |

**Security-specific tests, AI-quality tests:** the security-adjacent specs
listed above exist; there is no penetration/fuzz suite. `answer-quality` is the
only AI-quality measurement, and it is circular (§14, item 19).

---

## 18. CI/CD

One workflow: `.github/workflows/ci.yml`, triggered on `push` and
`pull_request`. **6 jobs.**

| Job | Name | What it does | Gate |
| --- | --- | --- | --- |
| `security` | Dependency vulnerability scan | `npm audit`; fails on **critical** (`:21`), reports high/moderate non-blocking (`:26`) | hard on critical |
| `lint` | Lint | builds shared, then `eslint .` | errors block |
| `api` | API — build & test | Postgres+pgvector service (`:59-60` health-gated), build shared → build API → **unit tests** (`:78`) → **run migrations against Postgres** (`:80`) → create the e2e database (`:84`) → **integration tests** (`:99`) | hard |
| `web` | Web — typecheck & build | `next build` (`:121`) — the only web typecheck | hard |
| `smoke` | Browser smoke — full stack via Docker Compose | `docker compose up` (`:138`), wait for `GET /health` (`:143`) and the web app (`:149`), install Chromium (`:159`), run `e2e-smoke.mjs` (`:165`), upload screenshots (`:169`), dump logs on failure, tear down | hard |
| `mobile` | Mobile — typecheck & test | install mobile deps (`:195`), `tsc --noEmit` (`:198`), jest (`:204`), **fail on critical** mobile vulnerabilities (`:215`), report high/moderate (`:218`) | hard on critical |

**Every job builds `@bnp/shared` first** where it needs it, because both `test`
and `lint` resolve `@bnp/shared` from its compiled `dist/`.

**No deployment job exists in CI.** There is no `deploy` job, no environment,
no release step, and no artifact publication other than the smoke
screenshots. Deployment happens outside this workflow (§19).

---

## 19. Deployment

### What actually runs in production

`infra/railway/README.md:32` names the live service: image
`infra/docker/Dockerfile.api`, host `api-production-5f73.up.railway.app` port
4000, healthcheck `GET /health`. A web service is deployed from
`Dockerfile.web` with its own healthcheck path. `infra/railway/README.md:18`
records why no `railway.json` is committed: the two services need different
healthcheck paths and a single committed file risks applying the wrong one.

**Deployment trigger: Railway auto-deploys `main`.** There is no CI deploy
step, so a merge to `main` is the deploy action.

### The API container boot sequence — `infra/docker/Dockerfile.api` `CMD`

```
1.  node dist/scripts/migrate.js            (always)
2.  if ADMIN_EMAIL && ADMIN_PASSWORD:
        node dist/scripts/create-admin.js   || exit 1     ← fatal on failure
3.  if SEED_ON_BOOT=true AND (NODE_ENV != production OR SEED_ALLOW_PRODUCTION=true):
        seed
4.  node dist/main.js
```

`Dockerfile.api:15` sets `NODE_ENV=production` in the runtime stage.

### Local / other targets

| Target | File | Status |
| --- | --- | --- |
| Full local stack | `docker-compose.yml` — postgres, minio, minio-init, api, web (+ a `redis` service behind a profile) | ✅ used by CI's `smoke` job |
| pgvector bootstrap | `infra/docker/initdb/01-pgvector.sql` | ✅ mounted by compose |
| Kubernetes | `infra/k8s/api-deployment.yaml`, `web-deployment.yaml`, `ingress.yaml`, `secrets.example.yaml` + README | 📋 **not referenced by any script, workflow, or documentation as the live target.** The manifests are internally coherent — `api-deployment.yaml:44` uses `/health/ready` for readiness and `:52` uses `/health` for liveness, with the reason documented at `:47-51` — but nothing applies them |
| EAS (mobile builds) | `apps/mobile/eas.json` | 📋 configured; **no CI job builds or publishes the mobile app** |

**Staging and preview environments: ❌ NOT FOUND.** Searched the workflow and
`infra/` for `staging`, `preview`, `environment:` — no second environment is
defined. `infra/railway/README.md` describes one environment.

---

## 20. Observability

The complete inventory. This is a short section because the surface is small.

| Capability | Status | Implementation | Runtime caller |
| --- | --- | --- | --- |
| Structured logging | ✅ | `common/logging/json-logger.service.ts` — one JSON object per line; stdout for log/warn/debug/verbose, **stderr for error/fatal** (`:70-71`) | installed once via `app.useLogger()` at `main.ts:23`; all 15 `new Logger()` sites across 14 files route through it automatically |
| Liveness probe | ✅ | `GET /health` — `health.controller.ts:31`, dependency-free by design (`:10-16`) | CI `ci.yml:143`, k8s `api-deployment.yaml:52`, Railway healthcheck |
| Readiness probe | ✅ | `GET /health/ready` — `health.controller.ts:37`, checks PostgreSQL (`SELECT 1`) **and** object storage in parallel (`:39-42`), sets 503 via `res` rather than throwing so `AllExceptionsFilter` does not redact the detail (`:17-21`) | k8s `api-deployment.yaml:44` |
| Audit trail as an observability surface | ✅ | global `AuditInterceptor` + semantic events (`AI:ANSWER`, `AI:ANSWER_REFUSED`, `DOSE:CALCULATE`, `RAG:REINDEX`, `SECURITY:DEMO_ACCOUNT_DISABLED`, `DOCUMENTS:EXPIRE`, `ERROR:UNHANDLED`) | every request; readable via `GET /audit-logs` |
| Boot-time index summary | ✅ | `indexing.service.ts:67` logs provider, chunk count, `staleRetrievable`, `staleOrphaned`, column dimensions, refusal threshold | every boot |
| **Metrics** | ❌ **NOT FOUND** | `prom-client`, `opentelemetry`, `micrometer`, `/metrics` — 0 hits in any manifest or source | — |
| **Distributed tracing** | ❌ **NOT FOUND** | `opentelemetry`, `jaeger`, `zipkin`, `traceparent` — 0 hits | — |
| **Error tracking** | ❌ **NOT FOUND** | `@sentry`, `bugsnag`, `rollbar`, `datadog`, `newrelic` — 0 hits | — |
| **Log aggregation config** | ❌ **NOT FOUND** | no fluentd/vector/loki config. JSON-on-stdout is the integration point; whatever collects it is outside this repository |
| **Alerting / SLOs / dashboards** | ❌ **NOT FOUND** | no alert rules, no dashboard definitions |
| **Frontend error reporting / RUM** | ❌ **NOT FOUND** | neither client reports errors anywhere |

There are also 23 `console.*` calls, all confined to CLI-style entry points
that run outside the Nest logger: `seed/seed.ts` (12), `scripts/create-admin.ts`
(7), `scripts/migrate.ts` (2), `seed/seed-policy.ts` (1), `config/env.ts:209`
(1 — the `MAIL_PROVIDER` warning).

`helmet@7.2.0` is what is installed; reading `node_modules/helmet/index.cjs`
shows its default set as `contentSecurityPolicy`, `crossOriginOpenerPolicy`,
`crossOriginResourcePolicy`, `originAgentCluster`, `referrerPolicy`,
`strictTransportSecurity`, `xContentTypeOptions`, `xDnsPrefetchControl`,
`xDownloadOptions`, `xFrameOptions`, `xPermittedCrossDomainPolicies`,
`xXssProtection`. **The actual response headers on a running instance were
not observed — NOT DETERMINED**; no request was made against a live server
in this investigation.

---

## 21. Documentation inventory

10 markdown files, 1,949 tracked lines.

| File | Lines | Purpose | Principal claims made |
| --- | --- | --- | --- |
| `README.md` | 430 | Setup, demo credentials, walkthroughs, env table | Stack versions; 13 protected screens; test counts; demo passwords are public and neutralised in production; break-glass procedure |
| `CLAUDE.md` | 195 | Repo guidance for AI assistants | Commands, architecture, RAG contract, RBAC source of truth, gotchas, test counts |
| `SECURITY.md` | 184 | Control list + operational requirements | ~20 implemented controls with file references, plus operational requirements |
| `docs/production-readiness.md` | 437 | Pilot/production checklist | A scorecard with **dated, layered audit updates**; open items |
| `docs/architecture.md` | 105 | Mermaid system diagrams | "13 protected screens"; module topology; the RAG chain |
| `docs/api.md` | 194 | REST reference | Endpoint list; error envelope; auth requirements |
| `docs/database-schema.md` | 63 | Schema reference | Table-by-table purpose and notable columns |
| `docs/clinical-validation.md` | 211 | Reviewer sign-off protocol | Explicitly states it is **not** a sign-off; separates what engineering established from what it did not |
| `infra/k8s/README.md` | — | k8s deployment notes | How to apply the manifests |
| `infra/railway/README.md` | — | **The live deployment** | Service names, hosts, healthcheck paths, why no `railway.json` is committed |

Also present but **untracked**: `apps/api/eval-report.md`, generated by
`npm run test:eval`. It is ignored via `apps/api/.gitignore:1`.

---

## 22. Documentation vs code

Every claim below was checked against the repository. Status is one of
VERIFIED / CONTRADICTED / NOT FOUND / NOT DETERMINED.

### Core product claims — all VERIFIED

| Claim | Source | Code evidence | Status |
| --- | --- | --- | --- |
| Answers come only from approved PDFs | `README.md:5-7` | Four hard SQL filters, `retrieval.service.ts:69-73` | **VERIFIED** |
| The assistant refuses rather than guessing | `README.md:10-12` | Four gates → one `refusal()`, `rag-query.service.ts:84`; exactly one `refused: false` return at `:187` | **VERIFIED** |
| The refusal string is returned exactly | `README.md:12` | `REFUSAL_MESSAGE_AR` hardcoded at `rag-query.service.ts:86` | **VERIFIED** |
| Every dose calculation carries the warning | `README.md:16` | `DOSE_SAFETY_WARNING_AR` in `dose.service.ts`; asserted in `dose.service.spec.ts` and `rbac-and-dose.e2e-spec.ts` | **VERIFIED** |
| RBAC: 7 roles, matrix is the single source of truth, guard never reads the DB | `CLAUDE.md`, `SECURITY.md` | `rbac.ts:2-9` (7 roles), `:56-60` (projection note), `PermissionsGuard` | **VERIFIED** |
| Roles API is read-only | `CLAUDE.md` | one route, `GET /roles` (`roles.controller.ts:31`); no `ROLES_MANAGE` in `rbac.ts` | **VERIFIED** |
| No public self-registration | `CLAUDE.md`, `SECURITY.md` | no register route; `auth.controller.ts:62-68` | **VERIFIED** |
| Guard order Throttler → JwtAuth → Permissions | `CLAUDE.md` | `app.module.ts:54-56` in that order | **VERIFIED** |
| `@Public()` opt-out with 7 public routes | `SECURITY.md` | exactly 7 `@Public()` decorators | **VERIFIED** |
| Secret fail-fast on 5 variables in production | `SECURITY.md` | `env.ts:186-193` | **VERIFIED** |
| `NODE_ENV` is validated | `SECURITY.md` | `validatedNodeEnv()` in `env.ts` | **VERIFIED** |
| `RAG_MIN_SIMILARITY` validated as finite in `[0,1]`, read per query | `SECURITY.md`, `CLAUDE.md` | `ragMinSimilarity()`; called at `rag-query.service.ts:117` inside `ask()` | **VERIFIED** |
| Migrations registered explicitly, not by glob | `CLAUDE.md` | `data-source.ts:34-40` | **VERIFIED** |
| The `embedding` column is raw SQL, not TypeORM-managed | `CLAUDE.md` | raw SQL in `indexing.service.ts` and `retrieval.service.ts` | **VERIFIED** |
| Chunk writes serialised by advisory lock + UNIQUE constraint | `CLAUDE.md` | `indexing.service.ts` lock; migration `1720000004000:42-43` | **VERIFIED** |
| Dimension mismatch refuses rather than 500s | `CLAUDE.md` | narrow catch in `retrieval.service.ts` | **VERIFIED** |
| Mock LLM is extractive and cannot hallucinate | `CLAUDE.md` | `MockLlmProvider` (`llm.service.ts:37-63`) selects verbatim sentences; no generation | **VERIFIED** |
| `DOCUMENTS_DOWNLOAD` withheld from `NURSE_USER` and `AUDITOR` | `CLAUDE.md` | `rbac.ts:63-65` and the two role arrays | **VERIFIED** |
| `MAIL_PROVIDER` deliberately does not fail-fast | `CLAUDE.md` | `mail.service.ts:101-109` warns + audits | **VERIFIED** |
| `apps/mobile` is not a workspace | `CLAUDE.md` | `package.json:6-10` | **VERIFIED** |
| `npm run build:shared` required before `test`/`lint` | `CLAUDE.md` | `@bnp/shared` `"main": "dist/index.js"`; root scripts | **VERIFIED** |
| `eval-report.md` is gitignored on purpose | `CLAUDE.md` | `apps/api/.gitignore:1`; file present but untracked | **VERIFIED** |
| Web i18n is not next-intl and not locale-routed | `CLAUDE.md` | `lib/i18n.ts` + `lib/language.tsx`; no `next-intl` dependency; routes carry no locale segment | **VERIFIED** |
| 13 protected screens | `README.md:25`, `docs/architecture.md:8` | 13 `page.tsx` files under `app/(app)/` | **VERIFIED** |
| Demo credentials neutralised in production | `README.md:150-162`, `SECURITY.md` | `DemoAccountGuardService`, `seed-policy.ts`, `Dockerfile.api` gate | **VERIFIED as implemented.** Whether it has *fired* on a live deployment is **NOT DETERMINED** — no production system was contacted in this investigation |

### Claims that do not match the code

| Claim | Source | Measured | Status |
| --- | --- | --- | --- |
| "API unit tests (**135**)" | `CLAUDE.md:15`, `README.md:226` | **213** tests, 21 suites (run this session) | **CONTRADICTED** — stale count |
| "API integration tests (**34**)" | `CLAUDE.md:16`, `README.md:227` | **68** tests, 7 suites (run this session) | **CONTRADICTED** — stale count |
| "32 mobile unit tests" | `CLAUDE.md:97`, `README.md:228` | **32** | **VERIFIED** |
| "web/ **Next.js 14** + Tailwind" | `README.md:25` | `next@^16.3.1` | **CONTRADICTED** — and internally inconsistent: `README.md:36` says "Next.js 16" in the same file |
| "All endpoints except `/health`, `/health/ready` and **`/auth/*`** require `Authorization`" | `docs/api.md:2-4` | 4 of the 9 `/auth/*` routes **do** require it: `logout` (`:97`), `mfa/enroll` (`:109`), `mfa/enable` (`:115`), `mfa/disable` (`:125`) | **CONTRADICTED** — the exemption is 5 specific routes, not the whole prefix |
| Open item: "the **Next 15 / NestJS 11 majors**" | `docs/production-readiness.md:16,50,76` | Both done: Next 16.3.1, NestJS 11.2.1 | **CONTRADICTED at those lines, but corrected later in the same document** — `:174` records the NestJS 11 migration and `:208-210` records Next 16. The file layers dated audit notes rather than rewriting them |
| "The web UI is English-only while mobile is Arabic-first" | `docs/production-readiness.md:17,51` | Web has a 714-line EN/AR dictionary and a language toggle | **CONTRADICTED at those lines, corrected at `:95`** — "The web UI is no longer English-only" |
| helmet provides "HSTS, `X-Content-Type-Options`, `X-Frame-Options`, COOP/CORP, etc." | `SECURITY.md` | `helmet@7.2.0` defaults include all of these (read from `node_modules/helmet/index.cjs`), and `helmet()` is called at `main.ts:26` | **VERIFIED at the configuration level; the emitted headers were NOT observed** |

### Claims about the running system that this investigation cannot check

| Claim | Source | Why not determined |
| --- | --- | --- |
| "Verified: 6th rapid login returns HTTP 429" | `SECURITY.md` | No live request was made. The mechanism exists (`@Throttle(AUTH_THROTTLE)` + global guard); the specific count was not reproduced |
| "Production reports 725 chunks… No stale or orphaned chunks" | `docs/clinical-validation.md:26` | Refers to a production deployment. **NOT DETERMINED** — no production system was contacted |
| Live deployment host / healthcheck | `infra/railway/README.md:32` | Configuration is present in the repo; the deployment itself was not contacted |
| Gold-set figures 15/15 routing, 9/10 content | `docs/clinical-validation.md:48-50` | Reproduced from the **untracked** generated `apps/api/eval-report.md`, and that file itself states the figures describe the **mock** embedder over **4 demo documents**. They are not evidence about a real corpus, and `clinical-validation.md:51-64` says so |

### Documentation that is unusually accurate about its own limits

Three places where the repository documents a control it does **not** have —
recorded here because it is evidence, not praise:

- `apps/mobile/src/screens/AuditScreen.tsx:18-21` — the design's "tamper-proof
  SHA-256 chain" status strip was omitted "because the audit table is not
  hash-chained, so displaying that badge would assert a control the platform
  does not implement." Consistent with §15: no hash chain exists.
- `apps/api/test/support/gold-set.ts:6-26` — discloses that the gold set is
  built from the seeded documents.
- `docs/clinical-validation.md:3-4` — states in bold that the document is a
  procedure for obtaining sign-off and is not itself a sign-off.

---

## 23. Dead-code candidates and unused capabilities

Each entry: symbol → definition → the reference search performed → the result.

### 23.1 An entire module with zero consumers — `packages/shared/src/types.ts`

| | |
| --- | --- |
| Definition | `packages/shared/src/types.ts` — 6 exported interfaces: `AuthTokens` (`:9`), `UserProfile` (`:14`), `CitationDto` (`:22`), `AiAnswerDto` (`:31`), `AskRequestDto` (`:42`), `DocumentDto` (`:69`) |
| Reference search | `grep -rn "DocumentDto\|AiAnswerDto\|CitationDto\|AskRequestDto\|UserProfile\|AuthTokens" apps packages` excluding `node_modules`, `dist`, `.next` |
| Result | The **only** hits outside `types.ts` itself are `documents.controller.ts:33,94`, and those are a locally-declared class named `UpdateDocumentDto` — a substring match, not an import |
| Status | 💀 **DEAD-CODE CANDIDATE — the whole file.** It is re-exported by `index.ts:3`, so it compiles into `dist`, but nothing consumes it. Both clients declare their own local interfaces instead (e.g. `SearchItem` at `cbahi/page.tsx:17`) |

### 23.2 Unreferenced exported constants

| Symbol | Definition | Search result | Status |
| --- | --- | --- | --- |
| `PLATFORM_TAGLINE` | `packages/shared/src/constants.ts:12` | 0 references outside its own definition | 💀 |
| `RETRIEVABLE_STATUSES` | `packages/shared/src/constants.ts:35` | 0 references outside its own definition. Retrieval instead compares `d.status = $2` against `DocumentStatus.ACTIVE` passed from `retrieval.service.ts` | 💀 |

`PLATFORM_NAME` (`constants.ts`), by contrast, **is** used —
`health.controller.ts:5,33`.

### 23.3 An unreferenced dependency

| Dependency | Declared | Search | Status |
| --- | --- | --- | --- |
| `@nestjs/config@^4.0.4` | `apps/api/package.json` `dependencies` | `grep -rn "@nestjs/config\|ConfigModule\|ConfigService" apps/api/src apps/api/test` → **0 hits** | 💀 **installed and never used.** Configuration is done by the hand-written `config/env.ts` instead |

Four other API dependencies produce no direct `import` but are **not** dead —
each was individually resolved:

| Dependency | Why it has no direct import |
| --- | --- |
| `reflect-metadata` | Side-effect import at 4 entry points: `main.ts:1`, `data-source.ts:1`, `seed.ts:1`, `create-admin.ts:1` |
| `nodemailer` | Dynamic `await import('nodemailer')` at `mail.service.ts:55`, plus the type-only `import('nodemailer').Transporter` at `:45` |
| `multer` | Reached through `FileInterceptor` (`documents.controller.ts:13,56`) and the `Express.Multer.File` type (`:59`) |
| `pg` / `passport` / `class-transformer` | Framework peers: the TypeORM `postgres` driver (`data-source.ts:27`), the base for `PassportStrategy` (`jwt.strategy.ts:2-3`), and what `ValidationPipe({transform:true})` uses. `class-transformer` has **0** direct references in source |

`react-dom` likewise has 0 references in `apps/web/src` — it is Next.js's
required runtime peer, not dead code.

### 23.4 Infrastructure declared but never referenced

| Item | Definition | Search | Status |
| --- | --- | --- | --- |
| `redis` service | `docker-compose.yml:132-137`, `image: redis:7-alpine`, behind `profiles: ["redis"]`, commented "Optional cache / queue backend (not required by the MVP)" | `grep -rin "redis\|REDIS"` across `apps` + `packages` → **0 hits** | 💀 — no code can use it; the profile means it does not even start by default |
| `infra/k8s/*` (4 manifests + README) | `api-deployment.yaml`, `web-deployment.yaml`, `ingress.yaml`, `secrets.example.yaml` | not referenced by `ci.yml`, any npm script, `docker-compose.yml`, or `infra/railway/README.md` | 📋 **PLANNED / NOT WIRED** — a coherent but unused deployment path. Production is Railway |
| `apps/mobile/eas.json` | EAS build profiles | no CI job builds or publishes mobile | 📋 |

### 23.5 Implemented API capabilities with no user interface

> **Superseded in part by `503cef4` — see §0.1.** The reachability findings
> below describe `114e655`; 11 of the routes called unreachable here now have
> a caller.

These are **not** dead code — they are implemented, tested in part, and
reachable by anyone holding a token. They simply have no caller in either
client, so no user can trigger them through the product.

| Capability | Routes | Consequence |
| --- | --- | --- |
| **MFA enrolment** | `POST /auth/mfa/enroll` \| `enable` \| `disable` | A user **cannot turn MFA on**. Verification works, so MFA functions only for accounts whose `mfa_enabled` was set by some other means |
| **Notifications** | `GET /notifications`, `POST /notifications/:id/read` | The daily cron (`notifications.service.ts:39`) writes expiry rows and governance notices that **no screen displays** |
| **User deletion** | `DELETE /users/:id` | Users can be created and edited from `/users`, never removed |
| **Own-profile read** | `GET /users/me` | Both clients use the login response instead |
| **Dose-formula authoring** | `POST /dose/formulas`, `POST /dose/formulas/:id/approve` | Formulas can only arrive via the seed or direct API calls; `PHARMACIST_REVIEWER` holds both permissions but has no screen for either |
| **Targeted RAG repair** | `POST /rag/provider-check`, `/rag/reindex/stale`, `/rag/reindex/:documentId` | Only the blunt full `POST /rag/reindex` is reachable, from `/settings` |
| **Chat history** | `GET /chat/history` | Past conversations are stored but not browsable |
| **Single-document reads** | `GET /documents/:id`, `GET /documents/:id/versions`, `PATCH /documents/:id` | Version history is recorded (`document_versions`) but never shown |

Status for all of the above: 🔵 **implemented, not user-reachable.**

### 23.6 Not dead — checked and cleared

| Suspicion | Finding |
| --- | --- |
| `pdfkit` in `dependencies` rather than `devDependencies` | Correctly placed: `seed/pdf.ts:1` uses it, and `seed.ts:167` runs in the container when seeding is enabled. It is also the fixture generator for `pdf-extraction.service.spec.ts` |
| Web pages that fetch nothing (`/assistant`, `/drug-prep`) | Not stubs — both delegate to `<AssistantChat>`, which calls `POST /chat/ask` at `assistant-chat.tsx:296` |
| Orphan web routes | None. Every `page.tsx` is linked; every nav href resolves to a page |
| Unregistered migrations | None. All 5 files are in `data-source.ts:34-40` |

---

## 24. Duplicate and competing implementations

| Capability | Implementation A | Implementation B | Which is connected | Evidence |
| --- | --- | --- | --- | --- |
| **LLM** | `MockLlmProvider` — `llm.service.ts:37`, name `mock-extractive-llm` | `OpenAiLlmProvider` — `:84`, name `openai:<model>` | **Exactly one at a time**, chosen at construction: `LLM_PROVIDER === 'openai' && OPENAI_API_KEY` (`:153-156`), else mock. Not competing — a deliberate strategy pair | ✅ by design |
| **Embeddings** | `MockEmbeddingProvider` — `embedding.service.ts:53` | `OpenAiEmbeddingProvider` — `:134` | Same pattern (`:169`). Vectors from the two are **incompatible**, which is why every chunk is stamped with `embedding_provider` and retrieval filters on it | ✅ by design |
| **Mail** | log provider (writes the link to the application log) | SMTP via nodemailer (`mail.service.ts:42-56`) | `MAIL_PROVIDER`, default `log` | ✅ by design |
| **i18n dictionary** | `apps/web/src/lib/i18n.ts` — **714 lines** | `apps/mobile/src/i18n.ts` — **171 lines** | **Both live.** Genuine duplication: mobile does not depend on `@bnp/shared` and cannot reuse the web dictionary. Keys overlap (`mfaCode`, `mfaHint` appear in both) | 🟡 real duplication |
| **API client** | `apps/web/src/lib/api.ts` — 92 lines | `apps/mobile/src/api.ts` — 181 lines | **Both live.** Both implement Bearer auth and refresh-on-401 independently (`web:47`, `mobile:126`). Storage differs by necessity (localStorage vs SecureStore) | 🟡 real duplication |
| **Chunk-duplication defence** | `pg_advisory_xact_lock` in `indexing.service.ts` | `UNIQUE (document_id, version_number, chunk_index)` — migration `1720000004000` | **Both active, and both needed**: the constraint turns silent duplication into an error, the lock is what makes the concurrent case succeed | ✅ complementary, not redundant |
| **Permission storage** | `packages/shared/src/rbac.ts` (compiled matrix) | `roles` / `role_permissions` / `permissions` tables | **`rbac.ts` is authoritative.** The tables are a UI projection — `rbac.ts:56-60` states editing them changes nothing. This is a *deliberate* redundancy, and the roles API was made read-only (`648fecc`) to stop it looking otherwise | ✅ documented |
| **Configuration** | hand-written `config/env.ts` | `@nestjs/config` (installed) | `env.ts` — `@nestjs/config` is never imported (§23.3) | 💀 the loser is dead |

**No legacy application, no `old/`, `legacy/`, `v1/`, `deprecated/` or `_bak`
directory exists.** There is one backend, one web app, one mobile app.

---

## 25. Git archaeology

108 commits over 48 days. Every claim below carries a SHA.

### Removed or replaced capabilities

| SHA | Date | What changed | Evidence in the diff |
| --- | --- | --- | --- |
| `648fecc` | — | **Public self-registration removed; roles API made read-only** | `auth.controller.ts` −18/+..., `roles.service.ts` **−83 lines**, `roles.controller.ts` rewritten (65 lines changed), `rbac.ts` +22/−; `permissions.guard.spec.ts` +36 |
| `71433f4` | 2026-08-10 | **The only file ever deleted in the repository's history**: `apps/mobile/src/screens/AssistantScreen.tsx`, replaced by `ChatScreen.tsx` in the Figma-based mobile rebuild | `git log --diff-filter=D --name-only` returns exactly one path across all 108 commits |
| `f77d5ec` | — | **A competing mail implementation was resolved, not left in place** — "Merge main; adopt its mail implementation over this branch's duplicate". `mail.service.ts` −220 lines, `mail.service.spec.ts` −117 | merge diffstat |
| `73d596c` | — | **Dead CSS dropped** — `apps/web/src/app/globals.css` −41 lines | diffstat |
| `2369232` | — | "Redesign the data screens and fix the dead `brand-*` palette" | commit subject |

### Major architectural migrations

| SHA | Change |
| --- | --- |
| `3d1c895` | 2026-07-05 — the founding commit: NestJS API, RAG pipeline, RBAC, audit, Docker infra, all at once |
| `51a1f84` | Next.js web app with "all 13 governance screens" |
| `b1bed2e` | The Expo mobile app added |
| `7c6f4a5` | Design-system foundation: semantic tokens, dark mode, primitives, responsive shell |
| `71433f4` | Mobile UI rebuilt from Figma, Arabic-first, RTL |
| `2a90c3d`, `d0ef814`, `9c9b1a0`, `ee12d6a` | Phases 10a–10c: the **web** app made bilingual EN/AR, then a direction sweep fixing RTL layout bugs |
| `e0662bd` | **API migrated to NestJS 11 + Express 5** |
| `b62443d` | **Web migrated to Next.js 16** |
| `cc2f971` | **Mobile upgraded to Expo SDK 57 / RN 0.86 / React 19** |
| `ad1b1cd` | Health split into liveness/readiness; structured JSON logging introduced |
| `a0c92a0` | The integration test suite added: real HTTP, real Postgres, real pgvector |
| `d543127` | Self-service MFA enrolment (Phase 9a) — the API side that §23.5 shows still has no UI |
| `2938d51` | ESLint 9 added and gated in CI |

### Development direction, most recent first

The last 8 commits are entirely **security, operations and evidence** work,
not features:

| SHA | Subject |
| --- | --- |
| `f49cf73` | report the refusal threshold in the boot summary |
| `0d141ba` | add the clinical validation protocol, reconcile readiness with the deployed system |
| `674f183` | fail the deploy when admin provisioning fails, instead of locking everyone out |
| `a7c250d` | make go-live executable and verifiable on a shell-less container |
| `f21b5e7` | make the index safe under concurrency and the stale count actionable |
| `dcdf1d7` | make every secret resolve through one validated path |
| `1ac14ce` | stop shipping working demo credentials to production |
| `c51aeb5` | measure answer quality against a gold set, and gate on routing |

### Capabilities that never existed, even historically

Two independent searches were run over **all** branches: `git log --all --grep`
(commit messages) and `git log --all -S<string>` (the pickaxe — finds any
commit that added or removed the string from tracked content).

| Searched | `--grep` hits | Pickaxe hits | Deleted paths |
| --- | --- | --- | --- |
| `biometric`, `sqlcipher`, `expo-local-authentication` | 0 | **0** | 0 |
| `createSign`, `ed25519` (document signing) | 0 | **0** | 0 |
| `@sentry`, `prom-client` (observability vendors) | 0 | **0** | 0 |
| `opentelemetry` | 0 | **1** — `3d1c895`, and the only file touched is `package-lock.json`, i.e. a transitive dependency name in the lockfile, never application code. It does not appear in any manifest or source at HEAD | 0 |
| `pinecone`, `weaviate`, `mongo`, `firebase`, `supabase` | 0 | — | 0 |
| `oauth`, `saml`, `sso` | 0 | — | 0 |
| `redis` (in commit messages) | 0 | — | 0 |

**Conclusion: none of these capabilities was ever removed, because none was
ever present.** They are absent, not abandoned. (The 53 `--grep` hits for
`anthropic` are the `Co-Authored-By: … <noreply@anthropic.com>` trailer in
commit bodies, not an AI provider; the 7 hits for `offline` are commit bodies
discussing the mock provider and mail, with no capability removed.)

---

## 26. Sensitive data findings

**No secret value is reproduced below.** Locations and categories only.

### Real secrets committed to the repository — none found

| Check | Result |
| --- | --- |
| A `.env` file present or tracked | ❌ **none.** Only `.env.example` exists |
| Private keys (`BEGIN * PRIVATE KEY`) | ❌ **NOT FOUND** |
| Certificates / keystores (`.pem`, `.p12`, `.jks`, `.keystore`) | ❌ **NOT FOUND** in the tracked tree |
| A real credential in git history | Not re-verified in this pass. Prior work in this repository examined history for a committed `.env` and found none. Treated here as **NOT DETERMINED** for this investigation, since no independent history scan for credential values was run today |

### Files that reference secret **names** (not values) — 33

`.env.example`, `.github/workflows/ci.yml`, `CLAUDE.md`, `README.md`,
`SECURITY.md`, `docker-compose.yml`, `docs/production-readiness.md`,
`infra/k8s/README.md`, `infra/k8s/secrets.example.yaml`,
`infra/railway/README.md`, and 23 API source/spec files
(`auth/*`, `config/env.ts`, `config/data-source.ts`, `mail/*`, `rag/*`,
`scripts/create-admin.ts`, `seed/*`, `storage/storage.service.ts`,
`test/support/env.ts`, `test/create-admin.e2e-spec.ts`).

### Deliberately published demo credentials

| Type | Location | Nature |
| --- | --- | --- |
| 7 demo account passwords | `apps/api/src/seed/demo-accounts.ts` (the shipped literals) and a table in `README.md` | **Intentionally public**, and the repository says so at `README.md:150-162`: *"These passwords are public, and production now enforces that."* The `DemoAccountGuardService` disables any production account still using one, comparing against the shipped literal only so a rotated account is never touched |

Values are **not** reproduced here.

### Personal data

| Category | Finding |
| --- | --- |
| Email addresses | 25 distinct occurrences, **all** at fictitious `@bnp.health` / `@hospital.example` domains or a `no-reply` sender default. Locations: `docker-compose.yml:92` (MAIL_FROM default), `apps/mobile/src/screens/LoginScreen.tsx:187` (a placeholder attribute), `docs/production-readiness.md:283,290` (transcribed log lines), and test fixtures in `apps/mobile/src/api.spec.ts` and the 5 API e2e specs. **All are fixture / documentation / placeholder — none is a real person's address** |
| One real address | `totti0770@gmail.com` appears as the **git commit author** on 40 commits. It is repository metadata, not content, and is inherent to any git history |
| **Patient / medical PII** | ❌ **NOT FOUND.** Searched `apps` + `packages` for `patient_name`, `mrn`, `national_id`, `iqama`, `date_of_birth`, `dob` — **0 hits.** The schema (§11) has no patient identity table, no patient column, and no field that stores a patient record. The system stores *documents*, *questions*, *answers* and *dose calculations*, not patients |
| Production data samples | ❌ **NOT FOUND.** The only document content is `seed/sample-docs.ts`, 4 synthetic clinical documents authored for the demo |

### One category worth naming precisely

The **audit log and the AI question log store free text a user typed**
(`ai_questions.question`). A nurse who types patient-identifying information
into a question would store it in `ai_questions`, and the answer's
`citations` rows cascade-delete with it. Nothing in the code redacts,
classifies, or restricts that input. This is a factual property of the
schema, stated here because §26 asks where personal information could reside —
**no such data exists in the repository**, and whether it exists in a running
deployment is **NOT DETERMINED**.

---

## 27. Executed validation commands

Every command below was actually run against this checkout during this
investigation, in the repository's own documented form. Exact commands and
exact results:

| # | Command | Result |
| --- | --- | --- |
| 1 | `npm run build:shared` | **Success.** `@bnp/shared` compiled to `dist/` |
| 2 | `npm test` (API unit suite) | **PASS — 21 suites, 213 tests, 0 failed.** Runtime 14.63 s. Two expected `console.warn`/`WARN` lines appear in output (the `MAIL_PROVIDER` production warning from `env.spec.ts`, and a redacted `[OpenAiHttp] /embeddings → 400` from `openai-http.spec.ts`); both are assertions, not errors |
| 3 | `npm run lint` (ESLint 9 flat, whole monorepo) | **PASS — ✖ 11 problems (0 errors, 11 warnings).** All 11 are `@typescript-eslint/no-explicit-any`, in `audit.interceptor.ts:36`, `health.controller.spec.ts:7,8,13`, `notifications.service.ts:83`, `pdf-extraction.service.ts:46`, `retrieval.service.ts:106`, and 4 further sites. Errors block CI; warnings do not |
| 4 | `pg_ctlcluster 16 main start` | Started a local PostgreSQL (it was stopped). `pg_isready` → `accepting connections` |
| 5 | `E2E_POSTGRES_DB=bnp_e2e npm run test:e2e -w @bnp/api` | **PASS — 7 suites, 68 tests, 0 failed.** Runtime 19.72 s. This ran all 5 migrations against a real PostgreSQL + pgvector, and includes the answer-quality gold set |
| 6 | `npm run build:web` | **PASS.** "Compiled successfully in 7.3s", "Finished TypeScript in 2.2s", 18/18 static pages generated. All 17 listed routes marked `○ (Static)` |
| 7 | `cd apps/mobile && npx tsc --noEmit` | **PASS — no output, no errors** |
| 8 | `cd apps/mobile && npm test` | **PASS — 2 suites, 32 tests, 0 failed.** Runtime 3.14 s |

**Totals: 313 tests, 30 suites, 0 failures**, plus a clean lint, a clean web
build and a clean mobile typecheck.

### Commands deliberately not run, with reasons

| Command | Why not |
| --- | --- |
| `npm run seed` | Writes demo rows to a database. This is a read-only investigation |
| `npm run test:eval` | Would overwrite the existing generated `apps/api/eval-report.md`. Its current contents were read instead |
| `node apps/web/e2e-smoke.mjs` | Requires the full Docker Compose stack running; not started, to avoid mutating local state |
| `docker compose up` | Same reason |
| Any request against the live Railway deployment | Out of scope for a repository investigation; nothing in this report claims production state |
| `npm audit` | Reports change with the registry over time and are not a property of this commit; the CI job that gates on them is documented in §18 instead |

---

## 28. Capability status matrix

> **Superseded in part by `503cef4` — see §0.1.** The reachability findings
> below describe `114e655`; 11 of the routes called unreachable here now have
> a caller.

| Capability | Exists | Implemented | Referenced | Called | Runtime reachable | Tested | Documented | Evidence | Status |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- | :-: |
| Refusal-by-Design (4 gates) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `rag-query.service.ts:84,129,160,171,182` | ✅ |
| Citations bound to retrieved rows | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `rag-query.service.ts:203-213`; `llm.service.ts:6-19` | ✅ |
| Governed retrieval (4 SQL filters) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `retrieval.service.ts:69-73` | ✅ |
| Vector search (pgvector + HNSW) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | migration `:104`; `retrieval.service.ts:60-77` | ✅ |
| Reranking + per-document diversity | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `rerank.service.ts:11,57` | ✅ |
| Chunking | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `chunking.service.ts` + spec | ✅ |
| PDF text extraction | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `pdf-extraction.service.ts` + spec | ✅ |
| Offline mock LLM + embeddings | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `llm.service.ts:37`; `embedding.service.ts:53` | ✅ |
| OpenAI LLM + embeddings | ✓ | ✓ | ✓ | ✓ | only when `LLM_PROVIDER=openai` + key | ✓ (spec-level) | ✓ | `llm.service.ts:84,153`; `openai-http.ts:53` | 🔵 |
| Document upload → S3 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `documents.controller.ts:50`; `storage.service.ts:30` | ✅ |
| Approval workflow (8 statuses) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `approval.service.ts:17-30`; `approvals/page.tsx` | ✅ |
| Indexing + advisory lock + UNIQUE | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `indexing.service.ts`; migration `1720000004000` | ✅ |
| Full reindex | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `rag.controller.ts:156` ← `settings/page.tsx:69` | ✅ |
| Targeted reindex (stale / one doc) | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | `rag.controller.ts:179,207`; no UI caller | 🔵 |
| Provider-check probe | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | `rag.controller.ts:70`; `rag-provider-check.spec.ts` | 🔵 |
| Chat (ask) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `chat.controller.ts:34` ← web + mobile | ✅ |
| Chat history | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | — | `chat.controller.ts:40`; 0 UI callers | 🔵 |
| Answer review | ✓ | ✓ | ✓ | ✓ | ✓ | 🟡 | ✓ | `chat.controller.ts:49,63` ← `answer-review/page.tsx` | ✅ |
| CBAHI keyword search | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | `rag.controller.ts:237` ← `cbahi/page.tsx:41` | ✅ |
| Dose calculation + safety warning | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `dose.controller.ts:55`; `dose.service.spec.ts` | ✅ |
| Dose-formula authoring / approval | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | `dose.controller.ts:73,82`; 0 UI callers | 🔵 |
| Login + JWT + refresh | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `auth.controller.ts:57,71`; both clients | ✅ |
| Token revocation (`token_version`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | migration `1720000001000`; `auth.service.ts` | ✅ |
| Password reset by email | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `auth.controller.ts:85,92` ← `login/forgot` | ✅ |
| Account lockout | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | migration `1720000002000`; `account-security.spec.ts` | ✅ |
| MFA **verification** | ✓ | ✓ | ✓ | ✓ | ✓ | 🟡 | ✓ | `auth.controller.ts:78`; both login screens | ✅ |
| MFA **enrolment** | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | `auth.controller.ts:109,115,125`; **0 UI callers** | 🔵 |
| RBAC (7 roles × 21 permissions) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `rbac.ts`; `permissions.guard.spec.ts` | ✅ |
| Permission-filtered navigation | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | `shell.tsx:25-52` | ✅ |
| User management (list/create/edit) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `users.controller.ts:46,57,63` ← `users/page.tsx` | ✅ |
| User deletion | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | — | `users.controller.ts:73`; 0 `DELETE` callers | 🔵 |
| Audit logging (interceptor + events) | ✓ | ✓ | ✓ | ✓ | ✓ | 🟡 | ✓ | `app.module.ts:57`; `audit.service.ts` | ✅ |
| Audit browsing | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | `audit.controller.ts:10` ← web + mobile | ✅ |
| Analytics overview | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | `analytics.module.ts:64` ← 3 callers | ✅ |
| Settings read/write | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | `settings.module.ts:58,64` ← `settings/page.tsx` | ✅ |
| Daily expiry cron | ✓ | ✓ | ✓ | ✓ | ✓ | 🟡 | ✓ | `notifications.service.ts:39` | ✅ |
| Notifications (read / mark read) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | `notifications.controller.ts:14,20`; **0 hits for `notification` in either client** | 🔵 |
| Email delivery (SMTP) | ✓ | ✓ | ✓ | ✓ | only when `MAIL_PROVIDER=smtp` | ✓ | ✓ | `mail.service.ts:55-56` | 🟡 |
| Bilingual EN/AR web | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | `lib/i18n.ts` (714 lines), `language.tsx` | ✅ |
| Bilingual mobile | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `apps/mobile/src/i18n.ts` + `i18n.spec.ts` | ✅ |
| Mobile secure token storage | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `apps/mobile/src/api.ts:95-96`; `api.spec.ts` | ✅ |
| Health liveness / readiness | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `health.controller.ts:31,37` ← CI, k8s, Railway | ✅ |
| Structured JSON logging | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `json-logger.service.ts`; `main.ts:23` | ✅ |
| Rate limiting + throttled auth | ✓ | ✓ | ✓ | ✓ | ✓ | 🟡 | ✓ | `app.module.ts:54`; `@Throttle` ×8 | ✅ |
| Demo-account production sweep | ✓ | ✓ | ✓ | ✓ | ✓ (production boot) | ✓ | ✓ | `demo-account-guard.service.ts:46` | 🔵 (never observed firing) |
| Break-glass admin script | ✓ | ✓ | ✓ | ✓ | ✓ (container CMD) | ✓ | ✓ | `scripts/create-admin.ts` | ✅ |
| Seed + demo data | ✓ | ✓ | ✓ | ✓ | ✓ (non-production) | ✓ | ✓ | `seed/seed.ts`; `seed-policy.spec.ts` | ✅ |
| Answer-quality gold set | ✓ | ✓ | ✓ | ✓ | ✓ (CI) | ✓ | ✓ | `answer-quality.e2e-spec.ts` — **circular**, §14 item 19 | 🟡 |
| Browser smoke | ✓ | ✓ | ✓ | ✓ | ✓ (CI) | n/a | ✓ | `e2e-smoke.mjs`; `ci.yml:165` | ✅ |
| `packages/shared/src/types.ts` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | 0 consumers | 💀 |
| `PLATFORM_TAGLINE`, `RETRIEVABLE_STATUSES` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | 0 consumers | 💀 |
| `@nestjs/config` dependency | ✓ | n/a | ✗ | ✗ | ✗ | ✗ | ✗ | 0 hits | 💀 |
| `redis` compose service | ✓ | n/a | ✗ | ✗ | ✗ | ✗ | 🟡 | `docker-compose.yml:132-137` | 💀 |
| Kubernetes deployment | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | `infra/k8s/*`; nothing applies it | 📋 |
| Mobile build / release pipeline | ✓ (`eas.json`) | n/a | ✗ | ✗ | ✗ | ✗ | ✓ | no CI job builds mobile | 📋 |
| Metrics / tracing / error tracking | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 🟡 (named as an open item) | 0 hits for every vendor searched | ❌ |
| Digital signature / document signing | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 0 hits for `createSign`/`ed25519`/`ECDSA`/`sha256` | ❌ |
| Hash-chained / tamper-evident audit | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ (explicitly disclaimed at `AuditScreen.tsx:18-21`) | no hash column, no trigger | ❌ |
| Biometric auth / encrypted local DB | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | not in `apps/mobile/package.json`; 0 hits | ❌ |
| OCR for scanned PDFs | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 🟡 (named as an open item) | 0 hits for `tesseract`/`ocr`/`textract` | ❌ |
| OAuth / SSO / SAML | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 0 hits | ❌ |
| Queues / WebSockets / webhooks | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 0 hits | ❌ |
| Web / shared test coverage | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 0 test files | ❌ |
| Coverage instrumentation | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 0 hits in every jest/CI config | ❌ |

---

## 29. Complete user journeys

Traced through actual code, not intent.

### 29.1 Opening the web app and signing in

```
Browser hits /                     app/page.tsx — redirects to /login or /dashboard
   │
   ▼  before first paint
app/layout.tsx  injects THEME_INIT (:17) and LANG_INIT (:34) as inline
                <script> tags at :55-56, stamping <html lang|dir> from the
                localStorage key `bnp.lang` before first paint (:51)
   │
   ▼
/login          login/page.tsx — email + password
   │  POST /auth/login              (auth.controller.ts:57, @Public, @Throttle)
   ▼
API: ThrottlerGuard → JwtAuthGuard sees @Public → skips → handler
     auth.service.ts: check locked_until → bcrypt.compare → issue tokens
   │
   ├─ if the account has MFA: response carries { mfaRequired, mfaToken }
   │      login/page.tsx:57 swaps the form; focus moves to the code field (:39-41)
   │      POST /auth/mfa/verify  → tokens
   │
   ▼
setSession(data)  → localStorage
window.location.href = '/dashboard'      (login/page.tsx:63 — a full navigation,
                                          so AuthProvider mounts with the session)
   │
   ▼
(app)/layout.tsx → shell.tsx renders only the nav items whose permission
                   the session holds (shell.tsx:30-52)
```

### 29.2 Asking a clinical question — the core journey

```
/assistant → <AssistantChat> → POST /chat/ask         (assistant-chat.tsx:296)
   │
   ▼  guards: Throttler → JwtAuth → Permissions(ai:ask)
chat.service.ts
   │  1. INSERT ai_questions  (the question verbatim, user, assistantType, channel)
   ▼
RagQueryService.ask()                                  (rag-query.service.ts:113)
   │  2. minScore = ragMinSimilarity()                              :117
   ▼
RetrievalService.search()                              (retrieval.service.ts)
   │  3. embed the question  → EmbeddingService.embedOne()
   │  4. pgvector ANN, LIMIT RAG_TOP_K, with 4 hard filters         :69-73
   │       ├─ 0 rows  ──────────────► REFUSE  NO_CANDIDATES         :129
   │       └─ dimension mismatch ───► caught → 0 rows → same gate
   ▼
RerankService.rerank()                                 (rerank.service.ts:11)
   │  5. promotion-only lexical blend, then selectDiverse() caps
   │     how many chunks one document may contribute                :57
   ▼
   6. threshold:  score >= minScore                    (rag-query.service.ts:159)
        └─ nothing qualifies ──────► REFUSE  BELOW_THRESHOLD        :160
   ▼
LlmService.answer(question, top)
   │  7. mock: picks verbatim sentences  |  openai: /chat/completions
   │       ├─ provider failed ─────► REFUSE  MODEL_ERROR            :171
   │       └─ empty output ────────► REFUSE  MODEL_FOUND_NOTHING    :182
   ▼
   8. citations built from the SQL rows, never from the model       :203-213
   ▼
chat.service.ts
   │  9. INSERT ai_answers + citations
   │ 10. audit  AI:ANSWER  or  AI:ANSWER_REFUSED                    :79
   │ 11. diagnostics attached ONLY if the caller holds analytics:read :102-104
   ▼
UI renders the answer with document title, page and approval date —
or the fixed Arabic refusal with zero citations.
```

Two properties visible in that trace and worth stating: a refusal is recorded
in the audit log as distinctly as an answer, and the retrieval internals are
withheld from a nurse and shown to a governance role — the comment at
`chat.service.ts:100-102` gives the reason, and the gate itself is at `:103-104`.

### 29.3 Getting a document into the corpus

```
/upload  ──POST /documents/upload──►  isPdf() prefix check (documents.service.ts:20)
                                      → S3 put → row in `documents`, status DRAFT
   │
   ▼  /approvals  (the same page drives every step; act() at :107)
DRAFT ──submit-review──► IN_REVIEW ──approve──► APPROVED ──index──► INDEXED/ACTIVE
   │                          └─────reject────► REJECTED
   │                                                │
   │                                                ▼  POST /documents/:id/index
   │                              approval.service.ts performs INDEX **and**
   │                              ACTIVATE in one call, so one click takes an
   │                              approved document live
   │                                                │
   │                                                ▼
   │                              IndexingService.indexDocument()
   │                                 extract → chunk → embed → advisory lock
   │                                 → DELETE + INSERT chunks in one transaction
   ▼
ACTIVE  ── now, and only now, retrieval can reach it (status = ACTIVE filter)
   │
   ├── re-upload ──► versionNumber++, status back to DRAFT; the new version must
   │                 be re-approved before the AI can cite it
   └── expiry cron (06:00 daily) ──► EXPIRED, removed from retrieval immediately
```

Illegal transitions are refused by the `TRANSITIONS` map
(`approval.service.ts:17-30`, enforced at `:50-55`).

### 29.4 Mobile

```
App.tsx:41-45  restore session   ← SecureStore (tokens) + AsyncStorage (profile)
   │  no session ──► LoginScreen                                    (App.tsx:81)
   ▼  session
tab = 'home'    HomeScreen        GET /analytics/overview
       'chat'   ChatScreen        POST /chat/ask
       'doses'  DoseCalculator    GET /dose/formulas, POST /dose/calculate
       'audit'  AuditScreen       GET /audit-logs
       'sources' PoliciesScreen   GET /documents
   │
   └─ App.tsx:97-98 falls back to 'home' if the stored tab is one the
      current role cannot see
```

---

## 30. Unknowns — explicit NOT DETERMINED list

Everything this investigation could not establish, with the search performed.

| # | Unknown | What was searched / why not determined |
| --- | --- | --- |
| 1 | Repository visibility (public/private) | Not readable from a local clone; no remote API call was made |
| 2 | The remote's default branch | The local HEAD is `main`; that is not proof of the remote default |
| 3 | Branch protection rules, required checks, review policy | Not readable from the clone |
| 4 | Open pull requests, issues, review history | Not queried |
| 5 | Whether the 25 remote branches are merged or stale | Only names were listed; no merge-base analysis was run |
| 6 | Actual HTTP response headers emitted by `helmet()` | `helmet@7.2.0`'s default middleware list was read from `node_modules/helmet/index.cjs`, but no request was made against a running server |
| 7 | Whether the demo-account sweep has ever fired in a real deployment | The code path exists and is unit-tested; no production system was contacted |
| 8 | Production chunk counts, `staleRetrievable`, live `RAG_MIN_SIMILARITY` | `docs/clinical-validation.md:26` quotes figures from a deployment; nothing in this repository proves them |
| 9 | Whether any real credential ever existed in git history | No credential-value scan of history was run in this pass. `.env` is absent at HEAD and `.gitignore`d |
| 10 | Runtime behaviour under `LLM_PROVIDER=openai` | No API key, no outbound call made. Only the mock path was executed (by the test suites) |
| 11 | Whether the mobile app builds or runs | No Android/iOS toolchain, emulator or device here. Typecheck and unit tests pass; `expo export`/EAS were not run |
| 12 | Whether `infra/k8s/*` manifests apply cleanly | No cluster available; they were read, not applied |
| 13 | Real-world answer quality | Structurally unmeasurable here: the only harness is circular (§14) and runs the mock embedder over 4 synthetic documents. `docs/clinical-validation.md` exists precisely because this cannot be settled by engineering |
| 14 | Per-record ownership rules on documents / answers / dose calculations | Searched `documents.service.ts`, `chat.service.ts`, `dose.service.ts` for `uploadedBy ===`, `userId ===`, `ownerId` — **no ownership gate found**. Whether that is intended is a design question this report does not answer |
| 15 | Test coverage percentage | No coverage instrumentation exists anywhere (§17), so no number can be produced |
| 16 | Why `GET /users/me`, `DELETE /users/:id`, MFA enrolment and the notifications UI were never wired | Intent is not recoverable from the code. `d543127` added MFA enrolment as "Phase 9a"; no later commit removes or wires a UI for it |

---

## 31. Final factual system map

### WHAT DEFINITELY EXISTS

A TypeScript monorepo of **202 tracked files** and **108 commits**, containing
four buildable units: a NestJS 11 API (49 routes, 12 controllers, 14 database
tables, 5 migrations), a Next.js 16 web app (16 pages, all statically
prerendered), an Expo 57 mobile app (6 screens), and one shared library.
**313 tests across 30 suites pass**, plus a clean lint, web build and mobile
typecheck — all executed and recorded in §27.

The governance machinery is real and verified in code: four independent
refusal gates converging on one hardcoded Arabic string; citations copied from
database rows into a model response shape that has no citation field; four
hard SQL filters restricting retrieval to approved, unexpired, current-version
chunks embedded by the active provider; a 7-role permission matrix compiled
into a shared file that the guard reads instead of the database; an audit
interceptor on every mutating request; and a document lifecycle with an
explicit legal-transition map.

### WHAT IS ACTUALLY CONNECTED

Both clients → the API over Bearer JWT with refresh-on-401. The API →
PostgreSQL/pgvector, → S3-compatible storage, and, when two environment
variables are set, → an OpenAI-compatible HTTP endpoint. One cron at 06:00
daily. Health probes consumed by CI, the k8s manifests and Railway. **31 of
49 routes** have a caller in web or mobile. Every web page is reachable from
navigation; every mobile screen is reachable from the tab switch.

### WHAT EXISTS BUT IS NOT CONNECTED

Eight implemented API capabilities have no user interface: MFA **enrolment**,
notifications (both routes — while a cron writes rows nobody can read), user
deletion, `GET /users/me`, dose-formula authoring and approval, targeted
reindex and the provider-check probe, chat history, and the single-document
document routes including version history.

Genuinely unreferenced: `packages/shared/src/types.ts` in its entirety (6
exported interfaces, 0 consumers), `PLATFORM_TAGLINE`, `RETRIEVABLE_STATUSES`,
the `@nestjs/config` dependency, and the `redis` compose service.

Configured but never invoked: the four Kubernetes manifests, and `eas.json`
(no CI job builds the mobile app).

### WHAT IS CLAIMED BUT NOT VERIFIED

Six documented claims do not match the code, all of them stale rather than
aspirational: the unit- and integration-test counts in both `CLAUDE.md` and
`README.md` (135/34 claimed, 213/68 measured); "Next.js 14" at `README.md:25`
against `next@16.3.1` and the same file's own line 36; the blanket
`/auth/*` authentication exemption in `docs/api.md:2-4`, which is wrong for
four of the nine auth routes; and two dated notes in
`docs/production-readiness.md` — the Next/Nest majors and "the web UI is
English-only" — both of which that same document explicitly corrects further
down.

Claims about a running deployment (725 chunks, zero stale chunks, a 429 on the
sixth rapid login) are outside what a repository can prove and are listed in
§30.

### WHAT CANNOT BE DETERMINED

Sixteen items, enumerated in §30 with the search performed for each. The
material ones: whether the answers this system produces are clinically sound
— structurally unmeasurable here, since the only quality harness is circular
by construction and runs a hashed bag-of-words embedder over four synthetic
documents; whether the mobile app builds or runs, there being no device or
toolchain; the actual security headers on a live response; and any statement
at all about the production deployment, which was not contacted.

### WHAT IS ABSENT — searched for and not found

Metrics, distributed tracing, error tracking, frontend error reporting, log
aggregation config, alerting. Digital signatures, HMAC, application-level
encryption, hash-chained audit. Biometric authentication, encrypted local
storage. OCR. OAuth, SSO, SAML, API keys, public self-registration. Message
queues, WebSockets, webhooks, GraphQL, tRPC, server actions, Next.js API
routes, Next middleware. Web tests, shared-package tests, coverage
instrumentation. A second environment (staging or preview). A deployment job
in CI.

Git archaeology run over all branches with both `--grep` and the pickaxe
confirms **none of these was ever removed — none was ever present.**

---

*Compiled 2026-08-31 against commit `114e655f3590ee648dc35ad61c726b44b0713479`.
The repository was not modified; this file is the only artefact created. No
secret value appears anywhere in it.*

*Amended 2026-08-31 with §0.1, recording what `503cef4` (PR #41) changed. The
body above is unchanged and still describes `114e655` exactly — the amendment
adds a section and three pointers to it, and rewrites no finding.*
