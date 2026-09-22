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
  // EmbeddingService is exported for its `name` only: the inventory report has
  // to say which provider is active to decide whether a document's chunks are
  // still reachable, and that answer must come from the same object retrieval
  // filters on rather than from a second read of the environment.
  // PdfExtractionService and ChunkingService are exported for the conflict
  // scanner, which reads a document's text without indexing it. Exporting
  // them is also what lets the e2e harness's PdfExtractionService override
  // reach the scanner as well as the indexer.
  exports: [
    PdfExtractionService,
    ChunkingService,
    IndexingService,
    RagQueryService,
    RetrievalService,
    RerankService,
    EmbeddingService,
  ],
})
export class RagModule {}
