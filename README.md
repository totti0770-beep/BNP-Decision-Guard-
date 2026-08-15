# BNP Decision Guard

**Knowledge Governance and Authorized Decision Platform**

A web + mobile platform that gives nurses trusted, cited answers **exclusively
from approved hospital PDF documents** — with an AI that refuses instead of
guessing, a governed document approval workflow, a pharmacist-gated dose
calculator, role-based access control, and a complete audit trail.

> When no sufficiently approved source exists, the assistant answers **exactly**:
>
> **«لا توجد وثيقة معتمدة كافية للإجابة. الرجاء الرجوع للمسؤول المختص.»**
>
> Every dose calculation carries the warning:
>
> **«لا يعتمد هذا الحساب دون مراجعة سريرية من المختص.»**

---

## Architecture

```
apps/
  api/        NestJS + TypeScript — REST API, RAG pipeline, RBAC, audit
  web/        Next.js 14 + Tailwind — 14 governance screens
  mobile/     Expo React Native — nurse-focused companion app
packages/
  shared/     RBAC matrix, clinical safety strings, lifecycle enums, DTO types
infra/
  docker/     Dockerfiles + Postgres init SQL
  k8s/        Kubernetes-ready reference manifests
docs/         Architecture, database schema, API reference
```

**Stack**: PostgreSQL 16 + pgvector (embeddings + HNSW index), MinIO
(S3-compatible PDF storage), NestJS 10, TypeORM, Next.js 14, Expo 51,
JWT auth (+ refresh, TOTP/MFA-ready), Docker Compose.

**RAG pipeline**: PDF → page-aware extraction → chunking → embeddings →
pgvector → cosine retrieval (**restricted to ACTIVE, non-expired documents**)
→ rerank → threshold check → context-only LLM → citations (document, page,
approval date, confidence) → exact refusal when no source qualifies.

**Pluggable AI providers**: with no API key the platform runs a deterministic
mock embedding provider and an **extractive** mock LLM that can only quote
approved documents — the entire system works offline. Set
`LLM_PROVIDER=openai`, `EMBEDDING_PROVIDER=openai` and `OPENAI_API_KEY` to use
any OpenAI-compatible endpoint (the context-only prompt and refusal gate still
apply).

### Switching to real AI (turn-key)

1. Set `LLM_PROVIDER=openai`, `EMBEDDING_PROVIDER=openai`, `OPENAI_API_KEY=…`
   (optionally `OPENAI_BASE_URL` for any OpenAI-compatible endpoint) and
   restart the API.
2. Every chunk is stamped with the provider that embedded it, and retrieval
   only compares vectors from the **currently configured** provider — vectors
   from different providers live in incompatible spaces. So immediately after
   the switch the assistant **refuses everything** (safe) and the API logs a
   startup warning naming the stale chunks.
3. Re-embed the corpus: sign in as a knowledge manager and call
   `POST /rag/reindex` — it re-extracts, re-chunks and re-embeds every ACTIVE
   document with the new provider and reports per-document results. A document
   that fails keeps its previous chunks (each rewrite is transactional).
4. Ask a question — answers now use real semantic retrieval; citations,
   thresholds and the exact refusal contract are unchanged.

Provider calls carry a hard timeout (`OPENAI_TIMEOUT_MS`, default 30 s) with
one retry on 429/5xx; a provider outage surfaces as a safe error, never a
fabricated answer.

**Document lifecycle**:
`DRAFT → IN_REVIEW → APPROVED → INDEXED → ACTIVE` (+ `REJECTED`, `EXPIRED`,
`INACTIVE`). Only **ACTIVE** documents are retrievable by the AI. Re-uploading
creates a new version and resets the lifecycle to DRAFT. A daily job expires
stale documents (removing them from retrieval immediately) and alerts knowledge
managers 30 days before expiry.

## Prerequisites

- Docker + Docker Compose v2 (that's all for the containerized run)
- For local development: Node.js ≥ 20

## Run locally (Docker Compose)

```bash
cp .env.example .env          # optional — sensible defaults are built in
docker compose up --build
```

| Service      | URL                                            |
| ------------ | ---------------------------------------------- |
| Web app      | http://localhost:3000                          |
| API          | http://localhost:4000 (health: `/health`)      |
| MinIO console| http://localhost:9001 (bnp_minio / bnp_minio_secret) |
| PostgreSQL   | localhost:5432 (bnp / bnp_secret)              |

The API container runs migrations and (with `SEED_ON_BOOT=true`, the default)
seeds roles, demo users, sample approved documents and dose formulas on first
boot.

## Run locally (without Docker for the apps)

```bash
docker compose up -d postgres minio minio-init   # infra only
npm install
npm run build:shared
npm run seed          # migrations + demo data (idempotent)
npm run dev:api       # API on :4000
npm run dev:web       # web on :3000
```

Mobile:

```bash
cd apps/mobile && npm install && npm start
# Android emulator: EXPO_PUBLIC_API_URL=http://10.0.2.2:4000 npm start
# Physical device:  EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:4000 npm start
```

Store builds (EAS — requires an Expo account; production signing additionally
needs Apple/Google developer credentials):

```bash
cd apps/mobile
npm install -g eas-cli
eas login
eas init                                   # links the project (writes extra.eas.projectId)
eas build --profile preview --platform android   # internal APK
eas build --profile production --platform all    # store builds
```

Profiles live in `apps/mobile/eas.json` — edit each profile's
`EXPO_PUBLIC_API_URL` to point at your deployed API before building.

## Demo users

| Role                       | Email                  | Password        |
| -------------------------- | ---------------------- | --------------- |
| Super Admin                | superadmin@bnp.health  | SuperAdmin123!  |
| Hospital Admin             | admin@bnp.health       | HospAdmin123!   |
| Nursing Knowledge Manager  | knowledge@bnp.health   | Knowledge123!   |
| Pharmacist Reviewer        | pharmacist@bnp.health  | Pharmacist123!  |
| CBAHI / Quality Officer    | quality@bnp.health     | Quality123!     |
| Nurse User                 | nurse@bnp.health       | NurseUser123!   |
| Auditor                    | auditor@bnp.health     | Auditor123!     |

*Demo data only — no real patient data is used anywhere in this MVP.*

> **⚠️ These passwords are public.** They are fine for a local demo, but on
> any internet-facing deployment you must either set `SEED_PASSWORD_<ROLE>`
> environment variables (e.g. `SEED_PASSWORD_NURSE_USER`) **before first
> boot** — seeding is skip-if-present, so overrides never touch an existing
> database — or sign in as an admin right after deploying and rotate every
> account from the **Users** screen (`PATCH /users/:id` also revokes that
> user's outstanding refresh tokens).

## How to upload and approve a PDF

1. Sign in as **knowledge@bnp.health** → **Upload Document** → choose a PDF,
   title, category and expiry date. The document is created as **DRAFT**.
2. On **Approval Workflow**, click **Submit for review** (→ IN_REVIEW).
3. Sign in as **pharmacist@bnp.health** (or quality@ for CBAHI docs) and click
   **Approve** (→ APPROVED). Reject sends it back with a reason.
4. Back as the knowledge manager, click **Index into AI** — the PDF is
   extracted, chunked, embedded into pgvector and becomes **ACTIVE**.
5. Only now can the AI cite it. **Deactivate** (or expiry) removes it from
   retrieval instantly.

## How to ask the AI assistant

Sign in as **nurse@bnp.health** → **AI Nursing Assistant** (or Drug
Preparation / CBAHI Search, which restrict retrieval to their category).

Every answer includes: short answer, practical steps, warnings, source document
name, page number, document approval date, and a confidence level. Try:

- *“What is the IV paracetamol dose for a patient weighing 50 kg or less?”* → cited answer
- *“What is the chemotherapy protocol for lung cancer?”* → exact Arabic refusal

## Dose calculator

Sign in as a nurse → **Dose Calculator**. Only formulas **approved by a
Pharmacist Reviewer** are usable; draft formulas are rejected by the API.
Output shows the formula source, step-by-step math, max-dose capping,
prescribed-vs-calculated deviation warnings, and always the Arabic safety
warning. Pharmacists manage formulas via `POST /dose/formulas` and
`POST /dose/formulas/:id/approve`.

## Tests

```bash
npm test               # 51 unit tests over the clinical safety + security paths
```

Covered: exact refusal contract, retrieval thresholding, mock-embedding
determinism, chunk/page integrity, dose math + unapproved-formula rejection +
max-dose caps, the RBAC permission matrix (nurse cannot approve/download,
only pharmacists approve formulas, auditor is read-only, a database-only role
grants nothing), upload content validation (a non-PDF cannot be stored by
spoofing the `Content-Type` header), the password-reset token never being
returned to the caller, and the production secret fail-fast.

Not covered, and worth knowing before you rely on the suite: there are no HTTP,
database, web or mobile tests, and no end-to-end run in CI. The browser smoke
script below is not wired into the pipeline.

Continuous integration (`.github/workflows/ci.yml`) runs the API build +
tests + migrations (against a real pgvector service), the web production
build, and the mobile typecheck on every push and pull request.

A browser end-to-end script (`apps/web/e2e-smoke.mjs`, Playwright) drives
login → cited answer → refusal → dose calculation → copy-protection →
role-aware navigation against a running stack.

## Environment variables

See `.env.example`. Key ones:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LLM_PROVIDER` / `EMBEDDING_PROVIDER` | `mock` | `mock` or `openai` |
| `OPENAI_API_KEY` | — | required only for `openai` providers |
| `RAG_MIN_SIMILARITY` | `0.25` | refusal threshold |
| `RAG_TOP_K` / `RAG_FINAL_K` | `8` / `4` | retrieval / rerank depth |
| `SEED_ON_BOOT` | `true` (docker) | seed demo data on API start |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | change-me | **must** be rotated in production |

## Security & governance design

See **[SECURITY.md](SECURITY.md)** for the full control list and operational
requirements, and **[docs/production-readiness.md](docs/production-readiness.md)**
for the pilot/production launch checklist. Highlights:

- **Production secret fail-fast**: with `NODE_ENV=production` the API refuses to
  boot if any JWT secret, DB password or S3 secret is missing or left at a
  shipped default.
- **Hardened edge**: `helmet` security headers, per-IP rate limiting with a
  stricter cap on `/auth/*` (brute-force defense, returns 429), an explicit
  `CORS_ORIGINS` allowlist, and a JSON body-size cap.
- **Revocable sessions**: `POST /auth/logout` (and any password change) bumps
  the user's `token_version`, immediately invalidating all outstanding refresh
  tokens.
- **Brute-force lockout**: an account locks for `AUTH_LOCKOUT_MINUTES` after
  `AUTH_MAX_FAILED_ATTEMPTS` failed logins — blocking even a correct password.
- **Self-service password reset**: `POST /auth/forgot-password` (no account
  enumeration) and `POST /auth/reset-password` (single-use token bound to
  `token_version`; rotating the password invalidates every session).
- **Safe errors**: a global exception filter returns a uniform envelope and
  never leaks internal 5xx details in production.
- **RBAC**: 7 roles with a central permission matrix (`packages/shared`),
  enforced by a global guard. The matrix is the single source of truth — the
  persisted `role_permissions` rows exist so the UI can display it and are
  never consulted when authorizing a request.
- **Refusal-first AI**: retrieval is hard-filtered to ACTIVE, non-expired
  document versions; sub-threshold matches refuse with the exact Arabic string;
  the mock LLM is extractive (cannot generate beyond context) and the OpenAI
  provider runs under a context-only prompt with the same server-side gate.
- **Audit**: every login, question, answer (incl. refusals), document action,
  dose calculation, permission change and settings edit is recorded with actor,
  IP and before/after metadata.
- **Copy protection**: `documents:download` is withheld from nurses and
  auditors; downloads are short-lived presigned URLs, and every download is
  audited.
- **Answer review**: the **AI Answer Review** screen (`GET /chat/answers`,
  `POST /chat/answers/:id/review`) lets the scientific committee
  (pharmacist/quality/knowledge manager) see every nurse's AI answers and
  approve or flag them — nurses cannot access either endpoint.
- **MFA-ready**: TOTP flow (`/auth/mfa/verify`) is implemented; enable per-user
  by setting `mfa_enabled` + secret.
- **HTTPS-ready**: the API and web containers sit behind whatever TLS
  terminator you deploy (see `infra/k8s/`); no HTTP-only assumptions in code.
- **Encryption at rest**: object storage is S3-compatible — enable SSE/KMS on
  MinIO or your cloud bucket; Postgres supports TDE/disk encryption at the
  infrastructure layer.
- **Dependency vulnerability scanning**: CI hard-fails on any **critical**
  `npm audit` finding. As of the August 2026 audit there are **0 critical, 5
  high and 9 moderate** findings; because the gate only blocks critical, the
  five highs currently pass CI. Some are closeable without the NestJS 11 /
  Next.js 15 majors — see `docs/production-readiness.md`.
- **No public self-registration**: accounts are provisioned by an administrator
  via `POST /users`. Roles are read-only over the API — permissions live in
  `packages/shared/src/rbac.ts`, which is what the guard actually enforces.

## Deployment notes

- `infra/k8s/` contains reference Deployments/Services and a Secret template;
  add an Ingress with TLS, point the env at a managed PostgreSQL (with the
  `vector` extension) and an S3 bucket, and set `SEED_ON_BOOT=false`.
- Images build from `infra/docker/Dockerfile.api` and `Dockerfile.web`.
- Scale-out: the API is stateless (JWT), so replicas are safe; the near-expiry
  cron should be limited to a single replica or moved to a Job in production.

## Documentation

- [docs/architecture.md](docs/architecture.md) — system + RAG flow diagrams
- [docs/database-schema.md](docs/database-schema.md) — all 16 tables
- [docs/api.md](docs/api.md) — REST endpoint reference

## Disclaimer

This MVP is a clinical **decision-support governance** platform demo. It ships
with synthetic demo content, uses no real patient data, and must pass local
clinical, security and regulatory review before any real-world use.
