import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Document } from '../entities';
import { StorageService } from '../storage/storage.service';
import { PdfExtractionService } from './pdf-extraction.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';

@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly extraction: PdfExtractionService,
    private readonly chunking: ChunkingService,
    private readonly embeddings: EmbeddingService,
  ) {}

  /** Full ingestion: PDF -> pages -> chunks -> embeddings -> pgvector. */
  async indexDocument(doc: Document): Promise<{ chunkCount: number }> {
    const pdf = await this.storage.download(doc.storageKey);
    const pages = await this.extraction.extractPages(pdf);
    const chunks = this.chunking.chunkPages(pages);
    if (chunks.length === 0) {
      throw new Error('No extractable text found in PDF');
    }
    const vectors = await this.embeddings.embed(chunks.map((c) => c.content));

    await this.dataSource.transaction(async (manager) => {
      // Replace any previous index for this document (old versions included).
      await manager.query(`DELETE FROM document_chunks WHERE document_id = $1`, [
        doc.id,
      ]);
      for (let i = 0; i < chunks.length; i++) {
        await manager.query(
          `INSERT INTO document_chunks
             (document_id, version_number, chunk_index, page_number, content, embedding)
           VALUES ($1, $2, $3, $4, $5, $6::vector)`,
          [
            doc.id,
            doc.versionNumber,
            chunks[i].chunkIndex,
            chunks[i].pageNumber,
            chunks[i].content,
            `[${vectors[i].join(',')}]`,
          ],
        );
      }
    });

    this.logger.log(
      `Indexed "${doc.title}" v${doc.versionNumber}: ${chunks.length} chunks (${this.embeddings.name})`,
    );
    return { chunkCount: chunks.length };
  }

  async removeDocumentChunks(documentId: string): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM document_chunks WHERE document_id = $1`,
      [documentId],
    );
  }
}
