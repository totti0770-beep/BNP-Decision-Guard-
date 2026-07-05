import { Injectable } from '@nestjs/common';
import { ExtractedPage } from './pdf-extraction.service';

export interface Chunk {
  chunkIndex: number;
  pageNumber: number;
  content: string;
}

const TARGET_CHARS = 800;
const OVERLAP_CHARS = 150;

@Injectable()
export class ChunkingService {
  /**
   * Page-aware chunking: chunks never cross page boundaries, so every chunk
   * cites exactly one page. Within a page, splits on sentence/line boundaries
   * around TARGET_CHARS with OVERLAP_CHARS of trailing context.
   */
  chunkPages(pages: ExtractedPage[]): Chunk[] {
    const chunks: Chunk[] = [];
    let index = 0;
    for (const page of pages) {
      for (const content of this.splitText(page.text)) {
        if (content.trim().length < 20) continue;
        chunks.push({ chunkIndex: index++, pageNumber: page.pageNumber, content });
      }
    }
    return chunks;
  }

  private splitText(text: string): string[] {
    if (text.length <= TARGET_CHARS) return [text];
    const sentences = text.split(/(?<=[.!?؟\n])\s+/);
    const out: string[] = [];
    let current = '';
    for (const sentence of sentences) {
      if (current.length + sentence.length + 1 > TARGET_CHARS && current.length > 0) {
        out.push(current.trim());
        current = current.slice(Math.max(0, current.length - OVERLAP_CHARS));
      }
      current += (current ? ' ' : '') + sentence;
    }
    if (current.trim()) out.push(current.trim());
    return out;
  }
}
