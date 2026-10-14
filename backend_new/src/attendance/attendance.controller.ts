import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNumber, IsString } from 'class-validator';
import { AttendanceService } from './attendance.service';
import { ConstraintsService } from '../planning/constraints.service';
import {
  CurrentUser,
  Roles,
  type AuthenticatedUser,
} from '../common/guards/roles.guard';
import { Role } from '../common/enums';

class PunchDto {
  @IsString()
  shiftId!: string;

  @IsString()
  kind!: string;

  @IsNumber()
  latitude!: number;

  @IsNumber()
  longitude!: number;

  @IsNumber()
  accuracyMeters!: number;
}

class CorrectionDto {
  @IsString()
  reason!: string;

  attachmentId?: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  isLate?: boolean;
  isAbsent?: boolean;
  isJustified?: boolean;
}

@ApiTags('attendance')
@ApiBearerAuth()
@Controller()
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly constraints: ConstraintsService,
  ) {}

  /**
   * Contrôles métier d'un créneau pour un agent donné. Le frontend appelle
   * cette route sur plusieurs agents pour peupler l'écran d'affectation.
   */
  @Post('shifts/validate')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @HttpCode(200)
  @ApiOperation({ summary: 'Contrôles métier d’un créneau pour un agent' })
  validateShift(
    @Body()
    body: {
      stationId: string;
      swapperId: string;
      startTime: string;
      endTime: string;
    },
  ) {
    const diff = Date.parse(body.endTime) - Date.parse(body.startTime);
    return this.constraints.report({
      stationId: body.stationId,
      swapperId: body.swapperId,
      startTime: body.startTime,
      endTime: body.endTime,
      hours: Math.max(0, Math.round((diff / 3_600_000) * 100) / 100),
    });
  }

  @Get('workspace')
  @ApiOperation({ summary: 'Postes de l’agent connecté (accueil / pointage)' })
  workspace(@CurrentUser() user: AuthenticatedUser) {
    return this.attendance.workspace(user);
  }

  @Get('shifts')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Postes supervisés avec pointages' })
  shifts(@CurrentUser() user: AuthenticatedUser) {
    return this.attendance.shiftsForSupervision(user);
  }

  @Post('attendance')
  @Roles(Role.SWAPPER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Prise ou fin de service avec contrôle GPS' })
  punch(@CurrentUser() user: AuthenticatedUser, @Body() body: PunchDto) {
    return this.attendance.punch(user, body);
  }

  @Get('attendance')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Pointages publiés (vue superviseur)' })
  records(
    @CurrentUser() user: AuthenticatedUser,
    @Query('stationId') stationId?: string,
  ) {
    return this.attendance.records(user, { stationId });
  }

  @Get('attendance/monitor')
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @ApiOperation({ summary: 'Suivi du jour : présents, retards, absents' })
  monitor(@CurrentUser() user: AuthenticatedUser) {
    return this.attendance.monitor(user);
  }

  @Get('attendance/history')
  @ApiOperation({ summary: 'Relevé des pointages passés' })
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.attendance.history(user, { from, to });
  }

  @Patch('corrections/shifts/:shiftId')
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @ApiOperation({ summary: 'Corriger un pointage (motif obligatoire)' })
  correct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('shiftId') shiftId: string,
    @Body() body: CorrectionDto,
  ) {
    return this.attendance.correct(user, shiftId, body);
  }
}
