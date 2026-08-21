import { Injectable } from '@nestjs/common';
import pdfParse from 'pdf-parse';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

@Injectable()
export class PdfExtractionService {
  /**
   * Extracts text per page so chunks can carry accurate page citations.
   *
   * Handing pdf-parse a plain `Uint8Array` rather than a `Buffer` is
   * load-bearing, and the reason is not obvious.
   *
   * pdf.js clones the input on its way to the (fake) worker with
   * `new value.constructor(value)` — pdf.js v1.10.100, build/pdf.js:3944.
   * For a `Buffer` that evaluates to `new Buffer(value)`, which allocates
   * out of Node's shared 8 KB buffer pool, so the clone lands at a non-zero
   * `byteOffset`. pdf.js then reads `.buffer` on it while ignoring
   * `byteOffset`/`byteLength`, parses whatever else is sitting in the pool,
   * and the `startxref` offset resolves onto unrelated bytes — surfacing as
   * `UnknownErrorException: bad XRef entry`.
   *
   * Crucially this cannot be fixed by handing in a zero-offset Buffer:
   * measured, pdf.js re-pools it anyway (offset 0 in → offset 8 of an 8192
   * ArrayBuffer out). Only a non-Buffer `Uint8Array` clones cleanly, because
   * `new Uint8Array(value)` never touches the pool.
   *
   * Measured over 12 isolated runs per variant on the same 1422-byte
   * document: plain `Uint8Array` 12/12 parsed; `Buffer` 8/12, whether or not
   * its own `byteOffset` was zero. That intermittency is why the failure was
   * originally misread as environmental — the pool's contents differ from
   * run to run. `StorageService.download` returns `Buffer.from(bytes)`, so
   * in production every document small enough to be pooled (under 4 KB) was
   * exposed to it.
   *
   * The cast is deliberate: @types/pdf-parse declares `Buffer`, but pdf.js
   * accepts any typed array and a `Buffer` is precisely what breaks it.
   */
  async extractPages(buffer: Buffer): Promise<ExtractedPage[]> {
    const pages: string[] = [];
    const bytes = new Uint8Array(buffer) as unknown as Buffer;
    await pdfParse(bytes, {
      pagerender: async (pageData: any) => {
        const textContent = await pageData.getTextContent();
        let lastY: number | null = null;
        let text = '';
        for (const item of textContent.items) {
          const y = item.transform?.[5];
          if (lastY !== null && y !== lastY) text += '\n';
          text += item.str;
          lastY = y;
        }
        pages.push(text);
        return text;
      },
    });
    return pages.map((text, i) => ({
      pageNumber: i + 1,
      text: text.replace(/[ \t]+/g, ' ').trim(),
    }));
  }
}
