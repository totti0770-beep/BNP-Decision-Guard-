# 06 — Dependencies

Every figure here was produced by a command on this commit, and the command is
named. Where a declared range and an installed version could differ, both are
given — this repository has been bitten by exactly that gap before, and
`CLAUDE.md` carries the gotcha.

## The shape of the tree

Five manifests, four of which are in the npm workspace and one of which is not.

| Manifest | Runtime deps | Dev deps | In the workspace? |
| --- | --- | --- | --- |
| `package.json` (root) | 0 | 4 | — it *is* the workspace root |
| `packages/shared/package.json` | **0** | 1 (`typescript`) | ✅ |
| `apps/api/package.json` | 26 | 16 | ✅ |
| `apps/web/package.json` | 5 | 9 | ✅ |
| `apps/mobile/package.json` | 6 | 7 | ❌ **separate install, own lockfile** |

Counted with a script over each manifest's `dependencies` / `devDependencies`
objects.

Two facts in that table carry weight:

- **`packages/shared` has zero runtime dependencies.** The module that holds the
  clinical safety strings, the RBAC matrix and the PHI scanner pulls in nothing
  at all. `phi.ts` is a pure function over a string, `rbac.ts` is a matrix and a
  `Set` union, `constants.ts` is literals and enums. Nothing a supply-chain
  advisory could reach sits underneath the code that decides whether a nurse's
  input is rejected or which permissions a role holds.
- **`apps/mobile` is outside the workspace**, which is why it needs its own CI
  audit job. A root `npm audit` cannot see it. `.github/workflows/ci.yml:227-229`
  runs the same gate script inside `apps/mobile`.

## Declared versus installed — the gap that has bitten this repo

`CLAUDE.md` records a case where raising a range and running `npm install`
printed `up to date` and left the old version on disk, because npm kept reusing
a nested lockfile node. The instruction it draws is: **verify the resolved
version, not the declared range.** Done here by reading each installed
`package.json` off disk.

| Package | Declared | Installed | |
| --- | --- | --- | --- |
| `next` | `^16.3.3` (`apps/web`) | **16.3.4** | ✅ above its floor — the case that once failed |
| `@nestjs/core` | `^11.2.1` | 11.2.1 | ✅ |
| `@nestjs/platform-express` | `^11.2.1` | 11.2.1 | ✅ |
| `react` / `react-dom` | `^18.3.1` (web) | 18.3.1 | ✅ deliberate — see below |
| `typeorm` | `^0.3.20` | 0.3.31 | ✅ |
| `pg` | `^8.12.0` | 8.23.0 | ✅ |
| `nodemailer` | `^10.0.10` | **10.0.10** | ✅ the security bump held |
| `multer` | `^2.0.2` + root override `^2.2.0` | **2.2.0** | ✅ the override is doing its job |
| `helmet` | `^7.1.0` | 7.2.0 | ✅ |
| `otplib` | `^12.0.1` | 12.0.1 | ✅ |
| `bcryptjs` | `^2.4.3` | 2.4.3 | ✅ |
| `pdf-parse` | `^1.1.1` | 1.1.4 | ✅ |
| `@aws-sdk/client-s3` | `^3.600.0` | 3.1115.0 | ✅ |
| `class-validator` | `^0.14.1` | 0.14.4 | ✅ |
| `tailwindcss` | `^3.4.6` | 3.4.19 | ✅ |
| `eslint` | `^9.39.5` | 9.39.5 | ✅ |
| `typescript` | `^5.5.4` | 5.9.3 | ✅ |

**React is on 18 on web and 19 on mobile**, and that is deliberate rather than
drift: `docs/production-readiness.md` records that Next 16 supports either, this
app uses no Server Actions or React 19-only APIs, and React 19 closes no
advisory — so its migration surface was not taken on inside a security-motivated
change. The two are separate installs and never share a runtime.

## Overrides

| Where | Override | Why, per the repository |
| --- | --- | --- |
| root | `multer ^2.2.0` | closes the multer advisories that the declared `^2.0.2` would not |
| root | `lodash ^4.18.1` | transitive-advisory pin |
| root | `file-type ^21.3.2` | transitive-advisory pin |
| root | `@nestjs/common ^11.0.0`, `@nestjs/core ^11.0.0` | `@nestjs/throttler` installs its own Nest peers, which left Nest 10 and 11 resolved side by side and produced a `DynamicModule is not assignable to DynamicModule` error naming the same type twice (`docs/production-readiness.md:202-207`) |
| `apps/mobile` | `uuid ^11.1.1` | the `xcode` prebuild path |

## Advisories, measured on this commit

```
$ npm audit
9 vulnerabilities (1 moderate, 8 high)
```

`npm audit --json`'s `metadata.vulnerabilities`:
`{"info":0,"low":0,"moderate":1,"high":8,"critical":0,"total":9}`.

**Zero critical**, which is what CI gates on
(`.github/scripts/audit-critical.mjs`, hard-fail). The nine break into three
groups, and `SECURITY.md`'s dependency-scanning row carries the triage:

| Severity | Package | Fix available | Group |
| --- | --- | --- | --- |
| high | `@nestjs/core` | `@nestjs/core@12.0.2` (**major**) | NestJS 12 chain |
| high | `@nestjs/platform-express` | `@nestjs/platform-express@12.0.2` (**major**) | NestJS 12 chain |
| high | `@nestjs/schedule` | `@nestjs/schedule@12.0.2` (**major**) | NestJS 12 chain |
| high | `@nestjs/testing` | `@nestjs/testing@12.0.2` (**major**) | NestJS 12 chain |
| high | `@nestjs/throttler` | in-range | NestJS 12 chain |
| high | `@nestjs/typeorm` | `@nestjs/typeorm@12.0.1` (**major**) | NestJS 12 chain |
| high | `multer` | only via `@nestjs/platform-express@12` (**major**) | NestJS 12 chain |
| high | `js-yaml` | in-range | build-time only |
| moderate | `qs` | in-range | build-time only |

**`multer` is the substantive one**, and it is worth being precise about the
exposure rather than waving at the severity: its four advisories are
denial-of-service on multipart parsing, which is the document-upload path. That
path is bounded at 25 MB by `FileInterceptor` (`documents.controller.ts:62-64`)
and requires the `documents:upload` permission, so it is not an unauthenticated
surface. It resolves only through a framework major.

**`js-yaml` genuinely reaches the tree twice**, and the repository's claim that
forcing one version would break a consumer checks out — the two copies are
different majors with different APIs:

```
node_modules/js-yaml                                   4.3.1   (ESLint's config loader)
node_modules/@istanbuljs/load-nyc-config/node_modules/js-yaml
                                                       3.15.1  (jest's coverage config)
```

Neither is imported by the API at runtime.

**`qs` arrives through Express 5's body parser.** An override to `^6.16.0` was
attempted and reverted: npm kept resolving the locked 6.15.3, and re-resolving
emptied the entry rather than upgrading it, leaving the tree inconsistent. The
installed version is still 6.15.3, confirming the revert held.

## What the CI gate actually decides on

`.github/scripts/audit-critical.mjs` reads `npm audit --json` and branches on
`metadata.vulnerabilities.critical`. It deliberately does **not** rely on
`npm audit --audit-level=critical`'s exit code, because that path calls the
registry's legacy "quick" endpoint, which npm is retiring and which returned
`400 Invalid package tree` on an unchanged lockfile `npm ci` had installed
cleanly seconds earlier in the same job — a red light with no finding behind it
and indistinguishable, to the gate, from a real critical.

The script also fails when the audit could not run at all: unparseable JSON, a
`report.error`, or missing severity counts each exit 1. Verified by mutation
(a stubbed critical count, a stubbed audit error, and a lockfile-less directory
each exit 1).

**One observation, recorded and not claimed as a finding.** The first
`npm audit --json` of this audit session returned `high: 7, total: 8`; three
later runs against the unchanged lockfile all returned `high: 8, total: 9`,
agreeing with `npm audit`'s printed summary and with the detailed
`vulnerabilities` map. `critical` was `0` in every run, so nothing observed
changes what the gate would have decided. It did not reproduce and npm's source
has not been read. It is on the record because the gate reads exactly one
number, and a count that moved between two runs of the same command on the same
tree is worth having written down if it ever recurs at a severity that matters.

## Dependencies with no direct import, each resolved

A package with zero `import` statements is not automatically dead. Each of
these was checked individually:

| Package | Why it has no direct import |
| --- | --- |
| `reflect-metadata` | side-effect import at four entry points — `main.ts:1`, `data-source.ts:1`, `seed.ts:1`, `create-admin.ts:1` |
| `nodemailer` | dynamic `await import('nodemailer')` at `mail.service.ts:55`, plus a type-only import at `:45` |
| `multer` | reached through `FileInterceptor` and the `Express.Multer.File` type |
| `class-transformer` | what `ValidationPipe({ transform: true })` uses; zero direct references |
| `pg` | the TypeORM `postgres` driver, named in `data-source.ts` |
| `passport` | the base for `PassportStrategy` in `jwt.strategy.ts` |
| `react-dom` | Next.js's required runtime peer |
| `pdfkit` | correctly in `dependencies`, not `devDependencies`: `seed/pdf.ts` uses it and the seed runs **in the container** when seeding is enabled. It is also the fixture generator for `pdf-extraction.service.spec.ts` |

`@nestjs/config` was previously in this position and was genuinely unused —
`REPO-DISCOVERY.md` §23.3 flagged it, and it is **no longer declared** in
`apps/api/package.json`. The finding was acted on.

## What is deliberately absent

Searched and not present, which is as much a property of this tree as what is
in it: no state-management library, no form library, no component library, no
data-fetching library (`apps/web/src/lib/async.ts` is a hand-rolled hook), no
navigation library in mobile (`App.tsx` is a `useState` tab switch), no GraphQL
client or server, no ORM besides TypeORM, no message queue, no WebSocket
library, no metrics/tracing/error-reporting SDK, and no secret-manager client.

The one that matters clinically: **no dependency sits between a retrieved chunk
and the answer text.** `MockLlmProvider` is a few dozen lines of sentence
scoring in `llm.service.ts`, and the OpenAI path is `fetch` in
`openai-http.ts:53`. There is no LangChain, no LlamaIndex, no agent framework —
which is why the claim that the assistant cannot cite an unretrieved document
is checkable by reading two files.
