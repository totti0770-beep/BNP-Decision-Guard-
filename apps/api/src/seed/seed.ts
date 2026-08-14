import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import {
  DoseFormulaStatus,
  DoseFormulaType,
  DoseRoute,
  Permission,
  permissionsForRoles,
  ROLE_DESCRIPTIONS,
  ROLE_PERMISSIONS,
  RoleName,
} from '@bnp/shared';
import { AppModule } from '../app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  DoseFormula,
  PermissionEntity,
  Role,
  Setting,
  User,
} from '../entities';
import { AuthenticatedUser } from '../common/decorators';
import { DocumentsService } from '../documents/documents.service';
import { ApprovalService } from '../approval/approval.service';
import { StorageService } from '../storage/storage.service';
import { AppDataSource } from '../config/data-source';
import { SAMPLE_DOCS } from './sample-docs';
import { buildPdf } from './pdf';

/**
 * Demo passwords are overridable per role via SEED_PASSWORD_<ROLE> (e.g.
 * SEED_PASSWORD_NURSE_USER). The shipped defaults are published in README,
 * so any internet-facing install must either set these overrides before
 * first boot or rotate every account from the /users screen right after —
 * seeding is skip-if-present, so env changes never touch an existing DB.
 */
function seedPassword(role: RoleName, fallback: string): string {
  return process.env[`SEED_PASSWORD_${role}`] || fallback;
}

export const DEMO_USERS: {
  email: string;
  password: string;
  fullName: string;
  role: RoleName;
}[] = [
  { email: 'superadmin@bnp.health', password: seedPassword(RoleName.SUPER_ADMIN, 'SuperAdmin123!'), fullName: 'Sara Al-Otaibi', role: RoleName.SUPER_ADMIN },
  { email: 'admin@bnp.health', password: seedPassword(RoleName.HOSPITAL_ADMIN, 'HospAdmin123!'), fullName: 'Mohammed Al-Harbi', role: RoleName.HOSPITAL_ADMIN },
  { email: 'knowledge@bnp.health', password: seedPassword(RoleName.NURSING_KNOWLEDGE_MANAGER, 'Knowledge123!'), fullName: 'Noura Al-Qahtani', role: RoleName.NURSING_KNOWLEDGE_MANAGER },
  { email: 'pharmacist@bnp.health', password: seedPassword(RoleName.PHARMACIST_REVIEWER, 'Pharmacist123!'), fullName: 'Khalid Al-Zahrani', role: RoleName.PHARMACIST_REVIEWER },
  { email: 'quality@bnp.health', password: seedPassword(RoleName.CBAHI_QUALITY_OFFICER, 'Quality123!'), fullName: 'Amal Al-Shehri', role: RoleName.CBAHI_QUALITY_OFFICER },
  { email: 'nurse@bnp.health', password: seedPassword(RoleName.NURSE_USER, 'NurseUser123!'), fullName: 'Fatimah Al-Ghamdi', role: RoleName.NURSE_USER },
  { email: 'auditor@bnp.health', password: seedPassword(RoleName.AUDITOR, 'Auditor123!'), fullName: 'Yousef Al-Dossary', role: RoleName.AUDITOR },
];

function asActor(user: User): AuthenticatedUser {
  const roles = user.roles.map((r) => r.name);
  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    roles,
    permissions: permissionsForRoles(roles),
  };
}

async function main() {
  // Make seeding forgiving in dev: ensure schema exists first.
  const ds = await AppDataSource.initialize();
  await ds.runMigrations();
  await ds.destroy();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const users: Repository<User> = app.get(getRepositoryToken(User));
  const roles: Repository<Role> = app.get(getRepositoryToken(Role));
  const permissions: Repository<PermissionEntity> = app.get(
    getRepositoryToken(PermissionEntity),
  );
  const settings: Repository<Setting> = app.get(getRepositoryToken(Setting));
  const formulas: Repository<DoseFormula> = app.get(
    getRepositoryToken(DoseFormula),
  );
  const documentsService = app.get(DocumentsService);
  const approvalService = app.get(ApprovalService);
  const storage = app.get(StorageService);

  if (await users.findOne({ where: { email: DEMO_USERS[0].email } })) {
    console.log('Seed data already present — skipping.');
    await app.close();
    return;
  }

  console.log('Seeding permissions and roles...');
  const permByCode = new Map<string, PermissionEntity>();
  for (const code of Object.values(Permission)) {
    permByCode.set(code, await permissions.save(permissions.create({ code })));
  }
  const roleByName = new Map<string, Role>();
  for (const roleName of Object.values(RoleName)) {
    roleByName.set(
      roleName,
      await roles.save(
        roles.create({
          name: roleName,
          description: ROLE_DESCRIPTIONS[roleName],
          permissions: ROLE_PERMISSIONS[roleName].map(
            (p) => permByCode.get(p)!,
          ),
        }),
      ),
    );
  }

  console.log('Seeding demo users...');
  const userByRole = new Map<RoleName, User>();
  for (const demo of DEMO_USERS) {
    const user = await users.save(
      users.create({
        email: demo.email,
        fullName: demo.fullName,
        passwordHash: await bcrypt.hash(demo.password, 10),
        roles: [roleByName.get(demo.role)!],
      }),
    );
    userByRole.set(demo.role, user);
  }

  console.log('Seeding settings...');
  const defaultSettings: [string, unknown, string][] = [
    ['platform.name', 'BNP Decision Guard', 'Display name'],
    // Informational only: the query path reads env RAG_MIN_SIMILARITY, not
    // this row. Editing it in the Settings UI does not change refusals.
    ['rag.minSimilarity', 0.25, 'Informational — governed by env RAG_MIN_SIMILARITY'],
    ['documents.nearExpiryDays', 30, 'Days before expiry to alert knowledge managers'],
    ['ai.requireCommitteeReview', true, 'Flag AI answers for scientific committee review'],
  ];
  for (const [key, value, description] of defaultSettings) {
    await settings.save(settings.create({ key, value, description }));
  }

  console.log('Uploading and approving sample documents (full pipeline)...');
  await storage.ensureBucket();
  const knowledgeManager = asActor(userByRole.get(RoleName.NURSING_KNOWLEDGE_MANAGER)!);
  const pharmacist = asActor(userByRole.get(RoleName.PHARMACIST_REVIEWER)!);
  const quality = asActor(userByRole.get(RoleName.CBAHI_QUALITY_OFFICER)!);

  const docIdByTitle = new Map<string, string>();
  for (const sample of SAMPLE_DOCS) {
    const pdf = await buildPdf(sample.title, sample.pages);
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + sample.expiryMonths);

    const uploaded = await documentsService.upload(
      {
        originalname: `${sample.title.slice(0, 40).replace(/\s+/g, '-')}.pdf`,
        mimetype: 'application/pdf',
        size: pdf.length,
        buffer: pdf,
      },
      {
        title: sample.title,
        description: sample.description,
        category: sample.category,
        expiryDate: expiry.toISOString(),
      },
      knowledgeManager,
    );
    await approvalService.submitReview(uploaded.id, knowledgeManager, 'Initial governance review');
    const approver = sample.category === 'CBAHI' ? quality : pharmacist;
    await approvalService.approve(uploaded.id, approver, 'Content verified against source policy');
    const indexed = await approvalService.index(uploaded.id, knowledgeManager);
    docIdByTitle.set(sample.title, uploaded.id);
    console.log(`  - ${sample.title} -> ACTIVE (${indexed.chunkCount} chunks)`);
  }

  console.log('Seeding dose formulas...');
  const paracetamolDocId = docIdByTitle.get(
    'IV Paracetamol (Acetaminophen) Preparation and Administration Guide',
  );
  await formulas.save(
    formulas.create({
      name: 'Paracetamol IV (pediatric, per dose)',
      drugName: 'Paracetamol (Acetaminophen)',
      formulaType: DoseFormulaType.MG_PER_KG_PER_DOSE,
      dosePerKg: 15,
      maxSingleDose: 1000,
      maxDailyDose: 3000,
      unit: 'mg',
      defaultRoute: DoseRoute.IV,
      defaultFrequencyPerDay: 4,
      notes: '15 mg/kg per dose every 6 hours for patients ≤ 50 kg. Source: approved IV paracetamol guide.',
      sourceDocument: paracetamolDocId ? ({ id: paracetamolDocId } as never) : null,
      status: DoseFormulaStatus.APPROVED,
      createdBy: { id: pharmacist.userId } as never,
      approvedBy: { id: pharmacist.userId } as never,
      approvedAt: new Date(),
    }),
  );
  await formulas.save(
    formulas.create({
      name: 'Amoxicillin PO (pediatric, per day)',
      drugName: 'Amoxicillin',
      formulaType: DoseFormulaType.MG_PER_KG_PER_DAY,
      dosePerKg: 50,
      maxDailyDose: 3000,
      unit: 'mg',
      defaultRoute: DoseRoute.PO,
      defaultFrequencyPerDay: 2,
      notes: '50 mg/kg/day divided every 12 hours (standard otitis media dosing).',
      status: DoseFormulaStatus.APPROVED,
      createdBy: { id: pharmacist.userId } as never,
      approvedBy: { id: pharmacist.userId } as never,
      approvedAt: new Date(),
    }),
  );
  // Deliberately unapproved formula: demonstrates the safety gate.
  await formulas.save(
    formulas.create({
      name: 'Gentamicin IV (pending pharmacy approval)',
      drugName: 'Gentamicin',
      formulaType: DoseFormulaType.MG_PER_KG_PER_DOSE,
      dosePerKg: 5,
      unit: 'mg',
      defaultRoute: DoseRoute.IV,
      defaultFrequencyPerDay: 1,
      notes: 'DRAFT — awaiting pharmacist review. Cannot be used for calculations.',
      status: DoseFormulaStatus.DRAFT,
      createdBy: { id: pharmacist.userId } as never,
    }),
  );

  console.log('\nSeed complete. Demo users:');
  for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(28)} ${u.email}  /  ${u.password}`);
  await app.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
