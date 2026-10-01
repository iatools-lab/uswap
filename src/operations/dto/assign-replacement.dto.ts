import {
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class AssignReplacementDto {
  @ApiProperty({
    example: 'uuid-du-swappeur-remplacant',
    description: 'Swappeur retenu par le superviseur.',
  })
  @IsString()
  @IsNotEmpty()
  swapperId: string;

  @ApiProperty({
    required: false,
    example: 'Absence couverte',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}