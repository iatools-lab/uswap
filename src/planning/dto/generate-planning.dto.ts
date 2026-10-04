import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

import { Type } from 'class-transformer';

export class PlanningStationSelectionDto {
  @ApiProperty({
    example: 'uuid-de-la-station',
    description: 'Station concernee par le planning.',
  })
  @IsString()
  @IsNotEmpty()
  stationId: string;

  @ApiProperty({
    type: [String],
    example: ['uuid-swapper-1', 'uuid-swapper-2'],
    description:
      'Swappeurs selectionnes pour cette station. En mode automatique, cette liste peut etre omise.',
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  swapperIds?: string[];

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  templateIds?: string[];

  @ApiProperty({ type: [Number], required: false })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  weekdays?: number[];

  @ApiProperty({
    type: [String],
    example: ['MORNING', 'AFTERNOON', 'NIGHT'],
    description:
      'Shifts selectionnes pour cette station. En mode automatique, les trois shifts par defaut sont utilises.',
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(['MORNING', 'AFTERNOON', 'NIGHT'], { each: true })
  shiftNames?: string[];
}

export class GeneratePlanningDto {
  @ApiProperty({
    type: [PlanningStationSelectionDto],
    example: [
      {
        stationId: 'uuid-station-1',
        swapperIds: ['uuid-swapper-1', 'uuid-swapper-2'],
        shiftNames: ['MORNING', 'AFTERNOON', 'NIGHT'],
      },
    ],
    description:
      'Stations concernees. En mode automatique, les swapperIds et shiftNames peuvent etre omis.',
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanningStationSelectionDto)
  stations?: PlanningStationSelectionDto[];

  // --- Sprint 5 : forme plate envoyee par l'ecran de planification ---

  @ApiProperty({ required: false, example: 'uuid-de-la-station' })
  @IsOptional()
  @IsString()
  stationId?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  templateIds?: string[];

  @ApiProperty({
    required: false,
    type: [Number],
    description: 'Jours de semaine 0=dimanche … 6=samedi',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  weekdays?: number[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  previewHash?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  revision?: number;
}
