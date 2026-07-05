import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DOSE_SAFETY_WARNING_AR,
  DoseFormulaStatus,
  DoseFormulaType,
} from '@bnp/shared';
import { DoseCalculation, DoseFormula } from '../entities';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators';

export interface CalculateInput {
  formulaId: string;
  weightKg: number;
  ageYears?: number;
  concentrationMgPerMl?: number;
  requiredDoseMg?: number;
  route?: string;
  frequencyPerDay?: number;
}

const round = (v: number) => Math.round(v * 100) / 100;

@Injectable()
export class DoseService {
  constructor(
    @InjectRepository(DoseFormula)
    private readonly formulas: Repository<DoseFormula>,
    @InjectRepository(DoseCalculation)
    private readonly calculations: Repository<DoseCalculation>,
    private readonly audit: AuditService,
  ) {}

  listFormulas(includeUnapproved = false) {
    return this.formulas.find({
      where: includeUnapproved ? {} : { status: DoseFormulaStatus.APPROVED },
      order: { drugName: 'ASC' },
    });
  }

  async createFormula(
    input: Partial<DoseFormula> & { name: string; drugName: string; formulaType: DoseFormulaType },
    actor: AuthenticatedUser,
  ) {
    const formula = await this.formulas.save(
      this.formulas.create({
        ...input,
        status: DoseFormulaStatus.DRAFT,
        createdBy: { id: actor.userId } as never,
      }),
    );
    this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'DOSE:FORMULA_CREATE',
      resourceType: 'dose_formula',
      resourceId: formula.id,
      metadata: { name: formula.name, drugName: formula.drugName },
    });
    return formula;
  }

  /** Only a Pharmacist Reviewer (dose:formulas-approve) can make a formula usable. */
  async approveFormula(id: string, actor: AuthenticatedUser) {
    const formula = await this.formulas.findOne({ where: { id } });
    if (!formula) throw new NotFoundException('Formula not found');
    formula.status = DoseFormulaStatus.APPROVED;
    formula.approvedBy = { id: actor.userId } as never;
    formula.approvedAt = new Date();
    await this.formulas.save(formula);
    this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'DOSE:FORMULA_APPROVE',
      resourceType: 'dose_formula',
      resourceId: id,
      metadata: { name: formula.name },
    });
    return formula;
  }

  async calculate(input: CalculateInput, actor: AuthenticatedUser) {
    if (!input.weightKg || input.weightKg <= 0 || input.weightKg > 400) {
      throw new BadRequestException('Weight must be between 0 and 400 kg');
    }

    const formula = await this.formulas.findOne({ where: { id: input.formulaId } });
    if (!formula) throw new NotFoundException('Formula not found');
    // Safety gate: unapproved formulas are never calculable.
    if (formula.status !== DoseFormulaStatus.APPROVED) {
      throw new BadRequestException(
        'This formula has not been approved by a Pharmacist Reviewer and cannot be used',
      );
    }

    const steps: string[] = [];
    const warnings: string[] = [];
    const frequency =
      input.frequencyPerDay ?? formula.defaultFrequencyPerDay ?? 1;
    let perDoseMg: number;

    steps.push(
      `Formula: ${formula.name} (${formula.drugName}) — approved ${formula.approvedAt?.toISOString().slice(0, 10) ?? 'n/a'}`,
    );
    steps.push(`Patient weight: ${input.weightKg} kg`);

    switch (formula.formulaType) {
      case DoseFormulaType.MG_PER_KG_PER_DOSE: {
        if (formula.dosePerKg == null)
          throw new BadRequestException('Formula is missing dose-per-kg value');
        perDoseMg = round(formula.dosePerKg * input.weightKg);
        steps.push(
          `Dose = ${formula.dosePerKg} ${formula.unit}/kg × ${input.weightKg} kg = ${perDoseMg} ${formula.unit} per dose`,
        );
        break;
      }
      case DoseFormulaType.MG_PER_KG_PER_DAY: {
        if (formula.dosePerKg == null)
          throw new BadRequestException('Formula is missing dose-per-kg value');
        const daily = round(formula.dosePerKg * input.weightKg);
        steps.push(
          `Daily dose = ${formula.dosePerKg} ${formula.unit}/kg/day × ${input.weightKg} kg = ${daily} ${formula.unit}/day`,
        );
        perDoseMg = round(daily / frequency);
        steps.push(
          `Per dose = ${daily} ${formula.unit} ÷ ${frequency} doses/day = ${perDoseMg} ${formula.unit} per dose`,
        );
        if (formula.maxDailyDose != null && daily > formula.maxDailyDose) {
          warnings.push(
            `Calculated daily dose (${daily} ${formula.unit}) exceeds the maximum daily dose (${formula.maxDailyDose} ${formula.unit}). Dose capped.`,
          );
          perDoseMg = round(formula.maxDailyDose / frequency);
          steps.push(
            `Capped per dose = ${formula.maxDailyDose} ${formula.unit} ÷ ${frequency} = ${perDoseMg} ${formula.unit}`,
          );
        }
        break;
      }
      case DoseFormulaType.FIXED_DOSE: {
        if (formula.fixedDose == null)
          throw new BadRequestException('Formula is missing fixed dose value');
        perDoseMg = formula.fixedDose;
        steps.push(`Fixed dose: ${perDoseMg} ${formula.unit} per dose`);
        break;
      }
      default:
        throw new BadRequestException('Unsupported formula type');
    }

    if (formula.maxSingleDose != null && perDoseMg > formula.maxSingleDose) {
      warnings.push(
        `Calculated dose (${perDoseMg} ${formula.unit}) exceeds the maximum single dose (${formula.maxSingleDose} ${formula.unit}). Dose capped at maximum.`,
      );
      perDoseMg = formula.maxSingleDose;
      steps.push(`Capped at maximum single dose: ${perDoseMg} ${formula.unit}`);
    }

    let volumeMl: number | null = null;
    if (input.concentrationMgPerMl && input.concentrationMgPerMl > 0) {
      volumeMl = round(perDoseMg / input.concentrationMgPerMl);
      steps.push(
        `Volume = ${perDoseMg} ${formula.unit} ÷ ${input.concentrationMgPerMl} ${formula.unit}/mL = ${volumeMl} mL`,
      );
    }

    if (
      input.requiredDoseMg != null &&
      Math.abs(input.requiredDoseMg - perDoseMg) / perDoseMg > 0.1
    ) {
      warnings.push(
        `Prescribed dose (${input.requiredDoseMg} ${formula.unit}) differs from the calculated dose (${perDoseMg} ${formula.unit}) by more than 10%. Verify with the prescriber.`,
      );
    }
    if (input.ageYears != null && input.ageYears < 1) {
      warnings.push(
        'Patient is under 1 year old — neonatal/infant dosing requires senior clinical verification.',
      );
    }

    const calculation = await this.calculations.save(
      this.calculations.create({
        userId: actor.userId,
        formulaId: formula.id,
        inputs: { ...input, route: input.route ?? formula.defaultRoute, frequency },
        steps,
        finalDoseMg: perDoseMg,
        volumeMl,
        warnings,
      }),
    );

    this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'DOSE:CALCULATE',
      resourceType: 'dose_calculation',
      resourceId: calculation.id,
      metadata: { formula: formula.name, finalDoseMg: perDoseMg, warnings: warnings.length },
    });

    return {
      calculationId: calculation.id,
      formulaName: formula.name,
      drugName: formula.drugName,
      route: input.route ?? formula.defaultRoute,
      frequencyPerDay: frequency,
      steps,
      finalDoseMg: perDoseMg,
      unit: formula.unit,
      volumeMl,
      warnings,
      sourceDocument: formula.sourceDocument
        ? { id: formula.sourceDocument.id, title: formula.sourceDocument.title }
        : null,
      // Contractual clinical safety warning — always present, verbatim.
      safetyWarning: DOSE_SAFETY_WARNING_AR,
    };
  }
}
