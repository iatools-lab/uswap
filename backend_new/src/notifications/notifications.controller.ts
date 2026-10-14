import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import { NotificationsService } from './notifications.service';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/guards/roles.guard';
import { serializeNotification } from '../common/serializers';
import { IsPushSubscription } from './dto/push-subscription.dto';

class UpdatePreferencesDto {
  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @IsOptional()
  @IsBoolean()
  digest?: boolean;

  @IsOptional()
  @IsBoolean()
  quietHoursEnabled?: boolean;

  @IsOptional()
  @IsString()
  quietHoursStart?: string | null;

  @IsOptional()
  @IsString()
  quietHoursEnd?: string | null;

  @IsOptional()
  @Min(7)
  @Max(365)
  retentionDays?: number;

  @IsOptional()
  @IsObject()
  categories?: Record<string, { email?: boolean; push?: boolean }>;
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Centre de notifications (50 dernieres)' })
  async list(@CurrentUser() user: AuthenticatedUser) {
    const rows = await this.notifications.listFor(user.id);
    return rows.map(serializeNotification);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marquer une notification comme lue' })
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.notifications.markRead(user.id, id);
    return { ok: true };
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Marquer toutes les notifications comme lues' })
  async markAll(@CurrentUser() user: AuthenticatedUser) {
    const count = await this.notifications.markAllRead(user.id);
    return { ok: true, count };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Nombre de notifications non lues (badge)' })
  async unreadCount(@CurrentUser() user: AuthenticatedUser) {
    const count = await this.notifications.unreadCount(user.id);
    return { count };
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Preferences de notification' })
  preferences(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.preferencesFor(user.id);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Mettre a jour les preferences de notification' })
  updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdatePreferencesDto,
  ) {
    return this.notifications.updatePreferences(user.id, body);
  }

  @Post('push-subscription')
  @HttpCode(201)
  @ApiOperation({ summary: 'Enregistrer un abonnement Web Push' })
  registerPush(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: IsPushSubscription,
  ) {
    return this.notifications.registerPushSubscription(
      user.id,
      {
        endpoint: body.endpoint,
        keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
      },
      body.userAgent,
    );
  }

  @Delete('push-subscription')
  @ApiOperation({ summary: 'Supprimer un abonnement Web Push' })
  @ApiQuery({ name: 'endpoint', required: true })
  async unregisterPush(
    @CurrentUser() user: AuthenticatedUser,
    @Query('endpoint') endpoint: string,
  ) {
    await this.notifications.removePushSubscription(user.id, endpoint);
    return { ok: true };
  }
}
