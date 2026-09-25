import {
  AttendanceStatus,
  NotificationKind,
  PlanningStatus,
  ReplacementStatus,
  Role,
  ShiftChangeType,
} from '@prisma/client';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { SchedulingEngineService } from '../scheduling/scheduling-engine.service';
import { getDurationInHours } from '../scheduling/scheduling.utils';
import { NotificationsService } from '../notifications/notifications.service';

export const REPLACEMENT_SOURCE = {
  DECLARATION: 'DECLARATION',
  AUTOMATIC_ABSENCE: 'AUTOMATIC_ABSENCE',
} as const;

export type ReplacementSource =
  (typeof REPLACEMENT_SOURCE)[keyof typeof REPLACEMENT_SOURCE];

export type ReplacementUrgency = 'CRITICAL' | 'HIGH' | 'NORMAL';

const HOUR_MS = 1000 * 60 * 60;

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulingEngine: SchedulingEngineService,
    private readonly notifications: NotificationsService,
  ) {}

  // ============================================================
  // ACCESS CONTROL HELPERS
  // ============================================================

  /**
   * A supervisor sees the stations attached to their account.
   * A station chief is restricted to their own station only.
   *
   * Public so the workspace module applies the exact same scoping rules.
   */
  async resolveAccessibleStationIds(
    userId: string,
  ): Promise<{
    unrestricted: boolean;
    stationIds: string[];
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        isActive: true,
        stationId: true,
        stationScopes: {
          select: { stationId: true },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new ForbiddenException(
        'Your account is not allowed to perform this action.',
      );
    }

    if (user.role === Role.ADMIN) {
      return { unrestricted: true, stationIds: [] };
    }

    if (user.role === Role.STATION_CHIEF) {
      if (!user.stationId) {
        throw new ForbiddenException(
          'This station chief is not assigned to a station.',
        );
      }

      return {
        unrestricted: false,
        stationIds: [user.stationId],
      };
    }

    if (user.role === Role.SUPERVISOR) {
      const stationIds = new Set<string>();

      if (user.stationId) {
        stationIds.add(user.stationId);
      }

      for (const scope of user.stationScopes) {
        stationIds.add(scope.stationId);
      }

      return {
        unrestricted: false,
        stationIds: [...stationIds],
      };
    }

    if (user.role === Role.SWAPPER) {
      // A swapper only ever sees their own shifts; the workspace service
      // additionally filters on swapperId. Their station (when set) scopes
      // the header, an empty list means "no station reachable".
      return {
        unrestricted: false,
        stationIds: user.stationId ? [user.stationId] : [],
      };
    }

    throw new ForbiddenException(
      'You do not have access to the operations workspace.',
    );
  }

  private assertStationAccess(
    access: { unrestricted: boolean; stationIds: string[] },
    stationId: string,
  ): void {
    if (access.unrestricted) {
      return;
    }

    if (!access.stationIds.includes(stationId)) {
      throw new ForbiddenException(
        'You do not have access to this station.',
      );
    }
  }

  // ============================================================
  // URGENCY
  // ============================================================

  private computeUrgency(
    startTime: Date,
    now: Date,
  ): {
    urgency: ReplacementUrgency;
    hoursUntilStart: number;
  } {
    const hoursUntilStart =
      (startTime.getTime() - now.getTime()) / HOUR_MS;

    if (hoursUntilStart <= 12) {
      return { urgency: 'CRITICAL', hoursUntilStart };
    }

    if (hoursUntilStart <= 48) {
      return { urgency: 'HIGH', hoursUntilStart };
    }

    return { urgency: 'NORMAL', hoursUntilStart };
  }

  // ============================================================
  // BLOC A — OPEN A REPLACEMENT REQUEST
  // ============================================================

  /**
   * Opens an OPEN ReplacementRequest for a shift, if none is already open.
   *
   * Shared by the swapper declaration endpoint and the automatic absence
   * scheduler, so both paths feed the same coverage queue.
   *
   * `requestedById` is the swapper for a manual declaration, and the
   * absent swapper for an automatic absence (a row needs an owner).
   */
  async openReplacementRequest(params: {
    shiftId: string;
    originalSwapperId: string;
    requestedById: string;
    reason?: string | null;
    source: ReplacementSource;
  }): Promise<{
    created: boolean;
    requestId: string;
    status: ReplacementStatus;
  }> {
    const existing = await this.prisma.replacementRequest.findFirst({
      where: {
        shiftId: params.shiftId,
        status: {
          in: [ReplacementStatus.OPEN, ReplacementStatus.ASSIGNED],
        },
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (existing) {
      return {
        created: false,
        requestId: existing.id,
        status: existing.status,
      };
    }

    const created = await this.prisma.replacementRequest.create({
      data: {
        shiftId: params.shiftId,
        originalSwapperId: params.originalSwapperId,
        requestedById: params.requestedById,
        reason: params.reason?.trim() || null,
        source: params.source,
        status: ReplacementStatus.OPEN,
      },
      select: {
        id: true,
        status: true,
      },
    });

    // Both origins (declared impediment and automatic absence) funnel through
    // here, so supervision is told exactly once either way.
    await this.notifySupervisionOfOpenRequest({
      requestId: created.id,
      shiftId: params.shiftId,
      source: params.source,
      reason: params.reason ?? null,
      originalSwapperId: params.originalSwapperId,
    });

    return {
      created: true,
      requestId: created.id,
      status: created.status,
    };
  }

  /**
   * Tells the supervisors and station chiefs who can act on a newly opened
   * replacement request.
   */
  private async notifySupervisionOfOpenRequest(params: {
    requestId: string;
    shiftId: string;
    source: ReplacementSource;
    reason: string | null;
    originalSwapperId: string;
  }): Promise<void> {
    const shift = await this.prisma.shift.findUnique({
      where: { id: params.shiftId },
      select: {
        stationId: true,
        startTime: true,
        station: { select: { name: true } },
        swapper: { select: { fullName: true } },
      },
    });

    if (!shift) return;

    const isAutomatic =
      params.source === REPLACEMENT_SOURCE.AUTOMATIC_ABSENCE;

    const when = shift.startTime.toISOString().slice(0, 16).replace('T', ' ');

    await this.notifications.notifyRoles({
      roles: [Role.ADMIN, Role.SUPERVISOR, Role.STATION_CHIEF],
      stationIds: [shift.stationId],
      kind: NotificationKind.REPLACEMENT_REQUESTED,
      title: isAutomatic
        ? `Absence constatée — ${shift.station.name}`
        : `Empêchement déclaré — ${shift.station.name}`,
      body: isAutomatic
        ? `Aucun pointage enregistré pour ${shift.swapper.fullName} (${when}). Un remplaçant est nécessaire.`
        : `${shift.swapper.fullName} ne peut plus assurer le shift du ${when}. Motif : ${params.reason ?? 'non précisé'}.`,
      link: '/app/supervision/operations',
      entityId: params.requestId,
    });
  }

  /**
   * Swapper declares an impediment on one of their own published shifts.
   */
  async declareAbsence(params: {
    swapperId: string;
    shiftId: string;
    reason: string;
  }) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: params.shiftId },
      select: {
        id: true,
        swapperId: true,
        stationId: true,
        startTime: true,
        endTime: true,
        planning: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found.');
    }

    if (shift.swapperId !== params.swapperId) {
      throw new ForbiddenException(
        'You can only declare an impediment on your own shift.',
      );
    }

    if (!shift.planning) {
      throw new BadRequestException(
        'The shift is not attached to a planning.',
      );
    }

    if (shift.planning.status !== PlanningStatus.PUBLISHED) {
      throw new BadRequestException(
        'An impediment can only be declared on a published planning.',
      );
    }

    if (shift.endTime.getTime() <= Date.now()) {
      throw new BadRequestException(
        'This shift has already ended and cannot be declared as an impediment.',
      );
    }

    const attendance = await this.prisma.attendance.findUnique({
      where: {
        shiftId_swapperId: {
          shiftId: shift.id,
          swapperId: params.swapperId,
        },
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (
      attendance &&
      (attendance.status === AttendanceStatus.CHECKED_IN ||
        attendance.status === AttendanceStatus.CHECKED_OUT)
    ) {
      throw new BadRequestException(
        'This shift is already in progress or completed.',
      );
    }

    const opened = await this.openReplacementRequest({
      shiftId: shift.id,
      originalSwapperId: shift.swapperId,
      requestedById: params.swapperId,
      reason: params.reason,
      source: REPLACEMENT_SOURCE.DECLARATION,
    });

    return {
      message: opened.created
        ? 'Impediment declared. A replacement request is now open.'
        : 'An open replacement request already exists for this shift.',
      requestId: opened.requestId,
      status: opened.status,
      shiftId: shift.id,
      stationId: shift.stationId,
      startTime: shift.startTime,
    };
  }

  // ============================================================
  // BLOC B — PENDING REPLACEMENTS (COVERAGE QUEUE)
  // ============================================================

  async findPendingReplacements(userId: string) {
    const access = await this.resolveAccessibleStationIds(userId);
    const now = new Date();

    const requests = await this.prisma.replacementRequest.findMany({
      where: {
        status: {
          in: [ReplacementStatus.OPEN, ReplacementStatus.ASSIGNED],
        },
        shift: {
          endTime: { gt: now },
          ...(access.unrestricted
            ? {}
            : { stationId: { in: access.stationIds } }),
        },
      },
      include: {
        shift: {
          select: {
            id: true,
            startTime: true,
            endTime: true,
            station: {
              select: {
                id: true,
                name: true,
                timezone: true,
              },
            },
          },
        },
        originalSwapper: {
          select: {
            id: true,
            fullName: true,
          },
        },
        assignedSwapper: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
      orderBy: {
        requestedAt: 'asc',
      },
    });

    return requests
      .map((request) => {
        const { urgency, hoursUntilStart } = this.computeUrgency(
          request.shift.startTime,
          now,
        );

        return {
          requestId: request.id,
          shiftId: request.shift.id,
          station: {
            id: request.shift.station.id,
            name: request.shift.station.name,
            timezone: request.shift.station.timezone,
          },
          swapper: {
            id: request.originalSwapper.id,
            fullName: request.originalSwapper.fullName,
          },
          assignedSwapper: request.assignedSwapper
            ? {
                id: request.assignedSwapper.id,
                fullName: request.assignedSwapper.fullName,
              }
            : null,
          startTime: request.shift.startTime,
          endTime: request.shift.endTime,
          status: request.status,
          urgency,
          hoursUntilStart,
          origin: request.source ?? REPLACEMENT_SOURCE.DECLARATION,
          reason: request.reason,
          reportedAt: request.requestedAt,
        };
      })
      .sort((a, b) => {
        if (a.urgency !== b.urgency) {
          const rank: Record<ReplacementUrgency, number> = {
            CRITICAL: 0,
            HIGH: 1,
            NORMAL: 2,
          };

          return rank[a.urgency] - rank[b.urgency];
        }

        return (
          new Date(a.startTime).getTime() -
          new Date(b.startTime).getTime()
        );
      });
  }

  // ============================================================
  // BLOC B — SHIFT CHANGE HISTORY
  // ============================================================

  async findShiftChanges(
    userId: string,
    filters: {
      from?: string;
      to?: string;
      type?: ShiftChangeType;
      swapperId?: string;
    },
  ) {
    const access = await this.resolveAccessibleStationIds(userId);

    const createdAt: {
      gte?: Date;
      lte?: Date;
    } = {};

    if (filters.from) {
      const from = new Date(filters.from);

      if (Number.isNaN(from.getTime())) {
        throw new BadRequestException('Invalid "from" date.');
      }

      createdAt.gte = from;
    }

    if (filters.to) {
      const to = new Date(filters.to);

      if (Number.isNaN(to.getTime())) {
        throw new BadRequestException('Invalid "to" date.');
      }

      createdAt.lte = to;
    }

    const changes = await this.prisma.shiftChange.findMany({
      where: {
        ...(filters.type ? { type: filters.type } : {}),
        ...(Object.keys(createdAt).length ? { createdAt } : {}),
        ...(filters.swapperId
          ? {
              OR: [
                { previousSwapperId: filters.swapperId },
                { newSwapperId: filters.swapperId },
              ],
            }
          : {}),
        shift: {
          ...(access.unrestricted
            ? {}
            : { stationId: { in: access.stationIds } }),
        },
      },
      include: {
        changedBy: {
          select: {
            id: true,
            fullName: true,
          },
        },
        previousSwapper: {
          select: {
            id: true,
            fullName: true,
          },
        },
        newSwapper: {
          select: {
            id: true,
            fullName: true,
          },
        },
        shift: {
          select: {
            id: true,
            startTime: true,
            endTime: true,
            station: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 500,
    });

    return changes.map((change) => ({
      id: change.id,
      type:
        change.type === ShiftChangeType.REPLACEMENT
          ? 'REPLACEMENT'
          : change.type === ShiftChangeType.SWAP
            ? 'SWAP'
            : 'REASSIGNMENT',
      rawType: change.type,
      initiator: change.changedBy.fullName,
      station: change.shift.station.name,
      outSwapper: change.previousSwapper?.fullName ?? null,
      inSwapper: change.newSwapper?.fullName ?? null,
      before: {
        startTime: change.oldStartTime,
        endTime: change.oldEndTime,
      },
      after: {
        startTime: change.newStartTime,
        endTime: change.newEndTime,
      },
      reason: change.reason,
      createdAt: change.createdAt,
    }));
  }

  // ============================================================
  // BLOC C — REPLACEMENT CANDIDATES
  // ============================================================

  /**
   * Every active swapper is evaluated against the scheduling engine, so a
   * replacement candidate obeys exactly the same rules as a planned shift:
   * 8h duration, no overlap, one shift per day, minimum rest, weekly limit
   * and approved leave.
   */
  async findReplacementCandidates(userId: string, shiftId: string) {
    const access = await this.resolveAccessibleStationIds(userId);

    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      select: {
        id: true,
        stationId: true,
        swapperId: true,
        startTime: true,
        endTime: true,
        planningId: true,
      },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found.');
    }

    this.assertStationAccess(access, shift.stationId);

    const swappers = await this.prisma.user.findMany({
      where: {
        role: Role.SWAPPER,
        isActive: true,
        id: { not: shift.swapperId },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
      },
      orderBy: {
        fullName: 'asc',
      },
    });

    const candidates = await Promise.all(
      swappers.map(async (swapper) => {
        const result = await this.schedulingEngine.validateShift({
          swapperId: swapper.id,
          stationId: shift.stationId,
          startTime: shift.startTime,
          endTime: shift.endTime,
          planningId: shift.planningId,
          excludeShiftId: shift.id,
        });

        return {
          id: swapper.id,
          fullName: swapper.fullName,
          email: swapper.email,
          eligible: result.valid,
          issues: result.errors.map((message, index) => ({
            code: `RULE_${index + 1}`,
            message,
          })),
        };
      }),
    );

    return {
      shiftId: shift.id,
      stationId: shift.stationId,
      startTime: shift.startTime,
      endTime: shift.endTime,
      durationHours: getDurationInHours(
        shift.startTime,
        shift.endTime,
      ),
      candidates,
    };
  }

  // ============================================================
  // BLOC C — ASSIGN A REPLACEMENT
  // ============================================================

  /**
   * Assigns a replacement swapper, records the ShiftChange, moves the
   * attendance row to the new swapper and closes the replacement request.
   */
  async assignReplacement(params: {
    changedById: string;
    shiftId: string;
    swapperId: string;
    reason?: string;
  }) {
    const access = await this.resolveAccessibleStationIds(
      params.changedById,
    );

    const shift = await this.prisma.shift.findUnique({
      where: { id: params.shiftId },
      select: {
        id: true,
        stationId: true,
        swapperId: true,
        startTime: true,
        endTime: true,
        planningId: true,
        station: {
          select: { isActive: true },
        },
      },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found.');
    }

    this.assertStationAccess(access, shift.stationId);

    if (shift.swapperId === params.swapperId) {
      throw new BadRequestException(
        'This swapper is already assigned to the shift.',
      );
    }

    if (!shift.station.isActive) {
      throw new BadRequestException(
        'This station is deactivated.',
      );
    }

    // Re-evaluate the rules at assignment time: availability may have
    // changed since the candidate list was rendered.
    await this.schedulingEngine.assertValidShift({
      swapperId: params.swapperId,
      stationId: shift.stationId,
      startTime: shift.startTime,
      endTime: shift.endTime,
      planningId: shift.planningId,
      excludeShiftId: shift.id,
    });

    const openRequest =
      await this.prisma.replacementRequest.findFirst({
        where: {
          shiftId: shift.id,
          status: {
            in: [ReplacementStatus.OPEN, ReplacementStatus.ASSIGNED],
          },
        },
        orderBy: {
          requestedAt: 'asc',
        },
        select: {
          id: true,
          reason: true,
          originalSwapperId: true,
        },
      });

    const reason =
      params.reason?.trim() ||
      openRequest?.reason ||
      'Replacement assigned by supervision.';

    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedShift = await tx.shift.update({
        where: { id: shift.id },
        data: {
          swapperId: params.swapperId,
        },
        include: {
          station: true,
          swapper: {
            select: {
              id: true,
              fullName: true,
            },
          },
        },
      });

      const shiftChange = await tx.shiftChange.create({
        data: {
          shiftId: shift.id,
          previousSwapperId: shift.swapperId,
          newSwapperId: params.swapperId,
          changedById: params.changedById,
          type: ShiftChangeType.REPLACEMENT,
          reason,
          oldStartTime: shift.startTime,
          oldEndTime: shift.endTime,
          newStartTime: shift.startTime,
          newEndTime: shift.endTime,
        },
      });

      // Hand the attendance row over to the replacement. Only an
      // untouched EXPECTED row is removed; anything already scanned is
      // preserved as history.
      const previousAttendance = await tx.attendance.findUnique({
        where: {
          shiftId_swapperId: {
            shiftId: shift.id,
            swapperId: shift.swapperId,
          },
        },
      });

      if (
        previousAttendance &&
        previousAttendance.status === AttendanceStatus.EXPECTED
      ) {
        await tx.attendance.delete({
          where: { id: previousAttendance.id },
        });
      }

      const replacementAttendance = await tx.attendance.findUnique({
        where: {
          shiftId_swapperId: {
            shiftId: shift.id,
            swapperId: params.swapperId,
          },
        },
      });

      if (!replacementAttendance) {
        await tx.attendance.create({
          data: {
            shiftId: shift.id,
            swapperId: params.swapperId,
            stationId: shift.stationId,
            status: AttendanceStatus.EXPECTED,
          },
        });
      }

      if (openRequest) {
        await tx.replacementRequest.update({
          where: { id: openRequest.id },
          data: {
            assignedSwapperId: params.swapperId,
            assignedById: params.changedById,
            assignedAt: now,
            resolvedAt: now,
            status: ReplacementStatus.RESOLVED,
            ...(params.reason?.trim()
              ? { reason: params.reason.trim() }
              : {}),
          },
        });
      }

      return {
        shift: updatedShift,
        shiftChange,
      };
    });

    // Notifications go out after the transaction commits: a rollback must
    // never leave a message claiming a change that did not happen.
    await this.notifyReplacementAssigned({
      shiftId: shift.id,
      previousSwapperId: shift.swapperId,
      newSwapperId: params.swapperId,
      newSwapperName: result.shift.swapper.fullName,
      stationId: shift.stationId,
      startTime: shift.startTime,
      reason,
    });

    return {
      message: 'Replacement assigned successfully.',
      shiftId: result.shift.id,
      previousSwapperId: shift.swapperId,
      newSwapper: {
        id: result.shift.swapper.id,
        fullName: result.shift.swapper.fullName,
      },
      shiftChangeId: result.shiftChange.id,
      requestId: openRequest?.id ?? null,
      requestStatus: openRequest
        ? ReplacementStatus.RESOLVED
        : null,
    };
  }

  /**
   * Tells the incoming swapper they now work the shift, tells the outgoing
   * one they are released, and closes the loop with supervision.
   */
  private async notifyReplacementAssigned(params: {
    shiftId: string;
    previousSwapperId: string;
    newSwapperId: string;
    newSwapperName: string;
    stationId: string;
    startTime: Date;
    reason: string;
  }): Promise<void> {
    const station = await this.prisma.station.findUnique({
      where: { id: params.stationId },
      select: { name: true },
    });

    const when = params.startTime
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ');

    // The incoming swapper — the most important message of the three.
    await this.notifications.notify({
      userId: params.newSwapperId,
      kind: NotificationKind.REPLACEMENT_ASSIGNED,
      title: 'Nouveau shift qui vous est affecté',
      body: `Vous remplacez sur ${station?.name ?? 'la station'} le ${when}. Motif : ${params.reason}.`,
      link: '/app/supervision/operations',
      entityId: params.shiftId,
    });

    // The outgoing swapper is released from the shift.
    await this.notifications.notify({
      userId: params.previousSwapperId,
      kind: NotificationKind.SHIFT_CHANGED,
      title: 'Vous êtes déchargé de ce shift',
      body: `${params.newSwapperName} assure désormais le shift du ${when} à ${station?.name ?? 'la station'}.`,
      link: '/app/supervision/operations',
      entityId: params.shiftId,
    });

    // Supervision gets the confirmation.
    await this.notifications.notifyRoles({
      roles: [Role.ADMIN, Role.SUPERVISOR, Role.STATION_CHIEF],
      stationIds: [params.stationId],
      kind: NotificationKind.SHIFT_CHANGED,
      title: 'Remplacement effectué',
      body: `${params.newSwapperName} couvre le shift du ${when} à ${station?.name ?? 'la station'}.`,
      link: '/app/supervision/operations',
      entityId: params.shiftId,
    });
  }
}