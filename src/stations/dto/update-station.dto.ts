import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateStationDto {
  @ApiProperty({
    required: false,
    example: 'Station Bonamoussadi',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    required: false,
    example: 'Douala, Cameroun',
  })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({
    required: false,
    example: 4.0511,
  })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiProperty({
    required: false,
    example: 9.7679,
  })
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiProperty({
    required: false,
    example: 'Africa/Douala',
  })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiProperty({
    required: false,
    example: 'John Doe',
  })
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiProperty({
    required: false,
    example: '+237690000000',
  })
  @IsOptional()
  @IsString()
  contactPhone?: string;

  @ApiProperty({
    required: false,
    example: 0,
    description: 'Tolerance de retard en minutes',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  latenessToleranceMinutes?: number;

  @ApiProperty({
    required: false,
    example: 8,
    description:
      'Repos minimum entre deux shifts du même swapper, en heures',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  minRestHours?: number;

  @ApiProperty({
    required: false,
    example: 48,
    description:
      'Nombre maximum d heures de travail autorisées par semaine pour un swapper',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  weeklyHoursLimit?: number;

  @ApiProperty({
    required: false,
    example: 300,
    description: 'Validité du QR de début en secondes',
  })
  @IsOptional()
  @IsInt()
  @Min(30)
  checkinQrTtl?: number;

  @ApiProperty({
    required: false,
    example: 300,
    description: 'Validité du QR de fin en secondes',
  })
  @IsOptional()
  @IsInt()
  @Min(30)
  checkoutQrTtl?: number;
}