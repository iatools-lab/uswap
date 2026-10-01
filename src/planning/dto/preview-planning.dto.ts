import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * Payload sent by the planner screen to preview or generate shifts:
 * one station, a set of templates and the weekdays to apply them to.
 * `weekdays` uses 0 = Sunday … 6 = Saturday.
 */
export class PreviewPlanningDto {
  @IsOptional()
  @IsString()
  stationId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  templateIds?: string[];

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  weekdays?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  revision?: number;

  @IsOptional()
  @IsString()
  previewHash?: string;

  // Legacy shape: stations[] with swapperIds/shiftNames.
  @IsOptional()
  @IsArray()
  stations?: { stationId: string; swapperIds?: string[]; shiftNames?: string[] }[];
}
