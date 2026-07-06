# Production Readiness — BNP Decision Guard

A CTO-level assessment of what exists today and what remains for pilot and
production. Use this as the launch checklist.

## Readiness scorecard

| Dimension | MVP | Pilot | Production |
| --- | --- | --- | --- |
| Core features (RAG, RBAC, audit, dose, workflow) | ✅ | ✅ | ✅ |
| Security hardening (headers, rate limit, CORS, secret fail-fast, token revocation) | ✅ | ✅ | 🟡 (add lockout, secret mgr) |
| CI (build + test + migrate on every push/PR) | ✅ | ✅ | 🟡 (add SCA/vuln scan) |
| Real semantic AI (OpenAI-compatible provider) | 🟡 config-gated | ✅ (key + eval) | ✅ |
| Approved clinical content corpus | 🔴 synthetic | ✅ real, governed | ✅ |
| High availability (HA Postgres, replicas, HPA, Ingress+TLS) | ➖ | 🟡 | ✅ required |
| Observability (logs/metrics/traces/alerts) | ➖ | 🟡 | ✅ required |
| Compliance (CBAHI/HIPAA, pen-test, DPIA, BAA) | ➖ | 🟡 in progress | ✅ signed off |
| DR / backup / restore runbook | ➖ | 🟡 | ✅ required |

Legend: ✅ done · 🟡 partial · 🔴 missing/blocker · ➖ not started

## Fastest path to LAUNCH (pilot demo) — DONE this iteration

- [x] Security headers (helmet)
- [x] Rate limiting incl. strict `/auth/*`
- [x] CORS allowlist
- [x] Production secret fail-fast
- [x] Global exception filter (no detail leakage)
- [x] Refresh-token revocation + `/auth/logout`
- [x] CI pipeline (API build+test+migrate, web build, mobile typecheck)
- [x] Security & readiness documentation

## Fastest path to FULLY FUNCTIONAL (real clinical use)

1. **Wire a real LLM/embeddings provider** — set `LLM_PROVIDER=openai`,
   `EMBEDDING_PROVIDER=openai`, `OPENAI_API_KEY`. Re-index documents so
   embeddings are regenerated at the provider's dimension. Run an answer-quality
   eval against a gold set of nurse questions.
2. **Ingest the real approved corpus** — upload actual hospital PDFs and run
   them through the governed `DRAFT → … → ACTIVE` workflow with real reviewers.
3. **Account lockout + password reset** — add failed-attempt lockout and a
   self-service reset flow (both build on the existing `token_version`).
4. **Mobile build** — add `eas.json`, produce signed Android/iOS builds, point
   `EXPO_PUBLIC_API_URL` at the deployed API.
5. **Scientific committee review UI** — surface the existing
   `POST /chat/answers/:id/review` endpoint in the web app for answer QA.

## Fastest path to PRODUCTION

1. **HA infrastructure** — managed PostgreSQL 16 with `vector`, object store
   with SSE/KMS, API replicas behind an Ingress with TLS + HPA; move the
   near-expiry cron to a singleton Job.
2. **Observability** — structured JSON logs shipped to a store, metrics +
   dashboards, error tracking, on-call alerting on refusal-rate spikes and 5xx.
3. **Security sign-off** — external penetration test, dependency/SCA scanning
   in CI, centralised secret management, DPIA.
4. **Compliance** — CBAHI/HIPAA controls mapping, BAAs with any external AI
   vendor, data-retention and audit-export policies.
5. **Resilience** — automated backups, tested restore runbook, load test to
   target concurrency, blue/green or rolling deploy strategy.

## Effort estimate

| Milestone | Estimate |
| --- | --- |
| Pilot demo (this iteration) | Delivered |
| Fully functional | ~1–2 sprints |
| Production sign-off | ~1 quarter (gated by compliance + pen-test) |
