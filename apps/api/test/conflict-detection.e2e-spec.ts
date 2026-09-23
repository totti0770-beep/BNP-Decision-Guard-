import { DocumentCategory, FindingStatus, RoleName } from '@bnp/shared';
import { buildPdf } from '../src/seed/pdf';
import {
  auth,
  createE2eApp,
  E2eContext,
  login,
  migrateE2eDatabase,
  seedRolesAndUsers,
  truncateAll,
} from './support/e2e-app';

const MANAGER = {
  email: 'knowledge@e2e.health',
  password: 'Knowledge123!',
  role: RoleName.NURSING_KNOWLEDGE_MANAGER,
};
const PHARMACIST = {
  email: 'pharmacist@e2e.health',
  password: 'Pharmacist123!',
  role: RoleName.PHARMACIST_REVIEWER,
};
const QUALITY = {
  email: 'quality@e2e.health',
  password: 'Quality123!',
  role: RoleName.CBAHI_QUALITY_OFFICER,
};
const ADMIN = {
  email: 'root@e2e.health',
  password: 'RootAdmin123!',
  role: RoleName.SUPER_ADMIN,
};
const NURSE = {
  email: 'nurse@e2e.health',
  password: 'NurseUser123!',
  role: RoleName.NURSE_USER,
};
const AUDITOR = {
  email: 'auditor@e2e.health',
  password: 'Auditor123!',
  role: RoleName.AUDITOR,
};

/**
 * Pre-activation conflict detection, end to end over real HTTP against a real
 * database.
 *
 * The unit suites decide what the rules find and what the gate does with a
 * finding. What only this suite can show is that the whole governed chain
 * holds together: a scan that runs on submit, a finding that reaches the
 * reviewer, an approval the platform refuses, an audit row for the refusal,
 * and two signatures from two authorities that let it through.
 */
describe('Pre-activation conflict detection', () => {
  let ctx: E2eContext;
  let managerToken: string;
  let pharmacistToken: string;
  let qualityToken: string;
  let adminToken: string;
  let nurseToken: string;
  let auditorToken: string;

  /** Audit writes are fire-and-forget; let them land before asserting. */
  const settleAudit = async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  };

  async function upload(title: string, token = managerToken): Promise<string> {
    const pdf = await buildPdf(title, [[title]]);
    const res = await ctx
      .http()
      .post('/documents/upload')
      .set(auth(token))
      .field('title', title)
      .field('category', DocumentCategory.MEDICATIONS)
      .attach('file', pdf, 'policy.pdf')
      .expect(201);
    return res.body.id;
  }

  function setText(paragraphs: string[]): void {
    ctx.pdf.emptyOnPurpose = false;
    ctx.pdf.failWith = null;
    ctx.pdf.pages = paragraphs.map((text, i) => ({ pageNumber: i + 1, text }));
  }

  const findings = (documentId: string, token: string) =>
    ctx.http().get(`/documents/${documentId}/findings`).set(auth(token));

  beforeAll(async () => {
    await migrateE2eDatabase();
    ctx = await createE2eApp();
    await truncateAll(ctx.dataSource);
    await seedRolesAndUsers(ctx.dataSource, [
      MANAGER,
      PHARMACIST,
      QUALITY,
      ADMIN,
      NURSE,
      AUDITOR,
    ]);

    managerToken = (await login(ctx, MANAGER.email, MANAGER.password)).accessToken;
    pharmacistToken = (await login(ctx, PHARMACIST.email, PHARMACIST.password)).accessToken;
    qualityToken = (await login(ctx, QUALITY.email, QUALITY.password)).accessToken;
    adminToken = (await login(ctx, ADMIN.email, ADMIN.password)).accessToken;
    nurseToken = (await login(ctx, NURSE.email, NURSE.password)).accessToken;
    auditorToken = (await login(ctx, AUDITOR.email, AUDITOR.password)).accessToken;
  }, 120_000);

  afterAll(async () => {
    await ctx?.close();
  });

  describe('a document with non-blocking findings still reaches APPROVED', () => {
    let documentId: string;

    beforeAll(async () => {
      documentId = await upload('Insulin Sliding Scale Protocol');
      setText([
        'Insulin Sliding Scale Protocol. Administer regular insulin 10 U subcutaneously ' +
          'when the blood glucose exceeds the threshold recorded on the chart.',
        'For hypoglycaemia give 1.0 mg of glucagon intramuscularly and recheck after fifteen minutes.',
      ]);
      await ctx
        .http()
        .post(`/documents/${documentId}/submit-review`)
        .set(auth(managerToken))
        .send({})
        .expect(201);
    });

    it('records what the scan found, with page-anchored evidence', async () => {
      const res = await findings(documentId, managerToken).expect(200);
      const codes = res.body.map((f: { ruleCode: string }) => f.ruleCode);
      expect(codes).toContain('ISMP_ABBREVIATION');
      expect(codes).toContain('ISMP_TRAILING_ZERO');

      const abbreviation = res.body.find(
        (f: { ruleCode: string }) => f.ruleCode === 'ISMP_ABBREVIATION',
      );
      expect(abbreviation.severity).toBe('MAJOR');
      expect(abbreviation.status).toBe(FindingStatus.OPEN);
      expect(abbreviation.evidence[0].pageNumber).toBe(1);
      expect(abbreviation.evidence[0].snippet).toContain('10 U');
    });

    /**
     * Separation of duties. The manager uploaded AND submitted this version
     * and holds findings:resolve, so nothing but the uploader check stands
     * between them and clearing their own finding.
     */
    it('refuses the person who submitted this version', async () => {
      const res = await findings(documentId, managerToken).expect(200);
      const abbreviation = res.body.find(
        (f: { ruleCode: string }) => f.ruleCode === 'ISMP_ABBREVIATION',
      );
      await ctx
        .http()
        .post(`/findings/${abbreviation.id}/resolve`)
        .set(auth(managerToken))
        .send({ justification: 'I wrote it, and the abbreviation is house style' })
        .expect(403);
    });

    it('accepts a reviewer who did not submit it', async () => {
      const res = await findings(documentId, managerToken).expect(200);
      const trailing = res.body.find(
        (f: { ruleCode: string }) => f.ruleCode === 'ISMP_TRAILING_ZERO',
      );
      const settled = await ctx
        .http()
        .post(`/findings/${trailing.id}/resolve`)
        .set(auth(pharmacistToken))
        .send({ justification: 'Dose rewritten as 1 mg in the source document' })
        .expect(201);
      expect(settled.body.status).toBe(FindingStatus.RESOLVED);
    });

    it('approves anyway, because MAJOR is recorded and not enforced', async () => {
      const res = await ctx
        .http()
        .post(`/documents/${documentId}/approve`)
        .set(auth(pharmacistToken))
        .send({})
        .expect(201);
      expect(res.body.status).toBe('APPROVED');
    });
  });

  describe('a document the scanner cannot read is refused', () => {
    let documentId: string;

    beforeAll(async () => {
      documentId = await upload('Scanned Isolation Policy');
      // A scanned, image-only PDF: pages exist, no retrievable text.
      ctx.pdf.emptyOnPurpose = true;
      ctx.pdf.failWith = null;
      await ctx
        .http()
        .post(`/documents/${documentId}/submit-review`)
        .set(auth(managerToken))
        .send({})
        .expect(201);
      await settleAudit();
    });

    /**
     * Submit-review must still succeed. If a scan failure surfaced as an
     * error, the reviewer would simply retry until it passed; the failure has
     * to arrive as a finding instead.
     */
    it('raises a BLOCKING finding rather than failing the submission', async () => {
      const res = await findings(documentId, managerToken).expect(200);
      const zero = res.body.find((f: { ruleCode: string }) => f.ruleCode === 'ZERO_EXTRACTION');
      expect(zero.severity).toBe('BLOCKING');
      expect(zero.status).toBe(FindingStatus.OPEN);
      expect(zero.waiverRolesOutstanding).toEqual([
        RoleName.PHARMACIST_REVIEWER,
        RoleName.CBAHI_QUALITY_OFFICER,
      ]);
    });

    it('cannot be cleared by one person through the resolve route', async () => {
      const res = await findings(documentId, managerToken).expect(200);
      const zero = res.body.find((f: { ruleCode: string }) => f.ruleCode === 'ZERO_EXTRACTION');
      // The one-signature path must never reach a BLOCKING finding, or the
      // dual control is bypassed by calling a different endpoint.
      await ctx
        .http()
        .post(`/findings/${zero.id}/resolve`)
        .set(auth(pharmacistToken))
        .send({ justification: 'Checked the source document and it reads fine' })
        .expect(400);
    });

    it('refuses the approval and names the rule', async () => {
      const res = await ctx
        .http()
        .post(`/documents/${documentId}/approve`)
        .set(auth(pharmacistToken))
        .send({})
        .expect(400);
      expect(res.body.message).toContain('ZERO_EXTRACTION');
    });

    /** Asserted against the database, not the response the refusal produced. */
    it('leaves no trace of the approval in the document or its history', async () => {
      const [doc] = await ctx.dataSource.query(
        `SELECT status, approval_date, approved_by_id FROM documents WHERE id = $1`,
        [documentId],
      );
      expect(doc.status).toBe('IN_REVIEW');
      expect(doc.approval_date).toBeNull();
      expect(doc.approved_by_id).toBeNull();

      const approvals = await ctx.dataSource.query(
        `SELECT action FROM document_approvals WHERE document_id = $1 AND action = 'APPROVE'`,
        [documentId],
      );
      expect(approvals).toHaveLength(0);
    });

    /**
     * The refusal happens before `transition()`, the only writer of
     * document_approvals, so without this event the block would leave no trace
     * anywhere.
     */
    it('audits the block', async () => {
      await settleAudit();
      const rows = await ctx.dataSource.query(
        `SELECT action, metadata FROM audit_logs
          WHERE resource_id = $1 AND action = 'DOCUMENTS:APPROVE_BLOCKED'`,
        [documentId],
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].metadata.findings[0].ruleCode).toBe('ZERO_EXTRACTION');
    });

    /**
     * The headline assertion. SUPER_ADMIN holds every permission in the
     * matrix, so anything gated on `findings:waive-blocking` alone would let
     * one administrator clear a blocking clinical finding by themselves.
     */
    it('refuses a lone SUPER_ADMIN, twice over', async () => {
      const res = await findings(documentId, managerToken).expect(200);
      const zero = res.body.find((f: { ruleCode: string }) => f.ruleCode === 'ZERO_EXTRACTION');

      await ctx
        .http()
        .post(`/findings/${zero.id}/waive`)
        .set(auth(adminToken))
        .send({ justification: 'Administrative override of the blocking finding' })
        .expect(403);

      await ctx
        .http()
        .post(`/findings/${zero.id}/waive`)
        .set(auth(adminToken))
        .send({ justification: 'Administrative override, second attempt' })
        .expect(403);

      const after = await findings(documentId, managerToken).expect(200);
      const unchanged = after.body.find(
        (f: { ruleCode: string }) => f.ruleCode === 'ZERO_EXTRACTION',
      );
      expect(unchanged.status).toBe(FindingStatus.OPEN);
    });

    it('takes two signatures from two authorities, and only then approves', async () => {
      const res = await findings(documentId, managerToken).expect(200);
      const zero = res.body.find((f: { ruleCode: string }) => f.ruleCode === 'ZERO_EXTRACTION');

      const first = await ctx
        .http()
        .post(`/findings/${zero.id}/waive`)
        .set(auth(pharmacistToken))
        .send({ justification: 'Signed original verified against the scanned copy' })
        .expect(201);
      expect(first.body.status).toBe(FindingStatus.WAIVER_PENDING);
      expect(first.body.rolesOutstanding).toEqual([RoleName.CBAHI_QUALITY_OFFICER]);

      // Half a waiver is not a waiver.
      await ctx
        .http()
        .post(`/documents/${documentId}/approve`)
        .set(auth(pharmacistToken))
        .send({})
        .expect(400);

      const second = await ctx
        .http()
        .post(`/findings/${zero.id}/waive`)
        .set(auth(qualityToken))
        .send({ justification: 'Quality accepts the documented mitigation for this cycle' })
        .expect(201);
      expect(second.body.status).toBe(FindingStatus.WAIVED);

      const approved = await ctx
        .http()
        .post(`/documents/${documentId}/approve`)
        .set(auth(pharmacistToken))
        .send({})
        .expect(201);
      expect(approved.body.status).toBe('APPROVED');
    });

    it('records both signatures with the authority each was made under', async () => {
      const res = await findings(documentId, managerToken).expect(200);
      const zero = res.body.find((f: { ruleCode: string }) => f.ruleCode === 'ZERO_EXTRACTION');
      expect(zero.resolutions.map((r: { actorRole: string }) => r.actorRole)).toEqual([
        RoleName.PHARMACIST_REVIEWER,
        RoleName.CBAHI_QUALITY_OFFICER,
      ]);
      expect(zero.resolutions[0].justification).toContain('Signed original verified');
    });
  });

  /**
   * A corrupt PDF and a scanned one collapse to the same clinical outcome:
   * the document cannot be confirmed free of blocking conflicts, so approval
   * stays closed. What must NOT happen is submit-review erroring, because a
   * reviewer would then simply retry until it went through.
   */
  describe('a PDF that throws during extraction', () => {
    it('is recorded as SCAN_FAILED and blocks approval, without failing the submission', async () => {
      const documentId = await upload('Corrupt Transfusion Policy');
      ctx.pdf.emptyOnPurpose = false;
      ctx.pdf.failWith = new Error('bad XRef entry');
      try {
        await ctx
          .http()
          .post(`/documents/${documentId}/submit-review`)
          .set(auth(managerToken))
          .send({})
          .expect(201);
      } finally {
        ctx.pdf.failWith = null;
      }

      const res = await findings(documentId, managerToken).expect(200);
      const failed = res.body.find((f: { ruleCode: string }) => f.ruleCode === 'SCAN_FAILED');
      expect(failed.severity).toBe('BLOCKING');
      expect(failed.evidence[0].snippet).toContain('bad XRef entry');

      await ctx
        .http()
        .post(`/documents/${documentId}/approve`)
        .set(auth(pharmacistToken))
        .send({})
        .expect(400);
    });
  });

  /**
   * A waiver is granted against specific bytes. Re-uploading produces a new
   * version, and the finding on it starts unresolved — otherwise a single
   * waiver would license every future revision of the document.
   */
  describe('a waiver does not carry to the next version', () => {
    let documentId: string;

    beforeAll(async () => {
      documentId = await upload('Contrast Media Protocol');
      ctx.pdf.emptyOnPurpose = true;
      await ctx
        .http()
        .post(`/documents/${documentId}/submit-review`)
        .set(auth(managerToken))
        .send({})
        .expect(201);

      const res = await findings(documentId, managerToken).expect(200);
      const zero = res.body.find((f: { ruleCode: string }) => f.ruleCode === 'ZERO_EXTRACTION');
      for (const token of [pharmacistToken, qualityToken]) {
        await ctx
          .http()
          .post(`/findings/${zero.id}/waive`)
          .set(auth(token))
          .send({ justification: 'Accepted for version one after manual verification' })
          .expect(201);
      }
      await ctx
        .http()
        .post(`/documents/${documentId}/approve`)
        .set(auth(pharmacistToken))
        .send({})
        .expect(201);
    });

    it('blocks the new version although the old one was waived', async () => {
      const pdf = await buildPdf('Contrast Media Protocol', [['Contrast Media Protocol v2']]);
      await ctx
        .http()
        .post('/documents/upload')
        .set(auth(managerToken))
        .field('title', 'Contrast Media Protocol')
        .field('category', DocumentCategory.MEDICATIONS)
        .field('documentId', documentId)
        .attach('file', pdf, 'policy-v2.pdf')
        .expect(201);

      ctx.pdf.emptyOnPurpose = true;
      await ctx
        .http()
        .post(`/documents/${documentId}/submit-review`)
        .set(auth(managerToken))
        .send({})
        .expect(201);

      const res = await findings(documentId, managerToken).expect(200);
      const v2 = res.body.filter((f: { versionNumber: number }) => f.versionNumber === 2);
      expect(v2).toHaveLength(1);
      expect(v2[0].status).toBe(FindingStatus.OPEN);

      // The v1 finding keeps its waiver as a record, and is stamped superseded.
      const v1 = res.body.find((f: { versionNumber: number }) => f.versionNumber === 1);
      expect(v1.status).toBe(FindingStatus.WAIVED);

      await ctx
        .http()
        .post(`/documents/${documentId}/approve`)
        .set(auth(pharmacistToken))
        .send({})
        .expect(400);
    });
  });

  /**
   * A document goes DRAFT → IN_REVIEW → REJECTED → IN_REVIEW on the same bytes
   * routinely, and every pass re-scans. The unique fingerprint is what stops
   * the reviewer seeing each issue once per attempt.
   */
  describe('re-submitting the same version does not multiply findings', () => {
    it('keeps one row per issue across three passes', async () => {
      const documentId = await upload('Wound Care Standard');
      const text = ['Wound Care Standard. Irrigate with 20 cc of sterile saline before dressing.'];

      for (let pass = 0; pass < 3; pass++) {
        setText(text);
        await ctx
          .http()
          .post(`/documents/${documentId}/submit-review`)
          .set(auth(managerToken))
          .send({})
          .expect(201);
        await ctx
          .http()
          .post(`/documents/${documentId}/reject`)
          .set(auth(pharmacistToken))
          .send({ comment: 'Returned for formatting' })
          .expect(201);
      }

      const [{ count }] = await ctx.dataSource.query(
        `SELECT count(*)::int AS count FROM review_findings WHERE document_id = $1`,
        [documentId],
      );
      const res = await findings(documentId, managerToken).expect(200);
      expect(res.body.map((f: { ruleCode: string }) => f.ruleCode)).toContain(
        'ISMP_ABBREVIATION',
      );
      expect(count).toBe(res.body.length);
      expect(count).toBeLessThanOrEqual(3);
    });
  });

  describe('who may see findings', () => {
    let documentId: string;

    beforeAll(async () => {
      documentId = await upload('Fall Prevention Policy');
      setText(['Fall Prevention Policy. Reassess every 8 hours and record 5 cc of intake.']);
      await ctx
        .http()
        .post(`/documents/${documentId}/submit-review`)
        .set(auth(managerToken))
        .send({})
        .expect(201);
    });

    it('refuses a nurse', async () => {
      await findings(documentId, nurseToken).expect(403);
    });

    /**
     * The matrix withholds DOCUMENTS_DOWNLOAD from AUDITOR because nurses and
     * auditors read answers, not source PDFs. Finding evidence is verbatim
     * source text, so it is withheld on the same grounds.
     */
    it('refuses an auditor, who is denied source text by the same rule', async () => {
      await findings(documentId, auditorToken).expect(403);
    });

    it('allows the knowledge manager, who would otherwise get a 400 they cannot diagnose', async () => {
      await findings(documentId, managerToken).expect(200);
    });

    it('allows both waiver authorities', async () => {
      await findings(documentId, pharmacistToken).expect(200);
      await findings(documentId, qualityToken).expect(200);
    });

    it('screens a justification for patient identifiers before storing it', async () => {
      const res = await findings(documentId, managerToken).expect(200);
      const any = res.body[0];
      const rejected = await ctx
        .http()
        .post(`/findings/${any.id}/dismiss`)
        .set(auth(pharmacistToken))
        .send({ justification: 'Discussed with the patient, ID 1098765432, on the ward' })
        .expect(400);
      expect(rejected.body.message).toContain('بيانات تعريف المرضى');
    });

    it('requires a justification that says something', async () => {
      const res = await findings(documentId, managerToken).expect(200);
      await ctx
        .http()
        .post(`/findings/${res.body[0].id}/dismiss`)
        .set(auth(pharmacistToken))
        .send({ justification: 'ok' })
        .expect(400);
    });
  });

  /**
   * The scan used to run only at submit-review, which accepts DRAFT and
   * REJECTED. A document already live could be scanned only by re-uploading
   * it, which resets it to DRAFT and takes it out of retrieval until someone
   * approves it again. These pin the in-place scan: it finds what the
   * submit-time scan would, and it moves nothing.
   */
  describe('scanning a document that is already live', () => {
    let documentId: string;
    const LIVE_TEXT =
      'Heparin Infusion Protocol. Start the infusion at 18 units per kg per hour ' +
      'and titrate to the anti-Xa level recorded on the chart.';

    const scan = (id: string, token: string) =>
      ctx.http().post(`/documents/${id}/findings/scan`).set(auth(token));

    const statusAndChunks = async (id: string) => {
      const [row] = await ctx.dataSource.query(
        `SELECT d.status, d.version_number,
                (SELECT count(*)::int FROM document_chunks c WHERE c.document_id = d.id) AS chunks
           FROM documents d WHERE d.id = $1`,
        [id],
      );
      return row as { status: string; version_number: number; chunks: number };
    };

    beforeAll(async () => {
      documentId = await upload('Heparin Infusion Protocol');
      // Clean at submit time, so every finding below comes from the live scan.
      setText([LIVE_TEXT]);
      await ctx
        .http()
        .post(`/documents/${documentId}/submit-review`)
        .set(auth(managerToken))
        .send({})
        .expect(201);
      await ctx
        .http()
        .post(`/documents/${documentId}/approve`)
        .set(auth(pharmacistToken))
        .send({})
        .expect(201);
      await ctx
        .http()
        .post(`/documents/${documentId}/index`)
        .set(auth(managerToken))
        .send({})
        .expect(201);
      expect((await statusAndChunks(documentId)).status).toBe('ACTIVE');
      expect((await findings(documentId, managerToken).expect(200)).body).toHaveLength(0);
    });

    it('records what the submit-time scan would have found', async () => {
      // Same document, now read as though it carried a trailing zero: the
      // situation of every document that went live before the scan existed.
      setText([LIVE_TEXT, 'For breakthrough clotting give a bolus of 5.0 mL.']);
      const res = await scan(documentId, managerToken).expect(201);
      expect(res.body.map((f: { ruleCode: string }) => f.ruleCode)).toContain(
        'ISMP_TRAILING_ZERO',
      );
    });

    /**
     * A blocking finding on a live document is shown, not enforced. Taking a
     * document offline is the deactivate action, with its own approval-history
     * event; it must never be a side effect of looking.
     */
    it('leaves the document live and retrievable even when it finds a blocker', async () => {
      const before = await statusAndChunks(documentId);
      ctx.pdf.failWith = new Error('corrupt cross-reference table');
      const res = await scan(documentId, managerToken).expect(201);
      ctx.pdf.failWith = null;

      expect(
        res.body.some(
          (f: { ruleCode: string; severity: string }) =>
            f.ruleCode === 'SCAN_FAILED' && f.severity === 'BLOCKING',
        ),
      ).toBe(true);
      expect(await statusAndChunks(documentId)).toEqual(before);

      const hits = await ctx
        .http()
        .get('/rag/search')
        .query({ q: 'heparin infusion anti-Xa titrate' })
        .set(auth(nurseToken))
        .expect(200);
      expect(hits.body.items.map((i: { documentId: string }) => i.documentId)).toContain(
        documentId,
      );

      const events = await ctx.dataSource.query(
        `SELECT action FROM document_approvals WHERE document_id = $1 ORDER BY created_at`,
        [documentId],
      );
      expect(events.map((e: { action: string }) => e.action)).toEqual([
        'SUBMIT_REVIEW',
        'APPROVE',
        'INDEX',
        'ACTIVATE',
      ]);
    });

    it('adds nothing when the same bytes are scanned again', async () => {
      const count = async () =>
        (
          await ctx.dataSource.query(
            `SELECT count(*)::int AS n FROM review_findings WHERE document_id = $1`,
            [documentId],
          )
        )[0].n;
      setText([LIVE_TEXT, 'For breakthrough clotting give a bolus of 5.0 mL.']);
      const before = await count();
      await scan(documentId, managerToken).expect(201);
      await scan(documentId, managerToken).expect(201);
      expect(await count()).toBe(before);
    });

    it('audits each scan', async () => {
      await settleAudit();
      const rows = await ctx.dataSource.query(
        `SELECT metadata FROM audit_logs
          WHERE resource_id = $1 AND action = 'FINDINGS:RETRO_SCAN'`,
        [documentId],
      );
      expect(rows.length).toBeGreaterThanOrEqual(4);
      expect(rows[0].metadata.version).toBe(1);
    });

    /** Draft documents are scanned by submit-review, where a blocker gates. */
    it('refuses a document that is not live', async () => {
      const draftId = await upload('Pressure Injury Bundle');
      const res = await scan(draftId, managerToken).expect(400);
      expect(res.body.message).toContain('Only ACTIVE documents');
      const rows = await ctx.dataSource.query(
        `SELECT 1 FROM review_findings WHERE document_id = $1`,
        [draftId],
      );
      expect(rows).toHaveLength(0);
    });

    it('is refused to a nurse and to an auditor', async () => {
      await scan(documentId, nurseToken).expect(403);
      await scan(documentId, auditorToken).expect(403);
    });

    it('is open to both waiver authorities', async () => {
      await scan(documentId, pharmacistToken).expect(201);
      await scan(documentId, qualityToken).expect(201);
    });
  });
});
