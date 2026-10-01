import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  ScheduledReportFormat,
  ScheduledReportFrequency,
} from '@prisma/client';

export class CreateScheduledReportDto {
  @IsString()
  @MinLength(4)
  @MaxLength(120)
  name!: string;

  @IsArray()
  @IsString({ each: true })
  recipients!: string[];

  @IsOptional()
  @IsEnum(ScheduledReportFrequency)
  frequency?: ScheduledReportFrequency;

  @IsOptional()
  @IsEnum(ScheduledReportFormat)
  format?: ScheduledReportFormat;
}

export class ToggleScheduledReportDto {
  @Type(() => Boolean)
  isActive!: boolean;
}
