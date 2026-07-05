import { MockEmbeddingProvider } from './embedding.service';

const cosine = (a: number[], b: number[]) =>
  a.reduce((s, v, i) => s + v * b[i], 0);

describe('MockEmbeddingProvider', () => {
  const provider = new MockEmbeddingProvider();

  it('is deterministic', async () => {
    const [a] = await provider.embed(['paracetamol dose per kg']);
    const [b] = await provider.embed(['paracetamol dose per kg']);
    expect(a).toEqual(b);
  });

  it('produces normalized 384-dim vectors', async () => {
    const [v] = await provider.embed(['hand hygiene policy']);
    expect(v).toHaveLength(384);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('ranks lexically related text above unrelated text', async () => {
    const [query, related, unrelated] = await provider.embed([
      'what is the paracetamol dose for children',
      'paracetamol dosing: administer 15 mg per kg per dose for children under 50 kg',
      'the hospital cafeteria opens at seven in the morning every day',
    ]);
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });
});
