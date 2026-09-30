import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ImportUserRowDto } from './import-user-row.dto';

export class ConfirmImportDto {
  @ApiProperty({ type: [ImportUserRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportUserRowDto)
  rows: ImportUserRowDto[];
}