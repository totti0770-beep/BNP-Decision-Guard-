import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';
import { DoseFormulaType, Permission } from '@bnp/shared';
import {
  AuthenticatedUser,
  CurrentUser,
  Permissions,
} from '../common/decorators';
import { DoseService } from './dose.service';

class CalculateDto {
  @IsUUID() formulaId: string;
  @IsNumber() @IsPositive() weightKg: number;
  @IsOptional() @IsNumber() ageYears?: number;
  @IsOptional() @IsNumber() @IsPositive() concentrationMgPerMl?: number;
  @IsOptional() @IsNumber() @IsPositive() requiredDoseMg?: number;
  @IsOptional() @IsString() route?: string;
  @IsOptional() @IsNumber() @IsPositive() frequencyPerDay?: number;
}

class CreateFormulaDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() drugName: string;
  @IsEnum(DoseFormulaType) formulaType: DoseFormulaType;
  @IsOptional() @IsNumber() dosePerKg?: number;
  @IsOptional() @IsNumber() fixedDose?: number;
  @IsOptional() @IsNumber() maxSingleDose?: number;
  @IsOptional() @IsNumber() maxDailyDose?: number;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() defaultRoute?: string;
  @IsOptional() @IsNumber() defaultFrequencyPerDay?: number;
  @IsOptional() @IsString() notes?: string;
}

@Controller('dose')
export class DoseController {
  constructor(private readonly dose: DoseService) {}

  @Post('calculate')
  @Permissions(Permission.DOSE_CALCULATE)
  calculate(@Body() dto: CalculateDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.dose.calculate(dto, actor);
  }

  @Get('formulas')
  @Permissions(Permission.DOSE_CALCULATE)
  formulas(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('all') all?: string,
  ) {
    const canSeeUnapproved = actor.permissions.includes(
      Permission.DOSE_FORMULAS_MANAGE,
    );
    return this.dose.listFormulas(all === 'true' && canSeeUnapproved);
  }

  @Post('formulas')
  @Permissions(Permission.DOSE_FORMULAS_MANAGE)
  createFormula(
    @Body() dto: CreateFormulaDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.dose.createFormula(dto as never, actor);
  }

  @Post('formulas/:id/approve')
  @Permissions(Permission.DOSE_FORMULAS_APPROVE)
  approveFormula(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.dose.approveFormula(id, actor);
  }
}
