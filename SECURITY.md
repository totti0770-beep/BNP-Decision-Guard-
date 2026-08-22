# Security Posture — BNP Decision Guard

This document describes the security controls implemented in the platform and
the operational steps required to run it safely. It is written for a healthcare
deployment where governed, source-bound clinical answers and a complete audit
trail are non-negotiable.

## Implemented controls

| Control | Where | Notes |
| --- | --- | --- |
| **Production secret fail-fast** | `apps/api/src/config/env.ts` | The API refuses to boot with `NODE_ENV=production` if any of `JWT_SECRET`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` is missing or left at its shipped default. `S3_ACCESS_KEY` was omitted for a while, which only moved the failure from boot to the first document upload. |
| **Demo credentials neutralised in production** | `auth/demo-account-guard.service.ts`, `seed/seed-policy.ts`, `infra/docker/Dockerfile.api` | The seed refuses to run under `NODE_ENV=production` (in the script *and* in the container start command), and any existing account still using a password published in `README.md` is disabled at boot with its refresh tokens revoked and a `SECURITY:DEMO_ACCOUNT_DISABLED` audit row. Compares against the shipped literal only, so a rotated account is never touched. See *Demo credentials*. |
| **Single secret-resolution path** | `config/env.ts` consumed by `jwt.strategy.ts`, `auth.module.ts`, `auth.service.ts`, `data-source.ts`, `storage.service.ts` | Six call sites previously resolved secrets as `process.env.X ?? '<shipped literal>'`, bypassing the fail-fast. `data-source.ts` was the sharp one: the container runs `dist/scripts/migrate.js` **before** `main.js`, an entrypoint that never called `loadEnv()` — so a deployment missing `POSTGRES_PASSWORD` silently used the demo value. Outside an environment labelled exactly `production` a missing `JWT_SECRET` resolved to a literal published in this repository, making tokens forgeable. |
| **`NODE_ENV` validation** | `config/env.ts` | `isProduction` gates the secret fail-fast, the CORS fail-closed default, 5xx suppression, the reset-token refusal, the seed refusal and the demo-account sweep. An unrecognised value — `Production`, `staging`, a typo — silently selected all of their permissive forms at once. Unset still means development (the documented local default); anything unrecognised now refuses to boot. |
| **Refusal-threshold validation** | `config/env.ts` (`ragMinSimilarity()`) | `RAG_MIN_SIMILARITY` had no validation. `abc` produced `NaN`, every `score >= NaN` is false, and the assistant **refused every question** — indistinguishable from an empty corpus, with nothing logged. A negative value disabled the threshold entirely and let unqualified chunks answer clinical questions. Both failures were silent and failed in opposite directions. Now must be a finite number in `[0, 1]`, checked at boot and on every query. |
| **Security headers** | `helmet` in `apps/api/src/main.ts` | HSTS, `X-Content-Type-Options`, `X-Frame-Options`, COOP/CORP, etc. |
| **Rate limiting** | `@nestjs/throttler`, `app.module.ts` | Global per-IP limit; a stricter limit on all `/auth/*` endpoints (`AUTH_RATE_LIMIT_MAX`) blunts credential brute-force. Verified: 6th rapid login returns HTTP 429. |
| **Per-account lockout** | `users.locked_until` + `auth.service.ts` | After `AUTH_MAX_FAILED_ATTEMPTS` consecutive failed logins the account is locked for `AUTH_LOCKOUT_MINUTES` — blocking even a correct password, so an attacker rotating IPs past the rate limiter is still stopped. Cleared on success or password reset. Verified end-to-end. |
| **Self-service password reset** | `/auth/forgot-password`, `/auth/reset-password`, `mail/mail.service.ts` | Reset token is bound to `token_version` (single-use; voided by logout/prior reset) and expires after `PASSWORD_RESET_TOKEN_MINUTES`. The link is emailed; `forgot-password` never reveals whether an email exists, and delivery failures are swallowed so response timing cannot become an enumeration oracle. Completing a reset rotates the hash, bumps `token_version` (invalidating all sessions) and clears lockout. Verified end-to-end. |
| **CORS allowlist** | `main.ts` + `CORS_ORIGINS` | Explicit origin allowlist; production with an empty list blocks all cross-origin browser calls instead of allowing `*`. |
| **Request body cap** | `express.json({ limit })` | `REQUEST_BODY_LIMIT` caps JSON payloads; PDF uploads go through multipart/multer. |
| **Refresh-token revocation** | `users.token_version` + `auth.service.ts` | `POST /auth/logout` and any password change bump `token_version`, immediately invalidating every outstanding refresh token. Verified end-to-end. |
| **RBAC** | `packages/shared/src/rbac.ts` + `PermissionsGuard` | 7 roles, central permission matrix, enforced globally. The matrix is the only input to authorization — `role_permissions` is a display projection, so the roles API is read-only and a database-only role grants nothing. Nurses/auditors cannot approve or download source PDFs. |
| **No public self-registration** | `auth.controller.ts` | Accounts are provisioned by an administrator via `POST /users`. The former public `POST /auth/register` handed any caller a `NURSE_USER` account with `ai:ask`, `ai:search`, `documents:read` and `dose:calculate` over the approved corpus. |
| **Reset token never disclosed** | `auth.service.ts` | `POST /auth/forgot-password` returns `{requested: true}` and nothing else; the token reaches the user only by email. Disclosure requires an explicit `AUTH_DEV_RETURN_RESET_TOKEN=true` opt-in that is additionally refused in production. It previously keyed off `NODE_ENV !== 'production'`, which failed open wherever `NODE_ENV` was unset. |
| **Email delivery** | `mail/mail.service.ts`, `MAIL_PROVIDER` | Reset links are emailed. `log` (default) writes them to the application log; `smtp` delivers via nodemailer and requires `MAIL_HOST`. Production boots either way and warns while log-only — mail is a degraded feature, and taking the clinical assistant offline over it would be the worse failure. |
| **Enumeration-safe delivery** | `auth.service.ts` | `sendQuietly()` swallows relay failures so the response *status* is identical whether or not the account exists, and the send is **not awaited**, so the response *timing* is identical too — an awaited SMTP round trip only happens for accounts that exist, which is an oracle in itself. |
| **Upload content validation** | `documents.service.ts` | Uploads must carry a real `%PDF-` signature, not merely a PDF `Content-Type` header, which the client controls. |
| **Refusal-first AI** | `apps/api/src/rag/*` | Retrieval hard-filtered to `ACTIVE`, non-expired documents; sub-threshold matches refuse with the exact governed message; the mock LLM is extractive and cannot generate beyond context. |
| **Uniform error envelope** | `AllExceptionsFilter` | 5xx internals are never leaked to clients in production; full errors are logged and audited. The client-safe reason is carried under both `message` and `error` — clients read `message`, and emitting only `error` meant every rejection reached users as "Request failed (400)" with the reason discarded. |
| **Secret redaction in provider logs** | `rag/openai-http.ts` | The upstream error body is logged to diagnose a rejected AI request, with key-shaped substrings (`sk-…`, `Bearer …`, `api_key=…`) stripped first. `OPENAI_BASE_URL` may point at a self-hosted OpenAI-compatible endpoint whose error handler reflects request headers back. Patterns are pinned by tests on both sides: they redact the credential and leave real provider messages intact. |
| **Full audit trail** | global `AuditInterceptor` + `AuditService` | Every login, question, answer (incl. refusals), document action, dose calculation, permission change and error is recorded with actor, IP and metadata. |
| **MFA (TOTP)** | `otplib`, `/auth/mfa/{enroll,enable,disable,verify}` | Self-service two-step enrolment: `enroll` mints a secret without arming it, `enable` arms it only after verifying a live code, `disable` requires the account password. Login then issues a half-authenticated token exchangeable only at `/auth/mfa/verify`. |
| **Answer governance review** | `GET /chat/answers`, `POST /chat/answers/:id/review`, `/answer-review` web screen | Pharmacist/quality/knowledge-manager roles review AI answers across all nurses (not just their own) and approve or flag them. Verified end-to-end incl. RBAC (nurse: 403 on both endpoints). |
| **Dependency vulnerability scanning** | `.github/workflows/ci.yml` (`security` job) | `npm audit --audit-level=critical` fails CI on any critical finding (hard gate); `--audit-level=high` reports the rest without blocking, since the two remaining findings require the Next.js 14→16 major (tracked in `docs/production-readiness.md`). |

## Operational requirements before a real deployment

1. **Set strong secrets** — generate high-entropy values for `JWT_SECRET`,
   `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`, `S3_SECRET_KEY`. The API will
   refuse to start in production otherwise.
2. **Set `CORS_ORIGINS`** to your exact web origin(s).
3. **Set `MAIL_PROVIDER=smtp` with `MAIL_HOST`** before onboarding real users.
   The default `log` provider writes reset links into the application log,
   where anyone with log access can read them. Production boots and warns
   rather than refusing, so this will not stop a deploy — check for the
   warning. Set `APP_BASE_URL` if the reset link should not use the first
   `CORS_ORIGINS` entry.
4. **Terminate TLS** in front of the API and web (Ingress/load balancer). All
   cookies/tokens must travel over HTTPS only.
5. **Provision a real administrator before the first production boot.**
   `ADMIN_EMAIL=... ADMIN_PASSWORD=... node dist/scripts/create-admin.js`
   creates (or resets and reactivates) a SUPER_ADMIN. This is not optional on
   an environment that was previously seeded — see *Demo credentials* below,
   which can otherwise disable every account you have.
6. **Set `SEED_ON_BOOT=false`** in any shared/production environment (the K8s
   manifest already does; Docker Compose defaults to `true` for local demos).
   Since the demo-credential fix this is defence in depth rather than the only
   protection: both the container start command and `seed.ts` refuse to seed
   when `NODE_ENV=production`, regardless of the flag.
7. **Enable encryption at rest** — SSE/KMS on the object store and disk/TDE
   encryption on PostgreSQL.
8. **Restrict network egress** if using an external LLM/embedding provider.

## Demo credentials

The seeded demo accounts in `README.md` — including `superadmin@bnp.health` —
use passwords published in this repository. Three controls now bound that:

**The seed will not create them in production.** `assertSeedingAllowed()`
(`apps/api/src/seed/seed-policy.ts`) throws when `NODE_ENV=production`, and the
container start command (`infra/docker/Dockerfile.api`) no longer gates on
`SEED_ON_BOOT` alone — it checks `NODE_ENV` too. The runtime image sets
`NODE_ENV=production`, so a flag left `true` on a real deployment is no longer
sufficient to create known-credential accounts. `SEED_ALLOW_PRODUCTION=true`
overrides both, for a throwaway demo holding no real data.

**Accounts that already exist are disabled at boot.**
`DemoAccountGuardService` (`apps/api/src/auth/demo-account-guard.service.ts`)
runs on every production start. For each demo email it `bcrypt.compare`s the
*shipped default* against the stored hash; on a match it sets `is_active =
false`, increments `token_version` (revoking every outstanding refresh token
for that account), writes a `SECURITY:DEMO_ACCOUNT_DISABLED` audit row, and
logs at error level.

The comparison is deliberately against the shipped literal and never against
`SEED_PASSWORD_<ROLE>`. That is what makes it incapable of a false positive: an
account whose password was rotated, or that was seeded from an operator's
override, does not match and is left alone. A database failure inside the sweep
is logged and swallowed rather than blocking startup — a control that can take
the clinical API offline is a denial of service against itself.
`ALLOW_DEMO_ACCOUNTS=true` opts out and logs an error at every boot.

**Provisioning and sweeping must succeed or fail together.** When
`ADMIN_EMAIL` and `ADMIN_PASSWORD` are set, the container runs `create-admin`
*before* the API starts, so the administrator exists by the time the sweep
runs. If that step fails the container now **exits non-zero and the API does
not start**, leaving the previous deployment serving.

That is a correction, not caution. It first shipped as warn-and-continue, and
on 2026-08-22 an `ADMIN_PASSWORD` of 9 characters was rejected by the password
policy — so no administrator was created, the API booted anyway, and the sweep
disabled all seven demo accounts: **zero active users on a live system, from a
typo in a variable**. Failing the deploy instead leaves the published demo
credentials live for the few minutes it takes to fix the variable — an
exposure that was already ongoing — rather than trading it for a total outage.

Set `ADMIN_PASSWORD` to at least 12 characters with an upper-case letter, a
lower-case letter, a digit and a symbol, and not to any password in the demo
table; `create-admin` rejects anything else.

**Break-glass.** On an environment that only ever held demo accounts, the sweep
disables all seven and locks everyone out. `node dist/scripts/create-admin.js`
(`ADMIN_EMAIL`, `ADMIN_PASSWORD`, optional `ADMIN_NAME`) creates a SUPER_ADMIN,
or resets the password, reactivates and re-roles an existing email while
revoking its outstanding tokens. It refuses passwords under 12 characters,
passwords missing a character class, and every password published in the demo
table. It never echoes the password to stdout.

**Verifying it fired.** After the next production deploy, the application log
carries one `Disabled "<email>"` line per affected account plus a summary
naming how many active accounts remain, and `GET /audit?action=SECURITY:DEMO_ACCOUNT_DISABLED`
returns the corresponding rows.

**Web UI.** The login page no longer prefills a demo email or renders a demo
password. The optional prefill now comes from `NEXT_PUBLIC_DEMO_EMAIL`, which is
set in no deployment config. It is supplied by the environment rather than
gated behind a flag because `NEXT_PUBLIC_*` values are inlined into the client
bundle — a hardcoded literal behind an `if` would still ship the address to
every browser. No password appears in the web source in any form.

## Known gaps (tracked, not yet implemented)

These are deliberately out of MVP scope and must be addressed before pilot /
production sign-off — see `docs/production-readiness.md`.

- **Email delivery is built but must be configured.** `MailService`
  (`MAIL_PROVIDER=log|smtp`) emails the reset link and the response stays
  generic. The default `log` provider writes messages to the application
  log — anyone with log access can then read reset links, so a deployment
  serving real users **must** set `MAIL_PROVIDER=smtp` with `MAIL_HOST`.
  Production boots either way and logs a warning while log-only, because
  taking the clinical assistant offline over mail config is the worse
  failure. SMS is still unimplemented.
- **MFA is enrollable but not enforceable.** Users can now turn TOTP on for
  themselves (`/auth/mfa/enroll` → `/auth/mfa/enable`), but nothing lets an
  administrator *require* it for a role — there is no org-wide MFA policy, so
  adoption is voluntary per user.
- ~~**High-severity dependency advisories pass CI.**~~ ✅ Root workspaces are
  at **0 findings of any severity** (re-run 21 Aug 2026): the NestJS 10→11
  upgrade closed all 9 moderates, and Next.js 14→16 closed the last 2 highs in
  `next` and its bundled `postcss`. The CI gate still hard-fails only on
  critical and reports high/moderate, so a new advisory surfaces without
  blocking.
- **`apps/mobile` dependencies are scanned AND gated.** It is deliberately not
  an npm workspace, so the root `npm audit` gate never sees it; the mobile CI
  job scans it and hard-fails on critical, matching the root job. The Expo
  51→57 upgrade (Aug 2026) took the tree from 1 critical / 21 high / 11
  moderate to **8 high and nothing else** — and those 8 all chain from one
  advisory pair on `image-size`, which is vulnerable at *every published
  version* (`<=2.0.2`, which is latest), so no dependency graph anywhere can
  clear it today. It sits in Metro's build-time asset pipeline; this app has
  no image assets, and the exposure is a build-time DoS from a maliciously
  crafted committed image. The non-blocking high-level report keeps it
  visible until a fixed release exists.
- Centralised secret management (Vault/KMS) instead of env vars.
- Observability: API logs are structured JSON already (`/health` liveness,
  `/health/ready` checks Postgres + object storage) — still missing is
  shipping those logs anywhere, metrics, error tracking, and alerting.
- Formal penetration test and CBAHI/HIPAA compliance review.
- ~~**Framework major-version migrations.**~~ ✅ Both are done: NestJS 10→11
  (Express 5) and Next.js 14→16. Together they closed every remaining
  advisory. The web app deliberately stays on **React 18** — Next 16 supports
  18 or 19, this app uses no Server Actions or React 19-only APIs, and React
  19 carries no security benefit here, so the extra migration surface was not
  worth taking on in the same change. It remains available as a routine
  follow-up. See `docs/production-readiness.md`.

## Reporting

For a real deployment, establish a security contact and disclosure process
here (e.g. `security@your-hospital.example`). Do not file vulnerabilities as
public issues.
