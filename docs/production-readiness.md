# Production Readiness — BNP Decision Guard

A CTO-level assessment of what exists today and what remains for pilot and
production. Use this as the launch checklist.

> **How to read this file.** Below the scorecard it is an append-only log of
> dated audit notes, newest last. An older note describes what was true *on its
> date*, not what is true now — that is the point of keeping them, and it is why
> a stale claim is struck through with a pointer to the note that superseded it
> rather than quietly rewritten. Rewriting an old note would destroy the record
> this file exists to be. **Where two notes disagree, the later one wins.**

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
> tested restore**, ~~the **Next 15 / NestJS 11 majors**~~, and **compliance
> sign-off**. ~~The web UI is English-only while mobile is Arabic-first —
> a deliberate inversion to revisit before a nurse-facing pilot.~~
>
> *Superseded: both majors shipped (see the NestJS 11 and Next.js 16 notes
> below), and the web UI became bilingual EN/AR (see the Phase 10 note).*

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
> restore**, **OCR for scanned PDFs**, ~~the **Next 15 / NestJS 11 majors**~~, and
> **compliance sign-off**. ~~The web UI is English-only while mobile is
> Arabic-first — revisit before a nurse-facing pilot.~~
>
> *Superseded: both majors shipped, and the web UI is bilingual — see the
> Phase 10, NestJS 11 and Next.js 16 notes below.*

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
> Sentry), ~~**MFA enrollment**~~, **backup + tested restore**, **OCR for scanned
> PDFs**, ~~the **Next 15 / NestJS 11 majors**~~, and **compliance sign-off**.
>
> *Superseded: MFA enrolment shipped (`/auth/mfa/{enroll,enable,disable}` plus
> the `/security` screen), and both majors shipped — see the notes below.*

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
> ~~13~~ protected screens (15 as of Sep 2026 — `/security` and
> `/notifications` were added later and are bilingual too), the shell and both
> auth screens are now bilingual
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

> **Cycle 3, Phases 11–12 (Aug 2026).** Testing expansion and a security
> re-review of everything phases 8–11 changed.
>
> - **Mobile had no runtime tests at all** — CI ran `tsc --noEmit` and nothing
>   else, over a module that decides where auth tokens are stored. 32 tests now
>   pin tokens reaching the OS keychain and never plaintext storage, the
>   pre-SecureStore session purge, a 401 refreshing exactly once without
>   looping, teardown on failed refresh, and the RTL helpers. Each assertion
>   was checked against a deliberately broken copy of the module. The mobile
>   **screens** still have no runtime coverage; that needs `jest-expo` plus
>   `@testing-library/react-native`.
> - **The browser smoke** gained search/filtering, the full user lifecycle
>   (validation gate → create → duplicate rejection → deactivate), audit
>   filtering, and a rejected sign-in. Role-visibility checks are now asserted
>   in both directions, so a locator that silently matched nothing can no
>   longer make them pass vacuously.
> - **Two real defects fell out of that coverage.** `AllExceptionsFilter`
>   emitted the client-safe reason under `error` only while every client reads
>   `message`, so *every* rejection reached a web user as "Request failed
>   (400)" with the reason discarded. And `IndexingService` embedded a whole
>   PDF in one `/embeddings` call, so ingestion got more likely to fail the
>   larger the document — one confirmed cause of the indexing incident noted
>   above. Both fixed, both pinned by tests that fail when reverted.
> - **Security re-review.** MFA enrol/enable/disable are authenticated,
>   throttled like the credential endpoints, act only on the caller's own JWT
>   id, and never expose the secret in a user DTO. Upstream provider error
>   bodies are now redacted before logging. `apps/mobile`'s dependency tree,
>   previously unscanned because it is not an npm workspace, is now reported
>   in CI (non-blocking — every finding is Expo/RN toolchain, build-time, and
>   needs an Expo major).

> **Cycle 4, Expo SDK 57 (Aug 2026).** The mobile app is on Expo SDK 57 /
> React Native 0.86.2 / React 19.2.3 — a single hop across six SDK majors,
> justified because the app has no config plugins, no custom metro config,
> and only three native modules; the one genuinely breaking transition
> (React 19 + New Architecture + mandatory Android edge-to-edge) lands
> regardless of path. Its audit went from 1 critical / 21 high / 11 moderate
> to **8 high and nothing else**, and the mobile CI job now hard-fails on
> critical like the root job. The remaining 8 all chain from one advisory
> pair on `image-size`, vulnerable at *every published version* (`<=2.0.2`
> == latest) — no dependency graph anywhere can clear it today; it sits in
> Metro's build-time asset pipeline and this app ships zero image assets.
> Changes beyond versions: core `SafeAreaView` (deprecated, iOS-only) →
> `react-native-safe-area-context` with a root `SafeAreaProvider`; dead
> `expo-status-bar` dependency dropped; `babel-preset-expo` declared as the
> direct devDependency it factually is (npm nests it under `expo/` at SDK
> 57, where Babel's root-relative resolution cannot find it); `uuid`
> override to ^11.1.1 for the `xcode` prebuild path. Verified without a
> device: typecheck on TS 5.9/React 19 types, 32/32 tests with unchanged
> mocks (both storage-mock surfaces re-checked against async-storage 2.2.0
> and expo-secure-store 57.0.1), and `npx expo export` producing Hermes
> bundles for both platforms — the strongest headless proof the bundle
> graph resolves under the New Architecture. **On-device visual checks
> under mandatory edge-to-edge are operator-owned** (listed in PR #32):
> LoginScreen keyboard behavior, ChatScreen composer vs nav bar, BottomNav
> clearance above the gesture bar, first-launch session restore.
>
> Still open and genuinely operator-owned: metrics/tracing/alerting, backup +
> tested restore, OCR for scanned PDFs, the Next.js 16 major, an org-wide
> "require MFA" policy, and compliance sign-off.

> **Cycle 3, NestJS 11 (Aug 2026).** The API now runs on NestJS 11 and Express
> 5, which closes **all 9** remaining moderate advisories — the audit is down
> to 2 high (`next` + bundled `postcss`), both gated on the Next.js 14→16 major
> that remains open. Verified against the whole regression net, not just a
> build: 135 unit tests, 34 integration tests over real HTTP through the real
> `AppModule` against real Postgres+pgvector, migrations, and the 13-step
> browser smoke driving a natively booted stack.
>
> Two things the upgrade forced, both improvements rather than shims:
>
> - `@nestjs/throttler` installs its Nest peers rather than relying on the
>   hoisted copy, which left Nest 10 and 11 resolved side by side and produced
>   a `DynamicModule is not assignable to DynamicModule` error naming the same
>   type twice. Pinned with an `overrides` entry alongside the existing
>   `multer`/`lodash` ones; the lockfile was regenerated so the stale subtree
>   could not survive the change.
> - jsonwebtoken 9's types narrow `expiresIn` to a template-literal union that
>   a value read from `process.env` can never satisfy. Rather than casting at
>   the call site, `config/env.ts` now validates the format and the two token
>   lifetimes flow from `loadEnv()` like every other setting — so
>   `JWT_EXPIRES_IN="1 hour"` fails at boot naming the variable and the legal
>   forms, instead of throwing inside the first login of the day.

> **Cycle 3, Next.js 16 (Aug 2026).** The web app is on Next.js 16.3.1, which
> closes the last 2 advisories. ~~**The dependency audit is now zero findings at
> every severity.**~~
>
> *Superseded: true on that date, and advisories are published against code
> that has not changed. By Sep 2026 the same tree carried 9 high and 1
> moderate, and `next@16.3.1` itself had become a **critical** (CVSS 9.0,
> GHSA-p293-qw3h-jr36) that failed the CI gate until the bump to `^16.3.3`. A
> zero-findings audit is a reading, never a property.*
>
> This was much smaller than the row below used to claim, and the estimate was
> wrong rather than merely conservative. The feared breaking changes do not
> apply to this codebase: no page receives `params` or `searchParams` as props
> (the only `searchParams` use is the *client* `useSearchParams()` hook, which
> is unchanged), there is no `middleware.ts` at all, and 23 of 25 components
> are `'use client'` — the two server components are layouts taking only
> `children`. The whole diff is a version bump plus three `tsconfig.json`
> lines Next 16 mandates.
>
> **React stays on 18 deliberately.** Next 16 supports 18 or 19, this app uses
> no Server Actions and no React 19-only APIs, and React 19 closes no
> advisory — so its migration surface (ref typing, `useRef` initial argument)
> was not worth taking on inside a security-motivated change. It is available
> as a routine follow-up whenever it is wanted.
>
> Verified the same way as the Nest upgrade: every route still reports
> `○ (Static)` in the build output — the property the no-locale-routing i18n
> decision depends on — and the 13-step browser smoke passes against a
> confirmed `next-server (v16.3.1)`. That confirmation mattered: a stale Next
> 14 server was still holding port 3000 and answering 200, so the first
> "passing" run was against the old build.
>
> CI now runs Node 22, matching the runtime container image. It was on 20
> while both Dockerfiles used `node:22-alpine`, so CI had never actually
> exercised the Node major that production runs.

> **Audit update (Sep 2026) — an independent evaluation set exists; clinical
> validation is still a blocker.** The evaluation harness was circular: the gold
> set's questions were authored from the four seeded demo documents they
> retrieve from (`answer-quality.e2e-spec.ts` imported `SAMPLE_DOCS`), so it
> could detect a retrieval regression and could not measure anything. A second
> set now sits beside it — cases in `apps/api/eval/*.jsonl`, editable without
> touching code, with a loader that **rejects** any field naming an expected
> document or an expected answer, and a unit test that fails the build if the
> module reaches for the seeded corpus again.
>
> Two runners share one scoring core: the e2e spec gates five invariants that
> hold on any corpus, and `npm run eval:field` runs the same cases against a
> live deployment over HTTP as a `NURSE_USER`, writing nothing to it. The output
> is the `docs/clinical-validation.md` §5.2 sheet with the machine columns
> filled and the four clinical judgement columns blank.
>
> **This does not move the clinical-validation row, and must not be read as
> moving it.** The row below stays 🔴. What existed before was a protocol on
> paper and no instrument; what exists now is the instrument, the paperwork it
> generates, and a set of placeholder questions an engineer wrote, labelled as
> such in every report. The blocker clears when a qualified reviewer fills the
> four columns on questions ward staff actually asked — and nothing engineering
> can build substitutes for that.
>
> One finding worth recording from the first run: under the mock embedding
> provider on the demo corpus, Arabic paraphrases of English questions
> frequently reach a different verdict than the English original. That is the
> expected behaviour of a bag-of-words stand-in rather than a defect in the
> platform, and it is exactly the gap §5.1 names — it is recorded here because
> the instrument now *shows* it instead of the documentation merely warning
> about it. It says nothing about a real embedding provider, which is the
> configuration a pilot would run.

> **Audit update (Sep 2026) — scorecard resync.** A file-by-file audit
> (`docs/audit/`) read this document against the code and found the *dated
> notes* sound and the *scorecard* stale. That distinction is this file's own:
> an old note is a record of its date and is left alone, but the scorecard and
> the two "fastest path" sections are statements about now, and three of their
> rows had drifted.
>
> - **Dependency posture** said `14 findings: 5 high, 9 moderate`. `npm audit`
>   on this commit reports **9 findings: 8 high, 1 moderate, 0 critical** — the
>   NestJS 12 chain plus `multer`, `js-yaml` and `qs`. `SECURITY.md`'s
>   dependency-scanning row carries the triage.
> - **Test counts** said `211 unit + 68 e2e`. `npm test` on this commit reports
>   **412 unit** across 28 suites.
> - **"Fastest path to PRODUCTION" item 1** still opened with "as of the August
>   2026 audit the count is **0 findings of any severity**", which the Next.js
>   16 note above had already superseded in the notes — but the superseding
>   note lives in the log, and the claim it supersedes was sitting in the
>   forward-looking section someone reads to plan the work.
>
> - **The corpus row contradicted the runbook.** The scorecard marked
>   *Approved clinical content corpus* ✅ "real, governed" for Pilot, while the
>   operator runbook lists *Real approved clinical corpus* as an item still
>   standing, and the clinical-validation row two lines above is 🔴 blocker for
>   the same column. 725 chunks being *indexed* is not the same claim as their
>   being approved through the governed workflow, and no one has audited their
>   provenance — `GET /documents/inventory` would, and has not been run.
>
> The 725-chunk figure in the go-live table below is left as it stands: it is a
> sourced reading from 2026-08-22. It is no longer the current number. The
> deployment of `a3e4f21` on 2026-09-14 booted with
> `chunks=2706 staleRetrievable=0 staleOrphaned=0` — the corpus has almost
> quadrupled since go-live, and the index is still coherent. Which documents
> those chunks belong to, and whether each passed the governed workflow, is
> what `GET /documents/inventory` reports and what nobody has yet pulled.

> **Audit update (Sep 2026) — all dependency advisories closed, no framework
> major.** The scorecard row and the item below both said the remaining highs
> were gated on a NestJS 12 major. Neither was right. `npm audit --json` marks a
> package vulnerable when a *dependency* of it is, and six of the seven packages
> in that "NestJS 12 chain" had no advisory of their own — they all traced to
> `multer`.
>
> | Package | Was | Now | How |
> | --- | --- | --- | --- |
> | `multer` (+ 6 inherited `@nestjs/*` markers) | 2.2.0 | **2.4.0** | root `overrides` bumped `^2.2.0` → `^2.3.0`; `platform-express` pins it exactly, so an override is genuinely needed here |
> | `js-yaml` (ESLint path) | 4.3.1 | **4.3.2** | already inside `@eslint/eslintrc`'s `^4.3.0` |
> | `js-yaml` (jest coverage path) | 3.15.1 | **3.15.2** | already inside `@istanbuljs/load-nyc-config`'s `^3.13.1` |
> | `qs` (Express body-parser) | 6.15.3 | **6.16.0** | already inside `express`'s `^6.14.0` |
>
> Three of the four needed no override at all — they were held below floors their
> own parents already allowed, by a stale lockfile. That is the failure mode
> `CLAUDE.md` documents from the `next` upgrade, and it had been costing this
> project three closable advisories since August. `npm audit` now reports
> `{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}`, with
> resolved versions verified on disk after `npm ci` — including both `js-yaml`
> copies, since the nested one is invisible to an ordinary `require.resolve`.

## Readiness scorecard

| Dimension | MVP | Pilot | Production |
| --- | --- | --- | --- |
| Core features (RAG, RBAC, audit, dose, workflow) | ✅ | ✅ | ✅ |
| Security hardening (headers, rate limit, CORS, secret fail-fast, token revocation, account lockout, password reset) | ✅ | ✅ | 🟡 (add secret mgr; set `MAIL_PROVIDER=smtp`) |
| Demo credentials neutralised in production | ✅ | ✅ | ✅ **verified live** — 7 accounts disabled on the 2026-08-22 deploy with matching audit rows |
| Single validated secret-resolution path (`loadEnv()`) | ✅ | ✅ | ✅ |
| Index integrity (advisory lock + UNIQUE constraint, real column-width check) | ✅ | ✅ | ✅ `staleRetrievable=0` on **2,706** chunks — re-measured 2026-09-14 from the post-merge boot log (was 725 at go-live) |
| **Clinical validation of answers** | 🔴 | 🔴 **blocker** | 🔴 — protocol in `docs/clinical-validation.md`, awaiting reviewer |
| Dependency vulnerability posture | ✅ | ✅ | ✅ **0 findings at every severity** — `npm audit` on this commit. The 8 high / 1 moderate this row carried were closed without a framework major; see the Sep 2026 note above and `SECURITY.md` |
| CI (build + test + migrate + SCA gate on every push/PR) | ✅ | ✅ | ✅ |
| Integration/E2E tests (real HTTP + Postgres, browser smoke) | ✅ 439 API unit + 257 integration against real Postgres+pgvector + 24 web unit (both measured on this commit) + the browser flow, all gate CI | ✅ | ✅ |
| Scientific-committee answer review UI | ✅ | ✅ | ✅ |
| Real semantic AI (provider-stamped index, reindex endpoint, timeouts) | ✅ turn-key | ✅ (key + eval) | ✅ |
| Mobile store-build config (EAS profiles, bundle ids) | ✅ | 🟡 (needs Expo/store accounts) | ✅ signed builds |
| Approved clinical content corpus | 🔴 synthetic | 🟡 **2,706** chunks **indexed** in production (`chunks=2706`, boot log of deployment `f750d589`, 2026-09-14; the go-live table below records 725 on 2026-08-22); whether they were approved through the governed workflow is unaudited — see the runbook row *Real approved clinical corpus* | ✅ |
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

## Go-live executed — 2026-08-22

The production deployment was taken through a full security remediation and
go-live on 2026-08-22. Each step below is recorded against the evidence that
established it, from the Railway deploy log or the HTTP request log — not from
assertion.

| Step | Evidence |
| --- | --- |
| Merge + deploy | `15a95e3`; Railway deploy SUCCESS |
| Administrator provisioned at boot | `Reset admin@bnp.health: password changed, account reactivated, SUPER_ADMIN attached…` |
| Demo credentials neutralised | 7 × `Disabled "<email>"` + `SECURITY:DEMO_ACCOUNT_DISABLED` audit rows |
| Administrator authenticates | `POST /auth/login → 201`, followed by permission-gated `GET /analytics/overview → 200` and `GET /settings → 200` |
| Index integrity | `Embedding index: provider="openai-embedding" chunks=725 staleRetrievable=0 staleOrphaned=0 columnDimensions=384` |
| Real accounts provisioned | 2 × `POST /users → 201` |
| Break-glass variables removed | `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` absent from the service; subsequent boot correctly skips `create-admin` |

**Confirmed by that deploy:** all seven seeded accounts — `superadmin@bnp.health`
among them — were still carrying passwords published in `README.md` in the live
database. The sweep's own bcrypt comparisons established this; it was not an
inference. They are now disabled with their refresh tokens revoked.

**One incident, and its fix.** The first deploy's `ADMIN_PASSWORD` was 9
characters. `create-admin` correctly refused it, but the failure was non-fatal,
so the API booted anyway and the sweep disabled all seven accounts — zero active
users, from a typo in a variable. Recovery took one corrected variable and one
redeploy. A `create-admin` failure is now fatal to container start, so
provisioning and sweeping succeed or fail together (see `SECURITY.md`).

**Remaining blocker: clinical validation.** See `docs/clinical-validation.md`.
No engineering work substitutes for it.

## Fastest path to FULLY FUNCTIONAL (real clinical use)

1. ~~**Wire a real LLM/embeddings provider**~~ — ✅ turn-key: set
   `LLM_PROVIDER=openai`, `EMBEDDING_PROVIDER=openai`, `OPENAI_API_KEY`,
   restart, then `POST /rag/reindex`. Chunks are provider-stamped and
   retrieval filters on the active provider, so a switch refuses safely until
   the corpus is re-embedded; provider calls have timeouts + retry.
   Remaining: supply the actual API key, and run the answer-quality gold set
   against the **real** providers. A gold set now exists
   (`apps/api/test/answer-quality.e2e-spec.ts`, `npm run test:eval`) and runs
   in CI, but under the mock providers — so it measures lexical retrieval over
   four demo documents, and gates that questions route to the document holding
   their answer while out-of-corpus questions refuse. That is a regression net,
   **not** clinical validation: the set a pilot needs is one a nurse educator
   writes from questions staff actually ask, including the ones the corpus
   cannot answer, scored by a clinician. The generated report states this
   plainly so a green run is not mistaken for sign-off.

   **Open incident (partially addressed).** On the live Railway deployment,
   indexing an uploaded document has failed with
   `POST /documents/:id/index → 500` / `AI provider returned 400 for
   /embeddings`. Two things have changed since:

   - `openai-http.ts` now logs the provider's response body, which is the only
     place the actual reason appears. It previously discarded it, so every
     failure looked identical.
   - One concrete cause has been found and fixed: `IndexingService` embeds a
     whole PDF in a single `/embeddings` call, and a long document exceeded the
     provider's per-request limits — an ingestion failure that got *more*
     likely the larger the document, which is the opposite of what an operator
     would guess. Requests are now split (`EMBEDDING_BATCH_SIZE`,
     `EMBEDDING_BATCH_CHARS`).

   Whether that was *the* cause of the observed 400 is **not yet confirmed**:
   no indexing has been attempted on the live deployment since the diagnostic
   logging shipped, so the logs hold no instance of the error. The remaining
   candidates — an invalid or unfunded `OPENAI_API_KEY`, or a project without
   access to the configured embedding model — are operator-owned and settable
   only in the Railway dashboard.

   **Next step for whoever runs the pilot: `POST /rag/provider-check`** (needs
   `documents:index`, so the knowledge-manager or super-admin login). It
   embeds one throwaway string through the identical code path, writes
   nothing, and changes no document state — so unlike indexing a test
   document it does not put anything into the corpus where the assistant
   could cite it. The response names the reason, and the same call reports
   whether the corpus is split across embedding providers, which is the other
   cause of "the assistant refuses everything".

   One limit worth knowing: the probe sends a single short input, so it
   reproduces a 400 from model access, an invalid key, a bad base URL or an
   unsupported `dimensions` value — but *not* one caused purely by request
   size, which is the cause already fixed by request batching. If the probe
   comes back `ok: true` and indexing still fails, size is the remaining
   suspect and the `[OpenAiHttp]` warning from the real attempt is the thing
   to read.
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

1. **Framework major-version migration** — both of the majors this item was
   written for are done: NestJS 10→11 and Next.js 14→16. The item then said the
   remaining highs were gated on a **NestJS 12** major. **That was wrong, and it
   is closed without one.** Six of the seven packages in that "chain" carried no
   advisory of their own; all of them traced to `multer`, fixed in 2.3.0. A
   one-line bump to the root override this repository already had takes the tree
   to **0 findings at every severity** — see the Sep 2026 note above.

   NestJS 12 exists (12.0.2, published 2026-09-14) and remains a sensible
   routine upgrade, but it is no longer a security item and should not be rushed
   on a platform that answers clinical questions. The CI gate still hard-fails on
   critical and reports high/moderate non-blocking, so a newly published advisory
   surfaces without blocking merges — and a count in a document is a reading with
   a date on it, never a property.
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
| ~~NestJS 10→11 / Next.js 14→16 major-version migration~~ | ~~Engineering~~ | ✅ **Done**, both. Together they take the audit to zero findings. The Next jump was far smaller than this row assumed: no page here takes `params`/`searchParams` as props and there is no middleware at all, so the headline breaking changes did not apply. Web stays on React 18 by choice — see the cycle note above. |
| ~~MFA enrollment endpoint~~ | ~~Engineering~~ | ✅ **Done** — `/auth/mfa/{enroll,enable,disable}` ship a two-step self-service flow (secret is not armed until a live code verifies it; disabling requires the password). Remaining gap is policy, not plumbing: no way for an admin to *require* MFA for a role. |
| OCR for scanned PDFs | Engineering (this codebase) | `pdf-parse` reads the text layer only; a scanned Arabic PDF indexes zero chunks. Code work. |

## Effort estimate

| Milestone | Estimate |
| --- | --- |
| Pilot demo (this iteration) | Delivered |
| Fully functional | ~1–2 sprints |
| Production sign-off | ~1 quarter (gated by compliance + pen-test) |
