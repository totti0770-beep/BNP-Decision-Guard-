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
| `minio` | image `minio/minio:latest` — **withdrawn; see [below](#minio-the-withdrawn-image-and-how-to-move-off-it)** | — (internal only) | Railway-managed |
| `api` | `infra/docker/Dockerfile.api` | `api-production-5f73.up.railway.app` (port 4000) | `GET /health` |
| `web` | `infra/docker/Dockerfile.web` | `web-production-3a27.up.railway.app` (port 3000) | `GET /login` |

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

## MinIO: the withdrawn image and how to move off it

**Read this before touching the `minio` service.**

The service runs `minio/minio:latest`, deployed 2026-08-14 with start command
`minio server /data --address :9000 --console-address :9001` on the 5 GB
volume `minio-data` at `/data`. That volume holds every uploaded hospital PDF.
Retrieval does not read it (chunks live in Postgres), but upload, download,
re-indexing and the conflict scan all do.

`minio/minio` has been withdrawn from Docker Hub (the repository API answers
404), so **any redeploy of this service will fail to pull**: changing one of
its variables or settings, a restart onto a new host, a Railway migration.
Until the procedure below has been run, **change nothing on the `minio`
service.** Merging to `main` is safe: it redeploys `api` and `web` only, and
`minio` has not been redeployed through any merge since 2026-08-14.

### Why not just change the image

Pointing this service at the image CI uses, `bitnamilegacy/minio`, looks like a
one-field change. It is not a safe one:

1. **File ownership.** Bitnami's image runs as uid 1001, and the files on
   `/data` were written by root. Railway's own docs say non-root images hit
   permission errors on attached volumes (`RAILWAY_RUN_UID=0` is the documented
   fix).
2. **Version.** The live image is whatever `latest` was on 2026-08-14. Its
   logs are past retention, so its exact version cannot be read, and it is
   probably newer than Bitnami's frozen `2025.7.23`. MinIO does not support
   running an older server over data written by a newer one.
3. **No backup.** Nothing else holds a copy of the bucket.

The change also redeploys immediately, so a failure is an outage of document
storage from the first second.

### The procedure

The approach is to copy first and cut over second, so the old service stays
untouched until the new one is proven.

1. **Add a service `minio-next`** from image
   `bitnamilegacy/minio:2025.7.23-debian-12-r5`, with no start command.
   - Attach a **new** volume at `/bitnami/minio/data`, at least as large as
     `minio-data`.
   - Set `RAILWAY_RUN_UID=0`.
   - Set `MINIO_ROOT_USER=${{minio.MINIO_ROOT_USER}}` and
     `MINIO_ROOT_PASSWORD=${{minio.MINIO_ROOT_PASSWORD}}`, as Railway reference
     variables, so no secret is retyped.
2. **Add a one-off service `minio-copy`** from image `rclone/rclone:1.75.1`,
   with restart policy **Never**. Give it these variables:
   ```
   RCLONE_CONFIG_SRC_TYPE=s3
   RCLONE_CONFIG_SRC_PROVIDER=Minio
   RCLONE_CONFIG_SRC_ENDPOINT=http://minio.railway.internal:9000
   RCLONE_CONFIG_SRC_ACCESS_KEY_ID=${{minio.MINIO_ROOT_USER}}
   RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY=${{minio.MINIO_ROOT_PASSWORD}}
   RCLONE_CONFIG_DST_TYPE=s3
   RCLONE_CONFIG_DST_PROVIDER=Minio
   RCLONE_CONFIG_DST_ENDPOINT=http://minio-next.railway.internal:9000
   RCLONE_CONFIG_DST_ACCESS_KEY_ID=${{minio-next.MINIO_ROOT_USER}}
   RCLONE_CONFIG_DST_SECRET_ACCESS_KEY=${{minio-next.MINIO_ROOT_PASSWORD}}
   ```
   Set its start command to
   `sync src:<bucket> dst:<bucket> --checksum -v`, where `<bucket>` is the
   `api` service's `S3_BUCKET`. `sync` only reads from the source.
3. **Verify** by changing the start command to
   `check src:<bucket> dst:<bucket> --checksum` and redeploying `minio-copy`.
   It must report `0 differences found`. Then run `size src:<bucket>` and
   `size dst:<bucket>`; the object counts and byte totals must match.
4. **Cut over.** Set the `api` service's `S3_ENDPOINT` to
   `http://minio-next.railway.internal:9000`, which redeploys `api`. Confirm
   that `GET /health/ready` is healthy (it probes the bucket), that one PDF
   downloads from the approvals screen, and that **Scan now** on one live
   document completes.
5. **Keep the old service** `minio` stopped, not deleted, with its volume, for
   at least two weeks. Delete `minio-copy`.

**Rollback** at any point before step 5 ends: set `S3_ENDPOINT` back to
`http://minio.railway.internal:9000`. Nothing in steps 1–3 writes to the
old service.

`bitnamilegacy/minio` is a frozen archive and will get no security updates.
It is a bridge off a dead registry, not a destination. Choosing a maintained
object store is a separate decision.

## Known gaps versus the k8s reference manifests

- `EMBEDDING_PROVIDER`/`LLM_PROVIDER` are set to `openai` here (real AI, not the
  `mock` default used elsewhere in docs) — this deployment is exercising the real
  provider path, not the offline demo path.
- Single replica, single region (`us-east4-eqdc4a`) — no HA, matching the "not yet
  provisioned" status in `docs/production-readiness.md`'s runbook.
