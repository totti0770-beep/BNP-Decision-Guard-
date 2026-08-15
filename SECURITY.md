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
| **Self-service password reset** | `/auth/forgot-password`, `/auth/reset-password` | Reset token is bound to `token_version` (single-use; voided by logout/prior reset) and expires after `PASSWORD_RESET_TOKEN_MINUTES`. `forgot-password` never reveals whether an email exists. Completing a reset rotates the hash, bumps `token_version` (invalidating all sessions) and clears lockout. Verified end-to-end. |
| **CORS allowlist** | `main.ts` + `CORS_ORIGINS` | Explicit origin allowlist; production with an empty list blocks all cross-origin browser calls instead of allowing `*`. |
| **Request body cap** | `express.json({ limit })` | `REQUEST_BODY_LIMIT` caps JSON payloads; PDF uploads go through multipart/multer. |
| **Refresh-token revocation** | `users.token_version` + `auth.service.ts` | `POST /auth/logout` and any password change bump `token_version`, immediately invalidating every outstanding refresh token. Verified end-to-end. |
| **RBAC** | `packages/shared/src/rbac.ts` + `PermissionsGuard` | 7 roles, central permission matrix, enforced globally. The matrix is the only input to authorization — `role_permissions` is a display projection, so the roles API is read-only and a database-only role grants nothing. Nurses/auditors cannot approve or download source PDFs. |
| **No public self-registration** | `auth.controller.ts` | Accounts are provisioned by an administrator via `POST /users`. The former public `POST /auth/register` handed any caller a `NURSE_USER` account with `ai:ask`, `ai:search`, `documents:read` and `dose:calculate` over the approved corpus. |
| **Reset token never disclosed** | `auth.service.ts` | `POST /auth/forgot-password` returns `{requested: true}` and nothing else; the token reaches the user only by email. Disclosure requires an explicit `AUTH_DEV_RETURN_RESET_TOKEN=true` opt-in that is additionally refused in production. It previously keyed off `NODE_ENV !== 'production'`, which failed open wherever `NODE_ENV` was unset. |
| **Email delivery** | `mail/mail.service.ts`, `MAIL_PROVIDER` | Reset links are delivered over SMTP. Production must choose explicitly: `smtp` (with `SMTP_HOST`) or `none` to disable self-service reset — an unset value, or `console` (which would write a working link into the server log), refuses to boot. The relay is verified at startup and a failure is logged loudly rather than silently swallowed. |
| **Enumeration-safe delivery** | `auth.service.ts` | Sending is fire-and-forget: awaiting the SMTP round-trip would make a request for a real account measurably slower than one for an address that does not exist, which is exactly the signal the uniform response exists to hide. Delivery outcomes are audited (`AUTH:PASSWORD_RESET_EMAIL_SENT` / `..._FAILED`), never returned. |
| **Upload content validation** | `documents.service.ts` | Uploads must carry a real `%PDF-` signature, not merely a PDF `Content-Type` header, which the client controls. |
| **Refusal-first AI** | `apps/api/src/rag/*` | Retrieval hard-filtered to `ACTIVE`, non-expired documents; sub-threshold matches refuse with the exact governed message; the mock LLM is extractive and cannot generate beyond context. |
| **Uniform error envelope** | `AllExceptionsFilter` | 5xx internals are never leaked to clients in production; full errors are logged and audited. |
| **Full audit trail** | global `AuditInterceptor` + `AuditService` | Every login, question, answer (incl. refusals), document action, dose calculation, permission change and error is recorded with actor, IP and metadata. |
| **MFA-ready** | `otplib` TOTP, `/auth/mfa/verify` | Per-user TOTP challenge flow implemented. |
| **Answer governance review** | `GET /chat/answers`, `POST /chat/answers/:id/review`, `/answer-review` web screen | Pharmacist/quality/knowledge-manager roles review AI answers across all nurses (not just their own) and approve or flag them. Verified end-to-end incl. RBAC (nurse: 403 on both endpoints). |
| **Dependency vulnerability scanning** | `.github/workflows/ci.yml` (`security` job) | `npm audit --audit-level=critical` fails CI on any critical finding (hard gate); `--audit-level=high` reports the rest without blocking, since some remaining findings require a NestJS 11 / Next.js 15 migration (tracked in `docs/production-readiness.md`). |

## Operational requirements before a real deployment

1. **Set strong secrets** — generate high-entropy values for `JWT_SECRET`,
   `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`, `S3_SECRET_KEY`. The API will
   refuse to start in production otherwise.
2. **Set `CORS_ORIGINS`** to your exact web origin(s).
3. **Choose an email posture** — `MAIL_PROVIDER=smtp` with `SMTP_HOST`,
   `MAIL_FROM` and `APP_WEB_URL` (the reset link is built from it), or
   `MAIL_PROVIDER=none` to disable self-service reset deliberately. The API
   will not start in production without one of these.
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

- **MFA cannot be enrolled.** `/auth/mfa/verify` and the login challenge work,
  but no endpoint writes `mfa_secret`, so MFA can only be switched on with
  direct database access. Treat "MFA-ready" as exactly that — not as available.
- **Five high-severity dependency advisories pass CI**, because the gate only
  hard-fails on critical (0 critical, 5 high, 9 moderate as of Aug 2026).
- Centralised secret management (Vault/KMS) instead of env vars.
- Observability: structured logs shipping, metrics, error tracking, alerting.
- Formal penetration test and CBAHI/HIPAA compliance review.
- **NestJS 10→11 / Next.js 14→15 migration.** The critical Next.js middleware
  auth-bypass CVE (CVE-2025-29927) and the exploitable multer/lodash CVEs were
  patched without a major-version bump. The current count is **14 findings (5
  high, 9 moderate, 0 critical)** — higher than the "1 high / 11 moderate"
  recorded earlier, as new advisories have since landed. Not all of them are
  gated on the majors; re-run resolution and pin what moves before assuming
  otherwise. See `docs/production-readiness.md`.

## Reporting

For a real deployment, establish a security contact and disclosure process
here (e.g. `security@your-hospital.example`). Do not file vulnerabilities as
public issues.
