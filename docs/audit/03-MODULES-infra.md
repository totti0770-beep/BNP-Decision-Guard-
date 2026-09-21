# 03 — Modules: infrastructure (`infra/`, `docker-compose.yml`, CI)

Four directories' worth of deployment material, of which exactly one path is
live.

| Path | Status |
| --- | --- |
| `infra/railway/README.md` | 📋 documents **the actual live deployment** |
| `infra/docker/` | ✅ the two images that are actually built |
| `docker-compose.yml` | ✅ the local stack, and CI's smoke job runs it |
| `infra/k8s/` | 📋 four reference manifests + README — **nothing applies them** |

## What actually runs in production

A Railway project (`bnp-decisionguard`) with four services, documented in
`infra/railway/README.md`: build sources, domains, healthcheck paths and the
environment-variable names per service. **It auto-deploys `main`**, and there is
no deploy job in CI — so **a merge to `main` is the deploy action.**

That single fact is why the branch carrying this audit has stayed a draft pull
request throughout.

The README also records why no `railway.json` is committed: the two web-facing
services need different healthcheck paths, and one committed file risks applying
the wrong one. And it names two known gaps of its own — the providers are
`openai` rather than `mock`, and the deployment is single-replica, single-region.

## `infra/docker/`

**`Dockerfile.api`** — two stages on `node:22-alpine`. The build stage installs
only the shared + api workspaces; the runtime stage copies `dist` and
`node_modules`, sets `NODE_ENV=production` and exposes 4000.

Its `CMD` is four steps and carries a **40-line comment recording an incident**:

```
1. node dist/scripts/migrate.js                      (always)
2. if ADMIN_EMAIL && ADMIN_PASSWORD:
       node dist/scripts/create-admin.js || exit 1   ← FATAL
3. if SEED_ON_BOOT=true AND (NODE_ENV != production OR SEED_ALLOW_PRODUCTION):
       seed
4. node dist/main.js
```

Step 2 first shipped as warn-and-continue. On 2026-08-22 an `ADMIN_PASSWORD` of
9 characters was rejected by the password policy, so no administrator was
created, the API booted anyway, and the demo-account sweep disabled all seven
seeded accounts — **zero active users on a live system, from a typo in a
variable.** Making it fatal trades a few minutes of published demo credentials
staying live — an exposure that was already ongoing — for not having a total
outage.

Step 1 running before `main.js` is why `config/data-source.ts` is the earliest
code in a deployment to touch production secrets, and why it must resolve them
through `loadEnv()`.

**`Dockerfile.web`** — two stages; the build stage bakes `NEXT_PUBLIC_API_URL`
in as an `ARG`. That is the reason changing the API URL requires a rebuild, not
a restart.

**`initdb/01-pgvector.sql`** — two statements the Postgres container runs on
first init: `CREATE EXTENSION IF NOT EXISTS vector` and `"uuid-ossp"`.

## `docker-compose.yml`

Four services — `postgres`, `minio`, `api`, `web` — and two named volumes.
Three decisions in it are corrections with failures behind them:

- **`NODE_ENV` defaults to `development`.** This file ships the shipped-default
  secrets, so `production` made the API's secret fail-fast refuse to boot, and
  `docker compose up --build` — the documented quickstart — never started on a
  clean clone, with nothing in CI noticing. CI's smoke job now brings the stack
  up exactly this way, so the quickstart is regression-tested.
- **MinIO comes from `quay.io/minio/minio:latest`.** `minio/minio` and
  `minio/mc` were withdrawn from Docker Hub — both answer 404 on the repository
  API while `pgvector/pgvector` beside them answers 200 — so every
  `docker compose up` and every CI smoke run died at image resolution, before a
  container existed. `quay.io` is MinIO's own registry: a registry change, not a
  change of software.
- **`minio-init` was deleted rather than repointed.** Its only job was `mc mb`,
  and `StorageService.ensureBucket()` already creates the bucket — called on
  every upload and on seed. A second service pulling a second withdrawn image to
  do work the application already does was one more thing to break.

`minio` deliberately has **no healthcheck**: the previous one shelled out to
`mc` inside an image not obliged to ship it. So `api` depends on it with
`service_started`, tolerates object storage arriving late, and `/health/ready`
reports `objectStorage: down` with a 503 until it is reachable. The `api`
healthcheck uses **node's own http client**, not curl or wget, because the
alpine runtime image is not obliged to have either — with a 60 s `start_period`
covering migrate + seed before the server listens.

## `infra/k8s/` — coherent, and unused

Four manifests plus a README. They are internally consistent: the API Deployment
runs 2 replicas, takes secrets via `envFrom`, and probes **different endpoints
for readiness and liveness** (`/health/ready` and `/health`) with the reason
written in — a slow Postgres must not make Kubernetes restart a healthy pod. The
Ingress sets a 1 MB body cap for web and 32 MB plus a 120 s read timeout for the
API, because ingestion runs inside the request. `secrets.example.yaml` has 16
keys with every sensitive one set to the literal `REPLACE_ME`; no real
credential is present.

The README is unusually honest for a manifest set: a nine-row table of what
these files deliberately do **not** do — images, secret management, Postgres,
object storage, TLS, the in-process expiry cron under `replicas: 2`, backups,
observability, and NetworkPolicy/HPA/PDB.

That cron row is the one to notice. The daily expiry job runs **in process**, so
two replicas means two runs.

**Nothing applies these manifests.** They are not referenced by CI, any npm
script, `docker-compose.yml`, or the Railway README. They are a reference path
for an HA deployment that does not exist yet.

## CI — `.github/workflows/ci.yml`

Six jobs, on push and pull_request to **every** branch, with no `needs:`, so all
six run in parallel.

| Job | Gates |
| --- | --- |
| `security` | `audit-critical.mjs` hard-fails on critical; `--audit-level=high` reports the rest |
| `lint` | `build:shared` then `eslint .` — errors block |
| `api` | build → 428 unit tests → migrations against real pgvector → create `bnp_e2e` via the `pg` client → integration tests |
| `web` | `next build` — the only web typecheck |
| `smoke` | full `docker compose` stack + Playwright, screenshots uploaded, logs dumped on failure, `down -v` |
| `mobile` | separate `npm ci`, typecheck, 32 tests, **its own** critical audit gate |

**`.github/scripts/audit-critical.mjs` is the most interesting file here.** It
exists because `npm audit --audit-level=critical` reaches the registry's legacy
"quick" endpoint, which npm is retiring and which answered `400 Invalid package
tree` on an unchanged lockfile `npm ci` had installed cleanly seconds earlier in
the same job. `npm audit` then exits 1 on the transport error, which the gate
cannot tell apart from a real critical finding.

The script reads `npm audit --json` — the bulk endpoint — and decides on
`metadata.vulnerabilities.critical`. It also **fails when the audit could not run
at all**, because silently passing when the advisory data never arrived is the
one outcome worse than a false red. Verified by mutation: a stubbed critical
count, a stubbed audit error and a lockfile-less directory each exit 1.

The reasoning in its header is the part worth keeping: *a security gate that
fails on registry mechanics is not a stricter gate — it is a gate whose red
light stops meaning anything, which is how a real critical finding ends up being
waved through as "that job is flaky again".*

The **mobile job exists because the root audit is blind to that tree.**
`apps/mobile` is not an npm workspace, so a root `npm audit` cannot see it; the
same script runs there with a `../../` path.

## What infrastructure does not cover

No deploy job, no container registry push, no staging or preview environment, no
log shipping, no metrics, no tracing, no error tracking, no alerting, no
backups, and no rehearsed restore. Application logs are structured JSON on
stdout — the integration point exists; nothing collects it.

Those are enumerated with owners in `docs/production-readiness.md`'s runbook
table, and most of them are correctly marked as needing the hospital's own
credentials, infrastructure or authorization rather than more engineering here.
