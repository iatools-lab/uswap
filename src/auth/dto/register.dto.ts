import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, IsBoolean, MinLength, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class RegisterDto {
  @ApiProperty({ example: 'Jean Dupont' })
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ example: 'utilisateur@upowa.org' })
  @IsEmail()
  email: string;

  @ApiProperty({ required: false, example: 'motdepasse123', minLength: 8, description: 'Requis uniquement si sendInvite est absent ou false' })
  @ValidateIf((o) => !o.sendInvite)
  @MinLength(8)
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
  phoneNumber?: string;

  @ApiProperty({ required: false, example: 'Quartier Bonapriso, Douala' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ required: false, default: false, description: 'Si true, le compte est cree inactif et un jeton d invitation est genere au lieu d un mot de passe' })
  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean;
}
