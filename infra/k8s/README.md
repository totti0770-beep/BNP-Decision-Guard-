# Kubernetes deployment (reference manifests)

A starting point for deploying BNP Decision Guard to a cluster. They mirror the
Docker Compose topology.

| File | What it is |
| --- | --- |
| `api-deployment.yaml` | NestJS API + Service. Expects a managed PostgreSQL with pgvector and an S3-compatible object store. |
| `web-deployment.yaml` | Next.js web app + Service. |
| `ingress.yaml` | TLS termination for both, on two hosts. |
| `secrets.example.yaml` | Template for required secrets. Copy, fill, apply as `bnp-secrets`. **Never commit real secrets.** |

## The three origins that must agree

More deployments break on this than on anything else here, because each failure
looks like a different problem:

1. **`api.your-hospital.example`** in `ingress.yaml`
2. **`NEXT_PUBLIC_API_URL`** baked into the web image — it is a Docker **build
   arg** (`Dockerfile.web`), not a runtime variable, so changing it means
   rebuilding the image
3. **`CORS_ORIGINS`** on the API Deployment, which must list the **web** origin

Get (2) wrong and browsers call the wrong host. Get (3) wrong and every call is
blocked by CORS while the API itself reports itself perfectly healthy.

## Before you apply anything

1. **Generate real secrets.** `JWT_SECRET`, `JWT_REFRESH_SECRET`,
   `POSTGRES_PASSWORD`, `S3_SECRET_KEY`. The API refuses to boot in production
   on a missing or shipped-default value — that refusal is the control working,
   not a bug.
2. **Set `NODE_ENV=production`** (already in `api-deployment.yaml`). Without it
   the API runs in development mode: the secret fail-fast never engages and 5xx
   internals leak to clients.
3. **Set `CORS_ORIGINS`** to your exact web origin(s).
4. **Choose an email posture.** `MAIL_PROVIDER=smtp` with `MAIL_HOST`, or leave
   it on `log` and accept that password-reset links only ever reach the
   application log. Production boots either way and warns; it also records a
   `MAIL:LOG_PROVIDER_IN_PRODUCTION` entry in the audit trail.
5. **`SEED_ON_BOOT=false`** (already set). The demo seed creates accounts with
   passwords published in the README.

## What these manifests deliberately do not do

Each of these needs a decision or a credential that cannot be committed to a
repository. They are the operator's, and none of them is optional for a real
clinical deployment.

| Gap | What is needed |
| --- | --- |
| **Container images** | `image: bnp-decision-guard/api:latest` refers to nothing that exists yet. CI builds both images (the smoke job) but pushes to no registry — there are no registry credentials in this repo. Push to your registry and pin a digest or version tag; `:latest` is not a deployable reference. |
| **Secret management** | `secrets.example.yaml` is a plain `Secret`, i.e. base64, not encryption. Use SealedSecrets, External Secrets, or your cloud's secret manager. |
| **PostgreSQL** | A managed instance with the `vector` extension available, sized and backed up. The manifests point at it; they do not provision it. |
| **Object storage** | An S3-compatible bucket with SSE/KMS enabled and lifecycle rules. |
| **TLS certificates** | `ingress.yaml` assumes cert-manager with a `letsencrypt-prod` ClusterIssuer. Adapt to your PKI. |
| **The expiry cron** | `notifications.service.ts` runs a daily sweep in-process, so with `replicas: 2` it runs twice. Move it to a `CronJob` against a single replica before scaling. |
| **Backup and restore** | Nothing here backs anything up. A restore that has never been rehearsed is not a backup. |
| **Observability** | No metrics, tracing or error tracking is wired. `/health` (liveness) and `/health/ready` (readiness, checks Postgres and object storage — 503 if either is unreachable) exist; logs are structured JSON lines, but nothing ships them anywhere — point your cluster's log collection at container stdout/stderr. |
| **Network policy, HPA, PDB** | Not included; add to suit your cluster. |

## Applying

```bash
kubectl apply -f secrets.example.yaml   # after filling it in
kubectl apply -f api-deployment.yaml
kubectl apply -f web-deployment.yaml
kubectl apply -f ingress.yaml
```

Migrations run automatically when the API container boots.
