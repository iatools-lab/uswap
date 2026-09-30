import { IsNotEmpty, IsOptional, IsString, IsInt, IsLatitude, IsLongitude, Min } from 'class-validator';
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

  @ApiProperty({ required: false, example: 4.0511 })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiProperty({ required: false, example: 9.7679 })
  @IsOptional()
  @IsLongitude()
  longitude?: number;

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

  @ApiProperty({ required: false, example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  latenessToleranceMinutes?: number;

  @ApiProperty({ required: false, example: 8 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minRestHours?: number;

  @ApiProperty({ required: false, example: 48 })
  @IsOptional()
  @IsInt()
  @Min(1)
  weeklyHoursLimit?: number;

  @ApiProperty({ required: false, example: 300 })
  @IsOptional()
  @IsInt()
  @Min(30)
  checkinQrTtl?: number;

  @ApiProperty({ required: false, example: 300 })
  @IsOptional()
  @IsInt()
  @Min(30)
  checkoutQrTtl?: number;
}