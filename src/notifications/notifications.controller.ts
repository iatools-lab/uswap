import {
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';

import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';

import { NotificationsService } from './notifications.service';

type AuthenticatedRequest = {
  user: {
    id: string;
  };
};

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Every authenticated role reads its own notifications, so no @Roles()
   * is declared here — the query is always scoped to req.user.id.
   */
  @Get()
  findMine(@Req() req: AuthenticatedRequest) {
    return this.notificationsService.findMine(req.user.id);
  }

  @Get('unread-count')
  unreadCount(@Req() req: AuthenticatedRequest) {
    return this.notificationsService.unreadCount(req.user.id);
  }

  @Patch('read-all')
  markAllAsRead(@Req() req: AuthenticatedRequest) {
    return this.notificationsService.markAllAsRead(req.user.id);
  }

  @Patch(':id/read')
  markAsRead(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.notificationsService.markAsRead(req.user.id, id);
  }
}