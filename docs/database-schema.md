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
| `documents` | Governed document registry | `category`, `status` (lifecycle), `version_number`, `storage_key` (S3), `approval_date`, `expiry_date`, `uploaded_by_id`, `approved_by_id` |
| `document_versions` | Immutable version history | `(document_id, version_number)` unique, `change_note`, `storage_key` |
| `document_chunks` | RAG index | `content`, `page_number`, `embedding vector(384)` + **HNSW cosine index**, `version_number` (must match parent doc for retrieval) |
| `document_approvals` | Workflow trail | `action`, `from_status`, `to_status`, `actor_id`, `comment` |

## AI Q&A

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `ai_questions` | Every question asked | `user_id`, `assistant_type`, `category`, `channel` (WEB/MOBILE) |
| `ai_answers` | Every answer incl. refusals | `short_answer`, `steps` (jsonb), `warnings` (jsonb), `confidence`, `refused`, `model`, `latency_ms`, `review_status`, `reviewed_by_id` |
| `citations` | Sources per answer | `document_id`, `chunk_id`, `document_title`, `page_number`, `approval_date`, `similarity`, `snippet` |

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

The only query path that reaches the LLM is:

```sql
SELECT ... FROM document_chunks c
JOIN documents d ON d.id = c.document_id
WHERE d.status = 'ACTIVE'
  AND (d.expiry_date IS NULL OR d.expiry_date > now())
  AND c.version_number = d.version_number
ORDER BY c.embedding <=> $query_vector
LIMIT $k;
```

Draft, in-review, rejected, expired, deactivated documents and stale versions
are structurally unreachable.
