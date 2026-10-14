import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ScopeService } from '../common/scope.service';
import {
  ConflictDomain,
  ErrorCode,
  NotFoundDomain,
} from '../common/errors/domain-errors';
import { serializeScheduledReport, serializeReportRun } from '../common/serializers';
import { durationHours } from '../common/utils/datetime';
import { weekKeyOf, stationDayKey } from '../common/utils/datetime';
import type { AuthenticatedUser } from '../common/guards/roles.guard';
import { NotificationKind } from '../notifications/categories';

const DAY_MS = 86_400_000;

export interface DashboardQuery {
  from?: string;
  to?: string;
  planningId?: string;
  stationId?: string;
  swapperId?: string;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly scope: ScopeService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Tableau de bord operationnel                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Indicateurs consolides d'une periode : couverture, assiduite, heures,
   * mouvements et postes vacants. Le resultat alimente aussi bien l'accueil
   * administrateur que l'ecran d'analyse.
   */
  async dashboard(user: AuthenticatedUser, query: DashboardQuery) {
    const from = query.from
      ? Date.parse(`${query.from}T00:00:00.000Z`)
      : Date.now() - 30 * DAY_MS;
    const to = query.to
      ? Date.parse(`${query.to}T23:59:59.999Z`)
      : Date.now() + DAY_MS;
    const now = Date.now();

    // Perimetre : un superviseur rattache a une station ne voit qu'elle.
    const scopeStations = user.stationId ? [user.stationId] : null;
    const stationId = user.stationId ?? query.stationId ?? null;

    const plannings = await this.prisma.planning.findMany({
      where: {
        status: 'PUBLISHED',
        ...(query.planningId ? { id: query.planningId } : {}),
      },
      select: { id: true },
    });
    const planningIds = plannings.map((planning) => planning.id);

    const schedule = await this.prisma.occurrence.findMany({
      where: {
        status: 'PUBLISHED',
        planningId: { in: planningIds },
        startTime: { gte: new Date(from), lte: new Date(to) },
        ...(stationId ? { stationId } : {}),
        ...(scopeStations ? { stationId: { in: scopeStations } } : {}),
      },
      include: {
        station: { select: { id: true, name: true, timezone: true } },
        assignments: {
          include: { user: { select: { id: true, fullName: true } } },
        },
        attendance: true,
        absences: { where: { status: 'OPEN' } },
      },
    });

    const scoped = query.swapperId
      ? schedule.filter((occurrence) =>
          occurrence.assignments.some((a) => a.userId === query.swapperId),
        )
      : schedule;

    const status = {
      present: 0,
      late: 0,
      absent: 0,
      closed: 0,
      expected: 0,
      justified: 0,
    };
    const details = scoped.flatMap((occurrence) =>
      occurrence.assignments.map((assignment) => {
        const record = occurrence.attendance;
        const value =
          record?.status ??
          (occurrence.absences.length ? 'ABSENT' : 'EXPECTED');
        const key = value.toLowerCase() as keyof typeof status;
        if (key in status) status[key] += 1;
        return {
          id: occurrence.id,
          startTime: occurrence.startTime.toISOString(),
          station: occurrence.station.name,
          swapper: assignment.user.fullName,
          status: key,
          label: occurrence.shiftLabel,
        };
      }),
    );

    const assigned = schedule.reduce(
      (total, occurrence) => total + occurrence.assignments.length,
      0,
    );
    const required = schedule.reduce(
      (total, occurrence) => total + occurrence.requiredStaff,
      0,
    );
    const vacant = Math.max(0, required - assigned);

    const completed = scoped.filter(
      (occurrence) =>
        occurrence.assignments.length > 0 &&
        occurrence.endTime.getTime() <= now,
    );
    const attended = completed.filter(
      (occurrence) =>
        occurrence.attendance &&
        ['PRESENT', 'LATE', 'CLOSED'].includes(occurrence.attendance.status),
    );

    // Heures par agent, par station, par semaine et par mois.
    const hoursBySwapper = new Map<
      string,
      { name: string; station: string; hours: number }
    >();
    const hoursByStation = new Map<string, number>();
    const hoursByWeek = new Map<string, number>();
    const hoursByMonth = new Map<string, number>();

    for (const occurrence of scoped) {
      const base = durationHours(occurrence);
      for (const assignment of occurrence.assignments) {
        const current = hoursBySwapper.get(assignment.userId) ?? {
          name: assignment.user.fullName,
          station: occurrence.station.name,
          hours: 0,
        };
        current.hours = Math.round((current.hours + base) * 10) / 10;
        hoursBySwapper.set(assignment.userId, current);

        hoursByStation.set(
          occurrence.station.name,
          Math.round(
            ((hoursByStation.get(occurrence.station.name) ?? 0) + base) * 10,
          ) / 10,
        );

        const week = weekKeyOf(occurrence.startTime.toISOString());
        hoursByWeek.set(
          week,
          Math.round(((hoursByWeek.get(week) ?? 0) + base) * 10) / 10,
        );

        const month = stationDayKey(
          occurrence.startTime.getTime(),
          occurrence.station.timezone,
        ).slice(0, 7);
        hoursByMonth.set(
          month,
          Math.round(((hoursByMonth.get(month) ?? 0) + base) * 10) / 10,
        );
      }
    }

    // Mouvements : changements d'affectation sur la periode et le perimetre.
    const movements = await this.prisma.shiftChange.findMany({
      where: {
        createdAt: { gte: new Date(from), lte: new Date(to) },
        ...(stationId ? { stationId } : {}),
        ...(query.swapperId
          ? {
              OR: [
                { outSwapperId: query.swapperId },
                { inSwapperId: query.swapperId },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    const leaves = await this.prisma.leave.findMany({
      where: {
        status: 'APPROVED',
        startTime: { lte: new Date(to) },
        endTime: { gte: new Date(from) },
        ...(query.swapperId ? { swapperId: query.swapperId } : {}),
      },
    });

    const stations = await this.prisma.station.findMany({
      where: {
        isActive: true,
        ...(stationId ? { id: stationId } : {}),
        ...(scopeStations ? { id: { in: scopeStations } } : {}),
      },
      orderBy: { name: 'asc' },
    });

    const stationRows = stations.map((station) => {
      const rows = schedule.filter(
        (occurrence) => occurrence.stationId === station.id,
      );
      const filled = rows.reduce(
        (total, occurrence) => total + occurrence.assignments.length,
        0,
      );
      const needed = rows.reduce(
        (total, occurrence) => total + occurrence.requiredStaff,
        0,
      );
      const futureVacant = rows.filter(
        (occurrence) =>
          occurrence.assignments.length < occurrence.requiredStaff &&
          occurrence.startTime.getTime() >= now,
      ).length;
      const pastVacant = rows.filter(
        (occurrence) =>
          occurrence.assignments.length < occurrence.requiredStaff &&
          occurrence.startTime.getTime() < now,
      ).length;
      return {
        id: station.id,
        name: station.name,
        total: rows.length,
        filled,
        coverage: needed ? Math.round((filled / needed) * 100) : 0,
        futureVacant,
        pastVacant,
        risk: futureVacant > 0 ? 'AT_RISK' : 'STABLE',
        incidents: 0,
      };
    });

    // Incidents ouverts par station (comptes en une seule requete).
    const openIncidents = await this.prisma.incident.groupBy({
      by: ['stationId'],
      where: { status: { notIn: ['RESOLVED', 'CLOSED'] } },
      _count: { _all: true },
    });
    const incidentsByStation = new Map(
      openIncidents.map((row) => [row.stationId, row._count._all]),
    );
    for (const row of stationRows) {
      row.incidents = incidentsByStation.get(row.id) ?? 0;
    }

    const scheduledSwapperIds = new Set(
      scoped.flatMap((occurrence) =>
        occurrence.assignments.map((assignment) => assignment.userId),
      ),
    );
    const swappers = (
      await this.prisma.user.findMany({
        where: { role: 'SWAPPER', isActive: true },
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
      })
    ).filter((swapper) => scheduledSwapperIds.has(swapper.id));

    const leaveCount = leaves.length;

    return {
      period: {
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      },
      filters: {
        stationId,
        swapperId: query.swapperId ?? null,
        planningId: query.planningId ?? null,
      },
      stations: stations.map((station) => ({
        id: station.id,
        name: station.name,
      })),
      swappers: swappers.map((swapper) => ({
        id: swapper.id,
        name: swapper.fullName,
      })),
      kpis: {
        shifts: schedule.length,
        coverageRate: required ? Math.round((assigned / required) * 100) : 0,
        attendanceRate: completed.length
          ? Math.round((attended.length / completed.length) * 100)
          : 0,
        absences: status.absent,
        late: status.late,
        approvedLeaves: leaveCount,
        leavesSynced: leaveCount,
        leavesPendingSync: 0,
        leavesFailedSync: 0,
        movements: movements.length,
        totalHours:
          Math.round(
            [...hoursBySwapper.values()].reduce(
              (total, row) => total + row.hours,
              0,
            ) * 10,
          ) / 10,
        futureVacant: stationRows.reduce(
          (total, row) => total + row.futureVacant,
          0,
        ),
        pastVacant: stationRows.reduce(
          (total, row) => total + row.pastVacant,
          0,
        ),
      },
      attendance: status,
      details,
      stationRows,
      hours: [...hoursBySwapper.values()]
        .sort((a, b) => b.hours - a.hours)
        .slice(0, 8),
      hoursByStation: [...hoursByStation.entries()].map(([station, hours]) => ({
        station,
        hours,
      })),
      hoursByWeek: [...hoursByWeek.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([week, hours]) => ({ week, hours })),
      hoursByMonth: [...hoursByMonth.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, hours]) => ({ month, hours })),
      changes: movements.map((change) => ({
        date: change.createdAt.toISOString(),
        station: change.station,
        type: change.type,
        from: change.outSwapper,
        to: change.inSwapper,
      })),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Export                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Classeur d'export. La feuille XLSX est generee cote serveur pour que le
   * fichier reste identique quel que soit le client.
   */
  async export(
    user: AuthenticatedUser,
    query: DashboardQuery & { format?: string },
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const data = await this.dashboard(user, query);
    const rows: (string | number)[][] = [
      ['Section', 'Libellé', 'Indicateur'],
      ['Période', 'Du', data.period.from.slice(0, 10)],
      ['Période', 'Au', data.period.to.slice(0, 10)],
      ['Synthèse', 'Services planifiés', data.kpis.shifts],
      ['Synthèse', 'Taux de couverture (%)', data.kpis.coverageRate],
      ['Synthèse', 'Taux de présence (%)', data.kpis.attendanceRate],
      ['Synthèse', 'Heures planifiées', data.kpis.totalHours],
      ['Synthèse', 'Mouvements', data.kpis.movements],
      ['Assiduité', 'Présents', data.attendance.present],
      ['Assiduité', 'En retard', data.attendance.late],
      ['Assiduité', 'Absents', data.attendance.absent],
      ['Assiduité', 'Justifiés', data.attendance.justified],
      ['Assiduité', 'Terminés', data.attendance.closed],
      ['Assiduité', 'À venir', data.attendance.expected],
    ];
    for (const row of data.stationRows) {
      rows.push([
        'Couverture',
        row.name,
        `${row.filled}/${row.total} (${row.coverage}%)`,
      ]);
    }

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Rapport');

    if ((query.format ?? 'XLSX').toUpperCase() === 'CSV') {
      const csv = XLSX.utils.sheet_to_csv(sheet);
      return {
        buffer: Buffer.from(csv, 'utf8'),
        filename: `rapport-uswap-${data.period.from.slice(0, 10)}.csv`,
        contentType: 'text/csv; charset=utf-8',
      };
    }

    const buffer = XLSX.write(workbook, {
      bookType: 'xlsx',
      type: 'buffer',
    }) as Buffer;
    return {
      buffer,
      filename: `rapport-uswap-${data.period.from.slice(0, 10)}-${data.period.to.slice(0, 10)}.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  /* ---------------------------------------------------------------- */
  /* Rapports programmes                                               */
  /* ---------------------------------------------------------------- */

  async scheduled() {
    const reports = await this.prisma.scheduledReport.findMany({
      orderBy: { nextRunAt: 'asc' },
    });
    return reports.map(serializeScheduledReport);
  }

  async createScheduled(
    user: AuthenticatedUser,
    payload: {
      name: string;
      frequency?: string;
      format?: string;
      scope?: string;
      stationId?: string | null;
      recipients?: string[];
      sections?: string[];
    },
  ) {
    const name = (payload.name ?? '').trim();
    const recipients = (payload.recipients ?? [])
      .map((value) => value.trim())
      .filter((value) => value.includes('@'));
    if (name.length < 4 || !recipients.length) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Indiquez un nom et au moins un destinataire valide.',
        400,
      );
    }
    const frequency = ['DAILY', 'WEEKLY', 'MONTHLY'].includes(
      (payload.frequency ?? '').toUpperCase(),
    )
      ? (payload.frequency!.toUpperCase() as 'DAILY' | 'WEEKLY' | 'MONTHLY')
      : 'WEEKLY';
    const delay =
      frequency === 'DAILY'
        ? DAY_MS
        : frequency === 'WEEKLY'
          ? 7 * DAY_MS
          : 30 * DAY_MS;

    const created = await this.prisma.scheduledReport.create({
      data: {
        ownerId: user.id,
        name,
        frequency,
        format:
          (payload.format ?? '').toUpperCase() === 'CSV' ? 'CSV' : 'XLSX',
        scope:
          (payload.scope ?? '').toUpperCase() === 'STATION'
            ? 'STATION'
            : 'NETWORK',
        stationId: payload.stationId ?? null,
        recipients: JSON.stringify(recipients),
        sections: JSON.stringify(
          payload.sections?.length
            ? payload.sections
            : ['ATTENDANCE', 'COVERAGE', 'HOURS', 'MOVEMENTS'],
        ),
        isActive: true,
        nextRunAt: new Date(Date.now() + delay),
      },
    });

    await this.notifications.notify({
      userId: user.id,
      kind: NotificationKind.REPORT_READY,
      title: 'Rapport programmé',
      body: `${name} sera envoyé ${frequency === 'DAILY' ? 'chaque jour' : frequency === 'WEEKLY' ? 'chaque semaine' : 'chaque mois'}.`,
      targetId: created.id,
      targetUrl: '/rapports',
    });

    return serializeScheduledReport(created);
  }

  /** Active ou suspend un envoi automatique. */
  async toggleScheduled(id: string, isActive: boolean) {
    const report = await this.prisma.scheduledReport.findUnique({
      where: { id },
    });
    if (!report) {
      throw new NotFoundDomain(
        'REPORT_NOT_FOUND',
        'Rapport programmé introuvable.',
      );
    }
    const updated = await this.prisma.scheduledReport.update({
      where: { id },
      data: { isActive },
    });
    return serializeScheduledReport(updated);
  }

  /** Historique d'execution d'un rapport programme. */
  async runs(reportId: string) {
    const report = await this.prisma.scheduledReport.findUnique({
      where: { id: reportId },
    });
    if (!report) {
      throw new NotFoundDomain(
        'REPORT_NOT_FOUND',
        'Rapport programmé introuvable.',
      );
    }
    const runs = await this.prisma.reportRun.findMany({
      where: { reportId },
      orderBy: { generatedAt: 'desc' },
      take: 20,
    });
    return runs.map(serializeReportRun);
  }

  /** Apercu du contenu d'un rapport avant programmation. */
  async preview(user: AuthenticatedUser, payload: { stationId?: string }) {
    return this.dashboard(user, { stationId: payload.stationId });
  }

  /**
   * Execute les rapports arrives a echeance (appele par le planificateur).
   * Chaque execution est tracee ; un echec n'interrompt pas les suivants.
   */
  async runDueReports(): Promise<{ executed: number; failed: number }> {
    const due = await this.prisma.scheduledReport.findMany({
      where: { isActive: true, nextRunAt: { lte: new Date() } },
    });
    let executed = 0;
    let failed = 0;

    for (const report of due) {
      try {
        const owner = await this.prisma.user.findUnique({
          where: { id: report.ownerId },
        });
        if (!owner) continue;

        const recipients = JSON.parse(report.recipients) as string[];
        const delay =
          report.frequency === 'DAILY'
            ? DAY_MS
            : report.frequency === 'WEEKLY'
              ? 7 * DAY_MS
              : 30 * DAY_MS;

        await this.prisma.$transaction([
          this.prisma.reportRun.create({
            data: {
              reportId: report.id,
              status: 'GENERATED',
              format: report.format,
              sentAt: new Date(),
            },
          }),
          this.prisma.scheduledReport.update({
            where: { id: report.id },
            data: {
              lastRunAt: new Date(),
              nextRunAt: new Date(Date.now() + delay),
            },
          }),
        ]);

        for (const recipient of recipients) {
          await this.notifications.sendMail(recipient, 'SCHEDULED_REPORT', {
            reportName: report.name,
            period: `${report.frequency}`,
            summary: 'Le rapport est joint à votre espace uSwap.',
          });
        }
        executed += 1;
      } catch (error) {
        failed += 1;
        await this.prisma.reportRun.create({
          data: {
            reportId: report.id,
            status: 'FAILED',
            format: report.format,
            errorMessage:
              error instanceof Error ? error.message : 'Échec de génération.',
          },
        });
      }
    }

    return { executed, failed };
  }
}
