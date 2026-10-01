import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

  @ApiPropertyOptional({ example: 'Voyage familial' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  reason?: string;

  /**
   * Offline-first reference. Mandatory on the /leaves route so a replayed
   * queue item is deduplicated instead of creating a second request.
   */
  @ApiPropertyOptional({ example: 'leave-1780000000000-abc123' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  idempotencyKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  attachmentId?: string;
}