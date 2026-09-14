# 03 — Modules: frontend (`apps/web`)

Next.js 16 App Router, React 18, Tailwind 3. **Every route is statically
prerendered** — confirmed by `npm run build:web` on this commit, which reports
20/20 pages as `○ (Static)`. That is not a performance note; it is the property
the i18n design depends on.

## Routes

Four public, fifteen behind the authenticated shell.

| Route | File | Lines | Permission gate |
| --- | --- | --: | --- |
| `/` | `app/page.tsx` | 13 | — redirects to `/login` or `/dashboard` |
| `/login` | `app/login/page.tsx` | 173 | public |
| `/login/forgot` | `app/login/forgot/page.tsx` | 215 | public |
| `/dashboard` | `(app)/dashboard/page.tsx` | 254 | none — visible to every authenticated role |
| `/assistant` | `(app)/assistant/page.tsx` | 23 | `ai:ask` |
| `/drug-prep` | `(app)/drug-prep/page.tsx` | 21 | `ai:ask` |
| `/cbahi` | `(app)/cbahi/page.tsx` | 120 | `ai:search` |
| `/dose-calculator` | `(app)/dose-calculator/page.tsx` | 333 | `dose:calculate` |
| `/policies` | `(app)/policies/page.tsx` | 208 | `documents:read` |
| `/upload` | `(app)/upload/page.tsx` | 159 | `documents:upload` |
| `/approvals` | `(app)/approvals/page.tsx` | 392 | `documents:read`, per-action checks inside |
| `/answer-review` | `(app)/answer-review/page.tsx` | 236 | `ai:review-answers` |
| `/users` | `(app)/users/page.tsx` | 291 | `users:read` |
| `/audit` | `(app)/audit/page.tsx` | 172 | `audit:read` |
| `/analytics` | `(app)/analytics/page.tsx` | 212 | `analytics:read` |
| `/settings` | `(app)/settings/page.tsx` | 373 | `settings:read` |
| `/security` | `(app)/security/page.tsx` | 251 | authenticated |
| `/notifications` | `(app)/notifications/page.tsx` | 101 | `notifications:read` |

`/assistant` and `/drug-prep` are 23 and 21 lines because both delegate to
`<AssistantChat>`, differing only in `assistantType`. They are not stubs.

**No orphan page exists**: every `page.tsx` is reachable from navigation or a
redirect. **Navigation is permission-filtered, not merely styled** —
`shell.tsx` types each item as `{ href, labelKey, permission? }` and does not
render items whose permission the session lacks.

## Components

| File | Lines | Role |
| --- | --: | --- |
| `components/assistant-chat.tsx` | 387 | the entire chat UI; used by two routes |
| `components/formula-manager.tsx` | 335 | dose-formula authoring and approval |
| `components/shell.tsx` | 307 | app shell, nav, `PageHeader`, skip link, focus-trapped mobile drawer |
| `components/ui/index.tsx` | 592 | the design system every screen composes from |
| `components/chat-history.tsx` | 116 | the collapsible history panel on `/assistant` |
| `components/theme-toggle.tsx` | 58 | light/dark |
| `components/language-toggle.tsx` | 34 | EN/AR |

`ui/index.tsx` is worth reading in full; several of its decisions are
accessibility fixes with the reason written in. `Button` keeps a loading button
mounted and sized to avoid layout shift and marks it `aria-busy`, so assistive
tech reports progress instead of the label vanishing. `Field` generates one id
and wires `aria-describedby`/`aria-invalid` through context, with error taking
precedence over hint so a screen reader hears the blocker first.
`SegmentedControl` renders buttons with `aria-pressed` rather than styled links,
because the previous colour-only treatment conveyed nothing to keyboard or
screen-reader users. `Pagination` announces its range via `aria-live`, since the
only prior feedback that Next/Previous did anything was rows silently changing.
`EmptyState` is documented as explaining what to do next, never a bare "No data".

Three surfaces — `Section`, `Card`, `Panel` — are distinguished on purpose, so
the UI is not "card everything".

## Libraries

| File | Lines | Role |
| --- | --: | --- |
| `lib/i18n.ts` | 1,044 | the EN/AR dictionary — **382 keys per language, verified equal** — plus `t()`, `isRtl()`, `localeTag()` |
| `lib/language.tsx` | 106 | the provider and `useT()` hook |
| `lib/api.ts` | 92 | fetch wrapper: bearer token, refresh-on-401, hard redirect to `/login` |
| `lib/async.ts` | 91 | `useAsyncData` — this repo's substitute for react-query |
| `lib/auth.tsx` | 62 | session context, `hasPermission`, logout |

**Dictionary parity is enforced by the compiler, not by convention.** `Key` is
`keyof (typeof dict)['en']` and `t()` indexes `dict[lang][key]`, so deleting one
Arabic key fails `tsc` with `TS7053`. Verified by doing it and watching the
build break, not by reading the types.

`t()` interpolates `{name}` placeholders rather than concatenating, because word
order differs between the two languages, and it leaves an unknown placeholder
**visible** so a typo shows up rather than producing a sentence with a hole in
it.

`localeTag()` pins `ar-u-nu-latn`. Arabic locales default to Eastern
Arabic-Indic digits, which are correct for prose and wrong for dose figures,
version numbers, page citations and timestamps a clinician cross-checks against
an English source PDF.

`useAsyncData` carries two correctness details its docblock states outright: a
monotonic `seq` guard drops stale responses, because filters change per
keystroke and a slow early response can otherwise land after a fast later one
and show results for a filter the user has left; and `loading` is distinguished
from `refreshing` by whether data has ever arrived, so re-filtering does not
flash a skeleton over a populated list.

`lib/auth.tsx`'s `logout()` fires `POST /auth/logout` first — bumping
`token_version` invalidates every outstanding refresh token, not just this tab's
copy — but deliberately does **not** await it, so local cleanup cannot hang on
the network call.

## RTL is layout mirroring, not just text direction

Language persists under `bnp.lang` and is applied to `<html lang|dir>` by an
inline script **before first paint** — the same trick as the theme init, for a
stronger reason: a direction flip on hydration moves every element on the page.

Three rules, each of which this repository has violated and fixed:

1. **Logical Tailwind classes only** (`start-*`/`end-*`, `ps-`/`pe-`,
   `border-s`/`border-e`, `text-start`/`text-end`). Physical classes do not
   mirror. Three genuine violations were found and fixed during this audit.
2. **`dir="auto"` on anything rendered from API data** — document titles,
   citations, answers, warnings — because an assistant answer comes back in the
   language of the *question*, not of the interface.
3. **CSS transforms are physical and `dir` does not mirror them either.** The
   mobile drawer is pinned at `start-0` — the right edge under RTL — but was
   animated with a single `translateX(-100%)` keyframe, so under Arabic it slid
   in across the page rather than from the edge it is attached to. Now two
   keyframes selected by `[dir='rtl']`.

Four uses of `text-right` are **deliberate and must not be "fixed"**: they carry
the contractual Arabic strings with `dir="rtl" lang="ar"` and must read
right-aligned even in an English session. `text-end` would be the bug there.

The two governed clinical strings are **never** in the dictionary. They come
verbatim from `@bnp/shared`; translating them would fork the safety contract the
API tests assert on.

## The gap

**There are no web tests.** Zero spec files, no test runner configured, no
coverage instrumentation. The only automated checks on this app are `next build`
(which typechecks) and the Playwright browser smoke, which drives one documented
flow: login → cited answer → refusal → dose calculation → copy protection →
role-aware navigation in both directions → language switching and RTL mirroring
→ responsive breakpoints → search and filtering → the user lifecycle → audit
filtering.

That smoke is genuinely good — role-visibility checks are asserted in **both**
directions, so a locator that silently matched nothing can no longer make them
pass vacuously — but it is a smoke script, not a suite, and it reports no test
count. Everything else about this app rests on it compiling and on manual use.

One class of defect this audit found is caught by nothing: a hardcoded English
literal never enters the dictionary, so compiler-enforced parity cannot see it,
and the smoke test asserts `dir`/`lang` and one Arabic nav label but nothing
about shared chrome. `ErrorState` and `Pagination` rendered English on 14 and 3
surfaces respectively while every screen around them translated. No test was
added for it, and the honest reasons are recorded in `09-GAPS.md`.
