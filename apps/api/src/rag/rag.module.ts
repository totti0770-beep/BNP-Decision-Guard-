import { Module } from '@nestjs/common';
import { PdfExtractionService } from './pdf-extraction.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { RetrievalService } from './retrieval.service';
import { RerankService } from './rerank.service';
import { LlmService } from './llm.service';
import { IndexingService } from './indexing.service';
import { RagQueryService } from './rag-query.service';
import { RagController } from './rag.controller';

@Module({
  controllers: [RagController],
  providers: [
    PdfExtractionService,
    ChunkingService,
    EmbeddingService,
    RetrievalService,
    RerankService,
    LlmService,
    IndexingService,
    RagQueryService,
  ],
  exports: [IndexingService, RagQueryService, RetrievalService, RerankService],
})
export class RagModule {}
