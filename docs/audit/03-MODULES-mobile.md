# 03 — Modules: mobile (`apps/mobile`)

Expo 57 / React Native 0.86.2 / React 19.2.3. **Not an npm workspace** — it has
its own `package.json` and its own lockfile, and installs from its own
directory. That is deliberate (Expo and Metro resolve hoisted dependencies
badly) and it has one security consequence: a root `npm audit` cannot see this
tree, which is why CI runs a separate audit gate inside it.

## The files

| File | Lines | Role |
| --- | --: | --- |
| `App.tsx` | 179 | the whole app shell — session restore, tab switch, language |
| `src/screens/ChatScreen.tsx` | 393 | the assistant |
| `src/screens/LoginScreen.tsx` | 272 | login + the TOTP step |
| `src/screens/DoseCalculatorScreen.tsx` | 201 | formula picker, inputs, result |
| `src/screens/HomeScreen.tsx` | 177 | overview tiles |
| `src/screens/AuditScreen.tsx` | 163 | audit browsing |
| `src/screens/PoliciesScreen.tsx` | 105 | approved-document list |
| `src/theme.ts` | 177 | design tokens |
| `src/api.ts` | 181 | the API client |
| `src/i18n.ts` | 175 | the Arabic-first dictionary |
| `src/components/BottomNav.tsx` | 67 | the tab bar |
| `src/api.spec.ts` | 348 | session storage, refresh-on-401 |
| `src/i18n.spec.ts` | 74 | the bilingual helpers |
| `test/mocks/async-storage.ts`, `test/mocks/expo-secure-store.ts` | — | two **separate** fakes |

**There is no navigation library.** `App.tsx` holds `const [tab, setTab] =
useState<Tab>(...)` and renders one screen per tab value. It also falls back to
`home` if the stored tab is one the current role cannot see — a small thing that
prevents a demoted user landing on a screen their permissions no longer cover.

## What the mobile app covers, and what it does not

Six of the web app's nineteen routes: login, home, chat, dose calculator, audit,
policies. It has **no** upload, approvals, answer review, user management,
settings, CBAHI search, drug-preparation or password-reset screen. A nurse is
fully served; a knowledge manager, pharmacist reviewer or administrator is not.

## The one thing this module gets more right than the web app

**Tokens go to the OS keychain, and a test proves they never go anywhere else.**
`expo-secure-store` holds the access and refresh tokens; `AsyncStorage` holds
only the user profile and an API-URL override. `api.ts` additionally performs a
one-time migration that deletes any pre-SecureStore plaintext session left in
AsyncStorage by an older build.

The reason that claim is checkable is a test-design decision: the two native
storage modules are mapped to **separate** fakes in `test/mocks/` via
`moduleNameMapper`. Keeping them separate is what lets `api.spec.ts` assert that
a token reached SecureStore *and* that AsyncStorage never saw it. A single
shared fake would have made the assertion unwritable.

The 32 tests also pin a 401 refreshing exactly once and replaying with the new
token without looping, session teardown when refresh fails, and the RTL helpers.
Each assertion was checked against a deliberately broken copy of the module —
mutation testing, not just green checkmarks.

## Why `jest.config.js` uses `testEnvironment: node`

Not the `jest-expo` preset, because neither `api.ts` nor `i18n.ts` imports a
React Native component. That is a correct choice for what is covered and it is
also the boundary of what *can* be covered: **the screens have no runtime
coverage at all.** Testing them needs `jest-expo` plus
`@testing-library/react-native`, which this app does not install.

CI runs `tsc --noEmit` over the screens, so they typecheck. Nothing executes
them.

## Deliberate divergences from the web app

Both are recorded in the source rather than inferred:

- **Mobile is Arabic-first; web defaults to English.** Not an inconsistency: the
  web app is already live and its governance screens skew English-speaking, so
  an English default changes nothing for a current user until they opt in. Which
  language is *default* is a per-client product call; both languages exist on
  both clients.
- **`src/i18n.ts` has `row()`/`align()` helpers that the web dictionary does
  not.** The browser does natively what React Native cannot: `dir="rtl"` flips
  layout and `dir="auto"` picks direction from content. React Native has no
  equivalent, so direction has to be computed and applied per style.

## Genuine duplication, and why it stands

`apps/mobile` does **not** depend on `@bnp/shared`. It therefore redeclares its
own i18n dictionary (175 lines against the web's 1,044) and its own API client
(181 lines against 92). Keys overlap. Both implement bearer auth and
refresh-on-401 independently.

This is real duplication rather than a misreading, and it follows from the
workspace decision above: sharing would mean either making mobile a workspace —
which Expo/Metro resolve badly — or publishing `@bnp/shared` somewhere both
installs can reach. Neither is free, and the duplicated surface is small and
stable. It is named here so the cost is visible, not to argue it should change.

The two contractual Arabic strings are the one thing that must **not** be
duplicated, and they are not: they come from the API in responses, verbatim.

## Build and release

`eas.json` carries development / preview / production profiles with per-profile
`EXPO_PUBLIC_API_URL`, and iOS/Android identifiers are in `app.json`.
**No CI job builds or publishes the mobile app.** Store builds need an Expo
account (`eas login && eas init`) and, for production signing, Apple/Google
developer credentials.

The Expo 51 → 57 upgrade was verified without a device: typecheck on TS 5.9 /
React 19 types, 32/32 tests with both storage-mock surfaces re-checked against
the shipped module versions, and `npx expo export` producing Hermes bundles for
both platforms — the strongest headless proof the bundle graph resolves under
the New Architecture. **On-device checks under mandatory edge-to-edge remain
operator-owned**: keyboard behaviour on login, the chat composer against the nav
bar, bottom-nav clearance above the gesture bar, and first-launch session
restore.

## Advisory posture

The Expo 51 → 57 upgrade took this tree from 1 critical / 21 high / 11 moderate
to **8 high and nothing else**, per `SECURITY.md`. Those 8 all chain from one
advisory pair on `image-size`, which is vulnerable at *every published version*
(`<=2.0.2`, which is latest) — so no dependency graph anywhere can clear it
today. It sits in Metro's build-time asset pipeline and this app ships zero
image assets. The mobile CI job hard-fails on critical, matching the root job,
and reports high/moderate without blocking.

Those figures could not be re-measured in this audit: `apps/mobile/node_modules`
is absent from the container, and the tree installs separately. CI measures them
on every push.
