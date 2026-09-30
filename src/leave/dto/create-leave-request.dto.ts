import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { LeaveType } from '@prisma/client';

export class CreateLeaveRequestDto {
  @ApiProperty({ example: '2026-09-10' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-09-15' })
  @IsDateString()
  endDate: string;

  @ApiProperty({ enum: LeaveType, example: 'ANNUAL' })
  @IsEnum(LeaveType)
  type: LeaveType;

  @ApiProperty({ required: false, example: 'Voyage familial' })
  @IsOptional()
  @IsString()
  reason?: string;
}