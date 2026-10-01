import {
  Controller,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common';

import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Role } from '@prisma/client';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

import { WorkspaceService } from './workspace.service';

type AuthenticatedRequest = {
  user: {
    id: string;
    role: Role;
  };
};

@ApiTags('workspace')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('workspace')
export class WorkspaceController {
  constructor(
    private readonly workspaceService: WorkspaceService,
  ) {}

  /**
   * Landing payload for the operations screen. Used by every role, so the
   * payload adapts to the caller instead of being role-split across routes.
   */
  @Get()
  @Roles(
    Role.ADMIN,
    Role.SUPERVISOR,
    Role.STATION_CHIEF,
    Role.SWAPPER,
  )
  getWorkspace(@Req() req: AuthenticatedRequest) {
    return this.workspaceService.getWorkspace(req.user.id);
  }
}