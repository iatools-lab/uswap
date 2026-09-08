import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'david@upowa.org',
    description: 'E-mail de l’utilisateur demandant la réinitialisation',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Veuillez fournir une adresse e-mail valide' })
  @IsNotEmpty({ message: 'L’e-mail est obligatoire' })
  email: string;
}
