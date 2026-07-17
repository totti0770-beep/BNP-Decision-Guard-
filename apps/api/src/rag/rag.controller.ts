import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Permission } from '@bnp/shared';
import {
  AuthenticatedUser,
  CurrentUser,
  Permissions,
} from '../common/decorators';
import { AuditService } from '../audit/audit.service';
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
    private readonly audit: AuditService,
  ) {}

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
