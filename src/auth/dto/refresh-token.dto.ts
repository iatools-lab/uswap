import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The refresh token normally travels in the `uswap_refresh` HttpOnly cookie,
 * so the body is optional. It is still accepted here for non-browser clients
 * (scripts, mobile) that have no cookie jar.
 */
export class RefreshTokenDto {
  @ApiPropertyOptional({
    example: 'jeton-de-rafraichissement',
    description:
      'Optionnel : par défaut le jeton est lu dans le cookie HttpOnly uswap_refresh.',
  })
  @IsOptional()
  @IsString()
  @MinLength(40)
  refreshToken?: string;
}
