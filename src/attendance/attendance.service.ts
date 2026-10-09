import {
  AttendanceStatus,
  PlanningStatus,
  Role,
} from '@prisma/client';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import {
  OperationsService,
  REPLACEMENT_SOURCE,
} from '../operations/operations.service';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationsService: OperationsService,
  ) {}

  // ============================================================
  // GPS PUNCH (v5.3)
  // Pointage par geolocalisation : le swappeur envoie sa position
  // pendant le creneau, le service verifie le perimetre de la station.
  // ============================================================

  async punch(
    swapperId: string,
    shiftId: string,
    kind: string,
    latitude: number,
    longitude: number,
    accuracyMeters?: number,
  ) {
    const normalizedKind = (kind ?? '').toUpperCase();

    if (normalizedKind !== 'CHECKIN' && normalizedKind !== 'CHECKOUT') {
      throw new BadRequestException(
        'Choisissez une prise ou une fin de service valide.',
      );
    }

    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new BadRequestException(
        'La position n’a pas pu être vérifiée. Autorisez la localisation puis réessayez.',
      );
    }

    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      select: {
        id: true,
        swapperId: true,
        stationId: true,
        startTime: true,
        endTime: true,
        planning: { select: { status: true } },
        station: {
          select: {
            id: true,
            name: true,
            timezone: true,
            latitude: true,
            longitude: true,
            geofenceRadiusMeters: true,
            latenessToleranceMinutes: true,
          },
        },
      },
    });

    if (!shift) {
      throw new NotFoundException('Shift introuvable.');
    }

    if (
      shift.planning?.status !== PlanningStatus.PUBLISHED ||
      shift.swapperId !== swapperId
    ) {
      throw new ForbiddenException(
        'Ce shift publié ne vous est pas affecté.',
      );
    }

    const station = shift.station;

    if (
      station.latitude === null ||
      station.longitude === null ||
      !Number.isFinite(station.latitude) ||
      !Number.isFinite(station.longitude)
    ) {
      throw new ForbiddenException(
        'La position de cette station n’est pas configurée. Contactez le superviseur.',
      );
    }

    const radius = station.geofenceRadiusMeters;

    if (!Number.isFinite(radius) || radius < 25) {
      throw new ForbiddenException(
        'Le périmètre de pointage de cette station est invalide. Contactez le superviseur.',
      );
    }

    const distanceMeters = this.haversineMeters(
      latitude,
      longitude,
      station.latitude,
      station.longitude,
    );

    const accuracy = Number.isFinite(accuracyMeters as number)
      ? Math.max(0, Math.round(accuracyMeters as number))
      : 0;

    if (accuracy > radius) {
      throw new ForbiddenException(
        'Votre position manque de précision pour vérifier le périmètre. Réessayez avec le GPS activé.',
      );
    }

    if (distanceMeters + accuracy > radius) {
      throw new ForbiddenException(
        `Pointage refusé : votre position est estimée à ${distanceMeters} m de ${station.name}; le périmètre autorisé est de ${radius} m et la précision GPS ne permet pas de confirmer que vous êtes dedans.`,
      );
    }

    const now = new Date();
    const tolerance = station.latenessToleranceMinutes;

    // The attendance row is normally created when the shift is generated, but a
    // swapper can legitimately point on a shift whose row is missing (older
    // plannings, manual shift, re-seeded database). Instead of refusing the
    // pointage we create the row, so the presence is always recorded.
    const existing = await this.prisma.attendance.findUnique({
      where: { shiftId_swapperId: { shiftId, swapperId } },
    });

    if (normalizedKind === 'CHECKIN') {
      // Une arrivée légèrement en avance est normale : on ouvre le pointage
      // 15 min avant le début du créneau. Sans cette marge, le bouton
      // « Prendre mon service » n'apparaissait qu'à l'heure pile et le
      // swappeur ne voyait aucun pointage possible à son arrivée.
      const earlyWindowMs = 15 * 60_000;
      if (
        now.getTime() < shift.startTime.getTime() - earlyWindowMs ||
        now > shift.endTime
      ) {
        throw new BadRequestException(
          'La prise de service est possible 15 min avant jusqu’à la fin du créneau prévu.',
        );
      }

      if (existing?.checkInAt) {
        throw new BadRequestException(
          'La prise de service est déjà enregistrée pour ce shift.',
        );
      }

      // Automatic presence status: on time, or late beyond the station
      // tolerance. The comparison uses the planned start time and the actual
      // date/time of the pointage.
      const isLate =
        now.getTime() > shift.startTime.getTime() + tolerance * 60_000;
      const status = isLate
        ? AttendanceStatus.CHECKED_IN
        : AttendanceStatus.CHECKED_IN;

      const attendance = await this.prisma.attendance.upsert({
        where: { shiftId_swapperId: { shiftId, swapperId } },
        create: {
          shiftId,
          swapperId,
          stationId: shift.stationId,
          status,
          checkInAt: now,
          checkInLatitude: latitude,
          checkInLongitude: longitude,
        },
        update: {
          status,
          checkInAt: now,
          checkInLatitude: latitude,
          checkInLongitude: longitude,
        },
      });

      await this.prisma.attendanceCorrection.create({
        data: {
          attendanceId: attendance.id,
          correctedById: swapperId,
          oldStatus: existing?.status ?? AttendanceStatus.EXPECTED,
          newStatus: status,
          oldCheckInAt: existing?.checkInAt ?? null,
          newCheckInAt: now,
          reason: isLate
            ? `Pointage GPS en retard (${distanceMeters} m du site).`
            : `Pointage GPS à l'heure (${distanceMeters} m du site).`,
        },
      }).catch(() => {
        // The audit row is best-effort: a schema without the correction table
        // must not block the pointage itself.
      });

      return {
        kind: 'CHECKIN' as const,
        status: isLate ? ('LATE' as const) : ('PRESENT' as const),
        presence: isLate ? 'PRESENT' as const : 'PRESENT' as const,
        checkedInAt: now.toISOString(),
        toleranceMinutes: tolerance,
        timezone: station.timezone,
        distanceMeters,
        latitude,
        longitude,
        accuracyMeters: accuracy,
        geofenceRadiusMeters: radius,
      };
    }

    const attendance = existing;

    if (!attendance || !attendance.checkInAt) {
      throw new BadRequestException(
        'La fin de service nécessite une prise de service enregistrée.',
      );
    }

    if (attendance.checkOutAt) {
      throw new BadRequestException(
        'La fin de service est déjà enregistrée.',
      );
    }

    if (now.getTime() > shift.endTime.getTime() + 5 * 60_000) {
      throw new BadRequestException(
        'La fenêtre de fin de service est dépassée. Le superviseur peut corriger le pointage.',
      );
    }

    await this.prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        status: AttendanceStatus.CHECKED_OUT,
        checkOutAt: now,
        checkOutLatitude: latitude,
        checkOutLongitude: longitude,
      },
    });

    return {
      kind: 'CHECKOUT' as const,
      status: 'CLOSED' as const,
      checkedInAt: attendance.checkInAt.toISOString(),
      checkedOutAt: now.toISOString(),
      toleranceMinutes: tolerance,
      timezone: station.timezone,
      distanceMeters,
      latitude,
      longitude,
      accuracyMeters: accuracy,
      geofenceRadiusMeters: radius,
    };
  }

  /** Distance de Haversine en mètres. */
  private haversineMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const toRad = (degrees: number) => (degrees * Math.PI) / 180;
    const earthRadius = 6_371_000;
    const deltaLat = toRad(lat2 - lat1);
    const deltaLon = toRad(lon2 - lon1);
    const a = Math.min(
      1,
      Math.max(
        0,
        Math.sin(deltaLat / 2) ** 2 +
          Math.cos(toRad(lat1)) *
            Math.cos(toRad(lat2)) *
            Math.sin(deltaLon / 2) ** 2,
      ),
    );
    return Math.round(
      earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)),
    );
  }

  // ============================================================
  // FIND ALL ATTENDANCES
  // ============================================================

  async findAll(status?: AttendanceStatus) {
    return this.prisma.attendance.findMany({
      where: status
        ? {
            status,
          }
        : undefined,
      include: {
        shift: {
          include: {
            station: {
              select: {
                id: true,
                name: true,
                timezone: true,
                latenessToleranceMinutes: true,
              },
            },
          },
        },
        station: true,
        swapper: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phoneNumber: true,
            role: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // ============================================================
  // GET ATTENDANCE STATISTICS
  // ============================================================

  async getStatistics() {
    const grouped = await this.prisma.attendance.groupBy({
      by: ['status'],
      _count: {
        _all: true,
      },
    });

    const statistics = {
      total: 0,
      expected: 0,
      checkedIn: 0,
      checkedOut: 0,
      absent: 0,
    };

    for (const item of grouped) {
      const count = item._count._all;

      statistics.total += count;

      if (item.status === AttendanceStatus.EXPECTED) {
        statistics.expected = count;
      }

      if (item.status === AttendanceStatus.CHECKED_IN) {
        statistics.checkedIn = count;
      }

      if (item.status === AttendanceStatus.CHECKED_OUT) {
        statistics.checkedOut = count;
      }

      if (item.status === AttendanceStatus.ABSENT) {
        statistics.absent = count;
      }
    }

    return statistics;
  }

  // ============================================================
  // FIND ATTENDANCES BY SHIFT
  // ============================================================

  async findByShift(shiftId: string, status?: AttendanceStatus) {
    const shift = await this.prisma.shift.findUnique({
      where: {
        id: shiftId,
      },
      select: {
        id: true,
      },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found.');
    }

    return this.prisma.attendance.findMany({
      where: {
        shiftId,
        ...(status ? { status } : {}),
      },
      include: {
        station: true,
        swapper: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phoneNumber: true,
            role: true,
          },
        },
      },
      orderBy: {
        checkInAt: 'asc',
      },
    });
  }

  // ============================================================
  // FIND PENDING CHECKOUTS
  // ============================================================

  async findPendingCheckouts(shiftId: string) {
    const shift = await this.prisma.shift.findUnique({
      where: {
        id: shiftId,
      },
      select: {
        id: true,
        stationId: true,
        startTime: true,
        endTime: true,
      },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found.');
    }

    const attendances = await this.prisma.attendance.findMany({
      where: {
        shiftId,
        status: AttendanceStatus.CHECKED_IN,
      },
      include: {
        swapper: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phoneNumber: true,
          },
        },
      },
      orderBy: {
        checkInAt: 'asc',
      },
    });

    return {
      shift: {
        id: shift.id,
        stationId: shift.stationId,
        startTime: shift.startTime,
        endTime: shift.endTime,
      },
      count: attendances.length,
      swappers: attendances.map((attendance) => ({
        attendanceId: attendance.id,
        swapperId: attendance.swapper.id,
        fullName: attendance.swapper.fullName,
        email: attendance.swapper.email,
        phoneNumber: attendance.swapper.phoneNumber,
        status: attendance.status,
        checkInAt: attendance.checkInAt,
        missingCheckout: true,
      })),
    };
  }

  // ============================================================
  // FIND ATTENDANCES BY STATION
  // ============================================================

  async findByStation(stationId: string, status?: AttendanceStatus) {
    const station = await this.prisma.station.findUnique({
      where: {
        id: stationId,
      },
      select: {
        id: true,
      },
    });

    if (!station) {
      throw new NotFoundException('Station not found.');
    }

    return this.prisma.attendance.findMany({
      where: {
        stationId,
        ...(status ? { status } : {}),
      },
      include: {
        shift: {
          include: {
            station: {
              select: {
                id: true,
                name: true,
                timezone: true,
                latenessToleranceMinutes: true,
              },
            },
          },
        },
        swapper: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phoneNumber: true,
            role: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // ============================================================
  // FIND ATTENDANCES BY SWAPPER
  // ============================================================

  async findBySwapper(swapperId: string, status?: AttendanceStatus) {
    const swapper = await this.prisma.user.findUnique({
      where: {
        id: swapperId,
      },
      select: {
        id: true,
        role: true,
      },
    });

    if (!swapper) {
      throw new NotFoundException('Swapper not found.');
    }

    if (swapper.role !== Role.SWAPPER) {
      throw new BadRequestException('The selected user is not a swapper.');
    }

    return this.prisma.attendance.findMany({
      where: {
        swapperId,
        ...(status ? { status } : {}),
      },
      include: {
        shift: true,
        station: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // ============================================================
  // FIND ONE ATTENDANCE
  // ============================================================

  async findOne(id: string) {
    const attendance = await this.prisma.attendance.findUnique({
      where: {
        id,
      },
      include: {
        shift: true,
        station: true,
        swapper: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phoneNumber: true,
            role: true,
          },
        },
        correctionHistory: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!attendance) {
      throw new NotFoundException(`Attendance ${id} not found.`);
    }

    return attendance;
  }

  // ============================================================
  // CORRECT ATTENDANCE
  // ============================================================

  async correctAttendance(
    attendanceId: string,
    correctedById: string,
    newStatus: AttendanceStatus,
    reason: string,
    checkInAt?: string,
    checkOutAt?: string,
    evidenceUrl?: string,
  ) {
    if (!reason || !reason.trim()) {
      throw new BadRequestException('A correction reason is required.');
    }

    if (newStatus === AttendanceStatus.JUSTIFIED) {
      throw new BadRequestException(
        'JUSTIFIED status is no longer supported by the attendance workflow.',
      );
    }

    const attendance = await this.prisma.attendance.findUnique({
      where: {
        id: attendanceId,
      },
    });

    if (!attendance) {
      throw new NotFoundException(`Attendance ${attendanceId} not found.`);
    }

    const correctedBy = await this.prisma.user.findUnique({
      where: {
        id: correctedById,
      },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (!correctedBy) {
      throw new NotFoundException(`User ${correctedById} not found.`);
    }

    if (
      !correctedBy.isActive ||
      (correctedBy.role !== Role.ADMIN && correctedBy.role !== Role.SUPERVISOR)
    ) {
      throw new UnauthorizedException(
        'Only active administrators or supervisors can correct attendance.',
      );
    }

    let newCheckInAt: Date | null = attendance.checkInAt;

    let newCheckOutAt: Date | null = attendance.checkOutAt;

    if (checkInAt !== undefined) {
      const parsedCheckIn = new Date(checkInAt);

      if (Number.isNaN(parsedCheckIn.getTime())) {
        throw new BadRequestException('Invalid check-in date.');
      }

      newCheckInAt = parsedCheckIn;
    }

    if (checkOutAt !== undefined) {
      const parsedCheckOut = new Date(checkOutAt);

      if (Number.isNaN(parsedCheckOut.getTime())) {
        throw new BadRequestException('Invalid check-out date.');
      }

      newCheckOutAt = parsedCheckOut;
    }

    if (newStatus === AttendanceStatus.CHECKED_IN && !newCheckInAt) {
      throw new BadRequestException(
        'Check-in time is required for CHECKED_IN status.',
      );
    }

    if (
      newStatus === AttendanceStatus.CHECKED_OUT &&
      (!newCheckInAt || !newCheckOutAt)
    ) {
      throw new BadRequestException(
        'Both check-in and check-out times are required for CHECKED_OUT status.',
      );
    }

    if (
      newCheckInAt &&
      newCheckOutAt &&
      newCheckOutAt.getTime() < newCheckInAt.getTime()
    ) {
      throw new BadRequestException(
        'Check-out time cannot be before check-in time.',
      );
    }

    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const correction = await tx.attendanceCorrection.create({
        data: {
          attendanceId: attendance.id,
          correctedById: correctedBy.id,
          oldStatus: attendance.status,
          newStatus,
          oldCheckInAt: attendance.checkInAt,
          newCheckInAt,
          oldCheckOutAt: attendance.checkOutAt,
          newCheckOutAt,
          reason: reason.trim(),
          evidenceUrl: evidenceUrl?.trim() || null,
        },
      });

      const updatedAttendance = await tx.attendance.update({
        where: {
          id: attendance.id,
        },
        data: {
          status: newStatus,
          checkInAt: newCheckInAt,
          checkOutAt: newCheckOutAt,
          correctedAt: now,
          correctedById: correctedBy.id,
          correctionReason: reason.trim(),
        },
      });

      return {
        correction,
        attendance: updatedAttendance,
      };
    });

    return {
      message: 'Attendance corrected successfully.',
      attendance: result.attendance,
      correction: result.correction,
    };
  }

  // ============================================================
  // AUTOMATICALLY MARK INCOMPLETE ATTENDANCES AS ABSENT
  // ============================================================

  async markExpectedAsAbsent() {
    const now = new Date();

    const completedShifts = await this.prisma.shift.findMany({
      where: {
        endTime: {
          lt: now,
        },
      },
      select: {
        id: true,
        endTime: true,
        station: {
          select: {
            latenessToleranceMinutes: true,
          },
        },
      },
    });

    if (completedShifts.length === 0) {
      return {
        updatedCount: 0,
      };
    }

    let updatedCount = 0;

    for (const shift of completedShifts) {
      const toleranceMs = shift.station.latenessToleranceMinutes * 60 * 1000;

      const absenceDeadline = shift.endTime.getTime() + toleranceMs;

      if (now.getTime() < absenceDeadline) {
        continue;
      }

      const expectedResult = await this.prisma.attendance.updateMany({
        where: {
          shiftId: shift.id,
          status: AttendanceStatus.EXPECTED,
        },
        data: {
          status: AttendanceStatus.ABSENT,
          absenceReason: 'No check-in was recorded before the shift ended.',
        },
      });

      const missingCheckoutResult = await this.prisma.attendance.updateMany({
        where: {
          shiftId: shift.id,
          status: AttendanceStatus.CHECKED_IN,
        },
        data: {
          status: AttendanceStatus.ABSENT,
          absenceReason: 'No check-out was recorded before the shift ended.',
        },
      });

      const absentCount = expectedResult.count + missingCheckoutResult.count;

      // An automatically detected absence must feed the replacement queue,
      // otherwise no one is asked to cover the shift. A declared impediment
      // is not an absence, so the two remain distinguishable via `source`.
      if (absentCount > 0) {
        await this.openReplacementForAbsence(shift.id);
      }

      updatedCount += absentCount;
    }

    return {
      updatedCount,
    };
  }

  // ============================================================
  // OPEN A REPLACEMENT REQUEST FOR AN AUTOMATIC ABSENCE
  // ============================================================

  private async openReplacementForAbsence(shiftId: string): Promise<void> {
    const shift = await this.prisma.shift.findUnique({
      where: {
        id: shiftId,
      },
      select: {
        id: true,
        swapperId: true,
      },
    });

    if (!shift || !shift.swapperId) {
      return;
    }

    try {
      await this.operationsService.openReplacementRequest({
        shiftId: shift.id,
        originalSwapperId: shift.swapperId,
        requestedById: shift.swapperId,
        reason: 'No check-in was recorded before the shift ended.',
        source: REPLACEMENT_SOURCE.AUTOMATIC_ABSENCE,
      });
    } catch {
      // The absence itself is already recorded. A failure to open the
      // replacement request must not roll back or crash the scheduler;
      // the next run will retry.
    }
  }

  // ============================================================
  // SPRINT 5 ” MONITOR & HISTORY
  // ============================================================

  /**
   * Live board used by supervisors: every shift of the day,
   * with the derived attendance status and a per-status summary.
   */
  async monitor(userId: string) {
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, stationId: true },
    });
    if (!actor) {
      throw new NotFoundException('Compte introuvable');
    }
    if (
      actor.role !== Role.SUPERVISOR &&
      actor.role !== Role.ADMIN
    ) {
      throw new ForbiddenException(
        'Accès non autorisé au suivi des pointages.',
      );
    }

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000);

    const shifts = await this.prisma.shift.findMany({
      where: {
        ...(actor.stationId ? { stationId: actor.stationId } : {}),
        startTime: { gte: start, lt: end },
      },
      include: {
        station: {
          select: {
            id: true,
            name: true,
            timezone: true,
            latenessToleranceMinutes: true,
          },
        },
        swapper: { select: { id: true, fullName: true } },
        attendances: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { startTime: 'asc' },
    });

    const summary = {
      expected: 0,
      present: 0,
      late: 0,
      absent: 0,
      closed: 0,
      justified: 0,
    };

    const rows = shifts.map((shift) => {
      const record = shift.attendances[0];
      const status = this.mapStatus(record?.status);
      const key = status.toLowerCase() as keyof typeof summary;
      if (key in summary) summary[key] += 1;
      return {
        shiftId: shift.id,
        station: {
          id: shift.station.id,
          name: shift.station.name,
          timezone: shift.station.timezone,
        },
        swapper: {
          id: shift.swapper?.id ?? '',
          fullName: shift.swapper?.fullName ?? 'Poste vacant',
        },
        template: `${shift.startTime.toISOString().slice(11, 16)} “ ${shift.endTime
          .toISOString()
          .slice(11, 16)}`,
        startTime: shift.startTime.toISOString(),
        endTime: shift.endTime.toISOString(),
        status,
        checkedInAt: record?.checkInAt?.toISOString() ?? null,
        checkedOutAt: record?.checkOutAt?.toISOString() ?? null,
        isLate: status === 'LATE',
        justified: status === 'JUSTIFIED',
        toleranceMinutes: shift.station.latenessToleranceMinutes,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      stationId: actor.stationId ?? null,
      summary,
      rows,
    };
  }

  /**
   * Personal attendance history of the signed-in swapper, over an optional
   * [from, to] window.
   */
  async history(userId: string, from?: string, to?: string) {
    const fromDate = from
      ? new Date(from)
      : new Date(Date.now() - 30 * 86_400_000);
    const toDate = to ? new Date(to) : new Date(Date.now() + 7 * 86_400_000);

    const shifts = await this.prisma.shift.findMany({
      where: {
        swapperId: userId,
        startTime: { gte: fromDate, lte: toDate },
      },
      include: {
        station: { select: { id: true, name: true, timezone: true } },
        attendances: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { startTime: 'desc' },
    });

    return shifts.map((shift) => {
      const record = shift.attendances[0];
      const status = this.mapStatus(record?.status);
      const plannedHours =
        (shift.endTime.getTime() - shift.startTime.getTime()) / 3_600_000;
      return {
        shiftId: shift.id,
        station: {
          id: shift.station.id,
          name: shift.station.name,
          timezone: shift.station.timezone,
        },
        template: `${shift.startTime.toISOString().slice(11, 16)} – ${shift.endTime
          .toISOString()
          .slice(11, 16)}`,
        plannedStart: shift.startTime.toISOString(),
        plannedEnd: shift.endTime.toISOString(),
        plannedHours: Math.round(plannedHours * 10) / 10,
        // Statut brut : sans lui, l'écran ne pouvait pas distinguer un créneau
        // « en attente de pointage » (EXPECTED) d'un créneau « absent » (ABSENT)
        // et affichait les créneaux à venir comme absents ou déjà pointés.
        status,
        checkedInAt: record?.checkInAt?.toISOString() ?? null,
        checkedOutAt: record?.checkOutAt?.toISOString() ?? null,
        isLate: status === 'LATE',
        isAbsent: status === 'ABSENT',
        isJustified: status === 'JUSTIFIED',
        isExpected: status === 'EXPECTED',
        corrected: Boolean(record?.correctedAt),
        correctedAt: record?.correctedAt?.toISOString() ?? null,
        correctionReason: record?.absenceReason ?? null,
      };
    });
  }

  /** Maps the Prisma status onto the vocabulary the frontend displays. */
  private mapStatus(status?: AttendanceStatus | null): string {
    switch (status) {
      case 'CHECKED_IN':
        return 'PRESENT';
      case 'CHECKED_OUT':
        return 'CLOSED';
      case 'ABSENT':
        return 'ABSENT';
      case 'JUSTIFIED':
        return 'JUSTIFIED';
      default:
        return 'EXPECTED';
    }
  }
}
