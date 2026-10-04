import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IncidentCategory, IncidentSeverity } from '@prisma/client';

export class CreateIncidentDto {
  @IsString()
  @MinLength(1)
  affectedSwapperId!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(140)
  title!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(4000)
  description!: string;

  @IsOptional()
  @IsEnum(IncidentSeverity)
  severity?: IncidentSeverity;

  @IsOptional()
  @IsEnum(IncidentCategory)
  category?: IncidentCategory;

  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachmentIds?: string[];
}
