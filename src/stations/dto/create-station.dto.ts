import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateStationDto {
  @ApiProperty({
    example: 'Station Bonamoussadi',
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    required: false,
    example: 'Douala, Cameroun',
  })
  @IsOptional()
  @IsString()
  location?: string;

  /**
   * Street address and city are collected by the station form. They are
   * accepted here (and stored inside `location`) so the request is not
   * rejected by the global ValidationPipe.
   */
  @ApiProperty({ required: false, example: 'Rue des palmiers' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ required: false, example: 'Douala' })
  @IsOptional()
  @IsString()
  city?: string;

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
    description: 'Repos minimum entre deux shifts du même swapper, en heures',
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

  @ApiProperty({
    required: false,
    example: 150,
    description:
      'Périmètre de pointage GPS en mètres : distance maximale autorisée entre la position du swappeur et la station lors du pointage.',
  })
  @IsOptional()
  @IsInt()
  @Min(25)
  geofenceRadiusMeters?: number;
}
