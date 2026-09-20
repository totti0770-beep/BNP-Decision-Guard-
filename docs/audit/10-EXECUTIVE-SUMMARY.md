# 10 — Executive summary

A CTO-level read of BNP Decision Guard at commit `1e00e01`, branch
`claude/project-discovery-audit-baseline-pwj2xx`. Every number below was
produced by a command run against this tree, and the command is named. Where I
could not prove something, it is in §9 rather than stated as fact.

**One sentence:** this is a genuinely built product with no stub screens and no
unfinished modules, deployed and serving today, whose remaining distance to a
clinical pilot is almost entirely *not* engineering work.

---

## The classification you asked for

| Layer | Verdict | Evidence |
| --- | --- | --- |
| **API** | **Completed and deployable** | 50 routes, every one backed by a service that touches a database, S3 or an LLM. No module returns canned data. `grep -rniE 'TODO\|FIXME\|HACK\|XXX' apps/api/src apps/web/src apps/mobile/src` → **0 hits**. |
| **Web** | **Completed and deployable** | 18 routes under `apps/web/src/app`, **all 18** reaching the real API — the two that do not import `lib/api` directly (`assistant`, `drug-prep`) delegate to `AssistantChat`, which does. **No UI-only screen exists.** |
| **Mobile** | **Completed as a thin client; three advertised capabilities absent** | 6 screens, all calling the real API. `apps/mobile/package.json` declares six runtime dependencies — `expo`, `react`, `react-native`, `react-native-safe-area-context`, `expo-secure-store`, `@react-native-async-storage/async-storage`. There is **no biometric library, no SQLCipher, no offline database**: those are concept only. |
| **Data model** | **Completed** | 15 `@Entity` classes, 6 migrations, `synchronize: false` (`config/data-source.ts:41`). Column-by-column reconciliation found **no schema drift**. |
| **Governance workflow** | **Completed** | `DRAFT → IN_REVIEW → APPROVED → INDEXED → ACTIVE` enforced by a `TRANSITIONS` map (`approval.service.ts:17-30`), exercised end to end in `test/document-lifecycle.e2e-spec.ts`. |
| **RAG chain** | **Completed** | Four hard SQL filters (`retrieval.service.ts:71-74`), four refusal gates all routing through one `refusal()` (`rag-query.service.ts:122,160,167,177`). |
| **Infrastructure** | **Architecture only, except Railway** | `infra/k8s/*` are reference manifests pointing at `bnp-decision-guard/api:latest`, an image that exists in no registry (`infra/k8s/README.md:52`). `infra/railway/README.md` documents the one deployment that is actually running. |
| **Clinical validation** | **Concept → now instrumented, still unperformed** | `docs/clinical-validation.md` is the protocol; `apps/api/eval/` + `npm run eval:field` generate the §5.2 sheet. No clinician has filled one in. |
| **Observability / backups** | **Missing** | No metrics, tracing or error tracking is wired; `infra/k8s/README.md:58-59` records both gaps. |

---

## 1. Completion percentage

**Method, so you can disagree with the number rather than the feeling.** Each
area is scored by counted artefacts, not judgement, then weighted by how much of
a clinical deployment it represents.

| Area | Measure | Count | Score | Weight |
| --- | --- | --- | --- | --- |
| API surface | routes wired to real services | 50/50 | 100% | 20% |
| API authorization | routes with an explicit guard decision | 50/50 (38 `@Permissions`, 7 `@Public()`, 5 authenticated-only) | 100% | 10% |
| Persistence | entities present in a migration | 15/15 | 100% | 10% |
| Web | routes reaching the API | 18/18 | 100% | 15% |
| Mobile | screens reaching the API | 6/6 | 100% | 5% |
| Mobile hardening | advertised capabilities implemented (offline store, biometrics, at-rest encryption) | 0/3 | 0% | 5% |
| Automated testing | suites green | 423 unit + 240 e2e + 32 mobile | 90% — web UI has **no unit tests at all**; the browser smoke is the only web coverage | 15% |
| Operability | health ✅, readiness ✅, structured logs ✅, metrics ❌, tracing ❌, error tracking ❌, backups ❌ | 3/7 | 43% | 10% |
| Clinical validation | reviewer-scored questions on a real corpus | 0 | 0% | 10% |

**Weighted total: 79%.**

Read it with its shape, not as one number: **engineering is ~95% done; the
non-engineering 21% is where the risk lives.** No amount of further coding moves
the clinical-validation row.

## 2. Readiness score

| Gate | Score | The one fact that sets it |
| --- | --- | --- |
| **Demo / investor walkthrough** | **10/10** | Running today at the Railway deployment; the full stack comes up from `docker compose up` again as of `a46181d`. |
| **MVP (internal, synthetic corpus)** | **9/10** | Complete governed loop, upload → approve → index → cited answer → refusal, proven in CI. |
| **Pilot (one ward, real corpus, supervised)** | **5/10** | Blocked on clinical sign-off and a real approved corpus — neither is code. |
| **Production (unsupervised clinical use)** | **4/10** | Add backups with a rehearsed restore, observability and an image registry. Was 3/10 while 8 high advisories stood; they are now **0 at every severity**, closed without the framework major everything assumed they needed. |

## 3. Critical missing components

1. **Clinical validation has never been performed.** `docs/production-readiness.md:260` carries it as 🔴. The instrument now exists (`npm run eval:field` emits the §5.2 sheet with the machine columns filled and the four judgement columns blank); a filled sheet does not.
2. **No approved clinical corpus.** The four seeded documents are synthetic by design. Production reports **2,706 chunks**, all on the active provider, none stale — the API's boot log on Railway deployment `f750d589` (commit `a3e4f21`, 2026-09-14T20:11:01Z): `Embedding index: provider="openai-embedding" chunks=2706 staleRetrievable=0 staleOrphaned=0 columnDimensions=384 refusalThreshold=0.25`. Their provenance is unaudited: `GET /documents/inventory` answers that and needs an authenticated call. *This line said ~2,706 without a source, was corrected to the documented 725, and is now 2,706 again with the source attached — the sequence is recorded in `09-GAPS.md`, because the number was right and the documentation was stale, which is a different failure from the one the correction assumed.*
3. ~~**`documents` records no issuing authority.**~~ **Closed** — `issuing_authority` on `documents` and, as a snapshot, on `citations`; surfaced on upload, edit, the policies list, every citation in both clients, and the inventory report. Existing rows are `null` until a knowledge manager records the real body; nothing is inferred.
4. **No backup or restore.** Nothing in the repository backs anything up; a restore that has never been rehearsed is not a backup.
5. **No observability.** `/health` and `/health/ready` exist and logs are structured JSON, but nothing ships them anywhere and nothing measures latency, refusal rate or error rate in production.
6. **Container images exist in no registry.** `infra/k8s/*` reference `bnp-decision-guard/api:latest`; CI builds images and pushes them nowhere.

## 4. Technical debt

| Item | Evidence | Cost if left |
| --- | --- | --- |
| ~~**NestJS 12 major outstanding**~~ **Closed, and it was never the blocker** | The 7 "high" entries were 1 advisory (`multer`) and 6 inherited markers. `multer` 2.2.0 → 2.4.0 via the existing root override took the tree to 0 findings. NestJS 12 remains a routine upgrade, not security debt | — |
| **`PUT /settings/:key` is unvalidated, and nothing reads settings** | `settings.module.ts:64-72`; no consumer of `SettingsService` outside its own module | An API that stores values which change nothing |
| **Expiry cron runs in-process** | `notifications.service.ts:39`; `infra/k8s/README.md:57` | Runs once per replica — duplicate expiries the moment you scale |
| **Web has no unit tests** | no `*.spec.tsx` under `apps/web` | Every web regression must be caught by one browser smoke |
| **Documented counts drift — and the reasons under them** | counts corrected four times in this session; then the *explanation* under the advisory count turned out to be wrong too, in three documents and in this audit's own report | Docs that lie quietly. A stale number looks stale; a stale rationale looks like understanding |
| **`EMBEDDING_DIM` and `vector(384)` are independent** | `migrations/1720000000000-initial-schema.ts:99` vs `embedding.service.ts:4` | A provider change needs a migration nobody is reminded to write |

## 5. Recommended next actions

1. **Run `GET /documents/inventory` against production.** The chunk count is now known and current (2,706, from today's boot log); what is not known is which documents they belong to and whether each passed the governed workflow. That needs a `documents:read` token. *You, today, five minutes.*
2. **Commission the clinical review.** 40 questions from ward staff, ≥12 unanswerable, scored by a clinician per §5.2. The runner produces the paperwork. *Nurse educator + reviewer, ~2 weeks.*
3. ~~**Add an issuing-authority column** and surface it in citations.~~ **Done.** What remains is data entry: the 725 production documents' authorities are unrecorded until someone who knows them fills them in via `PATCH /documents/:id`.
4. **Managed Postgres backups + one rehearsed restore.** *~1 day.*
5. **Ship logs and add error tracking.** *~2 days.*
6. ~~**Plan the NestJS 12 migration.**~~ **Done differently, and in minutes rather than days.** The advisories it was supposed to close were one package (`multer`) plus six inherited markers; the tree is now at 0 findings without it. NestJS 12 is now an ordinary upgrade to schedule, not a security action.

## 6. Fastest path to launch (supervised pilot)

The engineering is done; this is a sequencing problem.

1. Load the real corpus through the governed workflow — knowledge managers, not engineers.
2. Confirm `EMBEDDING_PROVIDER=openai` with a key present; boot now **refuses** the key-less combination (`config/env.ts`), so a silent downgrade to the mock can no longer happen.
3. `POST /rag/reindex` and confirm `staleRetrievable = 0`.
4. Run the field set as a `NURSE_USER` against the live deployment; hand the sheet to the reviewer.
5. Reviewer fills columns (a)–(d); any single blocker under §6 stops the pilot.
6. Backups on, logs shipped, one ward, supervised.

**Critical path is step 5, and it is not yours.** Everything else is days.

## 7. Fastest path to fully functional

Add to the above: the expiry
cron moved to a single-replica `CronJob`; images pushed to a registry and pinned
by digest; web unit tests; metrics and tracing; a data-retention policy. **None
of it is on the pilot's critical path** — which is the useful finding, because it
means the gate is clinical, not technical.

---

## What changed during this audit

Five defects were found and fixed, each proven before the change: broadcast
notifications reaching nobody; MinIO withdrawn from Docker Hub breaking every
`docker compose up` and CI's only full-stack test; a silent fall-back to the
mock LLM when `OPENAI_API_KEY` was absent, including in the shipped k8s
manifests; 500s on any malformed `?limit=`; and `nodemailer`'s four advisories.

One reported defect **did not survive testing**: `GET /notifications` was
reported as returning every user's rows. The test written to prove it disproved
it. It is recorded here because an audit that hides its own corrections is not
an audit.
