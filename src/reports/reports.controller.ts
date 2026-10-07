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
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateScheduledReportDto,
  ToggleScheduledReportDto,
  PreviewScheduledReportDto,
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

  /**
   * Sprint 6 : journal d'audit consolide (comptes, incidents, affectations,
   * reglages). Alimente `/admin/audit` cote frontend.
   */
  @Get('admin/audit')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @ApiOperation({ summary: "Journal d'audit consolide" })
  audit() {
    return this.reportsService.auditLog();
  }

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
  @ApiOperation({
    summary: 'Tableau de bord operationnel (pointages, couverture)',
  })
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

  @Post('admin/reports/schedules/preview')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Prévisualiser un rapport programmé' })
  previewSchedule(
    @Req() req: AuthenticatedRequest,
    @Body() dto: PreviewScheduledReportDto,
  ) {
    return this.reportsService.previewScheduledReport(req.user, dto);
  }

  @Get('admin/reports/schedules/:id/runs')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Historique des exécutions d’un rapport' })
  listRuns(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.reportsService.listReportRuns(req.user, id);
  }

  @Get('reports/export')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.STATION_CHIEF)
  @ApiOperation({ summary: 'Exporter un rapport filtré en CSV ou Excel' })
  async export(
    @Req() req: AuthenticatedRequest,
    @Query() query: QueryReportDashboardDto & { format?: string },
    @Res() res: Response,
  ) {
    const file = await this.reportsService.exportReport(req.user, query);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    res.send(file.content);
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
