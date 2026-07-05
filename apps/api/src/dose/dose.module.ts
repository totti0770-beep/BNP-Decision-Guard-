import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DoseCalculation, DoseFormula } from '../entities';
import { DoseController } from './dose.controller';
import { DoseService } from './dose.service';

@Module({
  imports: [TypeOrmModule.forFeature([DoseFormula, DoseCalculation])],
  controllers: [DoseController],
  providers: [DoseService],
  exports: [DoseService],
})
export class DoseCalculatorModule {}
