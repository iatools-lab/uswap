import { IsNotEmpty, IsOptional, IsString, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateStationDto {
  @ApiProperty({ example: 'Station Bonamoussadi' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ required: false, example: 'Douala, Cameroun' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({ required: false, example: 'Africa/Douala' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiProperty({ required: false, example: 'Jean Mballa' })
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiProperty({ required: false, example: '+237600000000' })
  @IsOptional()
  @IsString()
  contactPhone?: string;

  @ApiProperty({ required: false, example: 10, description: 'Tolerance de retard en minutes' })
  @IsOptional()
  @IsInt()
  @Min(0)
  latenessToleranceMinutes?: number;

  @ApiProperty({ required: false, example: 8, description: 'Repos minimal en heures entre deux shifts' })
  @IsOptional()
  @IsInt()
  @Min(0)
  minRestHours?: number;

  @ApiProperty({ required: false, example: 48, description: 'Limite hebdomadaire en heures' })
  @IsOptional()
  @IsInt()
  @Min(1)
  weeklyHoursLimit?: number;

  @ApiProperty({ required: false, example: 300, description: 'Duree de validite du QR de debut de service, en secondes' })
  @IsOptional()
  @IsInt()
  @Min(30)
  checkinQrTtl?: number;

  @ApiProperty({ required: false, example: 300, description: 'Duree de validite du QR de fin de service, en secondes' })
  @IsOptional()
  @IsInt()
  @Min(30)
  checkoutQrTtl?: number;
}