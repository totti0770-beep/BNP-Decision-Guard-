# Architecture

## System overview

```mermaid
graph TB
    subgraph Clients
        WEB[Next.js Web App<br/>13 governance screens]
        MOB[Expo Mobile App<br/>nurse companion]
    end

    subgraph API [NestJS API]
        AUTH[Auth<br/>JWT + refresh + MFA]
        RBAC[PermissionsGuard<br/>7-role matrix]
        DOCS[Documents +<br/>Approval Workflow]
        RAG[RAG Pipeline]
        CHAT[Chat / Assistants]
        DOSE[Dose Calculator]
        AUDIT[Audit Interceptor + Log]
        NOTIF[Notifications + Expiry Cron]
    end

    subgraph Data
        PG[(PostgreSQL 16<br/>+ pgvector HNSW)]
        S3[(MinIO / S3<br/>PDF storage)]
    end

    subgraph AI [Pluggable Providers]
        MOCKE[Mock hash embeddings<br/>no API key]
        MOCKL[Mock extractive LLM<br/>context-only]
        OAI[OpenAI-compatible<br/>optional]
    end

    WEB --> API
    MOB --> API
    AUTH --> RBAC
    DOCS --> S3
    DOCS --> RAG
    RAG --> PG
    RAG --> AI
    CHAT --> RAG
    CHAT --> AUDIT
    DOSE --> AUDIT
    DOCS --> AUDIT
    NOTIF --> PG
```

## RAG query flow (refusal-first)

```mermaid
sequenceDiagram
    participant N as Nurse
    participant C as ChatService
    participant R as RetrievalService
    participant K as RerankService
    participant L as LLM (mock/OpenAI)

    N->>C: POST /chat/ask {question}
    C->>C: persist ai_question (audited)
    C->>R: vector search (pgvector cosine)
    Note over R: WHERE status='ACTIVE'<br/>AND not expired<br/>AND current version only
    R-->>C: top-K chunks
    C->>K: rerank (vector + lexical coverage)
    alt best score < RAG_MIN_SIMILARITY or no chunks
        C-->>N: EXACT refusal (Arabic), confidence NONE, 0 citations
    else
        C->>L: question + surviving chunks ONLY
        L-->>C: {shortAnswer, steps, warnings}
        alt LLM found nothing in context
            C-->>N: EXACT refusal
        else
            C-->>N: answer + citations (doc, page, approval date) + confidence
        end
    end
    C->>C: persist ai_answer + citations (audited)
```

## Document lifecycle

```mermaid
stateDiagram-v2
    [*] --> DRAFT: upload (new or new version)
    DRAFT --> IN_REVIEW: submit-review
    IN_REVIEW --> APPROVED: approve (reviewer role)
    IN_REVIEW --> REJECTED: reject + reason
    REJECTED --> IN_REVIEW: resubmit
    APPROVED --> INDEXED: index (extract→chunk→embed)
    INDEXED --> ACTIVE: activate (automatic after index)
    ACTIVE --> EXPIRED: expiry cron (daily)
    ACTIVE --> INACTIVE: deactivate
    APPROVED --> INACTIVE: deactivate
    EXPIRED --> INACTIVE: deactivate
    note right of ACTIVE: ONLY this state is<br/>visible to AI retrieval
```

## Key design decisions

| Decision | Rationale |
| --- | --- |
| Refusal enforced **server-side, before and after** the LLM | The model can never be prompted into answering without sources |
| Mock LLM is extractive | Zero-hallucination baseline; system runs without any API key |
| Chunks never cross page boundaries | Page-accurate citations |
| Chunks tied to `documents.version_number` | New versions must be re-approved and re-indexed before retrieval |
| Permission matrix in `packages/shared` | One source of truth for API guard, web nav and seeds |
| Global audit interceptor + domain events | Coarse HTTP trail plus semantic events (refusals, approvals, downloads) |
