import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
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

  @IsOptional()
  @IsIn(['NETWORK', 'STATION'])
  scope?: 'NETWORK' | 'STATION';

  @IsOptional()
  @IsString()
  stationId?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sections?: string[];
}

export class PreviewScheduledReportDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsIn(['NETWORK', 'STATION'])
  scope?: 'NETWORK' | 'STATION';

  @IsOptional()
  @IsString()
  stationId?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sections?: string[];
}

export class ToggleScheduledReportDto {
  @Type(() => Boolean)
  isActive!: boolean;
}
