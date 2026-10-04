import { IsIn, IsOptional, IsString } from 'class-validator';

export class QueryReportDashboardDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  stationId?: string;

  @IsOptional()
  @IsString()
  swapperId?: string;

  @IsOptional()
  @IsIn(['CSV', 'XLSX'])
  format?: 'CSV' | 'XLSX';
}
