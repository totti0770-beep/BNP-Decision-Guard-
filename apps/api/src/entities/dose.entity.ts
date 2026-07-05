import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DoseFormulaStatus, DoseFormulaType, DoseRoute } from '@bnp/shared';
import { User } from './user.entity';
import { Document } from './document.entity';

const numericTransformer = {
  to: (v: number | null) => v,
  from: (v: string | null) => (v === null ? null : parseFloat(v)),
};

@Entity('dose_formulas')
export class DoseFormula {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ name: 'drug_name' })
  drugName: string;

  @Column({ name: 'formula_type', type: 'varchar' })
  formulaType: DoseFormulaType;

  @Column({ name: 'dose_per_kg', type: 'numeric', precision: 12, scale: 4, nullable: true, transformer: numericTransformer })
  dosePerKg: number | null;

  @Column({ name: 'fixed_dose', type: 'numeric', precision: 12, scale: 4, nullable: true, transformer: numericTransformer })
  fixedDose: number | null;

  @Column({ name: 'max_single_dose', type: 'numeric', precision: 12, scale: 4, nullable: true, transformer: numericTransformer })
  maxSingleDose: number | null;

  @Column({ name: 'max_daily_dose', type: 'numeric', precision: 12, scale: 4, nullable: true, transformer: numericTransformer })
  maxDailyDose: number | null;

  @Column({ default: 'mg' })
  unit: string;

  @Column({ name: 'default_route', type: 'varchar', nullable: true })
  defaultRoute: DoseRoute | null;

  @Column({ name: 'default_frequency_per_day', type: 'int', nullable: true })
  defaultFrequencyPerDay: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @ManyToOne(() => Document, { nullable: true, eager: true })
  @JoinColumn({ name: 'source_document_id' })
  sourceDocument: Document | null;

  @Column({ type: 'varchar', default: DoseFormulaStatus.DRAFT })
  status: DoseFormulaStatus;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approved_by_id' })
  approvedBy: User | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('dose_calculations')
export class DoseCalculation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'formula_id', type: 'uuid', nullable: true })
  formulaId: string | null;

  @Column({ type: 'jsonb' })
  inputs: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  steps: string[];

  @Column({ name: 'final_dose_mg', type: 'numeric', precision: 12, scale: 4, nullable: true, transformer: numericTransformer })
  finalDoseMg: number | null;

  @Column({ name: 'volume_ml', type: 'numeric', precision: 12, scale: 4, nullable: true, transformer: numericTransformer })
  volumeMl: number | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  warnings: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
