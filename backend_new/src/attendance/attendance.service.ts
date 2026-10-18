import { Injectable } from '@nestjs/common';
import { Prisma, AttendanceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConstraintsService } from '../planning/constraints.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../common/scope.service';
import {
  ConflictDomain,
  ErrorCode,
  ForbiddenDomain,
  NotFoundDomain,
} from '../common/errors/domain-errors';
import { serializeCorrection } from '../common/serializers';
import { stationDayKey, stationIso } from '../common/utils/datetime';
import type { AuthenticatedUser } from '../common/guards/roles.guard';
import { NotificationKind } from '../notifications/categories';

/** Rayon terrestre moyen, en metres (formule de haversine). */
const EARTH_RADIUS_M = 6_371_000;

/** Tolerance apres la fin de service pour enregistrer le depart. */
const CHECKOUT_GRACE_MS = 5 * 60_000;

export interface PunchInput {
  shiftId: string;
  kind: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly constraints: ConstraintsService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Vue « espace de travail » : postes du jour pour l'agent            */
  /* ---------------------------------------------------------------- */

  /**
   * Postes a venir ou en cours de l'agent connecte, tels que l'ecran d'accueil
   * les consomme : station, georeperage, tolerance et statut de pointage.
   */
  async workspace(user: AuthenticatedUser, limit = 50) {
    const windowStart = new Date(Date.now() - 2 * 86_400_000);
    const now = new Date();

    const occurrences = await this.prisma.occurrence.findMany({
      where: {
        status: 'PUBLISHED',
        endTime: { gt: windowStart },
        assignments: { some: { userId: user.id } },
      },
      orderBy: { startTime: 'asc' },
      take: limit,
      include: {
        station: true,
        attendance: {
          include: { corrections: { orderBy: { createdAt: 'desc' }, take: 1 } },
        },
      },
    });

    return {
      station: null,
      limit,
      generatedAt: now.toISOString(),
      shifts: occurrences.map((occurrence) => ({
        id: occurrence.id,
        planningId: occurrence.planningId,
        templateId: occurrence.shiftTemplateId,
        label: occurrence.shiftLabel ?? `Service ${occurrence.startTime.toISOString().slice(11, 16)}`,
        startTime: occurrence.startTime.toISOString(),
        endTime: occurrence.endTime.toISOString(),
        breakStart: occurrence.breakStart,
        breakEnd: occurrence.breakEnd,
        publishedAt: null,
        station: {
          id: occurrence.station.id,
          name: occurrence.station.name,
          timezone: occurrence.station.timezone,
          latitude: occurrence.station.latitude,
          longitude: occurrence.station.longitude,
          geofenceRadiusMeters: occurrence.station.geofenceRadiusMeters,
          latenessToleranceMinutes:
            occurrence.latenessToleranceOverrideMinutes ??
            occurrence.station.latenessToleranceMinutes,
        },
        swapper: { fullName: user.fullName },
        attendance: occurrence.attendance
          ? {
              status: occurrence.attendance.status,
              // Le contrat frontend (`BackendWorkspace`) attend `checkInAt` /
              // `checkOutAt` : les autres orthographes laissent l'ecran croire
              // a une absence, car la lecture retombe sur `undefined`.
              checkInAt:
                occurrence.attendance.checkedInAt?.toISOString() ?? null,
              checkOutAt:
                occurrence.attendance.checkedOutAt?.toISOString() ?? null,
              isLate: occurrence.attendance.isLate,
              isAbsent: occurrence.attendance.status === 'ABSENT',
            }
          : null,
      })),
    };
  }

  /** Postes supervises : pointages du jour, pour l'ecran de suivi en direct. */
  async shiftsForSupervision(user: AuthenticatedUser) {
    const occurrences = await this.prisma.occurrence.findMany({
      where: {
        status: 'PUBLISHED',
        endTime: { gt: new Date(Date.now() - 2 * 86_400_000) },
      },
      orderBy: { startTime: 'asc' },
      include: {
        station: true,
        assignments: {
          include: { user: { select: { id: true, fullName: true } } },
        },
        attendance: true,
      },
    });

    return occurrences.map((occurrence) => {
      const primary = occurrence.assignments[0];
      return {
        id: occurrence.id,
        startTime: occurrence.startTime.toISOString(),
        endTime: occurrence.endTime.toISOString(),
        publishedAt: null,
        station: {
          id: occurrence.station.id,
          name: occurrence.station.name,
          timezone: occurrence.station.timezone,
          latenessToleranceMinutes:
            occurrence.latenessToleranceOverrideMinutes ??
            occurrence.station.latenessToleranceMinutes,
        },
        swapper: primary
          ? { id: primary.userId, fullName: primary.user.fullName }
          : null,
        templateVersion: { label: occurrence.shiftLabel },
        attendance: occurrence.attendance
          ? {
              checkedInAt: occurrence.attendance.checkedInAt?.toISOString() ?? null,
              checkedOutAt: occurrence.attendance.checkedOutAt?.toISOString() ?? null,
              isLate: occurrence.attendance.isLate,
              isAbsent: occurrence.attendance.status === 'ABSENT',
            }
          : null,
      };
    });
  }

  /* ---------------------------------------------------------------- */
  /* Pointage                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Prise ou fin de service.
   *
   * Trois verifications avant d'ecrire quoi que ce soit :
   * 1. le poste est publie et effectivement attribue a l'agent ;
   * 2. la station expose des coordonnees exploitables ;
   * 3. la position transmise est compatible avec le perimetre autorise,
   *    en tenant compte de la precision GPS annoncee par l'appareil.
   */
  async punch(user: AuthenticatedUser, input: PunchInput) {
    const kind = (input.kind ?? '').toUpperCase();
    if (kind !== 'CHECKIN' && kind !== 'CHECKOUT') {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Choisissez une prise ou une fin de service valide.',
        400,
      );
    }
    if (
      !Number.isFinite(input.latitude) ||
      input.latitude < -90 ||
      input.latitude > 90 ||
      !Number.isFinite(input.longitude) ||
      input.longitude < -180 ||
      input.longitude > 180
    ) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        "La position n'a pas pu être vérifiée. Autorisez la localisation puis réessayez.",
        400,
      );
    }

    const occurrence = await this.prisma.occurrence.findUnique({
      where: { id: input.shiftId },
      include: {
        station: true,
        assignments: true,
        planning: { select: { status: true } },
      },
    });
    if (!occurrence) {
      throw new NotFoundDomain(ErrorCode.NOT_FOUND, 'Affectation introuvable.');
    }
    const assigned = occurrence.assignments.some((a) => a.userId === user.id);
    if (occurrence.status !== 'PUBLISHED' || !assigned) {
      throw new ForbiddenDomain(
        'SHIFT_NOT_ASSIGNED',
        'Ce shift publié ne vous est pas affecté.',
      );
    }

    const station = occurrence.station;
    if (
      station.latitude === null ||
      station.longitude === null ||
      !Number.isFinite(station.latitude) ||
      !Number.isFinite(station.longitude)
    ) {
      throw new ConflictDomain(
        'GEOFENCE_NOT_CONFIGURED',
        'La position de cette station n’est pas configurée. Contactez le superviseur.',
        409,
      );
    }

    const distanceMeters = this.haversine(
      station.latitude,
      station.longitude,
      input.latitude,
      input.longitude,
    );
    const radius = station.geofenceRadiusMeters;
    const accuracy = Number.isFinite(input.accuracyMeters)
      ? input.accuracyMeters
      : 0;
    if (!Number.isFinite(radius) || radius < 0) {
      throw new ConflictDomain(
        'GEOFENCE_INVALID',
        'Le périmètre de pointage de cette station est invalide. Contactez le superviseur.',
        409,
      );
    }
    if (radius > 0 && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > radius)) {
      throw new ConflictDomain(
        'GPS_INACCURATE',
        'Votre position manque de précision pour vérifier le périmètre. Réessayez avec le GPS activé.',
        409,
      );
    }
    if (radius > 0 && distanceMeters + accuracy > radius) {
      throw new ForbiddenDomain(
        ErrorCode.GEO_OUT_OF_RANGE,
        `Pointage refusé : votre position est estimée à ${distanceMeters} m de ${station.name} ; le périmètre autorisé est de ${radius} m et la précision GPS ne permet pas de confirmer que vous êtes dedans.`,
      );
    }

    const start = occurrence.startTime.getTime();
    const end = occurrence.endTime.getTime();
    const now = Date.now();
    const tolerance =
      occurrence.latenessToleranceOverrideMinutes ??
      station.latenessToleranceMinutes;
    const existing = await this.prisma.attendance.findUnique({
      where: { shiftId: occurrence.id },
    });

    if (kind === 'CHECKIN') {
      if (now < start || now > end) {
        throw new ConflictDomain(
          'OUTSIDE_SHIFT_WINDOW',
          'La prise de service est possible uniquement pendant le créneau prévu.',
          409,
        );
      }
      if (existing?.checkedInAt) {
        throw new ConflictDomain(
          'ALREADY_CHECKED_IN',
          'La prise de service est déjà enregistrée pour ce shift.',
          409,
        );
      }
      const late = now > start + tolerance * 60_000;
      const record = await this.prisma.attendance.upsert({
        where: { shiftId: occurrence.id },
        create: {
          shiftId: occurrence.id,
          swapperId: user.id,
          status: late ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
          checkedInAt: new Date(now),
          isLate: late,
        },
        update: {
          swapperId: user.id,
          status: late ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
          checkedInAt: new Date(now),
          isLate: late,
        },
      });

      // Un pointage efface l'absence automatique en attente.
      await this.prisma.absence.deleteMany({
        where: {
          shiftId: occurrence.id,
          origin: 'AUTOMATIC_ABSENCE',
          status: 'OPEN',
        },
      });
      await this.prisma.automatedAbsence.deleteMany({
        where: { shiftId: occurrence.id },
      });

      await this.notifications.notifyStaff([user.id], {
        kind: NotificationKind.CHECKIN,
        title: 'Prise de service enregistrée',
        body: `${user.fullName} · ${occurrence.shiftLabel ?? 'Service'} (${late ? 'en retard' : "à l'heure"}).`,
        targetId: occurrence.id,
        targetUrl: '/pointages',
      });
      await this.audit.record({
        actorId: user.id,
        action: late ? 'CHECKIN_LATE' : 'CHECKIN',
        targetType: 'Occurrence',
        targetId: occurrence.id,
        stationId: occurrence.stationId,
        metadata: { distanceMeters, accuracy, latitude: input.latitude },
      });

      return {
        kind,
        status: record.status,
        checkedInAt: record.checkedInAt?.toISOString() ?? null,
        toleranceMinutes: tolerance,
        timezone: station.timezone,
        distanceMeters,
      };
    }

    // CHECKOUT
    if (!existing?.checkedInAt) {
      throw new ConflictDomain(
        'CHECKIN_REQUIRED',
        'La fin de service nécessite une prise de service enregistrée.',
        409,
      );
    }
    if (existing.checkedOutAt) {
      throw new ConflictDomain(
        'ALREADY_CHECKED_OUT',
        'La fin de service est déjà enregistrée.',
        409,
      );
    }
    if (now > end + CHECKOUT_GRACE_MS) {
      throw new ConflictDomain(
        'CHECKOUT_WINDOW_CLOSED',
        'La fenêtre de fin de service est dépassée. Le superviseur peut corriger le pointage.',
        409,
      );
    }

    const record = await this.prisma.attendance.update({
      where: { shiftId: occurrence.id },
      data: {
        checkedOutAt: new Date(now),
        status: AttendanceStatus.CLOSED,
      },
    });

    await this.notifications.notifyStaff([user.id], {
      kind: NotificationKind.CHECKOUT,
      title: 'Fin de service enregistrée',
      body: `${user.fullName} · ${occurrence.shiftLabel ?? 'Service'}.`,
      targetId: occurrence.id,
      targetUrl: '/pointages',
    });
    await this.audit.record({
      actorId: user.id,
      action: 'CHECKOUT',
      targetType: 'Occurrence',
      targetId: occurrence.id,
      stationId: occurrence.stationId,
      metadata: { distanceMeters, accuracy },
    });

    return {
      kind,
      status: AttendanceStatus.CLOSED,
      checkedInAt: record.checkedInAt?.toISOString() ?? null,
      checkedOutAt: record.checkedOutAt?.toISOString() ?? null,
      toleranceMinutes: tolerance,
      timezone: station.timezone,
      distanceMeters,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Historique et suivi                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Releve des pointages passes. Un agent ne voit que les siens (US 2040),
   * un superviseur voit l'ensemble de son perimetre.
   */
  async history(
    user: AuthenticatedUser,
    params: { from?: string; to?: string } = {},
  ) {
    const isSwapper = user.role === 'SWAPPER';
    const from = params.from
      ? new Date(params.from)
      : isSwapper
        ? new Date(Date.now() - 30 * 86_400_000)
        : undefined;
    const to = params.to
      ? new Date(params.to)
      : isSwapper
        ? new Date(Date.now() + 7 * 86_400_000)
        : undefined;

    const occurrences = await this.prisma.occurrence.findMany({
      where: {
        status: 'PUBLISHED',
        ...(isSwapper
          ? { assignments: { some: { userId: user.id } } }
          : {}),
        ...(from || to
          ? {
              startTime: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      orderBy: { startTime: 'desc' },
      include: {
        station: { select: { id: true, name: true, timezone: true } },
        attendance: {
          include: { corrections: { orderBy: { createdAt: 'desc' }, take: 1 } },
        },
        absences: { where: { status: 'OPEN' } },
      },
    });

    return occurrences.map((occurrence) => {
      const record = occurrence.attendance;
      const status = record?.status ?? (occurrence.absences.length ? 'ABSENT' : 'EXPECTED');
      const correction = record?.corrections[0];
      const planned =
        (occurrence.endTime.getTime() - occurrence.startTime.getTime()) / 3_600_000;
      return {
        shiftId: occurrence.id,
        station: {
          id: occurrence.station.id,
          name: occurrence.station.name,
          timezone: occurrence.station.timezone,
        },
        template: occurrence.shiftLabel,
        plannedStart: occurrence.startTime.toISOString(),
        plannedEnd: occurrence.endTime.toISOString(),
        plannedHours:
          Math.round((planned - occurrence.breakMinutes / 60) * 100) / 100,
        checkedInAt: record?.checkedInAt?.toISOString() ?? null,
        checkedOutAt: record?.checkedOutAt?.toISOString() ?? null,
        isLate: record?.isLate ?? false,
        isAbsent: status === 'ABSENT',
        isJustified: status === 'JUSTIFIED',
        corrected: Boolean(correction),
        correctedAt: correction?.createdAt.toISOString() ?? null,
        correctionReason: correction?.reason ?? null,
      };
    });
  }

  /** Suivi du jour : toutes les personnes attendues, avec leur statut. */
  async monitor(user: AuthenticatedUser) {
    const today = stationDayKey(Date.now());
    const bounds = {
      start: new Date(stationIso(today, '00:00')),
      end: new Date(stationIso(today, '23:59')),
    };

    const occurrences = await this.prisma.occurrence.findMany({
      where: {
        status: 'PUBLISHED',
        startTime: { gte: bounds.start, lte: bounds.end },
        assignments: { some: {} },
      },
      orderBy: { startTime: 'asc' },
      include: {
        station: { select: { id: true, name: true, timezone: true, latenessToleranceMinutes: true } },
        assignments: { include: { user: { select: { id: true, fullName: true } } } },
        attendance: { include: { corrections: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        absences: { where: { status: 'OPEN' } },
      },
    });

    const rows = occurrences.flatMap((occurrence) =>
      occurrence.assignments.map((assignment) => {
        const record = occurrence.attendance;
        const status =
          record?.status ?? (occurrence.absences.length ? 'ABSENT' : 'EXPECTED');
        return {
          shiftId: occurrence.id,
          station: {
            id: occurrence.station.id,
            name: occurrence.station.name,
            timezone: occurrence.station.timezone,
          },
          swapper: { id: assignment.userId, fullName: assignment.user.fullName },
          template: occurrence.shiftLabel,
          startTime: occurrence.startTime.toISOString(),
          endTime: occurrence.endTime.toISOString(),
          status,
          checkedInAt: record?.checkedInAt?.toISOString() ?? null,
          checkedOutAt: record?.checkedOutAt?.toISOString() ?? null,
          isLate: record?.isLate ?? false,
          justified: status === 'JUSTIFIED',
          toleranceMinutes:
            occurrence.latenessToleranceOverrideMinutes ??
            occurrence.station.latenessToleranceMinutes,
        };
      }),
    );

    const summary = {
      expected: 0,
      present: 0,
      late: 0,
      absent: 0,
      closed: 0,
      justified: 0,
    };
    for (const row of rows) {
      if (row.status === 'EXPECTED') summary.expected += 1;
      else if (row.status === 'PRESENT') summary.present += 1;
      else if (row.status === 'LATE') summary.late += 1;
      else if (row.status === 'ABSENT') summary.absent += 1;
      else if (row.status === 'CLOSED') summary.closed += 1;
      else if (row.status === 'JUSTIFIED') summary.justified += 1;
    }

    return {
      generatedAt: new Date().toISOString(),
      stationId: null,
      summary,
      rows,
    };
  }

  /** Pointages bruts filtrables, consommes par les rapports. */
  async records(user: AuthenticatedUser, params: { stationId?: string } = {}) {
    const rows = await this.prisma.occurrence.findMany({
      where: {
        status: 'PUBLISHED',
        startTime: { lte: new Date() },
        assignments: { some: {} },
        ...(params.stationId ? { stationId: params.stationId } : {}),
      },
      orderBy: { startTime: 'desc' },
      include: {
        station: { select: { id: true, name: true, timezone: true, latenessToleranceMinutes: true } },
        assignments: { include: { user: { select: { id: true, fullName: true } } } },
        attendance: { include: { corrections: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        absences: { where: { status: 'OPEN' } },
      },
    });

    return rows.flatMap((occurrence) =>
      occurrence.assignments.map((assignment) => {
        const record = occurrence.attendance;
        const correction = record?.corrections[0];
        const status =
          record?.status ?? (occurrence.absences.length ? 'ABSENT' : 'EXPECTED');
        return {
          id: `attendance-${occurrence.id}-${assignment.userId}`,
          shiftId: occurrence.id,
          status,
          checkInAt: record?.checkedInAt?.toISOString() ?? null,
          checkOutAt: record?.checkedOutAt?.toISOString() ?? null,
          isLate: record?.isLate ?? false,
          correctedAt: correction?.createdAt.toISOString() ?? null,
          correctionReason: correction?.reason ?? null,
          station: {
            id: occurrence.station.id,
            name: occurrence.station.name,
            timezone: occurrence.station.timezone,
            latenessToleranceMinutes:
              occurrence.latenessToleranceOverrideMinutes ??
              occurrence.station.latenessToleranceMinutes,
          },
          swapper: { id: assignment.userId, fullName: assignment.user.fullName },
          shift: {
            startTime: occurrence.startTime.toISOString(),
            endTime: occurrence.endTime.toISOString(),
            template: { label: occurrence.shiftLabel },
            station: {
              id: occurrence.station.id,
              name: occurrence.station.name,
              timezone: occurrence.station.timezone,
              latenessToleranceMinutes:
                occurrence.latenessToleranceOverrideMinutes ??
                occurrence.station.latenessToleranceMinutes,
            },
            swapper: { id: assignment.userId, fullName: assignment.user.fullName },
          },
        };
      }),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Corrections superviseur (US 2045)                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Correction manuelle d'un pointage. Le motif est obligatoire et la valeur
   * precedente est conservee, afin que la modification reste auditable.
   */
  async correct(
    user: AuthenticatedUser,
    shiftId: string,
    payload: {
      reason: string;
      attachmentId?: string | null;
      checkedInAt?: string | null;
      checkedOutAt?: string | null;
      isLate?: boolean;
      isAbsent?: boolean;
      isJustified?: boolean;
    },
  ) {
    const reason = (payload.reason ?? '').trim();
    if (reason.length < 5) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Le motif de correction est obligatoire (5 caractères minimum).',
        400,
      );
    }

    const occurrence = await this.prisma.occurrence.findUnique({
      where: { id: shiftId },
      include: { assignments: true },
    });
    if (!occurrence) {
      throw new NotFoundDomain(ErrorCode.NOT_FOUND, 'Affectation introuvable.');
    }
    const swapperId = occurrence.assignments[0]?.userId ?? null;
    if (!swapperId) {
      throw new ConflictDomain(
        'SHIFT_WITHOUT_ASSIGNEE',
        "Ce poste n'a pas d'agent à corriger.",
        409,
      );
    }

    // Une absence justifiee est un statut distinct de l'absence constatee :
    // elle informe sans penaliser le decompte de presence.
    const confessedAbsent = payload.isJustified === true || payload.isAbsent === true;
    const checkedInAt = confessedAbsent
      ? null
      : payload.checkedInAt
        ? new Date(payload.checkedInAt)
        : null;
    const checkedOutAt = confessedAbsent
      ? null
      : payload.checkedOutAt
        ? new Date(payload.checkedOutAt)
        : null;

    if (checkedInAt && checkedOutAt && checkedOutAt <= checkedInAt) {
      throw new ConflictDomain(
        'INVALID_SEQUENCE',
        'La fin de service doit suivre la prise de service.',
        400,
      );
    }
    if (!confessedAbsent && !checkedInAt) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        "Indiquez l'heure de prise de service ou un statut d'absence.",
        400,
      );
    }

    const status = payload.isJustified
      ? AttendanceStatus.JUSTIFIED
      : confessedAbsent
        ? AttendanceStatus.ABSENT
        : checkedOutAt
          ? AttendanceStatus.CLOSED
          : payload.isLate === true
            ? AttendanceStatus.LATE
            : AttendanceStatus.PRESENT;

    const existing = await this.prisma.attendance.findUnique({
      where: { shiftId },
    });
    const before = existing
      ? {
          status: existing.status,
          checkedInAt: existing.checkedInAt?.toISOString() ?? null,
          checkedOutAt: existing.checkedOutAt?.toISOString() ?? null,
          isLate: existing.isLate,
        }
      : { status: 'ABSENT', checkedInAt: null, checkedOutAt: null, isLate: false };

    const after = {
      status,
      checkedInAt: checkedInAt?.toISOString() ?? null,
      checkedOutAt: checkedOutAt?.toISOString() ?? null,
      isLate: !confessedAbsent && payload.isLate === true,
    };

    const result = await this.prisma.$transaction(async (tx) => {
      const record = existing
        ? await tx.attendance.update({
            where: { shiftId },
            data: {
              status,
              checkedInAt,
              checkedOutAt,
              isLate: after.isLate,
              justified: payload.isJustified === true,
              swapperId,
            },
          })
        : await tx.attendance.create({
            data: {
              shiftId,
              swapperId,
              status,
              checkedInAt,
              checkedOutAt,
              isLate: after.isLate,
              justified: payload.isJustified === true,
            },
          });

      const correction = await tx.attendanceCorrection.create({
        data: {
          attendanceId: record.id,
          reason,
          attachmentId: payload.attachmentId ?? null,
          authorId: user.id,
          authorName: user.fullName,
          before: JSON.stringify(before),
          after: JSON.stringify(after),
        },
      });

      if (payload.isJustified) {
        await tx.absence.updateMany({
          where: { shiftId, status: 'OPEN' },
          data: { status: 'COVERED', coveredBy: null },
        });
      }

      return correction;
    });

    await this.notifications.notifyStaff([swapperId], {
      kind: NotificationKind.CORRECTION,
      title: payload.isJustified
        ? 'Absence requalifiée en justifiée'
        : 'Pointage corrigé',
      body: `${occurrence.shiftLabel ?? 'Service'} : ${reason}`,
      targetId: shiftId,
      targetUrl: '/pointages',
      critical: true,
    });
    await this.audit.record({
      actorId: user.id,
      action: 'ATTENDANCE_CORRECTED',
      targetType: 'Occurrence',
      targetId: shiftId,
      stationId: occurrence.stationId,
      metadata: { before, after, reason },
    });

    return {
      ok: true,
      status,
      correction: serializeCorrection(result),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Interne                                                           */
  /* ---------------------------------------------------------------- */

  /** Distance en metres entre deux points (formule de haversine). */
  private haversine(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const radians = (degrees: number) => (degrees * Math.PI) / 180;
    const deltaLat = radians(lat2 - lat1);
    const deltaLng = radians(lon2 - lon1);
    const a = Math.min(
      1,
      Math.max(
        0,
        Math.sin(deltaLat / 2) ** 2 +
          Math.cos(radians(lat1)) *
            Math.cos(radians(lat2)) *
            Math.sin(deltaLng / 2) ** 2,
      ),
    );
    return Math.round(EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  /** Verification de disponibilite, exposee pour l'ecran d'affectation. */
  async validateShift(payload: {
    stationId: string;
    swapperId: string;
    startTime: string;
    endTime: string;
  }) {
    const hours =
      Math.round(
        ((Date.parse(payload.endTime) - Date.parse(payload.startTime)) /
          3_600_000) *
          100,
      ) / 100;
    return this.constraints.report({
      stationId: payload.stationId,
      swapperId: payload.swapperId,
      startTime: payload.startTime,
      endTime: payload.endTime,
      hours,
    });
  }
}

/** Type partage par les rapports qui agregoent les pointages. */
export type AttendanceRow = Prisma.AttendanceGetPayload<{
  include: { corrections: true };
}>;
