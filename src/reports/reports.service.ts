import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, Role, ScheduledReportFormat } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { CreateScheduledReportDto } from './dto/create-scheduled-report.dto';
import { QueryReportDashboardDto } from './dto/query-report-dashboard.dto';
import { PreviewScheduledReportDto } from './dto/create-scheduled-report.dto';
import { EmailService } from '../auth/email.service';

const DAY_MS = 86_400_000;

type Actor = { id: string; role: Role };

/**
 * Reporting and network settings.
 *
 * `getSettings`/`updateSettings` back the global settings screen, while
 * `dashboard` aggregates attendance, coverage, hours and movements over a
 * period for the supervisor/chief report screen. `scheduledReports` handles the
 * recurring deliveries an administrator configures.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  // ============================================================
  // GLOBAL SETTINGS
  // ============================================================

  async getSettings() {
    const settings = await this.ensureSettings();
    const history = await this.prisma.globalSettingRevision.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
    });
    return { settings, history };
  }

  async updateSettings(actor: Actor, dto: UpdateSettingsDto) {
    if (actor.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Seul un administrateur peut modifier les réglages globaux.',
      );
    }

    const before = await this.ensureSettings();

    const supportEmail = dto.supportEmail?.trim() ?? before.supportEmail;
    if (!/^\S+@\S+\.\S+$/.test(supportEmail)) {
      throw new BadRequestException("L'adresse de support est invalide.");
    }

    const bounded = (
      value: number | undefined,
      min: number,
      max: number,
      key: string,
      fallback: number,
    ) => {
      if (value === undefined) return fallback;
      if (!Number.isFinite(value) || value < min || value > max) {
        throw new BadRequestException(
          `La valeur « ${key} » doit être comprise entre ${min} et ${max}.`,
        );
      }
      return Math.round(value);
    };

    const next = {
      sessionMinutes: bounded(
        dto.sessionMinutes,
        15,
        720,
        'sessionMinutes',
        before.sessionMinutes,
      ),
      invitationValidityHours: bounded(
        dto.invitationValidityHours,
        1,
        168,
        'invitationValidityHours',
        before.invitationValidityHours,
      ),
      maxAttachmentMb: bounded(
        dto.maxAttachmentMb,
        1,
        25,
        'maxAttachmentMb',
        before.maxAttachmentMb,
      ),
      notificationRetentionDays: bounded(
        dto.notificationRetentionDays,
        7,
        365,
        'notificationRetentionDays',
        before.notificationRetentionDays,
      ),
      supportEmail,
      webhookSecretConfigured: dto.webhookSecret
        ? true
        : before.webhookSecretConfigured,
      revision: before.revision + 1,
      updatedBy: actor.id,
    };

    const settings = await this.prisma.globalSetting.update({
      where: { id: before.id },
      data: next,
    });

    await this.prisma.globalSettingRevision.create({
      data: {
        revision: settings.revision,
        actorId: actor.id,
        before: this.sanitize(before),
        after: this.sanitize(settings),
      },
    });

    const history = await this.prisma.globalSettingRevision.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
    });
    return { settings, history };
  }

  // ============================================================
  // OPERATIONAL REPORT DASHBOARD
  // ============================================================

  async dashboard(actor: Actor, query: QueryReportDashboardDto) {
    if (
      actor.role !== Role.SUPERVISOR &&
      actor.role !== Role.ADMIN
    ) {
      throw new ForbiddenException('Accès non autorisé aux rapports.');
    }

    const now = Date.now();
    const from = query.from
      ? new Date(query.from)
      : new Date(now - 30 * DAY_MS);
    const to = query.to ? new Date(query.to) : new Date(now + DAY_MS);

    const me = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { stationId: true },
    });
    const scopedStationId =
      actor.role === Role.SUPERVISOR && me?.stationId
        ? me.stationId
        : query.stationId || null;

    const scopeStations = me?.stationId
      ? [me.stationId]
      : (await this.prisma.station.findMany({ select: { id: true } })).map(
          (station) => station.id,
        );

    const shifts = await this.prisma.shift.findMany({
      where: {
        stationId: { in: scopeStations },
        ...(scopedStationId ? { stationId: scopedStationId } : {}),
        ...(query.swapperId ? { swapperId: query.swapperId } : {}),
        ...(query.planningId ? { planningId: query.planningId } : {}),
        startTime: { gte: from, lte: to },
        planning: { status: 'PUBLISHED' },
      },
      include: {
        station: { select: { id: true, name: true } },
        swapper: { select: { id: true, fullName: true } },
        attendances: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { startTime: 'asc' },
    });

    const status = {
      present: 0,
      late: 0,
      absent: 0,
      closed: 0,
      expected: 0,
      justified: 0,
    };

    const details = shifts.map((shift) => {
      const record = shift.attendances[0];
      const value = record?.status ?? 'EXPECTED';
      const key = String(value).toLowerCase() as keyof typeof status;
      if (key in status) status[key] += 1;
      return {
        id: shift.id,
        startTime: shift.startTime.toISOString(),
        station: shift.station?.name ?? '—',
        swapper: shift.swapper?.fullName ?? 'Poste vacant',
        status: key,
        label: `${shift.station?.name ?? ''} ${shift.startTime
          .toISOString()
          .slice(11, 16)}`.trim(),
      };
    });

    const assigned = shifts.filter((shift) => shift.swapperId).length;

    const hoursBySwapper = new Map<
      string,
      { name: string; station: string; hours: number }
    >();
    const hoursByStation = new Map<
      string,
      { station: string; hours: number }
    >();
    const hoursByWeek = new Map<string, number>();
    const hoursByMonth = new Map<string, number>();
    for (const shift of shifts.filter((row) => row.swapperId)) {
      const person = shift.swapper;
      if (!person) continue;
      const hours =
        (shift.endTime.getTime() - shift.startTime.getTime()) / 3_600_000;
      const current = hoursBySwapper.get(person.id) ?? {
        name: person.fullName,
        station: shift.station?.name ?? '—',
        hours: 0,
      };
      current.hours = Math.round((current.hours + hours) * 10) / 10;
      hoursBySwapper.set(person.id, current);
      const stationKey = shift.station.id;
      const stationRow = hoursByStation.get(stationKey) ?? {
        station: shift.station?.name ?? '—',
        hours: 0,
      };
      stationRow.hours = Math.round((stationRow.hours + hours) * 10) / 10;
      hoursByStation.set(stationKey, stationRow);
      const weekDate = new Date(shift.startTime);
      const weekDay = weekDate.getUTCDay();
      weekDate.setUTCDate(
        weekDate.getUTCDate() - (weekDay === 0 ? 6 : weekDay - 1),
      );
      const weekKey = weekDate.toISOString().slice(0, 10);
      hoursByWeek.set(
        weekKey,
        Math.round(((hoursByWeek.get(weekKey) ?? 0) + hours) * 10) / 10,
      );
      const monthKey = shift.startTime.toISOString().slice(0, 7);
      hoursByMonth.set(
        monthKey,
        Math.round(((hoursByMonth.get(monthKey) ?? 0) + hours) * 10) / 10,
      );
    }

    const stationRows = await Promise.all(
      (
        await this.prisma.station.findMany({
          where: {
            isActive: true,
            id: {
              in: scopeStations,
              ...(scopedStationId ? { equals: scopedStationId } : {}),
            },
          },
          select: { id: true, name: true },
        })
      ).map(async (station) => {
        const rows = shifts.filter((shift) => shift.stationId === station.id);
        const filled = rows.filter((shift) => Boolean(shift.swapperId)).length;
        const vacant = rows.filter((shift) => !shift.swapperId);
        const openIncidents = await this.prisma.incident.count({
          where: {
            stationId: station.id,
            status: { notIn: ['RESOLVED', 'CLOSED'] },
          },
        });
        return {
          id: station.id,
          name: station.name,
          total: rows.length,
          filled,
          coverage: rows.length ? Math.round((filled / rows.length) * 100) : 0,
          futureVacant: vacant.filter(
            (shift) => shift.startTime.getTime() >= now,
          ).length,
          pastVacant: vacant.filter((shift) => shift.startTime.getTime() < now)
            .length,
          risk: vacant.length ? 'AT_RISK' : 'STABLE',
          incidents: openIncidents,
        };
      }),
    );

    const changes = await this.prisma.shiftChange.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        shift: {
          stationId: scopedStationId ? scopedStationId : { in: scopeStations },
        },
      },
      include: {
        shift: { select: { station: { select: { name: true } } } },
        previousSwapper: { select: { fullName: true } },
        newSwapper: { select: { fullName: true } },
      },
    });

    const leaveWhere = {
      startDate: { lte: to },
      endDate: { gte: from },
      user: {
        stationId: scopedStationId ? scopedStationId : { in: scopeStations },
      },
    };
    const [approvedLeaves, syncedLeaves, pendingLeaves, failedLeaves] =
      await Promise.all([
        this.prisma.leaveRequest.count({
          where: { ...leaveWhere, status: 'APPROVED' },
        }),
        this.prisma.leaveSyncOperation.count({
          where: {
            createdAt: { gte: from, lte: to },
            status: 'SYNCED',
            user: {
              stationId: scopedStationId
                ? scopedStationId
                : { in: scopeStations },
            },
          },
        }),
        this.prisma.leaveSyncOperation.count({
          where: {
            createdAt: { gte: from, lte: to },
            status: { in: ['QUEUED', 'PROCESSING'] },
            user: {
              stationId: scopedStationId
                ? scopedStationId
                : { in: scopeStations },
            },
          },
        }),
        this.prisma.leaveSyncOperation.count({
          where: {
            createdAt: { gte: from, lte: to },
            status: 'FAILED',
            user: {
              stationId: scopedStationId
                ? scopedStationId
                : { in: scopeStations },
            },
          },
        }),
      ]);

    const swappers = await this.prisma.user.findMany({
      where: {
        role: Role.SWAPPER,
        isActive: true,
        stationId: {
          in: scopeStations,
          ...(scopedStationId ? { equals: scopedStationId } : {}),
        },
      },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });

    const totalHours = Array.from(hoursBySwapper.values()).reduce(
      (sum, row) => sum + row.hours,
      0,
    );

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      filters: {
        stationId: scopedStationId,
        swapperId: query.swapperId ?? null,
      },
      stations: await this.prisma.station.findMany({
        where: { isActive: true, id: { in: scopeStations } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      swappers: swappers.map((swapper) => ({
        id: swapper.id,
        name: swapper.fullName,
      })),
      kpis: {
        shifts: shifts.length,
        coverageRate: shifts.length
          ? Math.round((assigned / shifts.length) * 100)
          : 0,
        attendanceRate: assigned
          ? Math.round(
              ((status.present + status.closed + status.late) / assigned) * 100,
            )
          : 0,
        absences: status.absent,
        late: status.late,
        approvedLeaves,
        leavesSynced: syncedLeaves,
        leavesPendingSync: pendingLeaves,
        leavesFailedSync: failedLeaves,
        movements: changes.length,
        totalHours: Math.round(totalHours * 10) / 10,
        futureVacant: stationRows.reduce(
          (sum, row) => sum + row.futureVacant,
          0,
        ),
        pastVacant: stationRows.reduce((sum, row) => sum + row.pastVacant, 0),
      },
      attendance: status,
      details,
      stationRows,
      hours: Array.from(hoursBySwapper.values())
        .sort((a, b) => b.hours - a.hours)
        .slice(0, 8),
      hoursByStation: Array.from(hoursByStation.values()).sort(
        (a, b) => b.hours - a.hours,
      ),
      hoursByWeek: Array.from(hoursByWeek.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([week, hours]) => ({ week, hours })),
      hoursByMonth: Array.from(hoursByMonth.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, hours]) => ({ month, hours })),
      changes: changes.map((change) => ({
        date: change.createdAt.toISOString(),
        station: change.shift?.station?.name ?? '—',
        type: change.type,
        from: change.previousSwapper?.fullName ?? '—',
        to: change.newSwapper?.fullName ?? '—',
      })),
    };
  }

  // ============================================================
  // SCHEDULED REPORTS
  // ============================================================

  async listScheduledReports() {
    return this.prisma.scheduledReport.findMany({
      orderBy: { nextRunAt: 'asc' },
      include: {
        runs: {
          orderBy: { generatedAt: 'desc' },
          take: 5,
        },
      },
    });
  }

  async createScheduledReport(actor: Actor, dto: CreateScheduledReportDto) {
    this.assertAdmin(actor);
    const name = dto.name?.trim() ?? '';
    const recipients = this.normalizeRecipients(dto.recipients);
    if (name.length < 4 || !recipients.length) {
      throw new BadRequestException(
        'Indiquez un nom et au moins un destinataire valide.',
      );
    }

    const scope = dto.scope ?? 'NETWORK';
    const stationId = dto.stationId ?? null;
    if (scope === 'STATION' && !stationId) {
      throw new BadRequestException(
        'Une station est obligatoire pour un rapport ciblé.',
      );
    }
    if (stationId) await this.assertStationExists(stationId);

    const sections = this.normalizeSections(dto.sections);
    const frequency = dto.frequency ?? 'WEEKLY';
    return this.prisma.scheduledReport.create({
      data: {
        ownerId: actor.id,
        name,
        frequency,
        format:
          dto.format === ScheduledReportFormat.CSV
            ? ScheduledReportFormat.CSV
            : ScheduledReportFormat.XLSX,
        scope,
        stationId,
        recipients,
        sections,
        isActive: true,
        nextRunAt: this.nextRunAt(frequency),
      },
      include: { runs: true },
    });
  }

  async previewScheduledReport(actor: Actor, dto: PreviewScheduledReportDto) {
    this.assertAdmin(actor);
    const from = this.parseDate(dto.from) ?? new Date(Date.now() - 30 * DAY_MS);
    const to = this.parseDate(dto.to) ?? new Date();
    const scope = dto.scope ?? 'NETWORK';
    if (scope === 'STATION' && !dto.stationId) {
      throw new BadRequestException(
        'Une station est obligatoire pour un rapport ciblé.',
      );
    }
    if (dto.stationId) await this.assertStationExists(dto.stationId);
    const report = await this.dashboard(actor, {
      from: from.toISOString(),
      to: to.toISOString(),
      stationId: scope === 'STATION' ? (dto.stationId ?? undefined) : undefined,
    });
    return {
      period: report.period,
      scope,
      stationId: dto.stationId ?? null,
      sections: this.normalizeSections(dto.sections),
      kpis: report.kpis,
      attendance: report.attendance,
      hours: report.hours,
      changes: report.changes,
      stationRows: report.stationRows,
      details: report.details,
    };
  }

  async exportReport(
    actor: Actor,
    query: QueryReportDashboardDto & { format?: string },
  ) {
    if (
      !([Role.ADMIN, Role.SUPERVISOR] as Role[]).includes(
        actor.role,
      )
    ) {
      throw new ForbiddenException('Accès non autorisé aux exports.');
    }
    const format = String(query.format ?? 'XLSX').toUpperCase();
    if (!['CSV', 'XLSX'].includes(format)) {
      throw new BadRequestException('Format d’export invalide.');
    }
    const report = await this.dashboard(actor, query);
    const sections = ['ATTENDANCE', 'COVERAGE', 'HOURS', 'MOVEMENTS'];
    const payload = await this.buildReportFile(
      report,
      sections,
      format as 'CSV' | 'XLSX',
    );
    await this.prisma.reportExportAudit.create({
      data: {
        actorId: actor.id,
        format,
        from: new Date(report.period.from),
        to: new Date(report.period.to),
        stationId: query.stationId ?? null,
        swapperId: query.swapperId ?? null,
        scope: actor.role === Role.ADMIN ? 'NETWORK' : 'SCOPED',
        sections,
      },
    });
    return payload;
  }

  async listReportRuns(actor: Actor, id: string) {
    this.assertAdmin(actor);
    await this.ensureScheduledReport(id);
    return this.prisma.scheduledReportRun.findMany({
      where: { scheduledReportId: id },
      orderBy: { generatedAt: 'desc' },
      take: 50,
    });
  }

  async toggleScheduledReport(id: string, isActive: boolean) {
    const report = await this.ensureScheduledReport(id);
    return this.prisma.scheduledReport.update({
      where: { id: report.id },
      data: {
        isActive,
        ...(isActive && !report.nextRunAt
          ? { nextRunAt: this.nextRunAt(report.frequency) }
          : {}),
      },
    });
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async processScheduledReports() {
    const due = await this.prisma.scheduledReport.findMany({
      where: { isActive: true, nextRunAt: { lte: new Date() } },
      take: 20,
      orderBy: { nextRunAt: 'asc' },
    });
    for (const report of due) {
      await this.runScheduledReport(report.id).catch(() => undefined);
    }
  }

  private async runScheduledReport(id: string) {
    const report = await this.prisma.scheduledReport.findUnique({
      where: { id },
    });
    if (!report || !report.isActive) return;
    const now = new Date();
    const to = new Date(now);
    const from = new Date(
      now.getTime() -
        (report.frequency === 'DAILY'
          ? DAY_MS
          : report.frequency === 'WEEKLY'
            ? 7 * DAY_MS
            : 30 * DAY_MS),
    );
    const run = await this.prisma.scheduledReportRun.create({
      data: {
        scheduledReportId: report.id,
        status: 'PROCESSING',
        format: report.format,
        recipients: report.recipients,
        from,
        to,
        scope: report.scope,
        stationId: report.stationId,
      },
    });
    try {
      const owner = await this.prisma.user.findUnique({
        where: { id: report.ownerId },
        select: { id: true, role: true },
      });
      if (!owner)
        throw new NotFoundException('Propriétaire du rapport introuvable.');
      const dashboard = await this.dashboard(owner, {
        from: from.toISOString(),
        to: to.toISOString(),
        stationId:
          report.scope === 'STATION'
            ? (report.stationId ?? undefined)
            : undefined,
      });
      const file = await this.buildReportFile(
        dashboard,
        report.sections,
        report.format,
      );
      const sent = await this.emailService.sendReportEmail(
        report.recipients,
        `uSwap — ${report.name}`,
        `<p>Veuillez trouver ci-joint le rapport « ${this.escapeHtml(report.name)} ».</p><p>Période : ${from.toLocaleDateString('fr-FR')} au ${to.toLocaleDateString('fr-FR')}.</p>`,
        file,
        report.ownerId,
      );
      if (!sent)
        throw new Error(
          'Le serveur SMTP n’est pas configuré ou l’envoi a échoué.',
        );
      await this.prisma.$transaction([
        this.prisma.scheduledReportRun.update({
          where: { id: run.id },
          data: { status: 'SENT', sentAt: new Date() },
        }),
        this.prisma.scheduledReport.update({
          where: { id: report.id },
          data: {
            lastRunAt: new Date(),
            nextRunAt: this.nextRunAt(report.frequency),
          },
        }),
      ]);
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.scheduledReportRun.update({
          where: { id: run.id },
          data: {
            status: 'FAILED',
            errorMessage:
              error instanceof Error ? error.message : String(error),
          },
        }),
        this.prisma.scheduledReport.update({
          where: { id: report.id },
          data: {
            lastRunAt: new Date(),
            nextRunAt: this.nextRunAt(report.frequency),
          },
        }),
      ]);
    }
  }

  private async buildReportFile(
    report: Awaited<ReturnType<ReportsService['dashboard']>>,
    sections: string[],
    format: 'CSV' | 'XLSX',
  ): Promise<{ filename: string; content: Buffer; contentType: string }> {
    const rows: Record<string, unknown>[] = [];
    const add = (section: string, values: Record<string, unknown>) =>
      rows.push({ Section: section, ...values });
    if (sections.includes('ATTENDANCE')) {
      for (const [status, count] of Object.entries(report.attendance))
        add('ASSIDUITE', { Statut: status, Nombre: count });
    }
    if (sections.includes('COVERAGE')) {
      for (const row of report.stationRows)
        add('COUVERTURE', {
          Station: row.name,
          Postes: row.total,
          Couverts: row.filled,
          Taux: `${row.coverage}%`,
          VacantsFuturs: row.futureVacant,
        });
    }
    if (sections.includes('HOURS')) {
      for (const row of report.hours)
        add('HEURES', {
          Swappeur: row.name,
          Station: row.station,
          Heures: row.hours,
        });
    }
    if (sections.includes('MOVEMENTS')) {
      for (const row of report.changes)
        add('MOUVEMENTS', {
          Date: row.date,
          Station: row.station,
          Type: row.type,
          De: row.from,
          Vers: row.to,
        });
    }
    if (format === 'CSV') {
      const headers = [
        'Section',
        ...Array.from(
          new Set(
            rows.flatMap((r) => Object.keys(r).filter((k) => k !== 'Section')),
          ),
        ),
      ];
      const esc = (value: unknown) =>
        `"${String(value ?? '').replace(/"/g, '""')}"`;
      const content = [
        headers,
        ...rows.map((r) => headers.map((h) => r[h] ?? '')),
      ]
        .map((r) => r.map(esc).join(';'))
        .join('\n');
      return {
        filename: `uswap-rapport-${this.fileStamp(report.period.from)}.csv`,
        content: Buffer.from(`\\ufeff${content}`, 'utf8'),
        contentType: 'text/csv; charset=utf-8',
      };
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Rapport');
    const headers = [
      'Section',
      ...Array.from(
        new Set(
          rows.flatMap((r) => Object.keys(r).filter((k) => k !== 'Section')),
        ),
      ),
    ];
    sheet.addRow(headers);
    for (const row of rows) sheet.addRow(headers.map((h) => row[h] ?? ''));
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column) => {
      column.width = Math.min(
        40,
        Math.max(12, (column.header?.toString().length ?? 10) + 4),
      );
    });
    const content = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      filename: `uswap-rapport-${this.fileStamp(report.period.from)}.xlsx`,
      content,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private normalizeRecipients(recipients: string[] | undefined) {
    return [
      ...new Set(
        (recipients ?? [])
          .map((value) => value.trim().toLowerCase())
          .filter((value) => /^\S+@\S+\.\S+$/.test(value)),
      ),
    ];
  }

  private normalizeSections(sections: string[] | undefined) {
    const allowed = ['ATTENDANCE', 'COVERAGE', 'HOURS', 'MOVEMENTS'];
    const requested =
      sections?.filter((value) => allowed.includes(value)) ?? allowed;
    return [...new Set(requested.length ? requested : allowed)];
  }

  private parseDate(value?: string) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
      throw new BadRequestException('Date de rapport invalide.');
    return parsed;
  }

  private nextRunAt(frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY') {
    const date = new Date();
    if (frequency === 'DAILY') date.setDate(date.getDate() + 1);
    else if (frequency === 'WEEKLY') date.setDate(date.getDate() + 7);
    else date.setMonth(date.getMonth() + 1);
    date.setHours(7, 0, 0, 0);
    return date;
  }

  private async assertStationExists(stationId: string) {
    const station = await this.prisma.station.findUnique({
      where: { id: stationId },
      select: { id: true },
    });
    if (!station) throw new NotFoundException('Station introuvable.');
  }

  private async ensureScheduledReport(id: string) {
    const report = await this.prisma.scheduledReport.findUnique({
      where: { id },
    });
    if (!report) throw new NotFoundException('Rapport programmé introuvable.');
    return report;
  }

  private assertAdmin(actor: Actor) {
    if (actor.role !== Role.ADMIN)
      throw new ForbiddenException(
        'Seul un administrateur peut gérer les rapports programmés.',
      );
  }

  private fileStamp(value: string) {
    return value.slice(0, 10).replace(/-/g, '');
  }

  private escapeHtml(value: string) {
    return value.replace(
      /[&<>"']/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#039;',
        })[char] ?? char,
    );
  }

  // ============================================================
  // LEAVE INTEGRATION HEALTH
  // ============================================================

  /**
   * Availability of the external HR integration, as shown on the admin
   * integrations screen: success rate, pending and failed operations.
   */
  async leaveIntegrationHealth() {
    const operations = await this.prisma.leaveSyncOperation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { fullName: true } } },
    });

    const failed = operations.filter((item) => item.status === 'FAILED');
    const pending = operations.filter((item) =>
      ['QUEUED', 'PROCESSING'].includes(item.status),
    );
    const synced = operations.filter((item) => item.status === 'SYNCED');
    const lastSync = await this.prisma.leaveBalance.findFirst({
      orderBy: { syncedAt: 'desc' },
      select: { syncedAt: true },
    });

    return {
      status: failed.length ? 'DEGRADED' : 'OPERATIONAL',
      lastSyncAt: lastSync?.syncedAt?.toISOString() ?? null,
      pending: pending.length,
      failed: failed.length,
      successRate: operations.length
        ? Math.round((synced.length / operations.length) * 100)
        : 100,
      operations: operations.slice(0, 8).map((item) => ({
        id: item.id,
        leaveId: item.leaveRequestId,
        action: item.action,
        status: item.status,
        attempts: item.attempts,
        queuedAt: item.createdAt.toISOString(),
        completedAt: item.completedAt?.toISOString() ?? null,
        lastError: item.lastError,
        userName: item.user?.fullName ?? 'Compte inconnu',
      })),
    };
  }

  // ============================================================
  // SPRINT 6 — JOURNAL D'AUDIT CONSOLIDE
  // ============================================================

  /**
   * Agrège les quatre pistes d'audit du réseau en une seule liste
   * chronologique, avec le vocabulaire attendu par l'écran d'audit :
   *
   * - `ACCOUNT`    : modifications de comptes (UserAuditLog)
   * - `INCIDENT`   : transitions d'incidents (IncidentAction)
   * - `ASSIGNMENT` : affectations et remplacements (ShiftChange)
   * - `SETTINGS`   : réglages réseau (GlobalSettingRevision)
   */
  async auditLog() {
    const [accountLogs, incidentActions, shiftChanges, settingsRevisions, people] =
      await Promise.all([
        this.prisma.userAuditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 200,
          include: {
            user: { select: { id: true, fullName: true } },
          },
        }),
        this.prisma.incidentAction.findMany({
          orderBy: { createdAt: 'desc' },
          take: 200,
          include: {
            author: { select: { id: true, fullName: true } },
            incident: { select: { id: true, title: true, stationId: true } },
          },
        }),
        this.prisma.shiftChange.findMany({
          orderBy: { createdAt: 'desc' },
          take: 200,
          include: {
            changedBy: { select: { id: true, fullName: true } },
            newSwapper: { select: { id: true, fullName: true } },
            previousSwapper: { select: { id: true, fullName: true } },
          },
        }),
        this.prisma.globalSettingRevision.findMany({
          orderBy: { createdAt: 'desc' },
          take: 200,
        }),
        this.prisma.user.findMany({
          select: { id: true, fullName: true },
          orderBy: { fullName: 'asc' },
        }),
      ]);

    const stationIds = new Set<string>();
    incidentActions.forEach((action) => {
      if (action.incident?.stationId) stationIds.add(action.incident.stationId);
    });

    const stations = stationIds.size
      ? await this.prisma.station.findMany({
          where: { id: { in: Array.from(stationIds) } },
          select: { id: true, name: true },
        })
      : [];
    const stationNames = new Map(stations.map((s) => [s.id, s.name]));

    const events: Array<Record<string, unknown>> = [];

    for (const log of accountLogs) {
      events.push({
        id: `account:${log.id}`,
        category: 'ACCOUNT',
        action: 'UPDATE_ACCOUNT',
        title: 'Compte modifié',
        objectName: log.user?.fullName ?? 'Compte inconnu',
        actorId: log.changedBy,
        actorName: null,
        targetUserId: log.userId,
        stationId: null,
        stationName: null,
        description: 'Modification des informations du compte.',
        result: 'SUCCESS',
        createdAt: log.createdAt.toISOString(),
      });
    }

    for (const action of incidentActions) {
      events.push({
        id: `incident:${action.id}`,
        category: 'INCIDENT',
        action: String(action.type),
        title: 'Incident mis à jour',
        objectName: action.incident?.title ?? 'Incident',
        actorId: action.authorId,
        actorName: action.author?.fullName ?? null,
        targetUserId: null,
        stationId: action.incident?.stationId ?? null,
        stationName: action.incident?.stationId
          ? (stationNames.get(action.incident.stationId) ?? null)
          : null,
        description: action.comment,
        result: 'SUCCESS',
        createdAt: action.createdAt.toISOString(),
      });
    }

    for (const change of shiftChanges) {
      events.push({
        id: `assignment:${change.id}`,
        category: 'ASSIGNMENT',
        action: String(change.type),
        title: 'Affectation modifiée',
        objectName:
          change.newSwapper?.fullName ??
          change.previousSwapper?.fullName ??
          'Poste',
        actorId: change.changedById,
        actorName: change.changedBy?.fullName ?? null,
        targetUserId: change.newSwapperId ?? change.previousSwapperId ?? null,
        stationId: null,
        stationName: null,
        description: change.reason ?? 'Affectation mise à jour.',
        result: 'SUCCESS',
        createdAt: change.createdAt.toISOString(),
      });
    }

    for (const revision of settingsRevisions) {
      events.push({
        id: `settings:${revision.id}`,
        category: 'SETTINGS',
        action: 'UPDATE_SETTINGS',
        title: 'Réglages mis à jour',
        objectName: `Révision ${revision.revision}`,
        actorId: revision.actorId ?? null,
        actorName: null,
        targetUserId: null,
        stationId: null,
        stationName: null,
        description: 'Modification des réglages réseau.',
        result: 'SUCCESS',
        createdAt: revision.createdAt.toISOString(),
      });
    }

    events.sort(
      (a, b) =>
        new Date(b.createdAt as string).getTime() -
        new Date(a.createdAt as string).getTime(),
    );

    return { events, people };
  }

  // ============================================================
  // HELPERS
  // ============================================================

  /** The row is a singleton (id = 1); create it lazily on first read. */
  private async ensureSettings() {
    const existing = await this.prisma.globalSetting.findUnique({
      where: { id: 1 },
    });
    if (existing) return existing;
    return this.prisma.globalSetting.create({ data: { id: 1 } });
  }

  /** Drops the backend-only columns before storing an audit snapshot. */
  private sanitize(settings: Record<string, unknown>): Prisma.InputJsonValue {
    const { updatedAt, createdAt, id, ...rest } = settings as Record<
      string,
      unknown
    > & { updatedAt?: unknown; createdAt?: unknown; id?: unknown };
    void updatedAt;
    void createdAt;
    void id;
    return rest as Prisma.InputJsonValue;
  }
}
