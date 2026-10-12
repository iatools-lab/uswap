import { Injectable } from '@nestjs/common';
import type { Occurrence, Station } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ErrorCode,
  NotFoundDomain,
} from '../common/errors/domain-errors';
import {
  durationHours,
  stationDayKey,
  weekKeyOf,
  addDaysKey,
} from '../common/utils/datetime';

export interface ConstraintIssue {
  code: string;
  message: string;
}

export interface ConstraintWeek {
  startDate: string;
  existingHours: number;
  addedHours: number;
  projectedHours: number;
  limitHours: number;
}

export interface ConstraintReport {
  valid: boolean;
  stationName: string;
  timezone: string;
  durationHours: number;
  weeks: ConstraintWeek[];
  errors: ConstraintIssue[];
  warnings: ConstraintIssue[];
}

export interface ConstraintInput {
  stationId: string;
  swapperId: string;
  startTime: string;
  endTime: string;
  hours: number;
  /** Poste en cours de modification : ignore dans les controles de chevauchement. */
  ignoreOccurrenceId?: string;
}

/**
 * Controles d'affectation (US 2042, 2043).
 *
 * Un `ConstraintReport` est renvoye tel quel par `/shifts/validate`,
 * `/plannings/:id/occurrences/:occ/validate` et consomme par l'ecran
 * d'affectation pour afficher les erreurs bloquantes et les avertissements.
 */
@Injectable()
export class ConstraintsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(input: ConstraintInput): Promise<ConstraintReport> {
    const station = await this.prisma.station.findUnique({
      where: { id: input.stationId },
    });
    if (!station) {
      return this.emptyReport(input);
    }
    const swapper = await this.prisma.user.findUnique({
      where: { id: input.swapperId },
    });

    const start = Date.parse(input.startTime);
    const end = Date.parse(input.endTime);
    const errors: ConstraintIssue[] = [];
    const warnings: ConstraintIssue[] = [];
    const hour = (from: number): string =>
      new Date(from).toLocaleString('fr-FR', {
        timeZone: station.timezone,
        dateStyle: 'short',
        timeStyle: 'short',
      });

    if (!(end > start)) {
      errors.push({
        code: 'INVALID_WINDOW',
        message: 'La fin du service doit être postérieure à son début.',
      });
    }
    if (!swapper) {
      errors.push({ code: 'SWAPPER_INVALID', message: 'Agent inconnu.' });
    } else if (swapper.role !== 'SWAPPER') {
      errors.push({
        code: 'SWAPPER_ROLE',
        message: "Ce compte n'est pas un agent.",
      });
    } else if (!swapper.isActive || swapper.disabledAt) {
      errors.push({
        code: 'SWAPPER_INACTIVE',
        message: 'Cet agent est désactivé.',
      });
    }
    if (swapper && swapper.stationId !== station.id) {
      const homeStation = swapper.stationId
        ? await this.prisma.station.findUnique({
            where: { id: swapper.stationId },
            select: { name: true },
          })
        : null;
      warnings.push({
        code: 'CROSS_STATION',
        message: `Ce collaborateur n’est pas rattaché à ${station.name}${
          homeStation ? ` ; sa station principale est ${homeStation.name}` : ''
        }. Il peut être affecté ici comme renfort ponctuel.`,
      });
    }
    if (!station.isActive) {
      errors.push({
        code: 'STATION_CLOSED',
        message: 'La station est désactivée : aucune affectation possible.',
      });
    }

    const others = await this.prisma.occurrence.findMany({
      where: {
        swapperId: input.swapperId,
        ...(input.ignoreOccurrenceId
          ? { id: { not: input.ignoreOccurrenceId } }
          : {}),
      },
      include: { station: true },
    });

    const approvedLeave = await this.prisma.leave.findFirst({
      where: {
        swapperId: input.swapperId,
        status: 'APPROVED',
        startTime: { lt: new Date(end) },
        endTime: { gt: new Date(start) },
      },
    });
    if (approvedLeave) {
      errors.push({
        code: 'APPROVED_LEAVE',
        message: `Congé approuvé du ${hour(
          approvedLeave.startTime.getTime(),
        )} au ${hour(approvedLeave.endTime.getTime())} : ${approvedLeave.reason}.`,
      });
    }

    for (const other of others) {
      const otherStart = other.startTime.getTime();
      const otherEnd = other.endTime.getTime();
      if (otherStart < end && start < otherEnd) {
        errors.push({
          code: 'OVERLAP',
          message: `Chevauchement avec le service du ${hour(otherStart)} (${other.label}).`,
        });
      }
    }

    if (station.enforceMinRest !== false) {
      const minRest = station.minRestHours * 3_600_000;
      for (const other of others) {
        const otherStart = other.startTime.getTime();
        const otherEnd = other.endTime.getTime();
        const gap =
          otherStart >= end
            ? otherStart - end
            : otherEnd <= start
              ? start - otherEnd
              : -1;
        if (gap >= 0 && gap < minRest) {
          errors.push({
            code: 'REST',
            message: `Repos insuffisant : ${
              Math.round((gap / 3_600_000) * 10) / 10
            } h entre deux services (minimum ${station.minRestHours} h).`,
          });
        }
      }
    }

    const weekStart = weekKeyOf(input.startTime);
    const existingHours = await this.hoursInWeek(
      input.swapperId,
      weekStart,
      input.ignoreOccurrenceId,
    );
    const projectedHours =
      Math.round((existingHours + input.hours) * 100) / 100;
    if (projectedHours > station.weeklyHoursLimit) {
      errors.push({
        code: 'WEEKLY_LIMIT',
        message: `Limite hebdomadaire dépassée : ${projectedHours} h projetées pour ${station.weeklyHoursLimit} h autorisées.`,
      });
    } else if (projectedHours > station.weeklyHoursLimit * 0.9) {
      warnings.push({
        code: 'NEAR_LIMIT',
        message: `Charge proche de la limite hebdomadaire (${projectedHours} h sur ${station.weeklyHoursLimit} h).`,
      });
    }

    const crossesMidnight =
      stationDayKey(start, station.timezone) !==
      stationDayKey(end, station.timezone);
    if (crossesMidnight) {
      warnings.push({
        code: 'NIGHT',
        message: 'Le service franchit minuit : vérifiez le repos qui suit.',
      });
    }

    const target = input.ignoreOccurrenceId
      ? await this.prisma.occurrence.findUnique({
          where: { id: input.ignoreOccurrenceId },
        })
      : null;
    if (input.hours >= 6 && (target?.breakMinutes ?? 0) === 0) {
      warnings.push({
        code: 'NO_BREAK',
        message:
          'Service de 6 h ou plus sans pause : complétez le modèle de shift.',
      });
    }

    const weeklyLimitWarning = await this.weeklyLimitWarning(
      station,
      input.swapperId,
    );
    if (weeklyLimitWarning) warnings.push(weeklyLimitWarning);

    const weeks: ConstraintWeek[] = [
      {
        startDate: weekStart,
        existingHours,
        addedHours: input.hours,
        projectedHours,
        limitHours: station.weeklyHoursLimit,
      },
    ];
    if (crossesMidnight) {
      const nextWeek = weekKeyOf(input.endTime, station.timezone);
      if (nextWeek !== weekStart) {
        const nextExisting = await this.hoursInWeek(
          input.swapperId,
          nextWeek,
          input.ignoreOccurrenceId,
        );
        weeks.push({
          startDate: nextWeek,
          existingHours: nextExisting,
          addedHours: 0,
          projectedHours: nextExisting,
          limitHours: station.weeklyHoursLimit,
        });
      }
    }

    return {
      valid: errors.length === 0,
      stationName: station.name,
      timezone: station.timezone,
      durationHours: input.hours,
      weeks,
      errors,
      warnings,
    };
  }

  /**
   * Heures deja planifiees d'un agent sur une semaine (lundi -> dimanche),
   * exprimees en jours de station pour rester coherentes avec l'affichage.
   */
  async hoursInWeek(
    swapperId: string,
    weekStart: string,
    ignoreOccurrenceId?: string,
  ): Promise<number> {
    const weekEnd = addDaysKey(weekStart, 7);
    const rows = await this.prisma.occurrence.findMany({
      where: {
        swapperId,
        ...(ignoreOccurrenceId ? { id: { not: ignoreOccurrenceId } } : {}),
      },
      include: { station: { select: { timezone: true } } },
    });
    let total = 0;
    for (const row of rows) {
      const timezone = row.station?.timezone ?? 'Africa/Douala';
      const key = stationDayKey(row.startTime.getTime(), timezone);
      if (key >= weekStart && key < weekEnd) total += durationHours(row);
    }
    return Math.round(total * 100) / 100;
  }

  /** Deux personnes ne doivent pas depasser la limite hebdomadaire cumulee. */
  private async weeklyLimitWarning(
    station: Station,
    swapperId: string,
  ): Promise<ConstraintIssue | null> {
    const weekStart = weekKeyOf(new Date().toISOString());
    const hours = await this.hoursInWeek(swapperId, weekStart);
    if (hours > station.weeklyHoursLimit * 0.9) {
      return {
        code: 'WEEK_TOTAL',
        message: `Semaine en cours : ${hours} h planifiées sur ${station.weeklyHoursLimit} h.`,
      };
    }
    return null;
  }

  private emptyReport(input: ConstraintInput): ConstraintReport {
    return {
      valid: false,
      stationName: '—',
      timezone: 'Africa/Douala',
      durationHours: input.hours,
      weeks: [],
      errors: [{ code: 'STATION_UNKNOWN', message: 'Station introuvable.' }],
      warnings: [],
    };
  }

  /** Postes vacants d'un planning : bloquant pour certaines stations. */
  async vacancyReport(planningId: string): Promise<{
    vacant: number;
    blockingStations: string[];
  }> {
    const occurrences = await this.prisma.occurrence.findMany({
      where: { planningId, swapperId: null },
      include: { station: { select: { name: true, blockPublishingWithVacancies: true } } },
    });
    const blockingStations = [
      ...new Set(
        occurrences
          .filter((item) => item.station.blockPublishingWithVacancies)
          .map((item) => item.station.name),
      ),
    ];
    return { vacant: occurrences.length, blockingStations };
  }

  /** Un agent peut-il couvrir ce poste ? (filtre de la file de remplacement) */
  async eligibleFor(
    occurrence: Occurrence,
    swapperId: string,
  ): Promise<ConstraintReport> {
    return this.report({
      stationId: occurrence.stationId,
      swapperId,
      startTime: occurrence.startTime.toISOString(),
      endTime: occurrence.endTime.toISOString(),
      hours: durationHours(occurrence),
      ignoreOccurrenceId: occurrence.id,
    });
  }

  /**
   * Controle d'un poste existant pour un agent donne : utilise par l'ecran
   * d'affectation pour annoter chaque candidat (disponible / en conflit).
   */
  async occurrenceReport(
    occurrenceId: string,
    swapperId: string,
  ): Promise<ConstraintReport> {
    const occurrence = await this.prisma.occurrence.findUnique({
      where: { id: occurrenceId },
    });
    if (!occurrence) {
      throw new NotFoundDomain(
        ErrorCode.NOT_FOUND,
        'Affectation introuvable.',
      );
    }
    return this.report({
      stationId: occurrence.stationId,
      swapperId,
      startTime: occurrence.startTime.toISOString(),
      endTime: occurrence.endTime.toISOString(),
      hours: durationHours(occurrence),
      ignoreOccurrenceId: occurrence.id,
    });
  }
}
