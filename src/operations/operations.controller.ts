import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Role, ShiftChangeType } from '@prisma/client';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

import { OperationsService } from './operations.service';

import { DeclareAbsenceDto } from './dto/declare-absence.dto';
import { AssignReplacementDto } from './dto/assign-replacement.dto';

type AuthenticatedRequest = {
  user: {
    id: string;
    role: Role;
  };
};

@ApiTags('operations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('operations')
export class OperationsController {
  constructor(
    private readonly operationsService: OperationsService,
  ) {}

  // ============================================================
  // BLOC A — SWAPPER DECLARES AN IMPEDIMENT
  // ============================================================

  @Post('absences')
  @Roles(Role.SWAPPER)
  declareAbsence(
    @Req() req: AuthenticatedRequest,
    @Body() dto: DeclareAbsenceDto,
  ) {
    return this.operationsService.declareAbsence({
      swapperId: req.user.id,
      shiftId: dto.shiftId,
      reason: dto.reason,
    });
  }

  // ============================================================
  // BLOC B — COVERAGE QUEUE
  // ============================================================

  @Get('replacements/pending')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.STATION_CHIEF)
  findPendingReplacements(@Req() req: AuthenticatedRequest) {
    return this.operationsService.findPendingReplacements(
      req.user.id,
    );
  }

  // ============================================================
  // BLOC B — SHIFT CHANGE HISTORY
  // ============================================================

  @Get('changes')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.STATION_CHIEF)
  findShiftChanges(
    @Req() req: AuthenticatedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type?: ShiftChangeType,
    @Query('swapperId') swapperId?: string,
  ) {
    return this.operationsService.findShiftChanges(req.user.id, {
      from,
      to,
      type,
      swapperId,
    });
  }

  // ============================================================
  // BLOC C — CANDIDATES FOR A SHIFT
  // ============================================================

  @Get('shifts/:shiftId/candidates')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.STATION_CHIEF)
  findReplacementCandidates(
    @Req() req: AuthenticatedRequest,
    @Param('shiftId') shiftId: string,
  ) {
    return this.operationsService.findReplacementCandidates(
      req.user.id,
      shiftId,
    );
  }

  // ============================================================
  // BLOC C — ASSIGN A REPLACEMENT
  // ============================================================

  @Post('shifts/:shiftId/replacement')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.STATION_CHIEF)
  assignReplacement(
    @Req() req: AuthenticatedRequest,
    @Param('shiftId') shiftId: string,
    @Body() dto: AssignReplacementDto,
  ) {
    return this.operationsService.assignReplacement({
      changedById: req.user.id,
      shiftId,
      swapperId: dto.swapperId,
      reason: dto.reason,
    });
  }
}