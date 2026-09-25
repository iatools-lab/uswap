import { Injectable, NotFoundException } from '@nestjs/common';

import { PlanningStatus, Role } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { OperationsService } from '../operations/operations.service';

const WORKSPACE_LIMIT = 50;

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationsService: OperationsService,
  ) {}

  /**
   * The operations landing payload consumed by OperationsPage.
   *
   * Shape mirrors `OperationData` in the frontend:
   *   { station: {...} | null, limit: number, shifts: OperationShift[] }
   */
  async getWorkspace(userId: string) {
    const access =
      await this.operationsService.resolveAccessibleStationIds(userId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        fullName: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User account not found.');
    }

    const stationFilter = access.unrestricted
      ? {}
      : { stationId: { in: access.stationIds } };

    const shifts = await this.prisma.shift.findMany({
      where: {
        ...stationFilter,
        // Only published planning is actionable, and only shifts that are
        // not already over. A swapper sees their own; supervision sees all.
        ...(user.role === Role.SWAPPER ? { swapperId: userId } : {}),
        planning: {
          status: PlanningStatus.PUBLISHED,
        },
        endTime: { gt: new Date() },
      },
      include: {
        station: {
          select: {
            id: true,
            name: true,
            location: true,
            timezone: true,
            latenessToleranceMinutes: true,
          },
        },
        planning: {
          select: {
            id: true,
            status: true,
            updatedAt: true,
          },
        },
        swapper: {
          select: {
            id: true,
            fullName: true,
          },
        },
        attendances: {
          select: {
            id: true,
            status: true,
            checkInAt: true,
            checkOutAt: true,
            stationId: true,
          },
        },
      },
      orderBy: {
        startTime: 'asc',
      },
      take: WORKSPACE_LIMIT,
    });

    const shapedShifts = shifts.map((shift) => {
      const attendance =
        shift.attendances.find(
          (row) => row.status !== 'ABSENT',
        ) ??
        shift.attendances[0] ??
        null;

      return {
        id: shift.id,
        startTime: shift.startTime,
        endTime: shift.endTime,
        publishedAt:
          shift.planning?.status === PlanningStatus.PUBLISHED
            ? shift.planning.updatedAt
            : null,
        station: {
          id: shift.station.id,
          name: shift.station.name,
          timezone: shift.station.timezone,
          latenessToleranceMinutes:
            shift.station.latenessToleranceMinutes,
        },
        swapper: {
          fullName: shift.swapper.fullName,
        },
        attendance: attendance
          ? {
              id: attendance.id,
              status: attendance.status,
              checkInAt: attendance.checkInAt,
              checkOutAt: attendance.checkOutAt,
              absenceReason: null,
            }
          : null,
      };
    });

    // The station shown in the header: the swapper's first shift station,
    // the station chief's own station, otherwise the first reachable one.
    let headerStation: {
      id: string;
      name: string;
      location: string | null;
      timezone?: string;
    } | null = null;

    if (shapedShifts.length > 0) {
      const first = shifts[0].station;

      headerStation = {
        id: first.id,
        name: first.name,
        location: first.location,
        timezone: first.timezone,
      };
    } else {
      const station =
        await this.prisma.station.findFirst({
          where: {
            isActive: true,
            ...(access.unrestricted
              ? {}
              : { id: { in: access.stationIds } }),
          },
          select: {
            id: true,
            name: true,
            location: true,
            timezone: true,
          },
          orderBy: {
            name: 'asc',
          },
        });

      headerStation = station ?? null;
    }

    return {
      station: headerStation,
      limit: WORKSPACE_LIMIT,
      shifts: shapedShifts,
    };
  }
}