import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'danielle.test@upowa.org' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Veuillez fournir une adresse e-mail valide' })
  email: string;

  @ApiProperty({ example: 'motdepasse123' })
  @IsString()
  @IsNotEmpty({ message: 'Le mot de passe est obligatoire' })
  @MaxLength(128, { message: 'Le mot de passe ne peut pas dépasser 128 caractères' })
  password: string;
}
