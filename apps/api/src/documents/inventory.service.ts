import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DocumentStatus } from '@bnp/shared';
import { EmbeddingService } from '../rag/embedding.service';

/**
 * Clinical reference inventory — what the assistant can actually cite, read
 * straight out of the database.
 *
 * This exists because nobody could answer "which documents are live, and are
 * they all reachable?" without opening a SQL client. The production corpus
 * turned out to hold 2,706 chunks while the repository ships four demo
 * documents, and nothing in the platform showed the difference.
 *
 * ## One of the fields a reader will look for is not in the database
 *
 * `documents` records **who issued a document** (`issuing_authority`, added
 * by migration `1720000005000`) but not **when it takes effect**. The latter
 * is reported as `null` and named in `fieldsNotInSchema`, so the gap is
 * machine-readable rather than a footnote someone skips. `issuingAuthority`
 * is likewise `null` for any document nobody has filled it in for.
 *
 * Neither is ever derived. A title or a filename often looks like it carries
 * the issuing body, and inferring one would produce a provenance column that
 * is right often enough to be trusted and wrong often enough to mislead — the
 * worst of both. `approval_date` is likewise reported under its
 * own name: it is the date this platform approved the document internally, not
 * the date the issuing authority made it effective, and relabelling it would
 * be the same fabrication with extra steps.
 *
 * ## Determinism
 *
 * The JSON carries no generation timestamp and orders rows by (title, id), so
 * running it twice against an unchanged database produces byte-identical
 * output and two runs can be diffed. The human view prints the time in its
 * header, where it does not contaminate the data.
 */

/** Bumped if the shape changes, so a stored report says which shape it is. */
export const INVENTORY_SCHEMA_VERSION = 'bnp.clinical-reference-inventory.v2';

export interface InventoryDocument {
  id: string;
  title: string;
  /**
   * `documents.issuing_authority`. Null means nobody has recorded it — never
   * inferred from the title or filename.
   */
  issuingAuthority: string | null;
  category: string;
  version: number;
  /** Always null: `documents` has no effective-date column. Never inferred. */
  effectiveDate: null;
  /** When *this platform* approved it. Not an issuing authority's date. */
  approvalDate: string | null;
  expiryDate: string | null;
  /** Chunks on the current version — the only ones retrieval can return. */
  chunkCount: number;
  /** Chunks left behind by earlier versions. Retrieval already excludes them. */
  supersededChunks: number;
  embeddingProviders: string[];
  firstIndexedAt: string | null;
  lastIndexedAt: string | null;
  /** Whether the assistant can cite this document right now. */
  retrievable: boolean;
  /** Why not, when `retrievable` is false. */
  notRetrievableReason: string | null;
}

export interface InventoryReport {
  schema: typeof INVENTORY_SCHEMA_VERSION;
  /** Fields the report is asked for that the database does not record. */
  fieldsNotInSchema: { field: string; reason: string }[];
  totals: {
    activeDocuments: number;
    retrievableDocuments: number;
    retrievableChunks: number;
    supersededChunks: number;
    documentsWithNoChunks: number;
    documentsExpired: number;
    documentsOnAnotherProvider: number;
    activeEmbeddingProvider: string;
    chunksByProvider: Record<string, number>;
    earliestIndexedAt: string | null;
    latestIndexedAt: string | null;
  };
  documents: InventoryDocument[];
}

const FIELDS_NOT_IN_SCHEMA = [
  {
    field: 'effectiveDate',
    reason:
      'The documents table has no effective-date column. approvalDate is reported separately and is this platform’s internal approval date, not an issuing authority’s effective date.',
  },
];

interface Row {
  id: string;
  title: string;
  issuing_authority: string | null;
  category: string;
  version_number: number;
  approval_date: Date | null;
  expiry_date: Date | null;
  chunk_count: string | number;
  superseded_chunks: string | number;
  providers: string[] | null;
  first_indexed_at: Date | null;
  last_indexed_at: Date | null;
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

@Injectable()
export class InventoryService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly embeddings: EmbeddingService,
  ) {}

  async build(): Promise<InventoryReport> {
    const rows: Row[] = await this.ds.query(
      `
      SELECT d.id,
             d.title,
             d.issuing_authority,
             d.category,
             d.version_number,
             d.approval_date,
             d.expiry_date,
             COALESCE(cur.chunk_count, 0)  AS chunk_count,
             COALESCE(old.chunk_count, 0)  AS superseded_chunks,
             cur.providers,
             cur.first_indexed_at,
             cur.last_indexed_at
        FROM documents d
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS chunk_count,
                 array_agg(DISTINCT c.embedding_provider) AS providers,
                 min(c.created_at) AS first_indexed_at,
                 max(c.created_at) AS last_indexed_at
            FROM document_chunks c
           WHERE c.document_id = d.id
             AND c.version_number = d.version_number
        ) cur ON true
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS chunk_count
            FROM document_chunks c
           WHERE c.document_id = d.id
             AND c.version_number <> d.version_number
        ) old ON true
       -- Two of retrieval's four filters live here: the ACTIVE status on the
       -- next line, and the current-version match in the "cur" lateral join
       -- above. The other two are applied in TypeScript below. Read the
       -- coupling note on notRetrievableReason before changing either place.
       -- (No backticks in this comment: it sits inside a template literal.)
       WHERE d.status = $1
       -- Deterministic: same database, same bytes. id breaks title ties.
       ORDER BY d.title, d.id
      `,
      [DocumentStatus.ACTIVE],
    );

    const activeProvider = this.embeddings.name;
    const now = Date.now();

    const documents: InventoryDocument[] = rows.map((r) => {
      const chunkCount = Number(r.chunk_count);
      const providers = [...(r.providers ?? [])].sort();
      const expired = r.expiry_date !== null && new Date(r.expiry_date).getTime() <= now;
      const onActiveProvider = providers.includes(activeProvider);

      // ─────────────────────────────────────────────────────────────────
      // COUPLED TO RetrievalService.search(). Change both or neither.
      //
      // `retrievable` answers "can the assistant cite this right now", and it
      // is only worth trusting while it computes the *same* answer retrieval
      // does. So it is derived from the same four filters
      // (`retrieval.service.ts:71-74`), one for one:
      //
      //   d.status = ACTIVE                    → the WHERE clause of the query
      //                                          above; non-ACTIVE rows never
      //                                          reach this map.
      //   d.expiry_date IS NULL OR > now()     → `expired`, below.
      //   c.version_number = d.version_number  → the `cur` lateral join, so
      //                                          chunkCount counts only what
      //                                          retrieval would consider.
      //   c.embedding_provider = <active>      → `onActiveProvider`, below.
      //
      // If a fifth filter is ever added to retrieval, or one of these four is
      // changed, this block is wrong the moment it is not changed with it —
      // and wrong quietly, because the report would still render and still
      // look authoritative. A governance report that disagrees with the engine
      // it describes is worse than no report: it is what someone signs.
      //
      // `test/inventory.e2e-spec.ts` pins each of the three uncitable states
      // against a real database, so a drift here fails the build rather than
      // being discovered by a reader.
      //
      // Everything below reads stored facts. Nothing here is a guess about a
      // document.
      // ─────────────────────────────────────────────────────────────────
      let notRetrievableReason: string | null = null;
      if (chunkCount === 0) {
        notRetrievableReason = 'No chunks on the current version — never indexed, or indexing failed.';
      } else if (expired) {
        notRetrievableReason = 'Past its expiry date; retrieval excludes it.';
      } else if (!onActiveProvider) {
        notRetrievableReason = `Chunks were embedded by ${providers.join(', ')}, but the active provider is ${activeProvider}. Repair with POST /rag/reindex/stale.`;
      }

      return {
        id: r.id,
        title: r.title,
        issuingAuthority: r.issuing_authority ?? null,
        category: r.category,
        version: Number(r.version_number),
        effectiveDate: null,
        approvalDate: iso(r.approval_date),
        expiryDate: iso(r.expiry_date),
        chunkCount,
        supersededChunks: Number(r.superseded_chunks),
        embeddingProviders: providers,
        firstIndexedAt: iso(r.first_indexed_at),
        lastIndexedAt: iso(r.last_indexed_at),
        retrievable: notRetrievableReason === null,
        notRetrievableReason,
      };
    });

    // Chunk totals are counted per provider from the same rows rather than by
    // a second query, so the totals can never disagree with the table above
    // them — a report whose summary contradicts its own rows is worse than no
    // report.
    const chunksByProvider: Record<string, number> = {};
    for (const doc of documents) {
      // A document's chunks are attributed to each provider present on it.
      // With one provider — the normal case — this is an exact count; a
      // document mid-reindex can appear under two, which is the anomaly the
      // reader needs to see rather than have averaged away.
      for (const provider of doc.embeddingProviders) {
        chunksByProvider[provider] = (chunksByProvider[provider] ?? 0) + doc.chunkCount;
      }
    }

    const indexTimes = documents
      .flatMap((d) => [d.firstIndexedAt, d.lastIndexedAt])
      .filter((t): t is string => t !== null)
      .sort();

    return {
      schema: INVENTORY_SCHEMA_VERSION,
      fieldsNotInSchema: FIELDS_NOT_IN_SCHEMA,
      totals: {
        activeDocuments: documents.length,
        retrievableDocuments: documents.filter((d) => d.retrievable).length,
        retrievableChunks: documents
          .filter((d) => d.retrievable)
          .reduce((sum, d) => sum + d.chunkCount, 0),
        supersededChunks: documents.reduce((sum, d) => sum + d.supersededChunks, 0),
        documentsWithNoChunks: documents.filter((d) => d.chunkCount === 0).length,
        documentsExpired: documents.filter(
          (d) => d.notRetrievableReason?.startsWith('Past its expiry') ?? false,
        ).length,
        documentsOnAnotherProvider: documents.filter(
          (d) => d.notRetrievableReason?.startsWith('Chunks were embedded') ?? false,
        ).length,
        activeEmbeddingProvider: activeProvider,
        chunksByProvider: Object.fromEntries(
          Object.entries(chunksByProvider).sort(([a], [b]) => a.localeCompare(b)),
        ),
        earliestIndexedAt: indexTimes[0] ?? null,
        latestIndexedAt: indexTimes[indexTimes.length - 1] ?? null,
      },
      documents,
    };
  }
}

/* ------------------------------------------------------------------------ */
/* Human view                                                                */
/* ------------------------------------------------------------------------ */

const pad = (s: string, width: number) =>
  s.length > width ? `${s.slice(0, width - 1)}…` : s.padEnd(width);

const date = (t: string | null) => (t ? t.slice(0, 10) : '—');

/**
 * Renders the same report a person can read. Pure, so the empty-corpus and
 * alignment cases are unit-testable without a database.
 *
 * `generatedAt` is a parameter rather than `new Date()` inside, for the same
 * reason the JSON omits it: the caller decides, and a test can pin it.
 */
export function renderInventoryTable(
  report: InventoryReport,
  generatedAt: Date,
): string {
  const t = report.totals;
  const out: string[] = [
    'Clinical reference inventory',
    `Generated ${generatedAt.toISOString()} · schema ${report.schema}`,
    '',
  ];

  if (report.documents.length === 0) {
    // An empty corpus is a legitimate state — a fresh deployment before the
    // first upload — not an error. It is also the state in which a nurse gets
    // the governed refusal to every question, so the report says so outright
    // rather than printing an empty table and leaving the reader to infer it.
    out.push('No ACTIVE documents. The assistant refuses every question in this state.');
    out.push('');
  } else {
    const header =
      `${pad('TITLE', 44)}  ${pad('ISSUED BY', 28)}  ${pad('CATEGORY', 18)}  ${pad('VER', 4)}  ` +
      `${pad('APPROVED', 11)}  ${pad('EXPIRES', 11)}  ${pad('CHUNKS', 7)}  ` +
      `${pad('PROVIDER', 22)}  ${pad('INDEXED', 11)}  OK`;
    out.push(header, '─'.repeat(header.length));

    for (const d of report.documents) {
      out.push(
        `${pad(d.title, 44)}  ${pad(d.issuingAuthority ?? '—', 28)}  ${pad(d.category, 18)}  ${pad(String(d.version), 4)}  ` +
          `${pad(date(d.approvalDate), 11)}  ${pad(date(d.expiryDate), 11)}  ` +
          `${pad(String(d.chunkCount), 7)}  ` +
          `${pad(d.embeddingProviders.join(',') || '—', 22)}  ` +
          `${pad(date(d.lastIndexedAt), 11)}  ${d.retrievable ? 'yes' : 'NO'}`,
      );
    }
    out.push('');

    const unreachable = report.documents.filter((d) => !d.retrievable);
    if (unreachable.length > 0) {
      // The finding the report exists to surface: a document that is ACTIVE in
      // the governance workflow but that the assistant cannot cite. It looks
      // approved on every screen and answers nothing.
      out.push(`${unreachable.length} ACTIVE document(s) the assistant cannot cite:`);
      for (const d of unreachable) {
        out.push(`  · ${d.title}`);
        out.push(`    ${d.notRetrievableReason}`);
      }
      out.push('');
    }
  }

  out.push(
    'TOTALS',
    `  ACTIVE documents          ${t.activeDocuments}`,
    `  Retrievable documents     ${t.retrievableDocuments}`,
    `  Retrievable chunks        ${t.retrievableChunks}`,
    `  Superseded chunks         ${t.supersededChunks}  (inert; retrieval excludes them)`,
    `  Documents with no chunks  ${t.documentsWithNoChunks}`,
    `  Documents expired         ${t.documentsExpired}`,
    `  On another provider       ${t.documentsOnAnotherProvider}`,
    `  Active provider           ${t.activeEmbeddingProvider}`,
    `  Indexed between           ${date(t.earliestIndexedAt)} and ${date(t.latestIndexedAt)}`,
    '',
    'NOT RECORDED BY THE DATABASE',
  );
  for (const f of report.fieldsNotInSchema) {
    out.push(`  ${f.field}: ${f.reason}`);
  }

  return out.join('\n');
}
