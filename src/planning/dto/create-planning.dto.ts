import { IsDateString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePlanningDto {
  @ApiProperty({ example: '2026-09-15' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-09-21' })
  @IsDateString()
  endDate: string;
}