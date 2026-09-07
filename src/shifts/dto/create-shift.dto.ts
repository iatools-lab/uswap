import { IsDateString, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateShiftDto {
  @ApiProperty({ example: 'uuid-de-la-station' })
  @IsString()
  @IsNotEmpty()
  stationId: string;

  @ApiProperty({ example: 'uuid-du-swappeur' })
  @IsString()
  @IsNotEmpty()
  swapperId: string;

  @ApiProperty({ example: '2026-09-08T08:00:00.000Z' })
  @IsDateString()
  startTime: string;

  @ApiProperty({ example: '2026-09-08T14:00:00.000Z' })
  @IsDateString()
  endTime: string;
}