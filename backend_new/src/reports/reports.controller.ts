import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import {
  CurrentUser,
  Roles,
  type AuthenticatedUser,
} from '../common/guards/roles.guard';
import { Role } from '../common/enums';

class ScheduledReportDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  frequency?: string;

  @IsOptional()
  @IsString()
  format?: string;

  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsString()
  stationId?: string | null;

  @IsOptional()
  @IsArray()
  recipients?: string[];

  @IsOptional()
  @IsArray()
  sections?: string[];
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports/dashboard')
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @ApiOperation({ summary: 'Indicateurs consolidés de la période' })
  dashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('planningId') planningId?: string,
    @Query('stationId') stationId?: string,
    @Query('swapperId') swapperId?: string,
  ) {
    return this.reports.dashboard(user, {
      from,
      to,
      planningId,
      stationId,
      swapperId,
    });
  }

  @Get('reports/export')
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @ApiOperation({ summary: 'Export XLSX/CSV du rapport de période' })
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('planningId') planningId?: string,
    @Query('stationId') stationId?: string,
    @Query('swapperId') swapperId?: string,
    @Query('format') format?: string,
  ) {
    const result = await this.reports.export(user, {
      from,
      to,
      planningId,
      stationId,
      swapperId,
      format,
    });
    response.setHeader('Content-Type', result.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    response.end(result.buffer);
  }

  @Get('admin/reports/schedules')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Rapports programmés' })
  async scheduled() {
    const rows = await this.reports.scheduled();
    return rows.sort(
      (a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt),
    );
  }

  @Post('admin/reports/schedules')
  @Roles(Role.ADMIN)
  @HttpCode(201)
  @ApiOperation({ summary: 'Programme un envoi automatique de rapport' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ScheduledReportDto,
  ) {
    return this.reports.createScheduled(user, body);
  }

  @Post('admin/reports/schedules/preview')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Aperçu du rapport avant programmation' })
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { stationId?: string },
  ) {
    return this.reports.preview(user, body);
  }

  @Get('admin/reports/schedules/:id/runs')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Historique d’exécution d’un rapport' })
  runs(@Param('id') id: string) {
    return this.reports.runs(id);
  }

  @Patch('admin/reports/schedules/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Active ou suspend un rapport programmé' })
  toggle(@Param('id') id: string, @Body() body: { isActive?: boolean }) {
    return this.reports.toggleScheduled(id, body.isActive === true);
  }

  @Post('admin/reports/schedules/:id/send')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Envoie immédiatement un rapport programmé à ses destinataires',
  })
  sendNow(@Param('id') id: string) {
    return this.reports.sendNow(id);
  }

  /**
   * Exécution immédiate des envois arrivés à échéance.
   *
   * Réservée au super administrateur : la tâche horaire l'appelle déjà toute
   * seule, mais un exploitant doit pouvoir vérifier « maintenant » qu'un
   * rapport part bien avec sa pièce jointe, sans attendre la prochaine heure.
   * Seuls les rapports réellement dus sont exécutés.
   */
  @Post('admin/reports/run-due')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Exécute immédiatement les rapports dus' })
  runDue() {
    return this.reports.runDueReports();
  }
}
