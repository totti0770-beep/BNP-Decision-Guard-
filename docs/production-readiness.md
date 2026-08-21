# Production Readiness — BNP Decision Guard

A CTO-level assessment of what exists today and what remains for pilot and
production. Use this as the launch checklist.

> **Audit update (Aug 2026).** A full re-audit (API, web, mobile, live
> Railway deployment) confirmed this scorecard and closed several rows:
> server-side logout on web **and** mobile, upload refresh-on-401,
> password-reset UI, `SEED_PASSWORD_<ROLE>` overrides, document-list
> pagination, mobile secure token storage + refresh + MFA step, and a
> reindex button in Settings (`documents:index`), and **email delivery**
> (pluggable `MAIL_PROVIDER=log|smtp` — code complete, needs `MAIL_HOST` to
> actually deliver). Still open, in impact order:
> **OCR for scanned PDFs** (pdf-parse reads the text layer only — a
> scanned Arabic PDF indexes zero chunks), **observability**, **backup +
> tested restore**, the **Next 15 / NestJS 11 majors**, and **compliance
> sign-off**. The web UI is English-only while mobile is Arabic-first —
> a deliberate inversion to revisit before a nurse-facing pilot.

> **Audit update (Aug 2026, second pass).** A read-only engineering baseline
> scored the platform **63/100** overall: MVP ready, pilot blocked, production
> not ready. It found the engineering sound but the shipped *configuration*
> unsafe, and the following have since been fixed:
>
> - `POST /auth/forgot-password` returned a valid reset token to any
>   unauthenticated caller whenever `NODE_ENV` was not exactly `production` —
>   and the k8s manifests never set it. Account takeover from a known email.
> - `docker compose up --build` could not start the API at all: compose set
>   `NODE_ENV=production` alongside the shipped default secrets the fail-fast
>   rejects. Neither compose nor k8s passed `CORS_ORIGINS`.
> - Upload trusted the client's `Content-Type` with no magic-byte check.
> - Public self-registration was **removed**; accounts are provisioned via
>   `POST /users`.
> - The roles API is now **read-only**. `rbac.ts` is the sole authorization
>   input, so `POST /roles` and `PATCH /roles/:id` wrote to `role_permissions`,
>   reported success and emitted a `ROLES:UPDATE_PERMISSIONS` audit entry while
>   changing nothing. No shipped screen used them, but any API client would
>   have been misled. `ROLES_MANAGE` was dropped from the matrix with them.
>
> - Email delivery landed independently on `main` (PR #13) while this branch
>   was open. That implementation is canonical; this branch adopted it and
>   contributed one fix on top — the send is no longer awaited, because an
>   awaited SMTP round trip happens only for accounts that exist and so leaks
>   by timing what the uniform response hides in the body.
>
> Still open, in impact order: **MFA enrollment** (no endpoint writes
> `mfa_secret`), **observability**,
> **integration/E2E tests** (none exist at the time of that pass; both landed
> later, along with a linter), **backup + tested
> restore**, **OCR for scanned PDFs**, the **Next 15 / NestJS 11 majors**, and
> **compliance sign-off**. The web UI is English-only while mobile is
> Arabic-first — revisit before a nurse-facing pilot.

> **Audit update (Aug 2026, third pass).** Continuing the same branch: a real
> `jest-e2e.config.js` now exists (it previously didn't, so `npm run
> test:e2e` was a dead script despite CI provisioning a Postgres service for
> it) — 32 integration tests hit real HTTP through the real `AppModule`
> (guards, `ValidationPipe`, exception filter) against real Postgres+pgvector,
> covering login/refresh/lockout/reset, the full document
> upload→review→approve→index→ACTIVE lifecycle, and RBAC 403s at the HTTP
> layer, not just in mocked unit tests. The browser smoke script
> (`apps/web/e2e-smoke.mjs`) is now wired into CI against the full Docker
> Compose stack — it had rotted from never being run: three stale selectors
> and two assertions that only `console.log`-ed instead of failing (nurse
> sees no download buttons, nurse sees no admin nav) are fixed. `/health` is
> now liveness-only (no dependency checks — a slow Postgres must not make
> Kubernetes restart a healthy pod); `/health/ready` is new and checks
> Postgres and object storage, returning 503 with per-dependency detail when
> either is unreachable, wired into `web-deployment.yaml`'s new probes and a
> new `ingress.yaml`. All API logs are now structured JSON lines
> (`{timestamp,level,context,message}`) via a custom Nest logger with no new
> dependency — every existing `new Logger(...)` call site needed no changes.
> Nothing ships those lines anywhere yet; that's still open below. Still
> open, in impact order: **metrics/tracing/alerting** (no Prometheus/OTel/
> Sentry), **MFA enrollment**, **backup + tested restore**, **OCR for scanned
> PDFs**, the **Next 15 / NestJS 11 majors**, and **compliance sign-off**.

> **Cycle 3 (Aug 2026).** This branch's earlier merge (PR #14) turned out to
> already be live: a Railway project (`bnp-decisionguard`, documented in
> `infra/railway/README.md`) auto-deploys `main` and is in active real use —
> confirmed via Railway logs showing a real user logging in, browsing, and
> exercising most nav routes. That traffic surfaced a genuine production
> incident, since fixed: `POST /documents/:id/index` was failing with an
> opaque `500` because the AI-provider HTTP client discarded the upstream
> error body on failure. It now logs that detail server-side, so the actual
> cause (parameter bug vs. Railway-side credential/billing issue) is
> diagnosable on the next occurrence instead of invisible. `web`'s Railway
> service also gained a `/login` healthcheck, matching `api`'s and the k8s
> reference's `web-deployment.yaml`. Still open: everything below this note
> was written before the live deployment was discovered, so read
> "Cloud / Kubernetes provisioning" in the runbook table as **partially
> resolved** — a real single-region, single-replica deployment exists, just
> not the HA/multi-replica target that row originally meant.

> **Cycle 3, Phase 10 (Aug 2026).** The web UI is no longer English-only. All
> 13 protected screens, the shell and both auth screens are now bilingual
> EN/AR with a per-user toggle, and RTL genuinely mirrors the layout rather
> than only flipping text direction. Deliberately *not* next-intl: its
> `[locale]` routing would have restructured every route, changed every URL,
> broken the browser smoke test's paths and the Railway `/login` healthcheck,
> and pushed statically prerendered routes dynamic — for SEO that does not
> exist behind auth. It instead reuses the localStorage + pre-paint init
> script pattern the app already used for theme, so `lang`/`dir` are correct
> in the first paint. Web defaults to English (mobile stays Arabic-first);
> the earlier note below that calls this a "deliberate inversion to revisit"
> is now resolved — both languages exist on both clients, and which one is
> *default* is a per-client product call rather than a gap. Still English in
> an Arabic session, on purpose: user names, emails, document titles, and the
> role enum values/descriptions returned by the API — that is data, not
> interface. Localised role display names would belong in the API/RBAC layer
> beside the roles, not as a drifting client-side copy.

## Readiness scorecard

| Dimension | MVP | Pilot | Production |
| --- | --- | --- | --- |
| Core features (RAG, RBAC, audit, dose, workflow) | ✅ | ✅ | ✅ |
| Security hardening (headers, rate limit, CORS, secret fail-fast, token revocation, account lockout, password reset) | ✅ | ✅ | 🟡 (add secret mgr; set `MAIL_PROVIDER=smtp`) |
| Dependency vulnerability posture | ✅ 0 critical | 🟡 5 high pass CI | 🟡 (14 findings: 5 high, 9 moderate — see below) |
| CI (build + test + migrate + SCA gate on every push/PR) | ✅ | ✅ | ✅ |
| Integration/E2E tests (real HTTP + Postgres, browser smoke) | ✅ 32 API + 7-step browser flow, both gate CI | ✅ | ✅ |
| Scientific-committee answer review UI | ✅ | ✅ | ✅ |
| Real semantic AI (provider-stamped index, reindex endpoint, timeouts) | ✅ turn-key | ✅ (key + eval) | ✅ |
| Mobile store-build config (EAS profiles, bundle ids) | ✅ | 🟡 (needs Expo/store accounts) | ✅ signed builds |
| Approved clinical content corpus | 🔴 synthetic | ✅ real, governed | ✅ |
| High availability (HA Postgres, replicas, HPA, Ingress+TLS) | ➖ | 🟡 | ✅ required |
| Observability (logs/metrics/traces/alerts) | 🟡 structured JSON logs + liveness/readiness | 🟡 | ✅ required |
| Compliance (CBAHI/HIPAA, pen-test, DPIA, BAA) | ➖ | 🟡 in progress | ✅ signed off |
| DR / backup / restore runbook | ➖ | 🟡 | ✅ required |

Legend: ✅ done · 🟡 partial · 🔴 missing/blocker · ➖ not started

## Fastest path to LAUNCH (pilot demo) — DONE

- [x] Security headers (helmet)
- [x] Rate limiting incl. strict `/auth/*`
- [x] CORS allowlist
- [x] Production secret fail-fast
- [x] Global exception filter (no detail leakage) — verified live: it caught
      and safely wrapped a real 500 during this session's testing.
- [x] Refresh-token revocation + `/auth/logout`
- [x] Account lockout + self-service password reset
- [x] CI pipeline (API build+test+migrate, web build, mobile typecheck)
- [x] Dependency vulnerability remediation: critical CVE-2025-29927 (Next.js
      middleware auth bypass) patched; multer and lodash CVEs closed via a
      corrected pin + npm `overrides` (verified live: file upload still works
      end-to-end on the upgraded multer). SCA gate added to CI.
- [x] Scientific-committee answer review UI (`/answer-review`) — backend
      previously had `POST /chat/answers/:id/review` with no way to discover
      *which* answers needed review; added `GET /chat/answers` (reviewer-only,
      cross-user) plus the web screen. Verified live end-to-end incl. RBAC
      (nurse gets 403 on both endpoints; pharmacist can list and decide).
- [x] Security & readiness documentation

## Fastest path to FULLY FUNCTIONAL (real clinical use)

1. ~~**Wire a real LLM/embeddings provider**~~ — ✅ turn-key: set
   `LLM_PROVIDER=openai`, `EMBEDDING_PROVIDER=openai`, `OPENAI_API_KEY`,
   restart, then `POST /rag/reindex`. Chunks are provider-stamped and
   retrieval filters on the active provider, so a switch refuses safely until
   the corpus is re-embedded; provider calls have timeouts + retry.
   Remaining: supply the actual API key and run an answer-quality eval
   against a gold set of nurse questions.
2. **Ingest the real approved corpus** — upload actual hospital PDFs and run
   them through the governed `DRAFT → … → ACTIVE` workflow with real reviewers.
3. ~~**Mobile build config**~~ — ✅ `apps/mobile/eas.json` (development /
   preview / production profiles with per-profile `EXPO_PUBLIC_API_URL`) and
   iOS/Android identifiers are in place. Remaining: `eas login && eas init`
   with your Expo account, then `eas build`; production signing needs
   Apple/Google developer credentials.
4. **Email delivery** — ✅ code complete, ⚙️ needs operator config. A
   pluggable `MailService` (`MAIL_PROVIDER=log|smtp`) mirrors the LLM and
   embedding provider pattern. `forgotPassword()` now emails the reset link,
   and expiry notifications additionally reach knowledge managers by mail.
   The default `log` provider only writes messages to the application log, so
   **set `MAIL_PROVIDER=smtp` + `MAIL_HOST` before onboarding real users** —
   production boots either way (mail is a degraded feature, not a security
   hole) but logs a warning while log-only. Reset links resolve against
   `APP_BASE_URL`, which falls back to the first `CORS_ORIGINS` entry.
   Remaining: point it at the hospital's real relay and confirm deliverability
   (SPF/DKIM on the `MAIL_FROM` domain). The message is English-only, which is
   worth revisiting for Arabic-speaking nursing staff.

## Fastest path to PRODUCTION

1. **Framework major-version migration** — as of the August 2026 audit the
   count is **14 findings (5 high, 9 moderate, 0 critical)**, not the 12 below;
   the highs are in `next`, `js-yaml`, `nanoid`, `postcss` and
   `brace-expansion`, and all five pass CI because the gate only hard-fails on
   critical. Verify which are genuinely major-gated before deferring them all.
   Historical note — 12 remaining npm audit findings (1
   high: residual Next.js 14 DoS/XSS/SSRF advisories only fixed in Next 15.5+;
   11 moderate: NestJS 10→11 transitive advisories in `express`/`body-parser`/
   `qs`/`uuid`) are only closeable by upgrading **Next.js 14→15** and
   **NestJS 10→11**. Both are semver-major with real breaking-change surface
   (Next: async `params`/`searchParams`, middleware changes; NestJS 11: Node
   version floor, module resolution changes) — this needs a dedicated
   migration + regression-test pass, not an autonomous dependency bump.
   Tracked in CI as a non-blocking `npm audit --audit-level=high` report.
2. **HA infrastructure** — managed PostgreSQL 16 with `vector`, object store
   with SSE/KMS, API replicas behind an Ingress with TLS + HPA; move the
   near-expiry cron to a singleton Job.
3. **Observability** — logs are structured JSON already (nothing to change in
   the app); still needed: ship those lines to a store, metrics + dashboards,
   error tracking, on-call alerting on refusal-rate spikes and 5xx.
4. **Security sign-off** — external penetration test, centralised secret
   management, DPIA.
5. **Compliance** — CBAHI/HIPAA controls mapping, BAAs with any external AI
   vendor, data-retention and audit-export policies.
6. **Resilience** — automated backups, tested restore runbook, load test to
   target concurrency, blue/green or rolling deploy strategy.

## Path to Production — Operator Runbook

Everything above is prose spread across three audit passes. This table is
the single checklist: every item still standing between this codebase and a
real clinical deployment, who owns closing it, and why it can't be closed by
more autonomous engineering work in this repository. "Hospital operator"
means your organization — a credential, a decision, or a real-world process
this session has no access to and, in several rows, should not have access
to (a pen test on your own infrastructure without authorization is not
something an AI agent should ever run itself).

| Item | Owner | Why it can't be automated here |
| --- | --- | --- |
| Real approved clinical corpus | Hospital operator (knowledge managers + pharmacist/quality reviewers) | Requires real hospital policy PDFs and real clinical sign-off through the governed `DRAFT → … → ACTIVE` workflow — the seeded corpus is synthetic by design. |
| Real SMTP relay + SPF/DKIM | Hospital operator (IT) | `MAIL_PROVIDER=smtp` is code-complete; needs a real mail domain, relay credentials, and DNS records this repo has no access to. |
| Cloud / Kubernetes provisioning | Hospital operator (infra/cloud team) | 🟡 Partially resolved — a real single-region, single-replica Railway deployment exists (`infra/railway/README.md`) with real Postgres+pgvector and object storage. `infra/k8s/` manifests remain references, not applied — needed for the HA/multi-replica target this row originally meant. |
| Container registry + CI image push | Hospital operator (platform team) | CI builds both images (the smoke job) but pushes to no registry — no registry credentials exist in this repo. |
| Centralised secret management (Vault/KMS/SealedSecrets) | Hospital operator (platform team) | `secrets.example.yaml` is plaintext-in-base64 by design; wiring a real secret manager needs your cloud account. |
| Log/metrics/tracing backend | Hospital operator (platform team) | Application logs are structured JSON already (this session's work) — shipping them to a store, plus Prometheus/OTel/Sentry, needs a provisioned backend. |
| External penetration test | Hospital operator (security team) | Authorized security testing against your live deployment is not something to run against a repository in the abstract — needs your infrastructure and your authorization. |
| CBAHI/HIPAA compliance sign-off, DPIA, vendor BAAs | Hospital operator (compliance/legal) | Regulatory sign-off is a human institutional process, not a code change. |
| Apple/Google developer accounts | Hospital operator | Required for `eas build`/`eas submit` to produce signed, store-distributable mobile builds. |
| Load testing against target concurrency | Hospital operator (platform team) | Needs a real, provisioned environment to load-test against — a laptop/CI run cannot represent production traffic. |
| Backup + tested restore drill | Hospital operator (platform team) | Requires a real database instance and a rehearsed recovery process; nothing here has ever backed anything up. |
| NestJS 10→11 / Next.js 14→15 major-version migration | Engineering (this codebase) | Not an operator item — semver-major breaking-change surface (Next: async `params`/`searchParams`; NestJS 11: Node floor, module resolution) needs a dedicated migration + regression pass, tracked as a non-blocking CI report in the meantime. |
| ~~MFA enrollment endpoint~~ | ~~Engineering~~ | ✅ **Done** — `/auth/mfa/{enroll,enable,disable}` ship a two-step self-service flow (secret is not armed until a live code verifies it; disabling requires the password). Remaining gap is policy, not plumbing: no way for an admin to *require* MFA for a role. |
| OCR for scanned PDFs | Engineering (this codebase) | `pdf-parse` reads the text layer only; a scanned Arabic PDF indexes zero chunks. Code work. |

## Effort estimate

| Milestone | Estimate |
| --- | --- |
| Pilot demo (this iteration) | Delivered |
| Fully functional | ~1–2 sprints |
| Production sign-off | ~1 quarter (gated by compliance + pen-test) |
