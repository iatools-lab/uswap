import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({ example: 'jeton-de-rafraichissement' })
  @IsString()
  @IsNotEmpty()
  @MinLength(40)
  refreshToken: string;
}
