import type { PrismaClient } from '@prisma/client';
import {
  ConflictDomain,
  ErrorCode,
  NotFoundDomain,
} from '../errors/domain-errors';

/**
 * Regles metier partagees entre plusieurs services.
 *
 * Elles prennent le client Prisma en parametre afin de s'executer aussi bien
 * hors transaction qu'a l'interieur d'un `$transaction` interactif.
 */
export type PrismaLike = PrismaClient;

export function slotMinutes(startTime: string, endTime: string): number {
  const toMinutes = (value: string): number =>
    Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  return (toMinutes(endTime) - toMinutes(startTime) + 1440) % 1440;
}

export function validateShiftSlot(
  startTime: string,
  endTime: string,
): { durationMinutes: number } {
  if (slotMinutes(startTime, endTime) === 0) {
    throw new ConflictDomain(
      ErrorCode.VALIDATION,
      'Le créneau doit avoir une durée supérieure à zéro.',
      400,
    );
  }
  return { durationMinutes: slotMinutes(startTime, endTime) };
}

/** Charge une station ou leve une 404 explicite. */
export async function stationOf(db: PrismaLike, stationId: string) {
  const station = await db.station.findUnique({ where: { id: stationId } });
  if (!station) {
    throw new NotFoundDomain(ErrorCode.NOT_FOUND, 'Station introuvable.');
  }
  return station;
}

/** Charge un poste (occurrence) ou leve une 404 explicite. */
export async function occurrenceOf(db: PrismaLike, occurrenceId: string) {
  const occurrence = await db.occurrence.findUnique({
    where: { id: occurrenceId },
  });
  if (!occurrence) {
    throw new NotFoundDomain(
      ErrorCode.NOT_FOUND,
      'Affectation introuvable.',
    );
  }
  return occurrence;
}

/** Charge un utilisateur ou leve une 404 explicite. */
export async function userOf(db: PrismaLike, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new NotFoundDomain(ErrorCode.NOT_FOUND, 'Compte introuvable.');
  }
  return user;
}

/**
 * Statut d'une affectation : pointage enregistre, absence constatee, sinon
 * « attendu ». Un poste vacant reste « attendu » (il n'engage personne).
 */
export async function attendanceStatusOf(
  db: PrismaLike,
  occurrenceId: string,
  swapperId: string | null,
): Promise<
  'EXPECTED' | 'PRESENT' | 'LATE' | 'CLOSED' | 'ABSENT' | 'JUSTIFIED'
> {
  if (swapperId) {
    const record = await db.attendance.findUnique({
      where: { shiftId: occurrenceId },
    });
    if (record) {
      return record.status as
        | 'EXPECTED'
        | 'PRESENT'
        | 'LATE'
        | 'CLOSED'
        | 'ABSENT'
        | 'JUSTIFIED';
    }
  }
  return 'EXPECTED';
}

/** Nombre total d'absences ouvertes d'un poste. */
export async function hasOpenAbsence(
  db: PrismaLike,
  occurrenceId: string,
): Promise<boolean> {
  const count = await db.absence.count({
    where: { shiftId: occurrenceId, status: 'OPEN' },
  });
  return count > 0;
}

/** Identifiant lisible et stable, utile pour les lots d'import et les cles. */
export function reference(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
