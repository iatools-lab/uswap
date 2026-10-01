import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token de réinitialisation reçu par e-mail' })
  @IsString()
  @IsNotEmpty({ message: 'Le token est obligatoire' })
  token: string;

  @ApiProperty({
    example: 'NouveauMotDePasse123!',
    description: 'Nouveau mot de passe (8 à 128 caractères)',
  })
  @IsString()
  @MinLength(8, { message: 'Le mot de passe doit contenir au moins 8 caractères' })
  @MaxLength(128, { message: 'Le mot de passe ne peut pas dépasser 128 caractères' })
  password: string;
}
