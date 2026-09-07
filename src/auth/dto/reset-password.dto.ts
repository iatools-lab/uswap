import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Le token de réinitialisation reçu ou généré',
  })
  @IsString()
  @IsNotEmpty({ message: 'Le token est obligatoire' })
  token: string;

  @ApiProperty({
    example: 'NouveauMotDePasse123!',
    description: 'Nouveau mot de passe (au moins 8 caractères)',
  })
  @IsString()
  @MinLength(8, { message: 'Le mot de passe doit contenir au moins 8 caractères' })
  password: string;
}