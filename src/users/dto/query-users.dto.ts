import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

/**
 * Empty query values arrive as "" (the screens serialise every filter, even
 * the unset ones). Treat blank as absent so `role=` does not fail enum
 * validation and turn the whole listing into a 400.
 */
const blankToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export class QueryUsersDto {
  @ApiProperty({ required: false, description: 'Recherche par nom ou e-mail' })
  @IsOptional()
  @IsString()
  search?: string;

  /**
   * Alias for `search`: the users screen sends `q` (matching what the screen
   * calls the field), while the API historically exposed `search`. Both are
   * accepted so neither side has to change.
   */
  @ApiProperty({ required: false, description: 'Alias de search' })
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  q?: string;

  /**
   * Sort order used by the users screen. Accepted here so the request is not
   * rejected by the global ValidationPipe (forbidNonWhitelisted).
   */
  @ApiProperty({ required: false, description: 'Ordre de tri de la liste' })
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiProperty({ required: false, enum: Role })
  @IsOptional()
  @Transform(blankToUndefined)
  @IsEnum(Role)
  role?: Role;

  @ApiProperty({ required: false, enum: ['active', 'pending', 'inactive'] })
  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn(['active', 'pending', 'inactive'])
  status?: 'active' | 'pending' | 'inactive';

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  stationId?: string;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
