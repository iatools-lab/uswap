import { IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({ example: 'jeton-de-rafraichissement' })
  @IsNotEmpty()
  refreshToken: string;
}