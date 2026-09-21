# 08 — Build and run

Everything here was executed on this commit unless a line says otherwise, and
the lines that say otherwise say why.

## The one thing that must happen first

```bash
npm install
npm run build:shared          # ← before anything else
```

`packages/shared/package.json` sets `"main": "dist/index.js"`, so `@bnp/shared`
is consumed from **compiled output, not source**. On a fresh clone, bare
`npm test` and bare `npm run lint` both fail with `Cannot find module
'@bnp/shared'` until shared is built. `build:api`, `build:web`, `dev:api`,
`dev:web` and `eval:field` all chain `build:shared` for you; `test` and `lint`
do not, and CI's `lint` job runs it explicitly for that reason
(`.github/workflows/ci.yml:54`).

This is the single most likely first-five-minutes failure in the repository,
and it is a configuration consequence rather than a bug.

## Scripts, and what each actually runs

Root (`package.json:11-25`):

| Script | Runs |
| --- | --- |
| `build:shared` | `tsc` in `packages/shared` |
| `build:api` / `build:web` | `build:shared` then the workspace build |
| `dev:api` / `dev:web` | `build:shared` then `start:dev` / `next dev` |
| `seed` | migrations + idempotent demo data, in `@bnp/api` |
| `inventory` | `build:shared` then the clinical-reference inventory in `@bnp/api` |
| `test` | the API **unit** suite only |
| `lint` / `lint:fix` | `eslint .` over the whole monorepo |
| `test:eval` / `test:eval:field` | the gold set / the field set, with `EVAL_REPORT=1` |
| `eval:field` | the HTTP runner against a live deployment |

Note what the root `test` script does **not** cover: the integration suite
(`npm run test:e2e -w @bnp/api`), the web app (there is no web test runner at
all) and mobile (a separate install). "All tests pass" from the root means the
unit suite passed.

## Measured on this commit

| Command | Result |
| --- | --- |
| `npm run build:shared` | ✅ success |
| `npm test` | ✅ **428 tests, 30 suites, 0 failures**, 9.5 s |
| `npm run lint` | ✅ **0 errors, 10 warnings** |
| `npm run build:web` | ✅ compiled in 598 ms, TypeScript in 1.56 s, **20/20 static pages**, every route `○ (Static)` |
| `npm audit` | **0 findings at every severity** (see `06-DEPENDENCIES.md`) |

All ten lint warnings are `@typescript-eslint/no-explicit-any`, and the rule is
warn-not-error on purpose (`eslint.config.js:39-46`). The exact sites, from
`eslint . -f json`:

```
apps/api/src/analytics/analytics.module.ts            52:47
apps/api/src/auth/account-security.spec.ts           102:20, 110:22
apps/api/src/common/filters/all-exceptions.filter.ts  37:60
apps/api/src/common/interceptors/audit.interceptor.ts 36:20
apps/api/src/health.controller.spec.ts                 7:8, 8:76, 13:52
apps/api/src/rag/pdf-extraction.service.ts            46:36
apps/api/src/rag/retrieval.service.ts                107:25
```

Five of the ten are in test files. Of the five in source, three sit at genuine
type boundaries — an exception filter handling an unknown thrown value, an
interceptor reading an untyped request, and a raw-SQL row from pgvector.

**Every route in the web build is `○ (Static)`.** That is not a performance
note, it is the property the i18n design depends on: `lib/language.tsx:51-62`
argues against locale routing partly because it would push statically
prerendered routes dynamic. The build output is the evidence that the argument
still holds. Fifteen of the twenty pages are the `(app)` screens, matching the
"15 protected screens" claim in `README.md` and `docs/architecture.md`.

## What could NOT be run here, and why

Stated rather than skipped, because a report that lists only what passed is not
a measurement.

| Command | Why not |
| --- | --- |
| `cd apps/mobile && npm test` | `apps/mobile/node_modules` is absent — it is a separate install, not an npm workspace. The 32 tests are likewise taken from documentation, not measured. CI runs them |
| `docker compose up` | No Docker daemon here |
| `node apps/web/e2e-smoke.mjs` | Needs the composed stack running |
| Anything against the live Railway deployment | Not contacted by this audit; see `09-GAPS.md` |

### Correction: the integration suite *was* runnable here

This table listed `npm run test:e2e -w @bnp/api` as impossible, on the grounds
that `pg` could not reach `localhost:5432` and there is no Docker daemon. Both
observations were true and the conclusion drawn from them was wrong. Nothing
was running on 5432; **PostgreSQL 16 and pgvector 0.6.0 are installed in this
container** — `/usr/lib/postgresql/16/bin/initdb` and
`/usr/share/postgresql/16/extension/vector.control`. A cluster started by hand
runs the whole suite:

```bash
DATA=/var/lib/postgresql/e2e
mkdir -p "$DATA" && chown -R postgres:postgres /var/lib/postgresql
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $DATA -U postgres --auth=trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $DATA -l /var/lib/postgresql/pg.log -o '-p 5432 -k /tmp' start"
psql -h 127.0.0.1 -U postgres -c 'create database bnp_e2e'
psql -h 127.0.0.1 -U postgres -d bnp_e2e -c 'create extension vector'

E2E_POSTGRES_HOST=127.0.0.1 E2E_POSTGRES_USER=postgres \
E2E_POSTGRES_PASSWORD=postgres E2E_POSTGRES_DB=bnp_e2e \
  npm run test:e2e -w @bnp/api
```

**257 tests across 14 suites, 0 failures**, in 25 seconds — measured, not
reported from documentation. `initdb` refuses to run as root, which is why the
cluster is owned by the `postgres` user and lives under
`/var/lib/postgresql`: a data directory under the session scratchpad is not
traversable by that user.

The cost of the wrong conclusion was not a missing number. The audit deferred
every database-dependent verification to CI for a whole branch, so a real
defect in the PHI control reached a pull request before a test caught it — and
that test needed only this. `ECONNREFUSED` means nothing is listening. It does
not mean nothing can.

## Running it locally

Two documented paths, both in `README.md`.

**Full stack in Docker:**

```bash
cp .env.example .env          # optional — defaults are built in
docker compose up --build
```

→ web :3000, API :4000 (`/health`, `/health/ready`), MinIO console :9001,
PostgreSQL :5432. The API container runs migrations and, with `SEED_ON_BOOT=true`
(the compose default), seeds roles, demo users, four sample approved documents
and dose formulas on first boot.

`docker-compose.yml` defines **four** services — `postgres`, `minio`, `api`,
`web` — plus two named volumes. Two things in it are deliberate and were
previously bugs:

- **`NODE_ENV` defaults to `development` here** (`:70-75`). This file ships the
  shipped-default secrets, so `production` made the API's secret fail-fast
  refuse to boot and `docker compose up --build` — the documented quickstart —
  never started at all, with nothing in CI noticing. CI's `smoke` job now brings
  the stack up exactly this way, so the quickstart is regression-tested.
- **MinIO comes from `quay.io/minio/minio:latest`, not Docker Hub** (`:22-31`).
  `minio/minio` and `minio/mc` were withdrawn from Docker Hub — both answer 404
  on the repository API while `pgvector/pgvector` beside them answers 200 — so
  every `docker compose up` and every CI smoke run died at image resolution,
  before a container existed. The `minio-init` service was **deleted rather than
  repointed**: its only job was `mc mb`, and `StorageService.ensureBucket()`
  already creates the bucket on demand.

`minio` deliberately carries **no healthcheck** (`:42-46`) — the previous one
shelled out to `mc` inside an image not obliged to ship it — so `api` depends on
it with `service_started` rather than `service_healthy`, and tolerates object
storage arriving late.

**Apps outside Docker:**

```bash
docker compose up -d postgres minio     # infra only
npm install && npm run build:shared
npm run seed
npm run dev:api                          # :4000
npm run dev:web                          # :3000
```

**Mobile** is a separate install and has no build step in CI:

```bash
cd apps/mobile && npm install && npx tsc --noEmit && npm test && npm start
```

## The container boot sequence

`infra/docker/Dockerfile.api`'s `CMD`, in order:

```
1. node dist/scripts/migrate.js                          (always)
2. if ADMIN_EMAIL && ADMIN_PASSWORD:
       node dist/scripts/create-admin.js  || exit 1      ← FATAL on failure
3. if SEED_ON_BOOT=true AND (NODE_ENV != production OR SEED_ALLOW_PRODUCTION=true):
       seed
4. node dist/main.js
```

Step 2 being fatal is a correction with an incident behind it, recorded in a
40-line comment above the `CMD` and in `SECURITY.md`. It first shipped as
warn-and-continue; on 2026-08-22 an `ADMIN_PASSWORD` of 9 characters was
rejected by the password policy, so no administrator was created, the API booted
anyway, and the demo-account sweep disabled all seven seeded accounts —
**zero active users on a live system, from a typo in a variable.** Failing the
deploy instead leaves the previous deployment serving.

Step 1 is why `config/data-source.ts` matters more than it looks: `migrate.js`
runs **before** `main.js`, so it is the earliest code in a deployment to touch
production secrets, and it must resolve them through `loadEnv()` like everything
else.

## CI

`.github/workflows/ci.yml` — six jobs, on push and pull_request to **every**
branch, with no `needs:` between them, so all six run in parallel.

| Job | What gates |
| --- | --- |
| `security` | `audit-critical.mjs` hard-fails on any critical; `npm audit --audit-level=high` reports the rest non-blocking |
| `lint` | `build:shared` then `eslint .` — errors block, the 10 warnings do not |
| `api` | build shared → build API → **428 unit tests** → migrations against a real `pgvector/pgvector:pg16` → create `bnp_e2e` via the `pg` client → **integration tests** |
| `web` | `next build` — the **only** web typecheck, since there is no web test runner |
| `smoke` | `docker compose up -d --build`, poll `/health` and `/login`, install Chromium, run `apps/web/e2e-smoke.mjs`, upload screenshots, dump logs on failure, tear down with `-v` |
| `mobile` | separate `npm ci` in `apps/mobile`, `tsc --noEmit`, 32 unit tests, and its **own** critical-severity audit gate |

Two details worth knowing:

- **The `api` job creates the e2e database with the `pg` client, not `psql`**
  (`:96-108`), rather than assuming psql is on the runner image.
- **The `mobile` job exists because the root audit cannot see that tree.**
  `apps/mobile` is not an npm workspace, so a root `npm audit` is blind to it.
  The same gate script runs there with a `../../` path.

**There is no deploy job.** Production deployment is Railway auto-deploying
`main` (`infra/railway/README.md`), so **a merge to `main` is the deploy
action** — which is the reason this audit's branch has stayed a draft PR. CI
builds both container images in the smoke job but pushes to no registry.

## Environment

`.env.example` is the documented template, 120 lines in nine sections, and no
`.env` is tracked. Resolution goes through exactly one path — `loadEnv()` in
`apps/api/src/config/env.ts` — and the rule `CLAUDE.md` states about it is
worth repeating because the failure is silent: **do not reintroduce
`process.env.X ?? '<literal>'` at a call site.** A fallback there resolves to a
value published in this repository whenever the variable is unset, and unset
only fail-fasts in production.

What refuses to boot, and what merely warns:

| Setting | Behaviour |
| --- | --- |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | **fail-fast** under `NODE_ENV=production` if missing or left at the shipped default |
| `NODE_ENV` | only `production`, `development`, `test` accepted; unset means development; anything else **refuses to boot** |
| `RAG_MIN_SIMILARITY` | must be finite and in `[0, 1]` — **fails the boot**, and is re-validated on every query |
| `RAG_TOP_K`, `RAG_FINAL_K`, `RAG_MAX_PER_DOCUMENT` | validated integers, **fail the boot** on a typo |
| `PHI_MRN_PATTERN` | a malformed regex **fails the boot** rather than being ignored |
| `CORS_ORIGINS` | empty in production blocks all cross-origin browser calls — no error, the web app simply stops working |
| `MAIL_PROVIDER` | `smtp` without `MAIL_HOST` fails the boot; production left on `log` **only warns**, deliberately — mail is a degraded feature, and refusing to boot would take the clinical assistant offline over undelivered reset links |
| `NEXT_PUBLIC_API_URL` | **baked in at Docker build time** as an `ARG` in `Dockerfile.web`; changing it needs a rebuild |

The RAG-knob validation is not defensive programming for its own sake.
`RAG_MAX_PER_DOCUMENT` was once read as `Math.max(1, parseInt(...))`, and
`Math.max(1, NaN)` is `NaN` while `used >= NaN` is always false — so a typo
silently switched the per-document cap **off**, with no error and no log line,
undoing a fix that exists because a live vancomycin-dilution question had been
answered out of a compatibility manual.
