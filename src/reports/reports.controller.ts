import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateScheduledReportDto,
  ToggleScheduledReportDto,
} from './dto/create-scheduled-report.dto';
import { QueryReportDashboardDto } from './dto/query-report-dashboard.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { ReportsService } from './reports.service';

type AuthenticatedRequest = { user: { id: string; role: Role } };

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // ---------- Global settings (admin) ----------

  @Get('admin/settings')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Reglages globaux du reseau et historique' })
  getSettings() {
    return this.reportsService.getSettings();
  }

  @Patch('admin/settings')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Mettre a jour les reglages globaux' })
  updateSettings(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.reportsService.updateSettings(req.user, dto);
  }

  // ---------- Operational report dashboard ----------

  @Get('reports/dashboard')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.STATION_CHIEF)
  @ApiOperation({ summary: 'Tableau de bord operationnel (pointages, couverture)' })
  dashboard(
    @Req() req: AuthenticatedRequest,
    @Query() query: QueryReportDashboardDto,
  ) {
    return this.reportsService.dashboard(req.user, query);
  }

  // ---------- Scheduled reports (admin) ----------

  @Get('admin/reports/schedules')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Rapports programmes' })
  listSchedules() {
    return this.reportsService.listScheduledReports();
  }

  @Post('admin/reports/schedules')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Programmer un rapport recurrent' })
  createSchedule(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateScheduledReportDto,
  ) {
    return this.reportsService.createScheduledReport(req.user, dto);
  }

  @Patch('admin/reports/schedules/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Activer ou suspendre un rapport programme' })
  toggleSchedule(
    @Param('id') id: string,
    @Body() dto: ToggleScheduledReportDto,
  ) {
    return this.reportsService.toggleScheduledReport(id, dto.isActive === true);
  }

  // ---------- Leave integration health (admin) ----------

  @Get('admin/integrations/leaves')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Etat de l integration de conges externe' })
  leaveIntegration() {
    return this.reportsService.leaveIntegrationHealth();
  }
}
