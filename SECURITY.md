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
| **RBAC** | `packages/shared/src/rbac.ts` + `PermissionsGuard` | 7 roles, central permission matrix, enforced globally. Nurses/auditors cannot approve or download source PDFs. |
| **Refusal-first AI** | `apps/api/src/rag/*` | Retrieval hard-filtered to `ACTIVE`, non-expired documents; sub-threshold matches refuse with the exact governed message; the mock LLM is extractive and cannot generate beyond context. |
| **Uniform error envelope** | `AllExceptionsFilter` | 5xx internals are never leaked to clients in production; full errors are logged and audited. |
| **Full audit trail** | global `AuditInterceptor` + `AuditService` | Every login, question, answer (incl. refusals), document action, dose calculation, permission change and error is recorded with actor, IP and metadata. |
| **MFA-ready** | `otplib` TOTP, `/auth/mfa/verify` | Per-user TOTP challenge flow implemented. |

## Operational requirements before a real deployment

1. **Set strong secrets** — generate high-entropy values for `JWT_SECRET`,
   `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`, `S3_SECRET_KEY`. The API will
   refuse to start in production otherwise.
2. **Set `CORS_ORIGINS`** to your exact web origin(s).
3. **Terminate TLS** in front of the API and web (Ingress/load balancer). All
   cookies/tokens must travel over HTTPS only.
4. **Set `SEED_ON_BOOT=false`** in any shared/production environment (the K8s
   manifest already does; Docker Compose defaults to `true` for local demos).
5. **Enable encryption at rest** — SSE/KMS on the object store and disk/TDE
   encryption on PostgreSQL.
6. **Restrict network egress** if using an external LLM/embedding provider.

## Known gaps (tracked, not yet implemented)

These are deliberately out of MVP scope and must be addressed before pilot /
production sign-off — see `docs/production-readiness.md`.

- Email/SMS delivery for the password-reset token (the flow exists; in
  production wire an email provider where the token is signed and return a
  generic response — currently the token is only returned outside production).
- Centralised secret management (Vault/KMS) instead of env vars.
- Observability: structured logs shipping, metrics, error tracking, alerting.
- Formal penetration test and CBAHI/HIPAA compliance review.
- Automated dependency/vulnerability scanning in CI (e.g. `npm audit`, SCA).

## Reporting

For a real deployment, establish a security contact and disclosure process
here (e.g. `security@your-hospital.example`). Do not file vulnerabilities as
public issues.
