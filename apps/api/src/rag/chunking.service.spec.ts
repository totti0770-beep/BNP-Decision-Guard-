import { ChunkingService } from './chunking.service';

describe('ChunkingService', () => {
  const svc = new ChunkingService();

  it('keeps chunks within page boundaries so citations are page-accurate', () => {
    const longSentence = 'This is a clinical sentence about medication safety. ';
    const chunks = svc.chunkPages([
      { pageNumber: 1, text: longSentence.repeat(40) },
      { pageNumber: 2, text: longSentence.repeat(40) },
    ]);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect([1, 2]).toContain(c.pageNumber);
      expect(c.content.length).toBeLessThanOrEqual(1100);
    }
    // Chunk indexes are globally sequential
    expect(chunks.map((c) => c.chunkIndex)).toEqual(
      chunks.map((_, i) => i),
    );
  });

  it('never starts a chunk mid-word', () => {
    // A drug-manual page: long enough to force several splits, with distinctive
    // multi-syllable drug names that a blind character slice would bisect.
    const monograph =
      'Cefonicid sodium Pregnancy Category B COMPATIBLE WITH sterile water D5W or NS. ' +
      'INCOMPATIBILITIES Y-site aminoglycoside vancomycin amphotericin ampicillin cephalosporins heparin. ' +
      'Direct dilute each 1 g with 10 mL sterile water and administer over three to five minutes. ';
    const chunks = svc.chunkPages([{ pageNumber: 1, text: monograph.repeat(6) }]);

    expect(chunks.length).toBeGreaterThan(1);
    const words = new Set(monograph.toLowerCase().match(/[a-z0-9]+/g));
    for (const c of chunks) {
      const first = c.content.toLowerCase().match(/^[a-z0-9]+/)?.[0];
      // Every chunk must open on a token that genuinely exists in the source —
      // "fonicid" (from "Cefonicid") would fail this.
      if (first) expect(words.has(first)).toBe(true);
    }
  });

  it('carries overlap for continuity rather than dropping it wholesale', () => {
    const sentence = 'Dilute the vial with ten millilitres of sterile water before use. ';
    const chunks = svc.chunkPages([{ pageNumber: 1, text: sentence.repeat(30) }]);
    expect(chunks.length).toBeGreaterThan(1);
    // The tail of one chunk should still appear at the head of the next.
    const tailWords = chunks[0].content.trim().split(/\s+/).slice(-4).join(' ');
    expect(chunks[1].content).toContain(tailWords);
  });

  it('drops empty/near-empty fragments', () => {
    const chunks = svc.chunkPages([{ pageNumber: 1, text: '   \n  ok ' }]);
    expect(chunks).toHaveLength(0);
  });
});
