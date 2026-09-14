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
| **PHI screening on free-text input** | `packages/shared/src/phi.ts`, `common/guards/phi-screen.guard.ts`, `@ScreenForPhi` | Patient identifiers are rejected before any store is written. Four patterns are active — Saudi national ID/Iqama, full numeric date of birth, Saudi mobile, and explicit identifying phrases (`اسم المريض`, `patient name`, `MRN` …) — plus an optional hospital MRN format. Arabic-Indic digits fold to ASCII first, so switching keyboards is not a bypass. Rejection returns `PHI_REJECTION_MESSAGE_AR` from `@bnp/shared`, and the only record written is `SECURITY:PHI_BLOCKED` carrying the pattern categories, never the text. See *PHI screening* below. |
| **Dependency vulnerability scanning** | `.github/workflows/ci.yml` (`security` job) | `npm audit --audit-level=critical` fails CI on any critical finding (hard gate); `--audit-level=high` reports the rest without blocking. The hard gate has bitten for real: `next@16.3.1` carried GHSA-p293-qw3h-jr36 (CVSS 9.0, unauthenticated RCE) and failed the pipeline until the bump to `^16.3.3`. The non-blocking findings are currently **9 high and 1 moderate** — the `@nestjs/core` chain and its five dependents, `multer`, `js-yaml`, `nodemailer`, and `qs` — none of them Next.js. Most resolve only through majors; `nodemailer` is the one with a product path (password reset) and a non-major fix. Count measured at the time of writing; `npm audit` is the authority. |

## PHI screening

Free-text fields a clinician types into are screened for patient identifiers,
and rejected input is never stored.

### "Never stored" is structural, not a convention

The screen runs as a **guard**, and Nest runs guards → interceptors → pipes →
handler. Because the guard throws before the interceptor chain, a rejected
request never reaches `AuditInterceptor` — so there is no `HTTP:POST:/chat/ask`
row, no `ERROR:400` row, and no code path anywhere that could carry the body
into the audit trail. The property "rejected text is written to no store" is
therefore a consequence of *where the check runs*, not a promise about what
each call site remembers not to log. A `class-validator` rule on the DTO would
have run in the pipe, one stage later, and could not have made the same claim —
nor could it have screened `GET /rag/search?q=`, which has no DTO at all.

The only row written for a rejection is `SECURITY:PHI_BLOCKED`, carrying the
actor, the route and the **pattern categories**. It never carries the text, any
fragment of it, or a hash of it. `test/phi-screening.e2e-spec.ts` proves this
against a real database by searching whole rows and whole `jsonb` documents
(`::text LIKE`) rather than named columns — the requirement is "nowhere", not
"not in the column we thought of".

### The interception counter

`SECURITY:PHI_BLOCKED` records a **per-category** breakdown from day one, not a
single total. In the first weeks of use the operating question is not how many
inputs were rejected but *which pattern is rejecting legitimate clinical
questions*, and a total cannot answer that. Query it with
`GET /audit?action=SECURITY:PHI_BLOCKED`.

### Which fields, and why two profiles

`FREE_TEXT` (all patterns) applies to the fields a clinician types a question
into: `POST /chat/ask`, `POST /rag/query`, `GET /rag/search?q=`.

`METADATA` (identifier patterns only — national ID, phone, MRN) applies to
fields that describe a *document*: upload title/description/change note,
`PATCH /documents/:id`, the four approval-comment routes, and dose formula
name/drug/notes. Identifiers are never legitimate there either, but dates and
names are — "supersedes the 2019-03-01 edition", "approved per Dr. Ali" is
exactly what a change note is for. Running the strict profile over governance
text would reject correct work, and a control that blocks correct work is a
control that gets switched off.

Three routes are screened for reasons worth stating:

- **`POST /rag/query` persists nothing** and is screened anyway, because it
  forwards the text to the LLM provider. Under `LLM_PROVIDER=openai` that text
  leaves the hospital. Stored text can be redacted afterwards; sent text cannot
  be recalled, which makes this the stricter case rather than the looser one.
- **`GET /rag/search?q=`** carries free text in the URL, and
  `AllExceptionsFilter` logs `req.url` on a 5xx. It is the one path by which a
  question could reach the application log.
- **The approval-comment routes** write the comment to two stores —
  `document_approvals.comment` and the audit metadata written alongside it in
  `approval.service.ts`.

### Deliberately not screened

- **`fullName` on `POST /users` / `PATCH /users/:id`** is a structured field for
  staff names, and a name in it is its purpose. This control targets identifiers
  that leak into a *free-text* field, not fields designed to hold a name.
- **`PATCH /settings/:key`** takes `{ value: unknown }` — an operator-set
  configuration value of unconstrained type. This is a **known, accepted
  limitation** rather than a field judged out of scope: it is reachable only by
  `settings:write` holders, and screening it would mean type-narrowing the
  settings contract. Revisit if free-text settings are ever exposed more widely.

### The MRN pattern ships disabled

`PHI_MRN_PATTERN` is unset by default. The mechanism is complete and the other
four patterns run regardless; setting this one environment variable to the
hospital's medical-record-number format turns the MRN check on **with no code
change**. It is unset because the platform has no institutional MRN format yet,
and a guessed pattern either misses every real MRN or fires on batch numbers.

A malformed pattern **fails the boot** rather than being ignored — falling back
to "no MRN check" on a typo would disable a security control silently. Note
that the regular expression is operator-supplied: a catastrophically
backtracking pattern is the operator's responsibility. The four built-in
patterns are linear-time by construction.

### The gold set is the false-positive corpus, and its limits

Every question in `GOLD_SET` (`apps/api/test/support/gold-set.ts`) is asserted
against the live screen in `test/phi-screening.e2e-spec.ts`. Any pattern that
rejects one of them fails the build.

This is not belt-and-braces. The first version of the identifying-phrase
pattern matched `patient id` as a prefix of "patient identifiers" and rejected
*"Which two patient identifiers must be checked before administering a
medication?"* — a medication-safety question a nurse asks constantly. Fourteen
hand-written negative cases missed it; the gold set caught it on the first full
run. Binding the two is what makes the screen safe to extend later.

**Its limits, stated so no one reads it as more than it is.** The gold set is
**15 cases** (10 answerable, 5 refusal), and it is **circular by design** — the
questions were authored from the four seeded demo documents they retrieve from
(see the header of `gold-set.ts`). So it is a far broader false-positive corpus
than any list maintained by hand, and it is **not** a representative sample of
the questions real nurses ask. It cannot tell you the screen's false-positive
rate in the ward; only the production counter can do that, and only once there
is real traffic.

*(This paragraph said "16 cases" until the field set landed. The file has 15.
Nothing computed the number, so nothing caught it — the same defect class the
documentation corrections were about, committed in the act of documenting.)*

**The independent set is now joined to this control, not merely promised to be.**
`test/phi-screening.e2e-spec.ts` asserts the field set
(`apps/api/eval/field-set.starter.jsonl`) against the live screen alongside the
gold set, so every case a hospital adds widens the false-positive corpus at no
extra cost. A site that replaces the starter file with three hundred ward
questions gets a three-hundred-case negative corpus without doing anything
else — and the loader refuses a case file containing an identifier, so the
questions cannot themselves become the leak.

### Known false positive

The national-ID rule is *ten digits beginning with 1 or 2*, so **a ten-digit
batch or catalogue number that happens to start with 1 or 2 is rejected**. This
is accepted, and it is pinned by a test so it stays a decision on record rather
than a surprise. The alternative — matching any ten digits — would reject batch
numbers, catalogue codes and long dose figures indiscriminately, and a rule that
blocks legitimate clinical questions gets disabled within a week, at which point
there is no screen at all. It cannot be narrowed further without the hospital's
real identifier format.

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
