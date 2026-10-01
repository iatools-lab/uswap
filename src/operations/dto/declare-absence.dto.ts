import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class DeclareAbsenceDto {
  @ApiProperty({ example: 'uuid-du-creneau' })
  @IsString()
  @IsNotEmpty()
  shiftId: string;

  @ApiProperty({
    example: 'Maladie',
    minLength: 3,
  })
  @IsString()
  @MinLength(3)
  reason: string;

  @ApiProperty({
    required: false,
    description:
      'Reference idempotente generee par le client (file hors connexion).',
  })
  @IsOptional()
  @IsString()
  clientRef?: string;
}