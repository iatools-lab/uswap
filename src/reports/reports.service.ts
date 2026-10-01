import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { CreateScheduledReportDto } from './dto/create-scheduled-report.dto';
import { QueryReportDashboardDto } from './dto/query-report-dashboard.dto';

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
  constructor(private readonly prisma: PrismaService) {}

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
      actor.role !== Role.STATION_CHIEF &&
      actor.role !== Role.ADMIN
    ) {
      throw new ForbiddenException('Accès non autorisé aux rapports.');
    }

    const now = Date.now();
    const from = query.from ? new Date(query.from) : new Date(now - 30 * DAY_MS);
    const to = query.to ? new Date(query.to) : new Date(now + DAY_MS);

    const me = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { stationId: true },
    });
    const scopedStationId =
      actor.role === Role.STATION_CHIEF
        ? me?.stationId ?? null
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
        startTime: { gte: from, lte: to },
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
        const filled = rows.length; // swapperId is mandatory on Shift.
        const vacant: typeof rows = [];
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
          futureVacant: vacant.filter((shift) => shift.startTime.getTime() >= now)
            .length,
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
          stationId: scopedStationId
            ? scopedStationId
            : { in: scopeStations },
        },
      },
      include: {
        shift: { select: { station: { select: { name: true } } } },
        previousSwapper: { select: { fullName: true } },
        newSwapper: { select: { fullName: true } },
      },
    });

    const approvedLeaves = await this.prisma.leaveRequest.count({
      where: {
        status: 'APPROVED',
        startDate: { lte: to },
        endDate: { gte: from },
      },
    });

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
      stations: (
        await this.prisma.station.findMany({
          where: { isActive: true, id: { in: scopeStations } },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      ),
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
        movements: changes.length,
        totalHours: Math.round(totalHours * 10) / 10,
        futureVacant: stationRows.reduce((sum, row) => sum + row.futureVacant, 0),
        pastVacant: stationRows.reduce((sum, row) => sum + row.pastVacant, 0),
      },
      attendance: status,
      details,
      stationRows,
      hours: Array.from(hoursBySwapper.values())
        .sort((a, b) => b.hours - a.hours)
        .slice(0, 8),
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

  listScheduledReports() {
    return this.prisma.scheduledReport.findMany({
      orderBy: { nextRunAt: 'asc' },
    });
  }

  async createScheduledReport(actor: Actor, dto: CreateScheduledReportDto) {
    if (actor.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Seul un administrateur peut programmer un rapport.',
      );
    }

    const name = dto.name?.trim() ?? '';
    const recipients = (dto.recipients ?? []).filter((value) =>
      value.includes('@'),
    );
    if (name.length < 4 || !recipients.length) {
      throw new BadRequestException(
        'Indiquez un nom et au moins un destinataire valide.',
      );
    }

    const frequency = dto.frequency ?? 'WEEKLY';
    const delay =
      frequency === 'DAILY'
        ? DAY_MS
        : frequency === 'WEEKLY'
          ? 7 * DAY_MS
          : 30 * DAY_MS;

    return this.prisma.scheduledReport.create({
      data: {
        ownerId: actor.id,
        name,
        frequency,
        format: dto.format === 'CSV' ? 'CSV' : 'XLSX',
        scope: 'NETWORK',
        stationId: null,
        recipients,
        sections: ['ATTENDANCE', 'COVERAGE', 'HOURS', 'MOVEMENTS'],
        isActive: true,
        nextRunAt: new Date(Date.now() + delay),
      },
    });
  }

  async toggleScheduledReport(id: string, isActive: boolean) {
    const report = await this.prisma.scheduledReport.findUnique({
      where: { id },
    });
    if (!report) {
      throw new NotFoundException('Rapport programmé introuvable.');
    }
    return this.prisma.scheduledReport.update({
      where: { id },
      data: { isActive },
    });
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

