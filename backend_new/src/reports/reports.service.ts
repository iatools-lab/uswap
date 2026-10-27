import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
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
      missed: 0,
    };
    const details = scoped.flatMap((occurrence) =>
      occurrence.assignments.map((assignment) => {
        const record = occurrence.attendance;
        // Un service qui n'a pas encore commence n'est PAS un absent : il est
        // « a venir ». Un shift date fait sans pointage ni fin de service est
        // « non pointe » (donnee manquante), distinct d'une absence constatee.
        const finished = occurrence.endTime.getTime() <= Date.now();
        const value = record
          ? record.status
          : occurrence.absences.length
            ? 'ABSENT'
            : finished
              ? 'MISSED'
              : 'EXPECTED';
        const key = value.toLowerCase() as keyof typeof status;
        if (key in status) status[key] += 1;
        // Donnees completes du pointage : le detail du classeur doit permettre
        // une analyse (heures reelles, ecart, retard) sans recalcul manuel.
        const plannedMs = occurrence.endTime.getTime() - occurrence.startTime.getTime();
        const plannedHours =
          Math.round((plannedMs / 3_600_000 - occurrence.breakMinutes / 60) * 100) / 100;
        const workedMs =
          record?.checkedInAt && record?.checkedOutAt
            ? record.checkedOutAt.getTime() - record.checkedInAt.getTime()
            : 0;
        return {
          id: occurrence.id,
          startTime: occurrence.startTime.toISOString(),
          endTime: occurrence.endTime.toISOString(),
          day: occurrence.day,
          station: occurrence.station.name,
          stationId: occurrence.stationId,
          swapper: assignment.user.fullName,
          swapperId: assignment.userId,
          status: key,
          label: occurrence.shiftLabel ?? occurrence.label,
          plannedHours,
          workedHours: Math.round((workedMs / 3_600_000) * 100) / 100,
          checkInAt: record?.checkedInAt?.toISOString() ?? null,
          checkOutAt: record?.checkedOutAt?.toISOString() ?? null,
          isLate: record?.isLate ?? false,
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
        vacancies: vacant,
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
   *
   * `options.sections` restreint les blocs exportes a ceux coches dans
   * l'ecran de programmation : un rapport programme doit contenir exactement
   * les informations demandees par son destinataire.
   */
  async export(
    user: AuthenticatedUser,
    query: DashboardQuery & { format?: string; sections?: string[] },
  ): Promise<{
    buffer: Buffer;
    filename: string;
    contentType: string;
    rows: (string | number)[][];
  }> {
    const data = await this.dashboard(user, query);
    const sections = query.sections?.length
      ? new Set(query.sections.map((section) => section.toUpperCase()))
      : null;
    const wants = (section: string) => !sections || sections.has(section);

    const from = data.period.from.slice(0, 10);
    const to = data.period.to.slice(0, 10);
    const stationName = data.filters.stationId
      ? (data.stations.find((item) => item.id === data.filters.stationId)?.name ??
        data.filters.stationId)
      : 'Tout le réseau';
    const generatedAt = new Date().toLocaleString('fr-FR', {
      timeZone: 'Africa/Douala',
    });

    /* -------------------------------------------------------------- */
    /* Feuilles du classeur                                           */
    /* -------------------------------------------------------------- */

    const summaryRows: Row[] = [
      ['Période analysée', `${from} → ${to}`],
      ['Périmètre', stationName],
      ['Rapport généré le', `${generatedAt} (Africa/Douala)`],
      ['', ''],
      ['Indicateur', 'Valeur', 'Lecture'],
      ['Services planifiés', data.kpis.shifts, 'Postes publiés sur la période'],
      ['Taux de couverture (%)', data.kpis.coverageRate, 'Postes pourvus / postes requis'],
      ['Postes vacants à venir', data.kpis.futureVacant, 'À pourvoir avant le service'],
      ['Postes vacants passés', data.kpis.pastVacant, 'Non pourvus sur des services passés'],
    ];
    if (wants('ATTENDANCE')) {
      summaryRows.push(
        ['Taux de présence (%)', data.kpis.attendanceRate, 'Présents / services terminés'],
        ['Présents', data.attendance.present, 'Prise de service à l’heure'],
        ['En retard', data.attendance.late, 'Prise de service après la tolérance'],
        ['Absents', data.attendance.absent, 'Absence constatée'],
      ['Non pointés', data.attendance.missed, 'Service passé sans aucun pointage'],
        ['Justifiés', data.attendance.justified, 'Absence requalifiée avec motif'],
        ['Terminés', data.attendance.closed, 'Prise ET fin de service enregistrées'],
        ['À venir', data.attendance.expected, 'Service pas encore commencé'],
      );
    }
    if (wants('HOURS')) {
      summaryRows.push([
        'Heures planifiées (h)',
        data.kpis.totalHours,
        'Somme des heures des agents affectés',
      ]);
    }
    summaryRows.push(
      ['Congés approuvés sur la période', data.kpis.approvedLeaves, 'Déjà validés'],
      ['Mouvements d’affectation', data.kpis.movements, 'Remplacements et échanges'],
    );

    const sheets: Sheet[] = [{ name: 'Synthèse', rows: summaryRows }];

    if (wants('ATTENDANCE')) {
      const byStatus = new Map<string, { label: string; count: number }>();
      for (const detail of data.details) {
        const entry = byStatus.get(detail.status) ?? {
          label: STATUS_LABELS[detail.status] ?? detail.status,
          count: 0,
        };
        entry.count += 1;
        byStatus.set(detail.status, entry);
      }
      const total = data.details.length;
      const attendanceRows: Row[] = [
        ['Statut', 'Nombre', 'Part (%)'],
        ...[...byStatus.values()]
          .sort((a, b) => b.count - a.count)
          .map((entry) => [
            entry.label,
            entry.count,
            total ? Math.round((entry.count / total) * 1000) / 10 : 0,
          ]),
        ['Total', total, total ? 100 : 0],
      ];
      sheets.push({ name: 'Assiduité', rows: attendanceRows, numberCols: [1, 2] });
    }

    if (wants('HOURS')) {
      const hoursRows: Row[] = [
        ['Agent', 'Station', 'Heures planifiées (h)'],
        ...data.hours.map((row) => [row.name, row.station, row.hours]),
        [
          'TOTAL',
          '',
          Math.round(data.hours.reduce((sum, row) => sum + row.hours, 0) * 10) / 10,
        ],
        ['', '', ''],
        ['Station', '', 'Heures planifiées (h)'],
        ...data.hoursByStation.map((row) => [row.station, '', row.hours]),
        ['', '', ''],
        ['Mois', '', 'Heures planifiées (h)'],
        ...data.hoursByMonth.map((row) => [row.month, '', row.hours]),
      ];
      sheets.push({ name: 'Heures', rows: hoursRows, numberCols: [2] });
    }

    if (wants('COVERAGE')) {
      const coverageRows: Row[] = [
        [
          'Station',
          'Services',
          'Postes pourvus',
          'Taux de couverture (%)',
          'Vacants à venir',
          'Vacants passés',
          'Incidents ouverts',
          'Risque',
        ],
        ...data.stationRows.map((row) => [
          row.name,
          row.total,
          row.filled,
          row.coverage,
          row.futureVacant,
          row.pastVacant,
          row.incidents,
          row.risk === 'AT_RISK' ? 'À risque' : 'Stable',
        ]),
      ];
      sheets.push({
        name: 'Couverture',
        rows: coverageRows,
        numberCols: [1, 2, 3, 4, 5, 6],
      });
    }

    // Détail ligne par ligne : c'est la feuille qui sert réellement à
    // l'analyse (filtres, tri, heures réelles, écarts).
    if (wants('ATTENDANCE') || wants('MOVEMENTS')) {
      const detailRows: Row[] = [
        [
          'Jour',
          'Début',
          'Fin',
          'Station',
          'Service',
          'Agent',
          'Statut',
          'Prise de service',
          'Fin de service',
          'Heures prévues',
          'Heures réalisées',
          'Écart (h)',
          'Retard',
        ],
        ...[...data.details]
          .sort((a, b) => a.startTime.localeCompare(b.startTime))
          .map((row) => {
            const start = new Date(row.startTime);
            const end = new Date(row.endTime);
            return [
              row.day,
              timeOfDay(start),
              timeOfDay(end),
              row.station,
              row.label ?? '',
              row.swapper,
              STATUS_LABELS[row.status] ?? row.status,
              row.checkInAt ? timeOfDay(new Date(row.checkInAt)) : '—',
              row.checkOutAt ? timeOfDay(new Date(row.checkOutAt)) : '—',
              row.plannedHours,
              row.workedHours,
              Math.round((row.workedHours - row.plannedHours) * 100) / 100,
              row.isLate ? 'Oui' : 'Non',
            ];
          }),
      ];
      sheets.push({
        name: 'Pointages',
        rows: detailRows,
        numberCols: [9, 10, 11],
        filter: true,
        freeze: 1,
      });
    }

    if (wants('MOVEMENTS')) {
      const movementRows: Row[] = [
        ['Date', 'Station', 'Type', 'De', 'Vers'],
        ...data.changes.map((change) => [
          new Date(change.date).toLocaleString('fr-FR', {
            timeZone: 'Africa/Douala',
          }),
          change.station ?? '—',
          change.type ?? '—',
          change.from ?? '—',
          change.to ?? '—',
        ]),
      ];
      sheets.push({ name: 'Mouvements', rows: movementRows, filter: true, freeze: 1 });
    }

    // `rows` reste la representation tabulaire du rapport : elle sert au
    // resume textuel de l'e-mail (lignes « Synthèse »).
    const rows: (string | number)[][] = summaryRows.filter(
      (row) => row[0] !== '' && row[0] !== 'Synthèse',
    );

    if ((query.format ?? 'XLSX').toUpperCase() === 'CSV') {
      const primary =
        sheets.find((sheet) => sheet.name === 'Pointages') ?? sheets[0];
      const csv = toCsv(primary.rows);
      return {
        // BOM UTF-8 : sans lui, Excel affiche « publiÃ© » au lieu de « publié ».
        buffer: Buffer.concat([Buffer.from('\uFEFF', 'utf8'), Buffer.from(csv, 'utf8')]),
        filename: `rapport-uswap-${from}-${to}.csv`,
        contentType: 'text/csv; charset=utf-8',
        rows,
      };
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'uSwap';
    workbook.created = new Date();
    for (const sheet of sheets) {
      addSheet(workbook, sheet);
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      buffer,
      filename: `rapport-uswap-${from}-${to}.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      rows,
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

        const role = owner.role;

        const recipients = (JSON.parse(report.recipients) as string[]).filter(
          (recipient) => typeof recipient === 'string' && recipient.includes('@'),
        );
        const sections = JSON.parse(report.sections) as string[];
        const stationId =
          report.scope === 'STATION' ? report.stationId ?? undefined : undefined;

        // Periode couverte : la frequence elle-meme, pas « maintenant ». Un
        // rapport hebdomadaire envoye lundi resume la semaine ecoulee.
        const delay =
          report.frequency === 'DAILY'
            ? DAY_MS
            : report.frequency === 'WEEKLY'
              ? 7 * DAY_MS
              : 30 * DAY_MS;
        const to = new Date();
        const from = new Date(to.getTime() - delay);

        // Le fichier est reellement genere au format choisi : le destinataire
        // recoit le classeur en piece jointe, pas un simple lien.
        const file = await this.export(
          {
            id: owner.id,
            email: owner.email,
            fullName: owner.fullName,
            role,
            stationId: owner.stationId,
            sessionId: 'scheduler',
          } as AuthenticatedUser,
          {
            from: from.toISOString().slice(0, 10),
            to: to.toISOString().slice(0, 10),
            stationId,
            format: report.format,
            sections,
          },
        );

        let sent = 0;
        const errors: string[] = [];
        for (const recipient of recipients) {
          try {
            await this.notifications.sendMail(
              recipient,
              'SCHEDULED_REPORT',
              {
                reportName: report.name,
                period: `${from.toISOString().slice(0, 10)} → ${to
                  .toISOString()
                  .slice(0, 10)}`,
                summary: this.summarize(file.rows),
                format: report.format,
                filename: file.filename,
              },
              [
                {
                  filename: file.filename,
                  content: file.buffer,
                  contentType: file.contentType,
                },
              ],
            );
            sent += 1;
          } catch (error) {
            errors.push(
              `${recipient} : ${error instanceof Error ? error.message : 'échec'}`,
            );
          }
        }

        await this.prisma.$transaction([
          this.prisma.reportRun.create({
            data: {
              reportId: report.id,
              status: errors.length === recipients.length ? 'FAILED' : 'SENT',
              format: report.format,
              generatedAt: new Date(),
              sentAt: sent ? new Date() : null,
              errorMessage: errors.length ? errors.join(' · ') : null,
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

        if (!sent) throw new Error(errors.join(' · ') || 'Aucun destinataire.');
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

  /**
   * Envoie « maintenant » un rapport programme, sans attendre son echeance.
   *
   * Utilise par l'exploitant pour verifier qu'un destinataire recoit bien le
   * fichier, et par la recette. La prochaine echeance est recalculee comme
   * pour une execution normale.
   */
  async sendNow(id: string) {
    const report = await this.prisma.scheduledReport.findUnique({
      where: { id },
    });
    if (!report) {
      throw new NotFoundDomain(
        'REPORT_NOT_FOUND',
        'Rapport programmé introuvable.',
      );
    }
    await this.prisma.scheduledReport.update({
      where: { id },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    });
    const result = await this.runDueReports();
    const run = await this.prisma.reportRun.findFirst({
      where: { reportId: id },
      orderBy: { generatedAt: 'desc' },
    });
    return {
      ok: run?.status === 'SENT',
      status: run?.status ?? 'FAILED',
      error: run?.errorMessage ?? null,
      ...result,
    };
  }

  /**
   * Resume textuel des indicateurs pour le corps de l'e-mail. Il reprend les
   * lignes « Synthèse » du fichier joint : le message et la piece jointe ne
   * racontent jamais deux choses differentes.
   */
  private summarize(rows: (string | number)[][]): string {
    // La feuille « Synthèse » commence par quelques lignes de contexte
    // (période, périmètre) puis par l'en-tête « Indicateur | Valeur ». On ne
    // reprend que les indicateurs chiffrés.
    return rows
      .filter(
        (row) =>
          typeof row[1] === 'number' &&
          row[0] !== 'Indicateur' &&
          row[0] !== '',
      )
      .map((row) => `${row[0]} : ${row[1]}`)
      .join(' · ');
  }
}

/* ------------------------------------------------------------------ */
/* Mise en forme du classeur (helpers d'export)                        */
/* ------------------------------------------------------------------ */

/** Une ligne de feuille : libelles et valeurs. */
type Row = (string | number)[];

interface Sheet {
  name: string;
  rows: Row[];
  /** Index (0-based) des colonnes numeriques : format « 0,0 ». */
  numberCols?: number[];
  /** Ligne d'en-tete : filtre automatique + ligne figee. */
  filter?: boolean;
  freeze?: number;
}

/** Libelles francais des statuts de pointage. */
const STATUS_LABELS: Record<string, string> = {
  present: 'Présent',
  late: 'En retard',
  absent: 'Absent',
  closed: 'Terminé',
  expected: 'À venir',
  justified: 'Justifié',
  missed: 'Non pointé',
};

/** Heure locale de la station (Africa/Douala, UTC+1 toute l'année). */
function timeOfDay(date: Date): string {
  return date.toLocaleTimeString('fr-FR', {
    timeZone: 'Africa/Douala',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** CSV RFC 4180 : champs echappes, separateur point-virgule (Excel FR). */
function toCsv(rows: Row[]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = cell === null || cell === undefined ? '' : String(cell);
          return /[";\n\r]/.test(value)
            ? `"${value.replace(/"/g, '""')}"`
            : value;
        })
        .join(';'),
    )
    .join('\r\n');
}

/**
 * Ecrit une feuille lisible : en-tete colore et fige, largeurs calculees,
 * nombres formates, totaux en gras et filtre automatique.
 */
function addSheet(workbook: ExcelJS.Workbook, sheet: Sheet): void {
  const worksheet = workbook.addWorksheet(sheet.name, {
    views: [
      {
        state: 'frozen',
        ySplit: sheet.freeze ?? (sheet.filter ? 1 : 0),
      },
    ],
  });

  sheet.rows.forEach((row) => worksheet.addRow(row));

  // Largeurs : basees sur le contenu, bornees pour rester lisibles.
  const columns = Math.max(...sheet.rows.map((row) => row.length), 1);
  for (let index = 1; index <= columns; index += 1) {
    const width = sheet.rows.reduce((max, row) => {
      const value = row[index - 1];
      const length =
        typeof value === 'string' || typeof value === 'number'
          ? String(value).length
          : 0;
      return Math.max(max, length);
    }, 10);
    worksheet.getColumn(index).width = Math.min(46, Math.max(12, width + 2));
  }

  if (sheet.filter) {
    // Ligne 1 = en-tete : les tableaux de detail sont filtrables d'un clic.
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: sheet.rows.length, column: columns },
    };
    const header = worksheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF001A70' },
    };
    header.alignment = { vertical: 'middle' };
    header.height = 22;
  } else {
    // Feuille de synthese : les libelles de la colonne A sont en gras, la
    // ligne d'en-tete des indicateurs est mise en valeur.
    worksheet.getColumn(1).font = { bold: true };
    const headerRow = sheet.rows.findIndex((row) => row[0] === 'Indicateur');
    if (headerRow >= 0) {
      const row = worksheet.getRow(headerRow + 1);
      row.font = { bold: true, color: { argb: 'FF001A70' } };
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEAF0FB' },
      };
    }
  }

  for (const index of sheet.numberCols ?? []) {
    worksheet.getColumn(index + 1).numFmt = '0.0';
    worksheet.getColumn(index + 1).alignment = { horizontal: 'right' };
  }

  // Lignes de total : mises en evidence d'un coup d'oeil.
  worksheet.eachRow((row, number) => {
    const raw: unknown = row.getCell(1).value;
    const label = typeof raw === 'string' ? raw.toUpperCase() : '';
    if (number > 1 && label === 'TOTAL') {
      row.font = { bold: true };
      row.border = { top: { style: 'thin', color: { argb: 'FF9AA1B4' } } };
    }
  });
}
