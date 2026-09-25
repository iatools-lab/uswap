import {
  AttendanceStatus,
  ReplacementStatus,
  Role,
} from '@prisma/client';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { OperationsService } from '../operations/operations.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationsService: OperationsService,
  ) {}

  /** Inclusive bounds of "today" in Douala local time, as UTC instants. */
  private getTodayRange(now: Date): {
    start: Date;
    end: Date;
    businessDate: string;
  } {
    const businessDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Douala',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

    const [year, month, day] = businessDate.split('-').map(Number);

    // Douala is UTC+1 with no DST, so local midnight is 23:00 UTC the day
    // before.
    const start = new Date(
      Date.UTC(year, month - 1, day, 0, 0, 0) - 60 * 60 * 1000,
    );
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    return { start, end, businessDate };
  }

  /**
   * Operational dashboard.
   *
   * Every counter respects the caller's station scope, so a supervisor sees
   * only their stations and a station chief only their own.
   */
  async getStats(userId: string) {
    const access =
      await this.operationsService.resolveAccessibleStationIds(userId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const now = new Date();
    const { start, end, businessDate } = this.getTodayRange(now);

    const stationFilter = access.unrestricted
      ? {}
      : { stationId: { in: access.stationIds } };

    // A swapper's dashboard is about their own work, not the whole station.
    const isSwapper = user?.role === Role.SWAPPER;
    const shiftScope = isSwapper
      ? { swapperId: userId }
      : stationFilter;

    // ------------------------------------------------------------
    // TODAY
    // ------------------------------------------------------------

    const todayShifts = await this.prisma.shift.findMany({
      where: {
        ...shiftScope,
        startTime: { gte: start, lt: end },
        planning: { status: 'PUBLISHED' },
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        swapperId: true,
        station: {
          select: {
            id: true,
            name: true,
            timezone: true,
            latenessToleranceMinutes: true,
          },
        },
        swapper: {
          select: { id: true, fullName: true },
        },
        attendances: {
          select: {
            id: true,
            status: true,
            checkInAt: true,
            checkOutAt: true,
            absenceReason: true,
          },
        },
      },
      orderBy: { startTime: 'asc' },
    });

    let present = 0;
    let late = 0;
    let absent = 0;
    let completed = 0;
    let expected = 0;

    const timeline = todayShifts.map((shift) => {
      const attendance = shift.attendances[0] ?? null;

      let status:
        | 'EXPECTED'
        | 'PRESENT'
        | 'LATE'
        | 'ABSENT'
        | 'CLOSED' = 'EXPECTED';

      if (!attendance || attendance.status === AttendanceStatus.EXPECTED) {
        status = 'EXPECTED';
        expected++;
      } else if (attendance.status === AttendanceStatus.ABSENT) {
        status = 'ABSENT';
        absent++;
      } else if (attendance.status === AttendanceStatus.CHECKED_OUT) {
        status = 'CLOSED';
        completed++;
      } else if (attendance.status === AttendanceStatus.CHECKED_IN) {
        const tolerance =
          shift.station.latenessToleranceMinutes * 60 * 1000;
        const isLate =
          attendance.checkInAt !== null &&
          attendance.checkInAt.getTime() >
            shift.startTime.getTime() + tolerance;

        if (isLate) {
          status = 'LATE';
          late++;
        } else {
          status = 'PRESENT';
          present++;
        }
      } else {
        status = 'EXPECTED';
        expected++;
      }

      // A shift that ended without a check-out is closed, even if the
      // attendance row was never flipped by the scheduler yet.
      if (
        status === 'PRESENT' &&
        shift.endTime.getTime() < now.getTime()
      ) {
        status = 'CLOSED';
        present--;
        completed++;
      }

      return {
        shiftId: shift.id,
        station: shift.station.name,
        timezone: shift.station.timezone,
        swapper: shift.swapper.fullName,
        startTime: shift.startTime,
        endTime: shift.endTime,
        status,
        checkedInAt: attendance?.checkInAt ?? null,
        checkedOutAt: attendance?.checkOutAt ?? null,
      };
    });

    // ------------------------------------------------------------
    // REPLACEMENTS
    // ------------------------------------------------------------

    const openReplacements = await this.prisma.replacementRequest.count({
      where: {
        status: {
          in: [ReplacementStatus.OPEN, ReplacementStatus.ASSIGNED],
        },
        shift: {
          endTime: { gt: now },
          ...(isSwapper ? { swapperId: userId } : stationFilter),
        },
      },
    });

    const assignedToday = await this.prisma.replacementRequest.count({
      where: {
        status: ReplacementStatus.RESOLVED,
        assignedAt: { gte: start, lt: end },
        shift: isSwapper ? { swapperId: userId } : stationFilter,
      },
    });

    // ------------------------------------------------------------
    // WEEKLY HOURS (for a swapper, the guard against exceeding the limit)
    // ------------------------------------------------------------

    const weekStart = new Date(start);
    const dayOfWeek = weekStart.getUTCDay();
    weekStart.setUTCDate(
      weekStart.getUTCDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1),
    );
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const weekShifts = await this.prisma.shift.findMany({
      where: {
        ...shiftScope,
        startTime: { gte: weekStart, lt: weekEnd },
      },
      select: { startTime: true, endTime: true },
    });

    const weeklyHours = weekShifts.reduce(
      (total, shift) =>
        total +
        (shift.endTime.getTime() - shift.startTime.getTime()) /
          (1000 * 60 * 60),
      0,
    );

    // The most restrictive configured limit among the reachable stations.
    const stations = await this.prisma.station.findMany({
      where: {
        isActive: true,
        ...(access.unrestricted
          ? {}
          : { id: { in: access.stationIds } }),
      },
      select: { weeklyHoursLimit: true },
      orderBy: { weeklyHoursLimit: 'asc' },
      take: 1,
    });

    const weeklyHoursLimit = stations[0]?.weeklyHoursLimit ?? 48;

    // ------------------------------------------------------------
    // HEADCOUNTS (supervision only)
    // ------------------------------------------------------------

    let workforce: {
      totalSwappers: number;
      activeSwappers: number;
    } | null = null;

    if (!isSwapper) {
      const [totalSwappers, activeSwappers] = await Promise.all([
        this.prisma.user.count({
          where: { role: Role.SWAPPER, ...stationFilter },
        }),
        this.prisma.user.count({
          where: { role: Role.SWAPPER, isActive: true, ...stationFilter },
        }),
      ]);

      workforce = { totalSwappers, activeSwappers };
    }

    return {
      generatedAt: now,
      businessDate,
      scope: {
        unrestricted: access.unrestricted,
        stationIds: access.stationIds,
      },
      today: {
        total: todayShifts.length,
        expected,
        present,
        late,
        absent,
        completed,
      },
      replacements: {
        open: openReplacements,
        assignedToday,
      },
      hours: {
        weekly: Math.round(weeklyHours * 10) / 10,
        weeklyLimit: weeklyHoursLimit,
        remaining: Math.max(
          0,
          Math.round((weeklyHoursLimit - weeklyHours) * 10) / 10,
        ),
      },
      workforce,
      timeline,
    };
  }
}