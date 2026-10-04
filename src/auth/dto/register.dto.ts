import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class RegisterDto {
  @ApiProperty({ example: 'Jean Dupont' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName: string;

  @ApiProperty({ example: 'utilisateur@upowa.org' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @ApiProperty({
    required: false,
    example: 'motdepasse123',
    minLength: 8,
    description:
      'Requis uniquement lorsque le compte est cree actif. Un compte en ' +
      'invitation (sendInvite ou accountStatus=PENDING) recoit un mot de ' +
      'passe temporaire et definit le sien a l activation.',
  })
  // Le mot de passe n'est exige que pour un compte cree ACTIF. Les deux
  // signaux d'invitation doivent etre pris en compte : le frontend envoie
  // accountStatus=PENDING tandis que d'anciens appels utilisent sendInvite.
  @ValidateIf((o) => !o.sendInvite && o.accountStatus !== 'PENDING')
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @ApiProperty({ enum: Role, example: 'SWAPPER' })
  @IsEnum(Role)
  role: Role;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  stationId?: string;

  @ApiProperty({ required: false, example: '+237600000000' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phoneNumber?: string;

  @ApiProperty({ required: false, example: 'Quartier Bonapriso, Douala' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiProperty({
    required: false,
    default: false,
    description:
      'Si true, le compte est créé inactif et une invitation est envoyée par e-mail',
  })
  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean;

  @ApiProperty({
    required: false,
    enum: ['ACTIVE', 'PENDING'],
    default: 'PENDING',
    description:
      'Etat initial du compte. ACTIVE exige un mot de passe et rend le compte ' +
      'immediatement connectable.',
  })
  @IsOptional()
  @IsIn(['ACTIVE', 'PENDING'])
  accountStatus?: 'ACTIVE' | 'PENDING';
}
