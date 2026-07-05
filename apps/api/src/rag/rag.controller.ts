import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Permission } from '@bnp/shared';
import { Permissions } from '../common/decorators';
import { RagQueryService } from './rag-query.service';
import { RetrievalService } from './retrieval.service';
import { RerankService } from './rerank.service';

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
  ) {}

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
