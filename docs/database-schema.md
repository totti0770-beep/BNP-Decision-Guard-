# Database schema

PostgreSQL 16 with the `vector` extension. Schema is created by the TypeORM
migration `apps/api/src/migrations/1720000000000-initial-schema.ts`.

## Identity & access

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `users` | Accounts | `email` (unique), `password_hash` (bcrypt), `is_active`, `mfa_enabled`, `mfa_secret`, `last_login_at` |
| `roles` | 7 seeded roles | `name` (unique) |
| `permissions` | Permission catalogue | `code` (unique, e.g. `documents:approve`) |
| `role_permissions` | Role ⇄ permission M:N | composite PK |
| `user_roles` | User ⇄ role M:N | composite PK |

## Knowledge base

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `documents` | Governed document registry | `category`, `status` (lifecycle), `version_number`, `storage_key` (S3), `issuing_authority` (the publishing body; nullable, never inferred), `approval_date`, `expiry_date`, `uploaded_by_id`, `approved_by_id` |
| `document_versions` | Immutable version history | `(document_id, version_number)` unique, `change_note`, `storage_key` |
| `document_chunks` | RAG index | `content`, `page_number`, `embedding vector(384)` + **HNSW cosine index**, `version_number` (must match parent doc for retrieval), `embedding_provider` (must match the configured provider — see the retrieval invariant), `UNIQUE (document_id, version_number, chunk_index)` |
| `document_approvals` | Workflow trail | `action`, `from_status`, `to_status`, `actor_id`, `comment` |
| `review_findings` | Pre-activation conflict scan results | `version_number` (a **snapshot**, not a join — the approval gate reads `version_number = documents.version_number`, so a re-upload supersedes findings with no sweep), `rule_code`, `severity` (`BLOCKING`/`MAJOR`/`MINOR`), `status` (`OPEN`/`WAIVER_PENDING`/`RESOLVED`/`WAIVED`/`SUPERSEDED`/`DISMISSED`), `fingerprint` with `UNIQUE (document_id, version_number, fingerprint)` so a re-scan of the same bytes is idempotent and never overwrites a waiver; partial index on `(document_id, version_number) WHERE status IN ('OPEN','WAIVER_PENDING') AND severity = 'BLOCKING'` — exactly the gate's query |
| `finding_evidence` | Where each finding was seen | `page_number`, `locus_index` (two-locus rules compare two places in one document), `snippet` (verbatim source text, `varchar(240)` — PHI screening covers request bodies only, so nothing screens what the scanner lifts out of a PDF), `char_start`, `char_end` |
| `finding_resolutions` | Signatures on a finding | `action` (`RESOLVE`/`WAIVE`/`DISMISS`), `actor_id` **NOT NULL** (no machine signs a waiver; unlike `document_approvals.actor_id`, nullable for the expiry cron), `actor_role` (the authority exercised, resolved from the database at signing time and frozen — a later role change must not rewrite who was entitled to sign), `justification` NOT NULL at the database, `UNIQUE (finding_id, actor_id, action)` so one person cannot sign twice |

## AI Q&A

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `ai_questions` | Every question asked | `user_id`, `assistant_type`, `category`, `channel` (WEB/MOBILE) |
| `ai_answers` | Every answer incl. refusals | `short_answer`, `steps` (jsonb), `warnings` (jsonb), `confidence`, `refused`, `model`, `latency_ms`, `review_status`, `reviewed_by_id` |
| `citations` | Sources per answer | `document_id`, `chunk_id`, `document_title`, `issuing_authority` (snapshot at answer time, like `document_title`), `page_number`, `approval_date`, `similarity`, `snippet` |

## Dose calculator

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `dose_formulas` | Formula registry | `formula_type` (MG_PER_KG_PER_DOSE / MG_PER_KG_PER_DAY / FIXED_DOSE), `dose_per_kg`, `max_single_dose`, `max_daily_dose`, `status` (must be APPROVED to use), `approved_by_id`, `source_document_id` |
| `dose_calculations` | Every calculation | `inputs` (jsonb), `steps` (jsonb), `final_dose_mg`, `volume_ml`, `warnings` (jsonb), `user_id` |

## Governance

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `audit_logs` | Full audit trail | `actor_id`, `actor_email`, `action`, `resource_type/id`, `metadata` (jsonb, before/after), `ip`, `user_agent`; indexed on `created_at` and `action` |
| `notifications` | Expiry & governance alerts | `user_id`, `type`, `is_read`, `metadata` |
| `settings` | Key/value platform config | `key` (PK), `value` (jsonb), `updated_by_id` |

## Retrieval invariant

The only query path that reaches the LLM is
(`apps/api/src/rag/retrieval.service.ts:62-78`):

```sql
SELECT ... FROM document_chunks c
JOIN documents d ON d.id = c.document_id
WHERE d.status = 'ACTIVE'
  AND (d.expiry_date IS NULL OR d.expiry_date > now())
  AND c.version_number = d.version_number
  AND c.embedding_provider = $configured_provider
ORDER BY c.embedding <=> $query_vector
LIMIT $k;
```

**All four predicates are load-bearing.** Draft, in-review, rejected, expired
and deactivated documents and stale versions are structurally unreachable —
and so are chunks embedded by a provider other than the one currently
configured.

That fourth filter is the least obvious and the easiest to drop by accident.
Vectors from different embedding providers occupy incompatible spaces, so
comparing across them yields a similarity score that is arithmetically valid
and clinically meaningless. Filtering instead means switching
`EMBEDDING_PROVIDER` makes the assistant **refuse everything** — visibly
wrong, and safe — rather than answer from junk similarity, until
`POST /rag/reindex` re-embeds the corpus. `providerCoverage()` reports how
many chunks are affected, and `test/rag-integrity.e2e-spec.ts` pins the
behaviour against a real database.
