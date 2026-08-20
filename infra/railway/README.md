# Railway deployment (live reference)

Unlike `infra/k8s/` and `docker-compose.yml`, which are reference manifests nobody
has necessarily applied, this describes an **actual running deployment**: project
`bnp-decisionguard` in the `totti0770-beep` Railway workspace, four services, wired
directly to this GitHub repository on `main`. Every push to `main` auto-deploys.

This file exists because that configuration previously lived only in the Railway
dashboard — undocumented, unreproducible, and invisible to anyone reading the repo.

## Why this is documentation, not `railway.json`

Railway's [Config as Code](https://docs.railway.com/config-as-code/reference) looks
for a single `railway.json`/`railway.toml` per deployment and — critically — **any
setting it defines always overrides the dashboard**, with no built-in way to scope
one root-level file to only one of several services sharing a repo. This project has
two services (`api`, `web`) built from the same repo with different Dockerfiles and
different healthcheck paths. A single committed `railway.json` risks silently
clobbering whichever service's dashboard settings it doesn't intend to touch, on a
system with real current traffic. Given the two services' dashboard settings are
already correct and verified live, the safer path is documenting them here rather
than introducing an unscoped file that could misconfigure production on the next
deploy. Revisit if Railway adds a per-service config-file path, or if the services
move to distinct subdirectories with their own root-directory settings.

## Services

| Service | Builds from | Public domain | Healthcheck |
| --- | --- | --- | --- |
| `postgres` | Railway's managed Postgres (pgvector-capable) | — (internal only) | Railway-managed |
| `minio` | Railway template | — (internal only) | Railway-managed |
| `api` | `infra/docker/Dockerfile.api` | `api-production-5f73.up.railway.app` (port 4000) | `GET /health` |
| `web` | `infra/docker/Dockerfile.web` | `web-production-3a27.up.railway.app` (port 3000) | *(none configured — see Phase 8 follow-up)* |

## Required environment variables (names only — set real values in the Railway dashboard)

**`api`**: `API_PORT`, `AUTH_LOCKOUT_MINUTES`, `AUTH_MAX_FAILED_ATTEMPTS`,
`AUTH_RATE_LIMIT_MAX`, `CORS_ORIGINS`, `EMBEDDING_DIM`, `EMBEDDING_PROVIDER`,
`JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_SECRET`,
`LLM_PROVIDER`, `NODE_ENV`, `OPENAI_API_KEY`, `PASSWORD_RESET_TOKEN_MINUTES`,
`POSTGRES_DB`, `POSTGRES_HOST`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`,
`POSTGRES_USER`, `RAG_FINAL_K`, `RAG_MIN_SIMILARITY`, `RAG_TOP_K`, `RATE_LIMIT_MAX`,
`RATE_LIMIT_TTL`, `REQUEST_BODY_LIMIT`, `S3_ACCESS_KEY`, `S3_BUCKET`, `S3_ENDPOINT`,
`S3_FORCE_PATH_STYLE`, `S3_REGION`, `S3_SECRET_KEY`, `SEED_ON_BOOT`.

**`web`**: `NEXT_PUBLIC_API_URL`, `NEXT_TELEMETRY_DISABLED`, `NODE_ENV`.

`CORS_ORIGINS` on `api` and `NEXT_PUBLIC_API_URL` on `web` must agree — see "The
three origins that must agree" in `infra/k8s/README.md`; the same failure mode
applies here. Verified agreeing as of this writing (API boot log:
`cors=https://web-production-3a27.up.railway.app`).

## Known gaps versus the k8s reference manifests

- No healthcheck configured on `web` (the `api` service has one; `web` doesn't).
  Low risk today — Railway falls back to TCP-port-open checks — but doesn't confirm
  the app actually serves a page. Track alongside `infra/k8s/web-deployment.yaml`'s
  `/login` probe, which already does this correctly.
- `EMBEDDING_PROVIDER`/`LLM_PROVIDER` are set to `openai` here (real AI, not the
  `mock` default used elsewhere in docs) — this deployment is exercising the real
  provider path, not the offline demo path.
- Single replica, single region (`us-east4-eqdc4a`) — no HA, matching the "not yet
  provisioned" status in `docs/production-readiness.md`'s runbook.
