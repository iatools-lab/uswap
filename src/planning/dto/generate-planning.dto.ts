import { IsArray, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GeneratePlanningDto {
  @ApiProperty({
    required: false,
    type: [String],
    description: 'Stations a couvrir. Si omis, toutes les stations actives sont utilisees.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  stationIds?: string[];

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Swappeurs disponibles pour cette generation. Si omis, tous les swappeurs actifs sont utilises.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  swapperIds?: string[];
}