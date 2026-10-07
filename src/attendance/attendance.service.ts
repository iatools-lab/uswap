import {
  AttendanceQrType,
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
import { createHash, randomBytes } from 'crypto';

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
  // GENERATE ATTENDANCE QR
  // ============================================================

  async generateQr(
    shiftId: string,
    stationId: string,
    generatedById: string,
    type: AttendanceQrType,
  ) {
    const generator = await this.prisma.user.findUnique({
      where: {
        id: generatedById,
      },
      select: {
        id: true,
        role: true,
        isActive: true,
        stationId: true,
        stationScopes: {
          select: {
            stationId: true,
          },
        },
      },
    });

    if (!generator) {
      throw new UnauthorizedException('User account not found.');
    }

    if (!generator.isActive) {
      throw new UnauthorizedException('Your account is inactive.');
    }

    if (
      generator.role !== Role.SUPERVISOR &&
      generator.role !== Role.STATION_CHIEF
    ) {
      throw new UnauthorizedException(
        'Only a supervisor or station chief can generate attendance QR codes.',
      );
    }

    // ------------------------------------------------------------
    // STATION CHIEF CAN ONLY GENERATE QR FOR THEIR OWN STATION
    // ------------------------------------------------------------

    if (generator.role === Role.STATION_CHIEF) {
      if (!generator.stationId) {
        throw new UnauthorizedException(
          'This station chief is not assigned to a station.',
        );
      }

      if (generator.stationId !== stationId) {
        throw new UnauthorizedException(
          'A station chief can only generate QR codes for their own station.',
        );
      }
    }

    // ------------------------------------------------------------
    // SUPERVISOR STATION ACCESS
    // ------------------------------------------------------------

    if (generator.role === Role.SUPERVISOR) {
      const hasStationAccess =
        generator.stationId === stationId ||
        generator.stationScopes.some((scope) => scope.stationId === stationId);

      if (!hasStationAccess) {
        throw new UnauthorizedException(
          'You do not have access to this station.',
        );
      }
    }

    const shift = await this.prisma.shift.findUnique({
      where: {
        id: shiftId,
      },
      include: {
        planning: {
          select: {
            id: true,
            status: true,
            startDate: true,
            endDate: true,
          },
        },
      },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found.');
    }

    if (shift.stationId !== stationId) {
      throw new BadRequestException(
        'This shift does not belong to the selected station.',
      );
    }

    if (!shift.planning) {
      throw new BadRequestException('The shift is not attached to a planning.');
    }

    if (shift.planning.status !== PlanningStatus.PUBLISHED) {
      throw new BadRequestException(
        'Attendance QR codes can only be generated for a published planning.',
      );
    }

    const station = await this.prisma.station.findUnique({
      where: {
        id: stationId,
      },
      select: {
        id: true,
        isActive: true,
        checkinQrTtl: true,
        checkoutQrTtl: true,
      },
    });

    if (!station) {
      throw new NotFoundException('Station not found.');
    }

    if (!station.isActive) {
      throw new BadRequestException('The selected station is inactive.');
    }

    const qrTtl =
      type === AttendanceQrType.START
        ? station.checkinQrTtl
        : station.checkoutQrTtl;

    if (!Number.isInteger(qrTtl) || qrTtl <= 0) {
      throw new BadRequestException(
        'The QR validity duration configured for this station is invalid.',
      );
    }

    const rawToken = randomBytes(32).toString('hex');

    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const expiresAt = new Date(Date.now() + qrTtl * 1000);

    const qr = await this.prisma.attendanceQr.create({
      data: {
        stationId,
        shiftId,
        type,
        tokenHash,
        expiresAt,
        createdById: generatedById,
      },
    });

    return {
      id: qr.id,
      token: rawToken,
      type: qr.type,
      shiftId: qr.shiftId,
      stationId: qr.stationId,
      expiresAt: qr.expiresAt,
      ttlSeconds: qrTtl,
    };
  }

  // ============================================================
  // CHECK IN
  // ============================================================

  // ============================================================
  // GPS PUNCH (v5.3)
  // Pointage par géolocalisation, sans QR : le swappeur envoie sa position
  // pendant le créneau, le service vérifie le périmètre de la station.
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
      if (now < shift.startTime || now > shift.endTime) {
        throw new BadRequestException(
          'La prise de service est possible uniquement pendant le créneau prévu.',
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

  async checkIn(
    token: string,
    swapperId: string,
    shiftId: string,
    stationId: string,
    latitude?: number,
    longitude?: number,
  ) {
    if (!token) {
      throw new BadRequestException('Attendance QR token is required.');
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');

    const qr = await this.prisma.attendanceQr.findUnique({
      where: {
        tokenHash,
      },
    });

    if (!qr) {
      throw new BadRequestException('Invalid attendance QR code.');
    }

    if (qr.type !== AttendanceQrType.START) {
      throw new BadRequestException('This QR code is not a check-in QR code.');
    }

    if (qr.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This attendance QR code has expired.');
    }

    if (qr.usedAt) {
      throw new BadRequestException(
        'This attendance QR code has already been used.',
      );
    }

    if (qr.shiftId !== shiftId || qr.stationId !== stationId) {
      throw new BadRequestException(
        'This QR code does not belong to the selected shift and station.',
      );
    }

    const swapper = await this.prisma.user.findUnique({
      where: {
        id: swapperId,
      },
      select: {
        id: true,
        fullName: true,
        role: true,
        isActive: true,
      },
    });

    if (!swapper) {
      throw new UnauthorizedException('Swapper account not found.');
    }

    if (!swapper.isActive || swapper.role !== Role.SWAPPER) {
      throw new UnauthorizedException('Only an active swapper can check in.');
    }

    const attendance = await this.prisma.attendance.findUnique({
      where: {
        shiftId_swapperId: {
          shiftId,
          swapperId,
        },
      },
    });

    if (!attendance) {
      throw new BadRequestException(
        'No attendance record exists for this swapper and shift.',
      );
    }

    if (attendance.stationId !== stationId) {
      throw new BadRequestException(
        'The attendance record does not belong to this station.',
      );
    }

    if (attendance.status === AttendanceStatus.CHECKED_IN) {
      throw new BadRequestException('This swapper is already checked in.');
    }

    if (attendance.status === AttendanceStatus.CHECKED_OUT) {
      throw new BadRequestException(
        'This attendance record has already been completed.',
      );
    }

    if (attendance.status === AttendanceStatus.ABSENT) {
      throw new BadRequestException(
        'This attendance has already been marked as absent.',
      );
    }

    if (attendance.status === AttendanceStatus.JUSTIFIED) {
      throw new BadRequestException(
        'This attendance record is a legacy justified record and cannot be checked in again.',
      );
    }

    const station = await this.prisma.station.findUnique({
      where: {
        id: stationId,
      },
      select: {
        latenessToleranceMinutes: true,
      },
    });

    if (!station) {
      throw new NotFoundException('Station not found.');
    }

    const shift = await this.prisma.shift.findUnique({
      where: {
        id: shiftId,
      },
      select: {
        startTime: true,
      },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found.');
    }

    const now = new Date();

    const toleranceMs = station.latenessToleranceMinutes * 60 * 1000;

    const allowedStartTime = shift.startTime.getTime() + toleranceMs;

    const isLate = now.getTime() > allowedStartTime;

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedAttendance = await tx.attendance.update({
        where: {
          id: attendance.id,
        },
        data: {
          status: AttendanceStatus.CHECKED_IN,
          checkInAt: now,
          checkInLatitude: latitude,
          checkInLongitude: longitude,
        },
      });

      await tx.attendanceQr.update({
        where: {
          id: qr.id,
        },
        data: {
          usedAt: now,
        },
      });

      return updatedAttendance;
    });

    return {
      message: 'Check-in successful',
      punctuality: isLate ? 'LATE' : 'ON_TIME',
      attendance: result,
    };
  }

  // ============================================================
  // CHECK OUT
  // ============================================================

  async checkOut(
    token: string,
    swapperId: string,
    shiftId: string,
    stationId: string,
    latitude?: number,
    longitude?: number,
  ) {
    if (!token) {
      throw new BadRequestException('Attendance QR token is required.');
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');

    const qr = await this.prisma.attendanceQr.findUnique({
      where: {
        tokenHash,
      },
    });

    if (!qr) {
      throw new BadRequestException('Invalid attendance QR code.');
    }

    if (qr.type !== AttendanceQrType.END) {
      throw new BadRequestException('This QR code is not a check-out QR code.');
    }

    if (qr.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This attendance QR code has expired.');
    }

    if (qr.usedAt) {
      throw new BadRequestException(
        'This attendance QR code has already been used.',
      );
    }

    if (qr.shiftId !== shiftId || qr.stationId !== stationId) {
      throw new BadRequestException(
        'This QR code does not belong to the selected shift and station.',
      );
    }

    const swapper = await this.prisma.user.findUnique({
      where: {
        id: swapperId,
      },
      select: {
        id: true,
        fullName: true,
        role: true,
        isActive: true,
      },
    });

    if (!swapper) {
      throw new UnauthorizedException('Swapper account not found.');
    }

    if (!swapper.isActive || swapper.role !== Role.SWAPPER) {
      throw new UnauthorizedException('Only an active swapper can check out.');
    }

    const attendance = await this.prisma.attendance.findUnique({
      where: {
        shiftId_swapperId: {
          shiftId,
          swapperId,
        },
      },
    });

    if (!attendance) {
      throw new BadRequestException(
        'No attendance record exists for this swapper and shift.',
      );
    }

    if (attendance.stationId !== stationId) {
      throw new BadRequestException(
        'The attendance record does not belong to this station.',
      );
    }

    if (attendance.status === AttendanceStatus.CHECKED_OUT) {
      throw new BadRequestException('This swapper has already checked out.');
    }

    if (attendance.status === AttendanceStatus.ABSENT) {
      throw new BadRequestException(
        'This attendance has already been marked as absent.',
      );
    }

    if (attendance.status === AttendanceStatus.JUSTIFIED) {
      throw new BadRequestException(
        'This attendance record is a legacy justified record and cannot be checked out.',
      );
    }

    // ------------------------------------------------------------
    // END WITHOUT START
    // ------------------------------------------------------------

    if (attendance.status === AttendanceStatus.EXPECTED) {
      const now = new Date();

      await this.prisma.$transaction(async (tx) => {
        await tx.attendance.update({
          where: {
            id: attendance.id,
          },
          data: {
            status: AttendanceStatus.ABSENT,
            absenceReason:
              'Check-out was attempted without a recorded check-in.',
          },
        });

        await tx.attendanceQr.update({
          where: {
            id: qr.id,
          },
          data: {
            usedAt: now,
          },
        });
      });

      throw new BadRequestException({
        message:
          'Check-out cannot be recorded because no check-in was recorded. Attendance has been marked ABSENT.',
        code: 'ABSENT_NO_CHECKIN',
      });
    }

    if (attendance.status !== AttendanceStatus.CHECKED_IN) {
      throw new BadRequestException(
        'Check-in must be completed before check-out.',
      );
    }

    // ------------------------------------------------------------
    // CHECK IF THE END OF THE SHIFT + TOLERANCE HAS PASSED
    // ------------------------------------------------------------

    const station = await this.prisma.station.findUnique({
      where: {
        id: stationId,
      },
      select: {
        latenessToleranceMinutes: true,
      },
    });

    if (!station) {
      throw new NotFoundException('Station not found.');
    }

    const shift = await this.prisma.shift.findUnique({
      where: {
        id: shiftId,
      },
      select: {
        endTime: true,
      },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found.');
    }

    const now = new Date();

    const toleranceMs = station.latenessToleranceMinutes * 60 * 1000;

    const absenceDeadline = shift.endTime.getTime() + toleranceMs;

    if (now.getTime() > absenceDeadline) {
      await this.prisma.$transaction(async (tx) => {
        await tx.attendance.update({
          where: {
            id: attendance.id,
          },
          data: {
            status: AttendanceStatus.ABSENT,
            absenceReason: 'No check-out was recorded before the shift ended.',
          },
        });

        await tx.attendanceQr.update({
          where: {
            id: qr.id,
          },
          data: {
            usedAt: now,
          },
        });
      });

      throw new BadRequestException({
        message:
          'The check-out was not recorded before the allowed shift end time. Attendance has been marked ABSENT.',
        code: 'ABSENT_NO_CHECKOUT',
      });
    }

    // ------------------------------------------------------------
    // NORMAL CHECK OUT
    // ------------------------------------------------------------

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedAttendance = await tx.attendance.update({
        where: {
          id: attendance.id,
        },
        data: {
          status: AttendanceStatus.CHECKED_OUT,
          checkOutAt: now,
          checkOutLatitude: latitude,
          checkOutLongitude: longitude,
        },
      });

      await tx.attendanceQr.update({
        where: {
          id: qr.id,
        },
        data: {
          usedAt: now,
        },
      });

      return updatedAttendance;
    });

    return {
      message: 'Check-out successful',
      attendance: result,
    };
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
  // SPRINT 5 — MONITOR & HISTORY
  // ============================================================

  /**
   * Live board used by supervisors and station chiefs: every shift of the day,
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
      actor.role !== Role.STATION_CHIEF &&
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
        template: `${shift.startTime.toISOString().slice(11, 16)} – ${shift.endTime
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
        checkedInAt: record?.checkInAt?.toISOString() ?? null,
        checkedOutAt: record?.checkOutAt?.toISOString() ?? null,
        isLate: status === 'LATE',
        isAbsent: status === 'ABSENT',
        isJustified: status === 'JUSTIFIED',
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
