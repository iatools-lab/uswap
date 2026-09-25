import { Controller, Get, Req, UseGuards } from '@nestjs/common';

import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Role } from '@prisma/client';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

import { DashboardService } from './dashboard.service';

type AuthenticatedRequest = {
  user: {
    id: string;
  };
};

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
  ) {}

  /**
   * Every role gets a dashboard; the payload adapts to the caller's scope
   * rather than being split across role-specific routes.
   */
  @Get('stats')
  @Roles(
    Role.ADMIN,
    Role.SUPERVISOR,
    Role.STATION_CHIEF,
    Role.SWAPPER,
  )
  getStats(@Req() req: AuthenticatedRequest) {
    return this.dashboardService.getStats(req.user.id);
  }
}