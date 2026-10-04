import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { IncidentSeverity, IncidentStatus } from '@prisma/client';

export class UpdateIncidentDto {
  @IsOptional()
  @IsEnum(IncidentStatus)
  status?: IncidentStatus;

  @IsOptional()
  @IsEnum(IncidentSeverity)
  severity?: IncidentSeverity;

  @IsOptional()
  @IsString()
  assigneeId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comment?: string;
}
