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

  it('drops empty/near-empty fragments', () => {
    const chunks = svc.chunkPages([{ pageNumber: 1, text: '   \n  ok ' }]);
    expect(chunks).toHaveLength(0);
  });
});
