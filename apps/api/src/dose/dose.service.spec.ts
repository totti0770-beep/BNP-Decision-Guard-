import { BadRequestException } from '@nestjs/common';
import {
  DOSE_SAFETY_WARNING_AR,
  DoseFormulaStatus,
  DoseFormulaType,
} from '@bnp/shared';
import { DoseService } from './dose.service';
import { DoseFormula } from '../entities';

const actor = {
  userId: 'u1',
  email: 'nurse@bnp.health',
  fullName: 'Nurse',
  roles: ['NURSE_USER'],
  permissions: [],
};

function makeService(formula: Partial<DoseFormula> | null) {
  const formulas = {
    findOne: jest.fn().mockResolvedValue(formula),
    find: jest.fn(),
  };
  const calculations = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ ...x, id: 'calc-1' })),
  };
  const audit = { record: jest.fn() };
  return new DoseService(formulas as never, calculations as never, audit as never);
}

const approvedPerDose: Partial<DoseFormula> = {
  id: 'f1',
  name: 'Paracetamol IV',
  drugName: 'Paracetamol',
  formulaType: DoseFormulaType.MG_PER_KG_PER_DOSE,
  dosePerKg: 15,
  maxSingleDose: 1000,
  unit: 'mg',
  status: DoseFormulaStatus.APPROVED,
  approvedAt: new Date('2026-02-01'),
  defaultFrequencyPerDay: 4,
  sourceDocument: null,
};

describe('DoseService safety gates', () => {
  it('REJECTS calculation with an unapproved formula', async () => {
    const svc = makeService({ ...approvedPerDose, status: DoseFormulaStatus.DRAFT });
    await expect(
      svc.calculate({ formulaId: 'f1', weightKg: 20 }, actor),
    ).rejects.toThrow(BadRequestException);
  });

  it('computes mg/kg per dose with step-by-step math and the verbatim Arabic safety warning', async () => {
    const svc = makeService(approvedPerDose);
    const result = await svc.calculate(
      { formulaId: 'f1', weightKg: 20, concentrationMgPerMl: 10 },
      actor,
    );
    expect(result.finalDoseMg).toBe(300); // 15 * 20
    expect(result.volumeMl).toBe(30); // 300 / 10
    expect(result.steps.join('\n')).toContain('15 mg/kg × 20 kg');
    expect(result.safetyWarning).toBe(DOSE_SAFETY_WARNING_AR);
    expect(result.safetyWarning).toBe('لا يعتمد هذا الحساب دون مراجعة سريرية من المختص.');
  });

  it('caps the dose at the maximum single dose and warns', async () => {
    const svc = makeService(approvedPerDose);
    const result = await svc.calculate({ formulaId: 'f1', weightKg: 90 }, actor);
    expect(result.finalDoseMg).toBe(1000); // capped, not 1350
    expect(result.warnings.join(' ')).toContain('maximum single dose');
  });

  it('divides daily formulas by frequency and caps at max daily dose', async () => {
    const svc = makeService({
      ...approvedPerDose,
      formulaType: DoseFormulaType.MG_PER_KG_PER_DAY,
      dosePerKg: 50,
      maxSingleDose: null,
      maxDailyDose: 3000,
      defaultFrequencyPerDay: 2,
    });
    const ok = await svc.calculate({ formulaId: 'f1', weightKg: 20 }, actor);
    expect(ok.finalDoseMg).toBe(500); // 50*20/2

    const capped = await svc.calculate({ formulaId: 'f1', weightKg: 80 }, actor);
    expect(capped.finalDoseMg).toBe(1500); // 3000 cap / 2
    expect(capped.warnings.join(' ')).toContain('maximum daily dose');
  });

  it('warns when prescribed dose deviates >10% from calculated', async () => {
    const svc = makeService(approvedPerDose);
    const result = await svc.calculate(
      { formulaId: 'f1', weightKg: 20, requiredDoseMg: 500 },
      actor,
    );
    expect(result.warnings.join(' ')).toContain('differs from the calculated dose');
  });

  it('rejects implausible weights', async () => {
    const svc = makeService(approvedPerDose);
    await expect(
      svc.calculate({ formulaId: 'f1', weightKg: 0 }, actor),
    ).rejects.toThrow(BadRequestException);
    await expect(
      svc.calculate({ formulaId: 'f1', weightKg: 500 }, actor),
    ).rejects.toThrow(BadRequestException);
  });
});
