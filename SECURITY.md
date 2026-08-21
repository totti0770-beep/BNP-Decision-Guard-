# Security Posture — BNP Decision Guard

This document describes the security controls implemented in the platform and
the operational steps required to run it safely. It is written for a healthcare
deployment where governed, source-bound clinical answers and a complete audit
trail are non-negotiable.

## Implemented controls

| Control | Where | Notes |
| --- | --- | --- |
| **Production secret fail-fast** | `apps/api/src/config/env.ts` | The API refuses to boot with `NODE_ENV=production` if any of `JWT_SECRET`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`, `S3_SECRET_KEY` is missing or left at its shipped default. |
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
5. **Set `SEED_ON_BOOT=false`** in any shared/production environment (the K8s
   manifest already does; Docker Compose defaults to `true` for local demos).
6. **Enable encryption at rest** — SSE/KMS on the object store and disk/TDE
   encryption on PostgreSQL.
7. **Restrict network egress** if using an external LLM/embedding provider.

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
- **`apps/mobile` dependencies were entirely unscanned until Aug 2026.** It is
  deliberately not an npm workspace, so the root `npm audit` gate never saw it.
  CI now reports it (non-blocking) alongside the mobile tests: **1 critical, 21
  high, 11 moderate**, every one of them reached through the Expo 51 / React
  Native 0.74 toolchain (`@expo/cli`, `metro`, `tar`, `@xmldom/xmldom`) rather
  than through app code. They are build-time dependencies, not shipped in the
  app bundle, and none resolves without an Expo major — which is why this is
  reported rather than gated: a hard gate would block every PR on something no
  PR can fix. Revisit with the Expo upgrade.
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
