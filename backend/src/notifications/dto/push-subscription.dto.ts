import { IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PushKeysDto {
  @IsString()
  p256dh!: string;

  @IsString()
  auth!: string;
}

/** Abonnement Web Push envoye par `subscription.toJSON()` du navigateur. */
export class IsPushSubscription {
  @IsString()
  endpoint!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;

  @IsOptional()
  @IsString()
  userAgent?: string;
}
