import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Permission } from '@bnp/shared';
import {
  AuthenticatedUser,
  CurrentUser,
  Permissions,
} from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { EmbeddingService, EMBEDDING_DIM } from './embedding.service';
import { redactSecrets } from './openai-http';
import { RagQueryService } from './rag-query.service';
import { RetrievalService } from './retrieval.service';
import { RerankService } from './rerank.service';
import { IndexingService } from './indexing.service';

class RagQueryDto {
  @IsString() @IsNotEmpty() question: string;
  @IsOptional() @IsString() category?: string;
}

@Controller('rag')
export class RagController {
  constructor(
    private readonly ragQuery: RagQueryService,
    private readonly retrieval: RetrievalService,
    private readonly rerank: RerankService,
    private readonly indexing: IndexingService,
    private readonly embeddings: EmbeddingService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Exercises the embeddings provider with one throwaway vector and reports
   * what came back.
   *
   * This exists because the only way to find out why indexing was failing
   * used to be to index something — which on a live system means pushing a
   * document through the approval workflow and into the corpus, where the
   * assistant can cite it, just to read an error. This runs the identical
   * code path (`openAiPost('/embeddings', …)`, same model, dimensions and
   * auth header) against a fixed probe string, writes nothing, and changes
   * no document state.
   *
   * Two things it deliberately does *not* do:
   *
   * - It is not part of `/health/ready`. Readiness is polled every few
   *   seconds; billing an embeddings call per poll, and pulling a pod out of
   *   rotation over a dependency that only affects ingestion rather than
   *   request serving, would both be wrong.
   * - It never returns the provider's raw response body. That is logged
   *   server-side, already redacted, by `openAiPost`. What comes back here
   *   is our own error string, redacted again as cheap insurance since a
   *   network-level failure can carry the configured base URL.
   *
   * A dimension mismatch is worth as much as a hard failure: the pgvector
   * column is fixed-width, so a provider returning a different size fails at
   * INSERT time, long after the request that caused it.
   *
   * Under the mock provider this always succeeds — it makes no network call.
   */
  @Post('provider-check')
  @Permissions(Permission.DOCUMENTS_INDEX)
  async providerCheck(@CurrentUser() actor: AuthenticatedUser) {
    const startedAt = Date.now();
    let ok = false;
    let dimensions: number | null = null;
    let error: string | null = null;

    try {
      const vector = await this.embeddings.embedOne(
        'embedding provider connectivity probe',
      );
      dimensions = vector.length;
      ok = dimensions === EMBEDDING_DIM;
      if (!ok) {
        error =
          `Provider returned ${dimensions}-dimension vectors but EMBEDDING_DIM ` +
          `is ${EMBEDDING_DIM}; inserts into the vector(${EMBEDDING_DIM}) column will fail.`;
      }
    } catch (err) {
      error = redactSecrets(err instanceof Error ? err.message : String(err));
    }

    const durationMs = Date.now() - startedAt;
    // Corpus coverage is reported even when the probe fails: "everything
    // refuses" has two very different causes, and this separates them.
    const corpus = await this.indexing.providerCoverage();

    this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'RAG:PROVIDER_CHECK',
      resourceType: 'rag_index',
      metadata: {
        provider: this.embeddings.name,
        ok,
        durationMs,
        staleChunks: corpus.staleChunks,
      },
    });

    return {
      provider: this.embeddings.name,
      ok,
      probe: { dimensions, expectedDimensions: EMBEDDING_DIM, durationMs },
      error,
      corpus,
    };
  }

  /**
   * Re-embeds every ACTIVE document with the currently configured embedding
   * provider. Run this once after changing EMBEDDING_PROVIDER — until then,
   * chunks from the old provider are excluded from retrieval and the
   * assistant refuses.
   */
  @Post('reindex')
  @Permissions(Permission.DOCUMENTS_INDEX)
  async reindex(@CurrentUser() actor: AuthenticatedUser) {
    const outcome = await this.indexing.reindexAll();
    this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'RAG:REINDEX',
      resourceType: 'rag_index',
      metadata: {
        provider: outcome.provider,
        reindexed: outcome.results.filter((r) => r.status === 'REINDEXED').length,
        failed: outcome.results.filter((r) => r.status === 'FAILED').length,
      },
    });
    return outcome;
  }

  /** Raw governed RAG answer (no persistence). Chat /ask persists + audits. */
  @Post('query')
  @Permissions(Permission.AI_ASK)
  query(@Body() dto: RagQueryDto) {
    return this.ragQuery.ask(dto.question, { category: dto.category });
  }

  /** Semantic search over approved documents — returns chunks, not answers. */
  @Get('search')
  @Permissions(Permission.AI_SEARCH)
  async search(@Query('q') q: string, @Query('category') category?: string) {
    if (!q || !q.trim()) return { items: [] };
    const chunks = await this.retrieval.search(q, { category });
    const ranked = this.rerank.rerank(q, chunks, 10);
    return {
      items: ranked.map((c) => ({
        documentId: c.documentId,
        documentTitle: c.documentTitle,
        category: c.category,
        pageNumber: c.pageNumber,
        approvalDate: c.approvalDate,
        similarity: Math.round((c.rerankScore ?? c.similarity) * 1000) / 1000,
        snippet: c.content.slice(0, 300),
      })),
    };
  }
}
