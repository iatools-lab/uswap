import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { LeaveService } from './leave.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { CancelLeaveDto, UpdateLeaveDto } from './dto/update-leave-request.dto';

type AuthenticatedRequest = { user: { id: string } };

/**
 * Leave routes.
 *
 * `/leaves/*` is the sprint 4/5 contract used by the swapper workspace.
 * `/leave-requests/*` is kept as a legacy alias so older clients keep working.
 */
@ApiTags('leave')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class LeaveController {
  constructor(private readonly leaveService: LeaveService) {}

  // ---------- Sprint 4/5 contract ----------

  @Get('leaves/workspace')
  @Roles(Role.SWAPPER)
  @ApiOperation({ summary: 'Espace conges du swappeur (solde + demandes)' })
  workspace(@Req() req: AuthenticatedRequest) {
    return this.leaveService.workspace(req.user.id);
  }

  @Post('leaves')
  @Roles(Role.SWAPPER)
  @ApiOperation({ summary: 'Creer une demande de conge (idempotent)' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateLeaveRequestDto) {
    return this.leaveService.create(req.user.id, dto);
  }

  @Patch('leaves/:id')
  @Roles(Role.SWAPPER)
  @ApiOperation({ summary: 'Modifier une demande de conge en attente' })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateLeaveDto,
  ) {
    return this.leaveService.update(req.user.id, id, dto);
  }

  @Post('leaves/:id/cancel')
  @Roles(Role.SWAPPER)
  @ApiOperation({ summary: 'Annuler une demande de conge en attente' })
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CancelLeaveDto,
  ) {
    return this.leaveService.cancel(req.user.id, id, dto);
  }

  @Post('leaves/sync/:operationId/retry')
  @Roles(Role.SWAPPER)
  @ApiOperation({ summary: 'Relancer une synchronisation de conge echouee' })
  retrySync(
    @Req() req: AuthenticatedRequest,
    @Param('operationId') operationId: string,
  ) {
    return this.leaveService.retrySync(req.user.id, operationId);
  }

  // ---------- Legacy aliases ----------

  @Roles(Role.SWAPPER)
  @Post('leave-requests')
  createLegacy(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateLeaveRequestDto,
  ) {
    return this.leaveService.create(req.user.id, dto);
  }

  @Get('leave-requests/mine')
  findMineLegacy(@Req() req: AuthenticatedRequest) {
    return this.leaveService.findMine(req.user.id);
  }
}
