import { Injectable } from '@nestjs/common';
import pdfParse from 'pdf-parse';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

@Injectable()
export class PdfExtractionService {
  /** Extracts text per page so chunks can carry accurate page citations. */
  async extractPages(buffer: Buffer): Promise<ExtractedPage[]> {
    const pages: string[] = [];
    await pdfParse(buffer, {
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
