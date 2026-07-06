# Production Readiness — BNP Decision Guard

A CTO-level assessment of what exists today and what remains for pilot and
production. Use this as the launch checklist.

## Readiness scorecard

| Dimension | MVP | Pilot | Production |
| --- | --- | --- | --- |
| Core features (RAG, RBAC, audit, dose, workflow) | ✅ | ✅ | ✅ |
| Security hardening (headers, rate limit, CORS, secret fail-fast, token revocation, account lockout, password reset) | ✅ | ✅ | 🟡 (add secret mgr, email delivery) |
| Dependency vulnerability posture (0 critical, 0 unpatchable high) | ✅ | ✅ | 🟡 (12 findings gated on a NestJS 11 / Next.js 15 migration — see below) |
| CI (build + test + migrate + SCA gate on every push/PR) | ✅ | ✅ | ✅ |
| Scientific-committee answer review UI | ✅ | ✅ | ✅ |
| Real semantic AI (OpenAI-compatible provider) | 🟡 config-gated | ✅ (key + eval) | ✅ |
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

1. **Wire a real LLM/embeddings provider** — set `LLM_PROVIDER=openai`,
   `EMBEDDING_PROVIDER=openai`, `OPENAI_API_KEY`. Re-index documents so
   embeddings are regenerated at the provider's dimension. Run an answer-quality
   eval against a gold set of nurse questions.
2. **Ingest the real approved corpus** — upload actual hospital PDFs and run
   them through the governed `DRAFT → … → ACTIVE` workflow with real reviewers.
3. **Mobile build** — add `eas.json`, produce signed Android/iOS builds, point
   `EXPO_PUBLIC_API_URL` at the deployed API. Requires an Apple/Google
   developer account and signing credentials this session does not have.
4. **Email delivery for password reset** — wire an email provider in
   `forgotPassword()` (currently returns the token directly outside production
   for demo purposes).

## Fastest path to PRODUCTION

1. **Framework major-version migration** — 12 remaining npm audit findings (1
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
