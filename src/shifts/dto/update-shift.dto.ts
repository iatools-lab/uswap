import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

import { PartialType } from '@nestjs/swagger';

import { ShiftChangeType } from '@prisma/client';

import { CreateShiftDto } from './create-shift.dto';

export class UpdateShiftDto extends PartialType(
  CreateShiftDto,
) {
  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsOptional()
  @IsEnum(ShiftChangeType)
  changeType?: ShiftChangeType;
}