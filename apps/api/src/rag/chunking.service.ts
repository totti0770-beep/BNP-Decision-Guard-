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
        current = this.overlapTail(current);
      }
      current += (current ? ' ' : '') + sentence;
    }
    if (current.trim()) out.push(current.trim());
    return out;
  }

  /**
   * Trailing context carried into the next chunk, always starting at a whole
   * token.
   *
   * Slicing by character count alone cuts mid-word, so a chunk could begin
   * "fonicid sodium" — the tail of "Cefonicid sodium". In a drug manual that
   * is not cosmetic: the fragment reads as a different (non-existent) drug,
   * it embeds as one, and an answer built on it would be attributed to the
   * wrong medication. Prefer resuming at a sentence boundary, fall back to a
   * word boundary, and carry nothing rather than carry a fragment.
   */
  private overlapTail(text: string): string {
    if (text.length <= OVERLAP_CHARS) return text;
    const tail = text.slice(text.length - OVERLAP_CHARS);

    const sentenceBreak = tail.search(/(?<=[.!?؟])\s+/);
    if (sentenceBreak !== -1) return tail.slice(sentenceBreak).trimStart();

    const wordBreak = tail.search(/\s/);
    return wordBreak === -1 ? '' : tail.slice(wordBreak + 1);
  }
}
