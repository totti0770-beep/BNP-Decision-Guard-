import {
  INVENTORY_SCHEMA_VERSION,
  InventoryDocument,
  InventoryReport,
  renderInventoryTable,
} from './inventory.service';

/**
 * The human view, which is pure and therefore testable without a database.
 * The SQL half is proved against real Postgres in `test/inventory.e2e-spec.ts`
 * — a fake DataSource would only assert that the query string is the one this
 * file already contains.
 */

const AT = new Date('2026-09-10T20:00:00.000Z');

function doc(over: Partial<InventoryDocument> = {}): InventoryDocument {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Hand Hygiene and Medication Administration Safety Policy',
    issuingAuthority: 'Nursing Department',
    category: 'NURSING_POLICIES',
    version: 2,
    effectiveDate: null,
    approvalDate: '2026-03-01T00:00:00.000Z',
    expiryDate: '2027-03-01T00:00:00.000Z',
    chunkCount: 42,
    supersededChunks: 0,
    embeddingProviders: ['openai-embedding'],
    firstIndexedAt: '2026-03-01T09:00:00.000Z',
    lastIndexedAt: '2026-03-01T09:04:00.000Z',
    retrievable: true,
    notRetrievableReason: null,
    ...over,
  };
}

function report(documents: InventoryDocument[]): InventoryReport {
  return {
    schema: INVENTORY_SCHEMA_VERSION,
    fieldsNotInSchema: [
      { field: 'effectiveDate', reason: 'The documents table has no effective-date column.' },
    ],
    totals: {
      activeDocuments: documents.length,
      retrievableDocuments: documents.filter((d) => d.retrievable).length,
      retrievableChunks: documents
        .filter((d) => d.retrievable)
        .reduce((s, d) => s + d.chunkCount, 0),
      supersededChunks: documents.reduce((s, d) => s + d.supersededChunks, 0),
      documentsWithNoChunks: documents.filter((d) => d.chunkCount === 0).length,
      documentsExpired: 0,
      documentsOnAnotherProvider: 0,
      activeEmbeddingProvider: 'openai-embedding',
      chunksByProvider: { 'openai-embedding': documents.reduce((s, d) => s + d.chunkCount, 0) },
      earliestIndexedAt: '2026-03-01T09:00:00.000Z',
      latestIndexedAt: '2026-03-01T09:04:00.000Z',
    },
    documents,
  };
}

describe('renderInventoryTable — an empty corpus', () => {
  const empty = report([]);

  it('renders without throwing and without an empty table', () => {
    // A fresh deployment before the first upload is a legitimate state, not an
    // error. The report has to survive it — this is the case a report built
    // against a populated database usually gets wrong.
    const out = renderInventoryTable(empty, AT);
    expect(out).toContain('No ACTIVE documents');
    expect(out).not.toContain('TITLE');
  });

  it('says what an empty corpus means for a nurse, rather than leaving it implied', () => {
    expect(renderInventoryTable(empty, AT)).toContain(
      'The assistant refuses every question in this state.',
    );
  });

  it('still prints the totals block, all zero', () => {
    const out = renderInventoryTable(empty, AT);
    expect(out).toContain('ACTIVE documents          0');
    expect(out).toContain('Retrievable chunks        0');
  });
});

describe('renderInventoryTable — a populated corpus', () => {
  it('prints one row per document with the columns asked for', () => {
    const out = renderInventoryTable(report([doc()]), AT);
    expect(out).toContain('Hand Hygiene');
    expect(out).toContain('NURSING_POLICIES');
    expect(out).toContain('2026-03-01'); // approved
    expect(out).toContain('2027-03-01'); // expires
    expect(out).toContain('42'); // chunks
    expect(out).toContain('openai-embedding');
  });

  it('carries the generation time in the header only', () => {
    // Deliberately not in the JSON: the report has to diff cleanly against
    // yesterday's run, and a timestamp inside the data would make every run
    // differ. The human view is where a reader needs it.
    const out = renderInventoryTable(report([doc()]), AT);
    expect(out).toContain('Generated 2026-09-10T20:00:00.000Z');
  });

  it('truncates a long title instead of breaking the column alignment', () => {
    const long = doc({ title: 'A'.repeat(120) });
    const out = renderInventoryTable(report([long]), AT);
    const row = out.split('\n').find((l) => l.startsWith('A'))!;
    expect(row).toContain('…');
    expect(row).toContain('NURSING_POLICIES');
  });
});

describe('renderInventoryTable — the finding it exists to surface', () => {
  it('calls out an ACTIVE document the assistant cannot cite', () => {
    // The whole point. A document that is ACTIVE in the governance workflow
    // but has no chunks looks approved on every screen and answers nothing.
    const orphan = doc({
      title: 'Peripheral IV Cannulation Procedure',
      chunkCount: 0,
      embeddingProviders: [],
      firstIndexedAt: null,
      lastIndexedAt: null,
      retrievable: false,
      notRetrievableReason:
        'No chunks on the current version — never indexed, or indexing failed.',
    });

    const out = renderInventoryTable(report([orphan]), AT);
    expect(out).toContain('1 ACTIVE document(s) the assistant cannot cite');
    expect(out).toContain('Peripheral IV Cannulation Procedure');
    expect(out).toContain('never indexed, or indexing failed');
  });

  it('marks the row itself, so the table alone is enough', () => {
    const orphan = doc({ chunkCount: 0, retrievable: false, notRetrievableReason: 'x' });
    const out = renderInventoryTable(report([orphan]), AT);
    const row = out.split('\n').find((l) => l.startsWith('Hand Hygiene'))!;
    expect(row.trimEnd().endsWith('NO')).toBe(true);
  });

  it('says nothing about unreachable documents when every one is reachable', () => {
    expect(renderInventoryTable(report([doc()]), AT)).not.toContain('cannot cite');
  });
});

describe('renderInventoryTable — the fields the database does not record', () => {
  it('names them in the output rather than silently omitting the columns', () => {
    // A reader looking for "effective date" must find out it is absent, not
    // conclude the report forgot it — or worse, that the documents have none.
    const out = renderInventoryTable(report([doc()]), AT);
    expect(out).toContain('NOT RECORDED BY THE DATABASE');
    expect(out).toContain('effectiveDate');
  });

  it('no longer lists the issuing authority as absent — it is a real column now', () => {
    const out = renderInventoryTable(report([doc()]), AT);
    expect(out).not.toContain('issuingBody');
    expect(out).toContain('ISSUED BY');
    expect(out).toContain('Nursing Department');
  });

  it('prints a dash, not a guess, for a document whose authority was never recorded', () => {
    const out = renderInventoryTable(report([doc({ issuingAuthority: null })]), AT);
    expect(out).not.toContain('Nursing Department');
  });
});
