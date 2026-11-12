import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../common/scope.service';
import { type AuthenticatedUser } from '../common/guards/roles.guard';
import {
  durationHours,
  stationDayKey,
  weekKeyOf,
  addDaysKey,
} from '../common/utils/datetime';

const DOUALA = 'Africa/Douala';

/**
 * Tableau de bord (`GET /dashboard/stats`).
 *
 * Renvoie exactement les indicateurs consommés par l'écran d'accueil : la
 * répartition du jour, les demandes de remplacement ouvertes, la charge
 * hebdomadaire, l'effectif et la chronologie des postes.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async stats(user: AuthenticatedUser) {
    const now = new Date();
    const businessDay = stationDayKey(now.getTime(), DOUALA);
    const dayStart = Date.parse(`${businessDay}T00:00:00.000+01:00`);
    const dayEnd = Date.parse(`${addDaysKey(businessDay, 1)}T00:00:00.000+01:00`);

    const accessible = await this.scope.stationIdsFor(user);
    const stationFilter = accessible ? { stationId: { in: accessible } } : {};

    const occurrences = await this.prisma.occurrence.findMany({
      where: {
        ...stationFilter,
        // Un agent ne voit que ses propres postes.
        ...(user.role === 'SWAPPER' ? { swapperId: user.id } : {}),
        startTime: { gte: new Date(dayStart), lt: new Date(dayEnd) },
      },
      include: {
        attendance: true,
        station: { select: { name: true, timezone: true } },
        assignments: { include: { user: { select: { fullName: true } } } },
      },
      orderBy: { startTime: 'asc' },
    });

    const bucket = {
      EXPECTED: 0,
      PRESENT: 0,
      LATE: 0,
      ABSENT: 0,
      CLOSED: 0,
    };
    const timeline = occurrences.map((occurrence) => {
      const status = this.dayStatus(occurrence.attendance);
      bucket[status] += 1;
      return {
        shiftId: occurrence.id,
        station: occurrence.station.name,
        timezone: occurrence.station.timezone,
        swapper: occurrence.assignments[0]?.user.fullName ?? '—',
        startTime: occurrence.startTime.toISOString(),
        endTime: occurrence.endTime.toISOString(),
        status,
        checkedInAt: occurrence.attendance?.checkedInAt?.toISOString() ?? null,
        checkedOutAt: occurrence.attendance?.checkedOutAt?.toISOString() ?? null,
      };
    });

    const weekStart = weekKeyOf(now.toISOString(), DOUALA);
    const weekEnd = addDaysKey(weekStart, 7);
    const weekOccurrences = await this.prisma.occurrence.findMany({
      where: {
        ...stationFilter,
        ...(user.role === 'SWAPPER' ? { swapperId: user.id } : {}),
      },
      include: { station: { select: { timezone: true } } },
    });
    let weeklyHours = 0;
    for (const occurrence of weekOccurrences) {
      const key = stationDayKey(
        occurrence.startTime.getTime(),
        occurrence.station.timezone,
      );
      if (key >= weekStart && key < weekEnd) weeklyHours += durationHours(occurrence);
    }
    weeklyHours = Math.round(weeklyHours * 100) / 100;

    const station = accessible?.length
      ? await this.prisma.station.findUnique({ where: { id: accessible[0] } })
      : user.stationId
        ? await this.prisma.station.findUnique({ where: { id: user.stationId } })
        : await this.prisma.station.findFirst({ orderBy: { createdAt: 'asc' } });
    const weeklyLimit = station?.weeklyHoursLimit ?? 48;

    const openReplacements = await this.prisma.planningVacancy.count({
      where: accessible ? { stationId: { in: accessible } } : {},
    });

    const workforce =
      user.role === 'SWAPPER'
        ? null
        : {
            totalSwappers: await this.prisma.user.count({
              where: { role: 'SWAPPER' },
            }),
            activeSwappers: await this.prisma.user.count({
              where: { role: 'SWAPPER', isActive: true, disabledAt: null },
            }),
          };

    const total = occurrences.length;
    return {
      generatedAt: now.toISOString(),
      businessDate: businessDay,
      scope: {
        unrestricted: accessible === null,
        stationIds: accessible ?? [],
      },
      today: {
        total,
        expected: bucket.EXPECTED,
        present: bucket.PRESENT,
        late: bucket.LATE,
        absent: bucket.ABSENT,
        completed: bucket.CLOSED,
      },
      replacements: {
        open: openReplacements,
        assignedToday: 0,
      },
      hours: {
        weekly: weeklyHours,
        weeklyLimit,
        remaining: Math.max(0, Math.round((weeklyLimit - weeklyHours) * 100) / 100),
      },
      workforce,
      timeline,
    };
  }

  /** Statut « du jour » : reprend le vocabulaire de l'écran (5 valeurs). */
  private dayStatus(
    attendance: {
      status: string;
      checkedInAt: Date | null;
      checkedOutAt: Date | null;
    } | null,
  ): 'EXPECTED' | 'PRESENT' | 'LATE' | 'ABSENT' | 'CLOSED' {
    if (!attendance) return 'EXPECTED';
    if (attendance.checkedOutAt) return 'CLOSED';
    switch (attendance.status) {
      case 'PRESENT':
        return 'PRESENT';
      case 'LATE':
        return 'LATE';
      case 'ABSENT':
      case 'JUSTIFIED':
        return 'ABSENT';
      case 'CLOSED':
        return 'CLOSED';
      default:
        return attendance.checkedInAt ? 'PRESENT' : 'EXPECTED';
    }
  }
}
