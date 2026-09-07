import { IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ActivateAccountDto {
  @ApiProperty({ example: 'jeton-recu-par-e-mail' })
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'motdepasse123', minLength: 8 })
  @MinLength(8)
  password: string;
}