# REST API reference

Base URL: `http://localhost:4000`. All endpoints except `/health` and `/auth/*`
require `Authorization: Bearer <accessToken>` and the listed permission.

## Auth

| Method & path | Body | Notes |
| --- | --- | --- |
| `POST /auth/login` | `{email, password}` | → tokens + user, or `{mfaRequired, mfaToken}` |
| `POST /auth/mfa/verify` | `{mfaToken, code}` | TOTP verification → tokens |
| `POST /auth/refresh` | `{refreshToken}` | → new token pair |
| `POST /auth/register` | `{email, password, fullName}` | self-registration → NURSE_USER role |

## Users & roles

| Endpoint | Permission |
| --- | --- |
| `GET /users` | `users:read` |
| `GET /users/me` | (any authenticated) |
| `POST /users` `{email, password, fullName, roles[]}` | `users:manage` |
| `PATCH /users/:id` `{fullName?, password?, isActive?, roles?}` | `users:manage` |
| `DELETE /users/:id` (soft deactivate) | `users:manage` |
| `GET /roles` | `roles:read` |
| `POST /roles` / `PATCH /roles/:id` | `roles:manage` |

## Documents & approval workflow

| Endpoint | Permission |
| --- | --- |
| `POST /documents/upload` (multipart: `file` PDF + `title`, `category`, `description?`, `expiryDate?`, `documentId?` for a new version) | `documents:upload` |
| `GET /documents?category=&status=&search=&limit=&offset=` | `documents:read` |
| `GET /documents/:id` · `GET /documents/:id/versions` · `GET /documents/:id/approval-history` | `documents:read` |
| `PATCH /documents/:id` `{title?, description?, expiryDate?}` | `documents:manage` |
| `GET /documents/:id/download-url` (5-min presigned URL, audited) | `documents:download` |
| `POST /documents/:id/submit-review` `{comment?}` | `documents:submit-review` |
| `POST /documents/:id/approve` / `.../reject` `{comment?}` | `documents:approve` |
| `POST /documents/:id/index` (extract→chunk→embed→ACTIVE) | `documents:index` |
| `POST /documents/:id/deactivate` `{comment?}` (removes from AI) | `documents:deactivate` |

## RAG & chat

| Endpoint | Permission |
| --- | --- |
| `POST /rag/query` `{question, category?}` — raw governed answer, no persistence | `ai:ask` |
| `GET /rag/search?q=&category=` — semantic search, returns chunks | `ai:search` |
| `POST /chat/ask` `{question, assistantType?: NURSING\|DRUG_PREPARATION\|CBAHI, category?, channel?}` — persisted + audited | `ai:ask` |
| `GET /chat/history?limit=` — own Q&A history | `ai:ask` |
| `POST /chat/answers/:id/review` `{status: APPROVED\|FLAGGED}` — committee review | `ai:review-answers` |

Answer shape:

```json
{
  "refused": false,
  "shortAnswer": "...",
  "steps": ["..."],
  "warnings": ["..."],
  "confidence": "HIGH|MEDIUM|LOW|NONE",
  "citations": [{
    "documentTitle": "...", "pageNumber": 1,
    "approvalDate": "2026-07-05T...", "similarity": 0.68, "snippet": "..."
  }]
}
```

When refused, `shortAnswer` is exactly
`لا توجد وثيقة معتمدة كافية للإجابة. الرجاء الرجوع للمسؤول المختص.` with
`confidence: "NONE"` and zero citations.

## Dose calculator

| Endpoint | Permission |
| --- | --- |
| `POST /dose/calculate` `{formulaId, weightKg, ageYears?, concentrationMgPerMl?, requiredDoseMg?, route?, frequencyPerDay?}` | `dose:calculate` |
| `GET /dose/formulas` (approved only; `?all=true` for managers) | `dose:calculate` |
| `POST /dose/formulas` | `dose:formulas-manage` |
| `POST /dose/formulas/:id/approve` | `dose:formulas-approve` (Pharmacist Reviewer) |

Calculations with non-APPROVED formulas are rejected (400). Every result
includes step-by-step math, max-dose capping and the verbatim Arabic safety
warning.

## Governance

| Endpoint | Permission |
| --- | --- |
| `GET /audit-logs?action=&actorEmail=&resourceType=&limit=&offset=` | `audit:read` |
| `GET /analytics/overview` | `analytics:read` |
| `GET /settings` | `settings:read` |
| `PUT /settings/:key` `{value}` | `settings:manage` |
| `GET /notifications` · `POST /notifications/:id/read` | `notifications:read` |
| `GET /health` | public |
