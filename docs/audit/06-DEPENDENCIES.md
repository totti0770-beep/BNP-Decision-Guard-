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
found 0 vulnerabilities
```

`npm audit --json`'s `metadata.vulnerabilities`:
`{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}`.

**This section previously reported 9 findings (8 high, 1 moderate) and repeated
`SECURITY.md`'s explanation for why they stood: that the highs were gated on a
NestJS 12 major and that `js-yaml` could not be fixed because "forcing a single
version would break the 3.x consumer". I checked neither claim before writing
them down. Both were wrong, and all nine closed in a single change.**

What the nine actually were:

| Package | Was | Now | What it needed |
| --- | --- | --- | --- |
| `multer` | 2.2.0 | **2.4.0** | root `overrides` `^2.2.0` → `^2.3.0` |
| `@nestjs/core`, `platform-express`, `schedule`, `testing`, `throttler`, `typeorm` | — | — | **nothing** — no advisory of their own; inherited from `multer` |
| `js-yaml` (ESLint path) | 4.3.1 | **4.3.2** | lockfile re-resolution |
| `js-yaml` (jest coverage path) | 3.15.1 | **3.15.2** | lockfile re-resolution |
| `qs` (Express body-parser) | 6.15.3 | **6.16.0** | lockfile re-resolution |

Two mistakes produced the old text, and they are different mistakes:

**Counting inherited markers as findings.** `npm audit --json` lists a package
under `vulnerabilities` when a *dependency* of it is vulnerable, not only when it
has an advisory. Six of the seven "NestJS 12 chain" entries were markers. The
distinction is one pass over `via`: an entry whose `via` array holds only strings
has no advisory of its own. Running that pass is what collapsed a seven-package
framework-major problem into one package.

**Answering a question nobody had asked.** The `js-yaml` claim was true —
forcing both copies to one version *would* break the 3.x consumer — and
irrelevant, because each copy had a patched release inside its own parent's
declared range. `@eslint/eslintrc` declares `^4.3.0` and 4.3.2 is in it;
`@istanbuljs/load-nyc-config` declares `^3.13.1` and 3.15.2 is in it. Both
shipped in late August. `qs` was the same: `express` declares `^6.14.0`, and
6.16.0 satisfies it.

So three of the four were held below floors their own parents already allowed,
by nothing but a stale lockfile — **the exact failure mode `CLAUDE.md` documents
from the `next` upgrade**, restated in a security context and not recognised.
The earlier `qs` attempt failed because it reached for an override, which emptied
the entry; `npm update qs --package-lock-only` lifts it cleanly.

`multer` was the one genuine override case, because
`@nestjs/platform-express@11.2.1` pins it at exactly `2.2.0` rather than by
range. Its four advisories are denial-of-service on multipart parsing — the
document-upload path — which is why it was the substantive one. That path stays
bounded at 25 MB by `FileInterceptor` and gated on `documents:upload`.

**Not adopted: NestJS 12.** `@nestjs/core@12.0.2` was published
2026-09-14T18:14 UTC, hours before this change. It is a reasonable routine
upgrade and no longer a security item.

### Verified on disk, not from declared ranges

`npm ci` then reading each installed `package.json`, because a security bump that
fails the nested-lockfile way reads exactly like success:

```
multer     2.4.0
qs         6.16.0
node_modules/js-yaml                                        4.3.2
node_modules/@istanbuljs/load-nyc-config/node_modules/js-yaml  3.15.2
```

Both `js-yaml` copies are checked deliberately. The nested one is invisible to
an ordinary `require.resolve`, and it is the one an advisory would be missed on.

### The removals in that diff were not cleanup, and reading them as cleanup broke upload

The first attempt at this change hand-deleted `multer`'s node from
`package-lock.json` to force re-resolution — the remedy `CLAUDE.md` gives for a
stale entry pinned below its own floor. The resulting diff showed seven removals
and no additions: `concat-stream`, `readable-stream`, `string_decoder`,
`typedarray`, and three nested `mime-db` / `mime-types` / `media-typer`
packages. This report said they left "because multer 2.4.0 no longer needs them.
A smaller tree, not a wider one."

**That was wrong, and it broke every document upload.** Three of those removals
belonged to `type-is@1.6.18`, which multer pulls and which pins
`media-typer: "0.3.0"` and `mime-types: "~2.1.24"` — an exact pin and a tilde
range. With its nested copies gone, `type-is` resolved Express 5's hoisted
`media-typer@1.1.1` and `mime-types@3.0.2` instead. Wrong majors, changed API, so
`is(req, ['multipart'])` returned **false** for a valid multipart request, and
multer's gate

```js
if (!is(req, ['multipart'])) return next()      // make-middleware.js:68
```

silently skipped parsing. The handler got `undefined`, `isPdf(undefined)`
returned false, and `POST /documents/upload` 400'd — with no error, no log line,
and no failure anywhere that runs without a database. **85 of 229 integration
tests** went red in CI while the 412-test unit suite, lint and the web build were
all green.

Regenerating the lockfile (`rm -rf node_modules package-lock.json && npm
install`) restores the nested pins and fixes it. The rule worth keeping:
**never hand-delete lockfile nodes to force a version.** `CLAUDE.md`'s gotcha is
about a single stale entry; deleting one takes its nested subtree with it, and
that subtree can be load-bearing for a package that never asked for it.

A second wrong conclusion came out of the same episode and is corrected here too.
Comparing a *nested* multer 2.3.0 (which had its own correct sub-dependencies)
against a *hoisted* 2.4.0 (which did not) looked like evidence that 2.4.0 was
defective. It was not: the variable was resolution, not version. On a correctly
regenerated tree **multer 2.4.0 works**, and that is what ships here.

`apps/api/package.json` also declares `multer` directly, so its range floats
independently of the override — worth knowing, because a mismatch between the two
produces two copies with different sub-dependency trees, which is exactly the
shape that made this hard to see.

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
