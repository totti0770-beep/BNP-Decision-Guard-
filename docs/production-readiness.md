# Production Readiness — BNP Decision Guard

A CTO-level assessment of what exists today and what remains for pilot and
production. Use this as the launch checklist.

> **Audit update (Aug 2026).** A full re-audit (API, web, mobile, live
> Railway deployment) confirmed this scorecard and closed several rows:
> server-side logout on web **and** mobile, upload refresh-on-401,
> password-reset UI, `SEED_PASSWORD_<ROLE>` overrides, document-list
> pagination, mobile secure token storage + refresh + MFA step, and a
> reindex button in Settings (`documents:index`). Still open, in impact
> order: **email delivery** (password reset is dead in production without
> it), **OCR for scanned PDFs** (pdf-parse reads the text layer only — a
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
> Still open, in impact order: **email delivery** (reset is unusable without
> it), **MFA enrollment** (no endpoint writes `mfa_secret`), **observability**,
> **integration/E2E tests** (none exist; no linter either), **backup + tested
> restore**, **OCR for scanned PDFs**, the **Next 15 / NestJS 11 majors**, and
> **compliance sign-off**. The web UI is English-only while mobile is
> Arabic-first — revisit before a nurse-facing pilot.

## Readiness scorecard

| Dimension | MVP | Pilot | Production |
| --- | --- | --- | --- |
| Core features (RAG, RBAC, audit, dose, workflow) | ✅ | ✅ | ✅ |
| Security hardening (headers, rate limit, CORS, secret fail-fast, token revocation, account lockout, password reset) | ✅ | ✅ | 🟡 (add secret mgr, email delivery) |
| Dependency vulnerability posture | ✅ 0 critical | 🟡 5 high pass CI | 🟡 (14 findings: 5 high, 9 moderate — see below) |
| CI (build + test + migrate + SCA gate on every push/PR) | ✅ | ✅ | ✅ |
| Scientific-committee answer review UI | ✅ | ✅ | ✅ |
| Real semantic AI (provider-stamped index, reindex endpoint, timeouts) | ✅ turn-key | ✅ (key + eval) | ✅ |
| Mobile store-build config (EAS profiles, bundle ids) | ✅ | 🟡 (needs Expo/store accounts) | ✅ signed builds |
| Approved clinical content corpus | 🔴 synthetic | ✅ real, governed | ✅ |
| High availability (HA Postgres, replicas, HPA, Ingress+TLS) | ➖ | 🟡 | ✅ required |
| Observability (logs/metrics/traces/alerts) | ➖ | 🟡 | ✅ required |
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
4. **Email delivery for password reset** — wire an email provider in
   `forgotPassword()` (currently returns the token directly outside production
   for demo purposes).

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
3. **Observability** — structured JSON logs shipped to a store, metrics +
   dashboards, error tracking, on-call alerting on refusal-rate spikes and 5xx.
4. **Security sign-off** — external penetration test, centralised secret
   management, DPIA.
5. **Compliance** — CBAHI/HIPAA controls mapping, BAAs with any external AI
   vendor, data-retention and audit-export policies.
6. **Resilience** — automated backups, tested restore runbook, load test to
   target concurrency, blue/green or rolling deploy strategy.

## Effort estimate

| Milestone | Estimate |
| --- | --- |
| Pilot demo (this iteration) | Delivered |
| Fully functional | ~1–2 sprints |
| Production sign-off | ~1 quarter (gated by compliance + pen-test) |
