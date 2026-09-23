# Production corpus audit — 2026-09-23

**Read-only.** Nothing was written to production to produce this report. Every
request against the live service was a `GET`.

The question this answers is not *"what has been uploaded"* but *"what can the
assistant cite in front of a nurse right now, and what is known about how it
got there"*. Those differ, and the figure in circulation — 2,760 chunks — was
until today a count of the first without evidence that it was also the second.

---

## 1. Sources

| | Source | How obtained |
| --- | --- | --- |
| S1 | API boot log, deployment `598377b9` (commit `9eb03d6`), 2026-09-22T12:40:01Z: `Embedding index: provider="openai-embedding" chunks=2760 staleRetrievable=0 staleOrphaned=0 columnDimensions=384 refusalThreshold=0.25` | Railway deployment logs |
| S2 | `GET /documents/inventory` | Authenticated SUPER_ADMIN browser session on the production web origin, 2026-09-23; values relayed into the engineering session |
| S3 | `GET /analytics/overview` | Same session, same day |
| S4 | Dashboard at `/dashboard` | Screenshot, same day |

This container cannot reach `*.up.railway.app` (the egress policy answers the
CONNECT with 403), so S2 and S3 were read from a browser that could, and the
values reported here are the ones relayed from it. The raw JSON was not
retained, and document ids were not recorded. See §7.

## 2. What the 2,760 counts

S1's `chunks=` is the sum of

```sql
SELECT embedding_provider, count(*) AS n FROM document_chunks GROUP BY embedding_provider
```

(`apps/api/src/rag/indexing.service.ts:145-146`, summed at `:76`). There is no
condition on document status, expiry or version: it counts the table.

The inventory's `totals.retrievableChunks` is the sum after all four retrieval
filters (`apps/api/src/documents/inventory.service.ts:259-261`), which are
derived one for one from `RetrievalService.search()`
(`inventory.service.ts:175-204` against `retrieval.service.ts:74-77`). So in
general `2760 ≥ retrievableChunks`, and the difference is the audit.

## 3. Reconciliation

| | Slice | Value | Source |
| --- | --- | --- | --- |
| A | Citable: ACTIVE, unexpired, current version, active provider | **2,760** | S2 `totals.retrievableChunks` |
| B | Earlier versions of ACTIVE documents | **0** | S2 `totals.supersededChunks` |
| C | ACTIVE documents excluded by expiry or provider | **0** | S2: all five rows `retrievable: true` |
| D | Documents that are not ACTIVE | **0** | Derived: S1 − (A + B + C) = 2760 − 2760 |

**D is derived, not read.** The inventory does not report it: its query is
restricted to `d.status = ACTIVE` (`inventory.service.ts:159`). The derivation
is valid because S1 is a snapshot at 12:40:01Z and the latest chunk on any
ACTIVE document was written at 10:54Z (S2 `totals.latestIndexedAt`), so no
chunk counted in A was created after S1 was taken.

**Result: every chunk in the table is citable.** The 2,760 figure in
`docs/clinical-validation.md` describes the approved corpus as well as the
stored one.

Two structural reasons this is expected rather than lucky:

- `B = 0` always after an index: `indexDocument` deletes *every* version's
  chunks for the document before inserting
  (`apps/api/src/rag/indexing.service.ts:245-248`).
- The nine documents that are not ACTIVE (§5) hold no chunks. Deactivation
  deletes them (`apps/api/src/approval/approval.service.ts:191-192`), and
  DRAFT, APPROVED and REJECTED documents were never indexed.

### Contradiction test

S1's `staleRetrievable=0 staleOrphaned=0` implies every chunk in the table is
stamped with the active provider (`indexing.service.ts:153-155`). The
inventory, computed by an independent query, had to agree:
`totals.documentsOnAnotherProvider` is **0** (S2). It agrees.

## 4. Classification of ACTIVE documents that cannot be cited

`notRetrievableReason` is non-null only when a nominally ACTIVE document is
excluded by a retrieval filter, with precedence fixed at
`inventory.service.ts:206-212`.

| Category | Count | Source |
| --- | --- | --- |
| Not indexed (`chunkCount = 0`) | **0** | S2 `totals.documentsWithNoChunks` |
| Expired | **0** | S2 `totals.documentsExpired`; independently S3 `near_expiry_documents = 0`, whose predicate `status = 'ACTIVE' AND expiry_date < now() + 30 days` (`apps/api/src/analytics/analytics.module.ts:20-22`) includes any ACTIVE document already past expiry |
| Another embedding provider | **0** | S2 `totals.documentsOnAnotherProvider` |

**No ACTIVE document is outside retrieval.**

Note on S4: the dashboard tile "expired — no longer citable: 0" counts
`status = 'EXPIRED'` (`analytics.module.ts:19`), which is documents the daily
sweep has already moved. On its own it would not rule out an ACTIVE document
past its expiry that the sweep had not reached yet. The 30-day tile does.

## 5. The corpus

| Document (as relayed) | Chunks | Approved | Issuing authority | L1 scan |
| --- | ---: | --- | --- | --- |
| HIGH-ALERT MEDICATIONS POLICY | 39 | 2026-09-17 | *null* | never run |
| IPP-MM 006.1 LASA | 15 | 2026-09-17 | *null* | never run |
| IV MANUAL GUIDELINE 2026 | 574 | 2026-09-02 | *null* | never run |
| JSH-DRUG FORMULARY 2026 | 2,120 | 2026-08-18 | *null* | never run |
| JSH-NR-ICU-001 Admitting Patient | 12 | 2026-08-14 | *null* | never run |
| **Total** | **2,760** | | | |

S3 `total_documents` is **14**. With `documents_in_review = 0` and
`expired_documents = 0` (S3), the other nine are DRAFT, APPROVED, INDEXED,
REJECTED or INACTIVE (`packages/shared/src/constants.ts:30-39`); the split
between those was not read.

## 6. Findings

**F1 — None of the five live documents has been read by the L1 conflict scan.**
The scan runs at submit-review (`approval.service.ts`, `submitReview()`), which
necessarily precedes approval. The latest approval is 2026-09-17; the scan
reached production at 2026-09-22T12:40:01Z (S1's deployment). An empty findings
list on these documents therefore means *not scanned*, not *clean*.
Until this change there was no way to scan them short of re-uploading, which
resets a document to DRAFT and removes it from retrieval until it is approved
again (`SUBMIT_REVIEW` accepts only DRAFT and REJECTED,
`approval.service.ts:20`). For the formulary that meant removing 77% of the
citable corpus for the length of a review.
*Remedy in this change:* `POST /documents/:id/findings/scan`, which scans an
ACTIVE document in place and changes no status.

**F2 — The findings panel described every unscanned live document as clean.**
For a document with no findings it said "No findings were raised on this
version", which reads as a scan result. On production that sentence was true
of no live document. *Remedy in this change:* on an ACTIVE document the empty
state now says an empty list is not evidence of a scan, until a scan in the
session says otherwise.

**F3 — No live document records who issued it.** All five carry
`issuingAuthority = null`. That is by design, not a defect: migration
`1720000005000` added the column with no backfill, because inferring a body
from a title or filename would be right often enough to be trusted and wrong
often enough to mislead (`inventory.service.ts:24-30`). The prefix "JSH-" on
three titles is exactly that temptation. But until now the field could be set
only at upload; the web app had no way to set it on an existing document.
*Remedy in this change:* an editor in the approvals-page disclosure, for
holders of `documents:manage`, calling the existing `PATCH /documents/:id`
(audited by value). The values must come from someone who knows them.

**F4 — One document is 76.8% of the citable corpus.** JSH-DRUG FORMULARY 2026
holds 2,120 of 2,760 chunks. The per-document cap on the final answer set
(`RAG_MAX_PER_DOCUMENT`, default 3, `apps/api/src/config/env.ts:105`) is what
keeps it from crowding out the other four; the deployed value of that variable
was not read. The formulary is also the document with the most dose
expressions, and so the most exposure to the ISMP rules, and it has never been
scanned (F1).

**F5 — Title hygiene.** As relayed, one title carries a leading space and two
end in `.pdf`. Titles are snapshotted into `citations.document_title` at answer
time, so a correction changes future citations only. It is a data edit through
the same `PATCH`.

### Context, not findings

- Refusal rate 47.6% (S4) is `refused_answers / total_questions`
  (`analytics.module.ts:44-50`); with 42 questions the only integer numerator
  giving 47.6% is 20. The denominator includes every question since launch,
  test traffic included, so this cannot be read as a rate on answerable
  questions. `docs/clinical-validation.md` §6 treats refusals of answerable
  questions as a tuning input, not a blocker.
- `questionsByDay` sums to 13 because it covers the last 14 days only
  (`analytics.module.ts:35`).

## 7. What this audit does not establish

- **Clinical soundness of any document or answer.** That is
  `docs/clinical-validation.md`, and it needs a qualified reviewer.
- **Who approved each document.** Inventory reports indexing state, not
  approval provenance. `GET /documents/:id/approval-history` was not read.
- **The response's `schema` field.** It was not relayed, so this report does
  not confirm the production payload is `bnp.clinical-reference-inventory.v2`.
- **Document ids, and the raw JSON.** Not retained. A re-run (§8) produces
  byte-identical output against an unchanged database, by design
  (`inventory.service.ts:32-37`).
- **The status of each of the nine non-ACTIVE documents.**
- **What a scan of the five would find.** It has not been run on production.
- **Whether a document was ever scanned, from the data alone.** No table
  records a scan that found nothing: `review_findings` holds findings, and a
  clean scan leaves no row. The screen can say "scanned just now", but it
  cannot yet say "scanned on 2026-09-24 and clean". Recording scans
  persistently is the follow-up that would close this.

## 8. Reproducing it

From a browser tab signed in to the production web app, in the developer
console (reads only; the token never leaves the page):

```js
const { accessToken } = JSON.parse(localStorage.getItem('bnp.session'));
const get = (p) => fetch('https://api-production-5f73.up.railway.app' + p,
  { headers: { Authorization: 'Bearer ' + accessToken } }).then((r) => r.json());
copy(JSON.stringify({ inventory: await get('/documents/inventory'),
                      overview: await get('/analytics/overview') }, null, 2));
```

## 9. After this change is deployed

Each is a write to production, and each is a decision for the people who own
it, not a step this report takes:

1. Scan each of the five in place from the approvals screen, starting with the
   formulary. A BLOCKING result there is shown, not enforced: whether to
   deactivate is a human call.
2. Record the issuing authority on each, from the documents themselves.
3. Re-read the inventory and compare it with §5.
