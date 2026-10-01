import { IsOptional, IsString } from 'class-validator';

export class QueryIncidentsDto {
  @IsOptional()
  @IsString()
  stationId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  severity?: string;
}
