# 03 — Modules: `packages/shared`

Four source files, 394 lines, and **zero runtime dependencies**. It is the
smallest unit in the repository and carries the most weight: the clinical safety
contract, the authorization matrix and the PHI scanner all live here, and
nothing a supply-chain advisory could reach sits underneath any of them.

| File | Lines | Holds |
| --- | --: | --- |
| `constants.ts` | 83 | three verbatim Arabic strings + eight enums |
| `phi.ts` | 159 | the PHI scanner — a pure function over a string |
| `rbac.ts` | 141 | 7 roles × 22 permissions, and `permissionsForRoles()` |
| `index.ts` | 11 | the barrel |

Consumed from **compiled output**: `package.json` sets
`"main": "dist/index.js"`, which is why `npm run build:shared` must run before
anything else on a fresh clone. `apps/api` and `apps/web` import it; `apps/mobile`
does not (see `03-MODULES-mobile.md`).

## `constants.ts` — the clinical contract

Three Arabic strings are returned **verbatim** and asserted by exact string
equality in tests. Rewording any of them fails the build.

| Constant | Returned when |
| --- | --- |
| `REFUSAL_MESSAGE_AR` | no approved source qualifies — all four RAG gates |
| `DOSE_SAFETY_WARNING_AR` | attached to **every** dose calculation result |
| `PHI_REJECTION_MESSAGE_AR` | the PHI screen rejects an input |

The third was added with PHI screening and is under the same contract as the
other two, not a lesser one: `phi-screen.guard.spec.ts:100` and
`phi-screening.e2e-spec.ts:137,273,299,331` all assert it with `toBe`.
`CLAUDE.md` described only two until this audit compared the section against the
file.

The file's header comment on `PHI_REJECTION_MESSAGE_AR` is worth quoting for
what it reveals about the design: the message a nurse sees when the platform
refuses their input is part of the clinical contract, not a controller detail —
and it has to tell them *what to remove*, because a bare "invalid input" teaches
nothing and invites a retry with the same data.

Eight enums follow: `DocumentCategory` (5), `DocumentStatus` (8),
`ApprovalAction` (7), `ConfidenceLevel` (4), `AssistantType` (3),
`DoseFormulaStatus` (3), `DoseFormulaType` (3), `DoseRoute` (6), plus
`PLATFORM_NAME`.

## `rbac.ts` — the single source of truth for authorization

7 roles, 22 permissions, and a `ROLE_PERMISSIONS` matrix mapping every role.
`permissionsForRoles()` unions via a `Set` and **silently ignores unknown
roles** — which is the mechanism behind "a role that exists only in the database
grants nothing".

| Role | Reach |
| --- | --- |
| `SUPER_ADMIN` | all 22 |
| `HOSPITAL_ADMIN` | everything except approving, indexing, answer review and dose-formula management |
| `NURSING_KNOWLEDGE_MANAGER` | the full document lifecycle, including approve and index, plus answer review |
| `PHARMACIST_REVIEWER` | approvals, dose-formula manage + approve, answer review |
| `CBAHI_QUALITY_OFFICER` | the quality-document workflow, answer review |
| `NURSE_USER` | `CLINICAL_READ` only — `documents:read`, `ai:ask`, `ai:search`, `dose:calculate`, `notifications:read` |
| `AUDITOR` | four read permissions; **no AI access at all** |

Two absences are deliberate and both carry a comment:

- **There is no `ROLES_MANAGE` permission.** Permissions are compiled into this
  file; a runtime edit to `role_permissions` would authorize nothing. The roles
  API is read-only for the same reason, and the endpoints that appeared to edit
  permissions were removed rather than left looking functional.
- **`documents:download` is withheld from `NURSE_USER` and `AUDITOR`.** Nurses
  read cited answers; they do not copy source PDFs. The consequence is traced:
  those roles get 403 on `GET /documents/:id/download-url`, and the download
  control on `/policies` is unusable for them.

## `phi.ts` — a pure scanner with no dependencies

No database, no request object, no logger. `scanForPhi(text, options)` returns
the matching **categories** and never any part of the text — which is what makes
the "the audit row never carries the input" property possible upstream.

Four patterns are built in:

| Category | Pattern |
| --- | --- |
| `NATIONAL_ID` | ten digits beginning 1 or 2 (Saudi national ID / Iqama) |
| `DATE_OF_BIRTH` | a full numeric date, either order |
| `PHONE` | Saudi mobile in three forms |
| `IDENTIFYING_CONTEXT` | Arabic and English phrases, each requiring a trailing value |

A fifth, `MRN`, runs **only when a pattern is supplied**. `PHI_MRN_PATTERN`
ships unset because the platform has no institutional MRN format yet, and a
guessed pattern either misses every real MRN or fires on batch numbers. A
malformed pattern **fails the boot** rather than being ignored — falling back to
"no MRN check" on a typo would disable a security control silently.

`foldDigits()` maps Arabic-Indic and Extended Arabic-Indic digits to ASCII
before matching, so switching keyboards is not a bypass.

Two profiles exist because one would be wrong: `FREE_TEXT` runs everything,
`METADATA` runs only the identifier patterns (national ID, phone, MRN), because
dates and names are legitimate in governance text and a control that blocks
correct work gets switched off.

**One accepted false positive, pinned by a test so it stays a decision on
record:** a ten-digit batch or catalogue number starting with 1 or 2 is
rejected. Matching any ten digits would reject batch numbers, catalogue codes
and long dose figures indiscriminately.

The corpus that keeps the patterns honest is the 15-case gold set, asserted
against the live screen — and the reason that binding exists is instructive. The
first identifying-phrase pattern matched `patient id` as a prefix of "patient
identifiers" and rejected *"Which two patient identifiers must be checked before
administering a medication?"* — a medication-safety question a nurse asks
constantly. Fourteen hand-written negative cases missed it; the gold set caught
it on the first full run. The field set is now asserted the same way, so every
case a hospital adds widens the false-positive corpus for free.

## `index.ts`

Re-exports `./constants`, `./phi` and `./rbac`. Its comment records that a
former `types.ts` of eight DTO interfaces was deleted after a sweep found zero
consumers — a `REPO-DISCOVERY.md` §23.1 finding that was acted on.

## Testing

`packages/shared` has **no test script and no spec files of its own.** Its
behaviour is covered entirely from `apps/api`: `phi-scanner.spec.ts` exercises
the scanner, `permissions.guard.spec.ts` the matrix, and the clinical strings are
asserted across the unit and integration suites.

That is defensible — the consumers test the contract they depend on — but worth
naming, because it means a change here is only caught if an API test happens to
cover the case. The compiler helps: `Permission` and `RoleName` are enums, so a
removed member fails every site that names it.
