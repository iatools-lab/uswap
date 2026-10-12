import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConstraintsService } from '../planning/constraints.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { AttachmentsService } from '../common/attachments/attachments.service';
import {
  ConflictDomain,
  ErrorCode,
  ForbiddenDomain,
  NotFoundDomain,
} from '../common/errors/domain-errors';
import { serializeChange, durationHours } from '../common/serializers';
import type { AuthenticatedUser } from '../common/guards/roles.guard';
import { NotificationKind } from '../notifications/categories';

const HOUR_MS = 3_600_000;

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly constraints: ConstraintsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly attachments: AttachmentsService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Justificatifs                                                     */
  /* ---------------------------------------------------------------- */

  /** Enregistre la piece jointe exigee par une declaration d'absence. */
  async uploadAbsenceAttachment(
    user: AuthenticatedUser,
    file: Parameters<AttachmentsService['store']>[0],
  ) {
    return this.attachments.store(file, user.id, {
      maxMb: 5,
      allowedTypes: [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
      ],
    });
  }

  /** Meme depot, mais resserve aux superviseurs pour les corrections. */
  async uploadCorrectionAttachment(
    user: AuthenticatedUser,
    file: Parameters<AttachmentsService['store']>[0],
  ) {
    return this.attachments.store(file, user.id, { maxMb: 5 });
  }

  /* ---------------------------------------------------------------- */
  /* Declaration d'absence (US 2047)                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Un agent declara une indisponibilite sur un de ses postes publies.
   *
   * L'operation est **idempotente** : `clientRef` (ou `idempotencyKey`) permet
   * de rejouer une declaration faite hors connexion sans creer de doublon.
   */
  async declareAbsence(
    user: AuthenticatedUser,
    payload: {
      shiftId: string;
      reason: string;
      attachmentId?: string | null;
      clientRef?: string | null;
      idempotencyKey?: string | null;
    },
  ) {
    const reason = (payload.reason ?? '').trim();
    if (reason.length < 3) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        "Précisez un motif d'absence (3 caractères minimum).",
        400,
      );
    }
    await this.attachments.assertExists(payload.attachmentId);

    const occurrence = await this.prisma.occurrence.findUnique({
      where: { id: payload.shiftId },
      include: { assignments: true },
    });
    if (!occurrence) {
      throw new NotFoundDomain(ErrorCode.NOT_FOUND, 'Affectation introuvable.');
    }
    const assigned = occurrence.assignments.some((a) => a.userId === user.id);
    if (!assigned) {
      throw new ForbiddenDomain(
        'SHIFT_NOT_ASSIGNED',
        'Ce shift ne vous est pas affecté.',
      );
    }
    if (occurrence.endTime.getTime() < Date.now()) {
      throw new ConflictDomain(
        'SHIFT_ALREADY_FINISHED',
        'Ce service est déjà terminé.',
        409,
      );
    }

    // Rejeu hors connexion : on renvoie la declaration existante.
    const clientRef = payload.clientRef ?? payload.idempotencyKey ?? null;
    if (clientRef) {
      const replayed = await this.prisma.absence.findUnique({
        where: { clientRef },
      });
      if (replayed) return { id: replayed.id, replayed: true };
    }

    const alreadyOpen = await this.prisma.absence.findFirst({
      where: { shiftId: occurrence.id, status: 'OPEN' },
    });
    if (alreadyOpen) {
      throw new ConflictDomain(
        'ABSENCE_ALREADY_DECLARED',
        'Une absence est déjà déclarée pour ce shift.',
        409,
      );
    }

    const created = await this.prisma.absence.create({
      data: {
        shiftId: occurrence.id,
        swapperId: user.id,
        reason,
        attachmentId: payload.attachmentId,
        clientRef,
        origin: 'DECLARATION',
        status: 'OPEN',
      },
    });

    await this.notifications.notifyStaff([user.id], {
      kind: NotificationKind.ABSENCE_DECLARED,
      title: 'Absence déclarée',
      body: `${user.fullName} · ${occurrence.shiftLabel ?? 'Service'} : ${reason}`,
      targetId: occurrence.id,
      targetUrl: `/remplacements?replacement=${occurrence.id}`,
      critical: true,
    });
    await this.audit.record({
      actorId: user.id,
      action: 'ABSENCE_DECLARED',
      targetType: 'Occurrence',
      targetId: occurrence.id,
      stationId: occurrence.stationId,
      metadata: { reason, clientRef },
    });

    return { id: created.id, replayed: false };
  }

  /* ---------------------------------------------------------------- */
  /* File des remplacements a pourvoir                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Absences sans remplacant, congés approuvés inclus (US 2047).
   *
   * L'urgence se deduit de l'ecart entre maintenant et le debut du service :
   *   ≤ 4 h → critique, ≤ 24 h → élevée, au-dela → normale.
   */
  async pendingReplacements(stationId?: string | null) {
    const windowStart = new Date(Date.now() - 2 * HOUR_MS);

    const absences = await this.prisma.absence.findMany({
      where: {
        status: 'OPEN',
        occurrence: {
          status: 'PUBLISHED',
          endTime: { gt: windowStart },
          ...(stationId ? { stationId } : {}),
        },
      },
      include: {
        occurrence: { include: { station: true } },
        swapper: { select: { id: true, fullName: true } },
      },
    });

    interface ReplacementRow {
      shiftId: string;
      station: { id: string; name: string; timezone: string };
      swapper: { id: string; fullName: string };
      template: string | null;
      startTime: string;
      endTime: string;
      urgency: 'CRITICAL' | 'HIGH' | 'NORMAL';
      hoursUntilStart: number;
      origin: string;
      reason: string;
      reportedAt: string | null;
    }

    const rows: ReplacementRow[] = absences.map((absence) => ({
      shiftId: absence.shiftId,
      station: {
        id: absence.occurrence.station.id,
        name: absence.occurrence.station.name,
        timezone: absence.occurrence.station.timezone,
      },
      swapper: { id: absence.swapperId, fullName: absence.swapper.fullName },
      template: absence.occurrence.shiftLabel,
      startTime: absence.occurrence.startTime.toISOString(),
      endTime: absence.occurrence.endTime.toISOString(),
      urgency: this.urgencyOf(absence.occurrence.startTime.toISOString()),
      hoursUntilStart: this.hoursUntil(absence.occurrence.startTime.toISOString()),
      origin: absence.origin as string,
      reason: absence.reason,
      reportedAt: absence.reportedAt.toISOString(),
    }));

    // Congés approuvés : les postes couverts par un congé valide rejoignent la
    // file s'ils ne sont pas déjà signalés par une absence.
    const covered = new Set(rows.map((row) => row.shiftId));
    const leaves = await this.prisma.leave.findMany({
      where: { status: 'APPROVED', endTime: { gt: windowStart } },
      include: { swapper: { select: { id: true, fullName: true } } },
    });
    for (const leave of leaves) {
      const occurrences = await this.prisma.occurrence.findMany({
        where: {
          status: 'PUBLISHED',
          endTime: { gt: windowStart },
          startTime: { lt: leave.endTime },
          assignments: { some: { userId: leave.swapperId } },
          ...(stationId ? { stationId } : {}),
        },
        include: { station: true },
      });
      for (const occurrence of occurrences) {
        if (covered.has(occurrence.id)) continue;
        covered.add(occurrence.id);
        rows.push({
          shiftId: occurrence.id,
          station: {
            id: occurrence.station.id,
            name: occurrence.station.name,
            timezone: occurrence.station.timezone,
          },
          swapper: { id: leave.swapperId, fullName: leave.swapper.fullName },
          template: occurrence.shiftLabel,
          startTime: occurrence.startTime.toISOString(),
          endTime: occurrence.endTime.toISOString(),
          urgency: this.urgencyOf(occurrence.startTime.toISOString()),
          hoursUntilStart: this.hoursUntil(occurrence.startTime.toISOString()),
          origin: 'APPROVED_LEAVE',
          reason: leave.reason,
          reportedAt: null,
        });
      }
    }

    return rows.sort(
      (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime),
    );
  }

  /** Candidats pour un poste, annotes par les regles metier (US 2042). */
  async candidates(shiftId: string) {
    const occurrence = await this.prisma.occurrence.findUnique({
      where: { id: shiftId },
      include: { assignments: true },
    });
    if (!occurrence) {
      throw new NotFoundDomain(ErrorCode.NOT_FOUND, 'Affectation introuvable.');
    }

    const currentIds = new Set(occurrence.assignments.map((a) => a.userId));
    const swappers = await this.prisma.user.findMany({
      where: { role: 'SWAPPER', isActive: true, disabledAt: null },
      orderBy: { fullName: 'asc' },
      include: { station: { select: { name: true } } },
    });

    interface CandidateRow {
      id: string;
      fullName: string;
      email: string;
      homeStationName: string | null;
      eligible: boolean;
      issues: { code: string; message: string }[];
    }
    const candidates: CandidateRow[] = [];
    for (const swapper of swappers) {
      // L'agent deja affecte est toujours presente comme eligible : il ne se
      // penalise pas lui-meme en se voyant attribuer son propre service.
      if (currentIds.has(swapper.id)) {
        candidates.push({
          id: swapper.id,
          fullName: swapper.fullName,
          email: swapper.email,
          homeStationName: swapper.station?.name ?? null,
          eligible: true,
          issues: [],
        });
        continue;
      }
      const report = await this.constraints.eligibleFor(occurrence, swapper.id);
      candidates.push({
        id: swapper.id,
        fullName: swapper.fullName,
        email: swapper.email,
        homeStationName: swapper.station?.name ?? null,
        eligible: report.valid,
        issues: [...report.errors, ...report.warnings].map((issue) => ({
          code: issue.code,
          message: issue.message,
        })),
      });
    }

    return {
      candidates: candidates.sort(
        (a, b) =>
          Number(b.eligible) - Number(a.eligible) ||
          a.fullName.localeCompare(b.fullName, 'fr'),
      ),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Remplacement                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Affecte un remplacant a un poste : met a jour le poste, vide la file
   * d'absences du shift et journalise le changement d'affectation.
   */
  async replace(
    actor: AuthenticatedUser,
    shiftId: string,
    payload: { swapperId: string; reason?: string | null },
  ) {
    const occurrence = await this.prisma.occurrence.findUnique({
      where: { id: shiftId },
      include: { assignments: true, station: true },
    });
    if (!occurrence) {
      throw new NotFoundDomain(ErrorCode.NOT_FOUND, 'Affectation introuvable.');
    }

    const swapper = await this.prisma.user.findFirst({
      where: {
        id: payload.swapperId,
        role: 'SWAPPER',
        isActive: true,
        disabledAt: null,
      },
    });
    if (!swapper) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Sélectionnez un agent actif.',
        400,
      );
    }

    const report = await this.constraints.eligibleFor(occurrence, swapper.id);
    if (!report.valid) {
      throw new ConflictDomain(
        ErrorCode.PLANNING_CONFLICT,
        report.errors[0]?.message ?? 'Remplacement impossible.',
        409,
        { errors: report.errors, warnings: report.warnings },
      );
    }

    const previous = occurrence.assignments[0]
      ? await this.prisma.user.findUnique({
          where: { id: occurrence.assignments[0].userId },
          select: { id: true, fullName: true },
        })
      : null;

    await this.prisma.$transaction(async (tx) => {
      // Le poste est reattribue en une seule fois : on remplace l'affectation
      // courante sans creer d'affectation concurrente.
      await tx.occurrenceAssignment.deleteMany({
        where: { occurrenceId: shiftId },
      });
      await tx.occurrenceAssignment.create({
        data: { occurrenceId: shiftId, userId: swapper.id, assignedById: actor.id },
      });
      await tx.occurrence.update({
        where: { id: shiftId },
        data: { revision: { increment: 1 }, status: 'PUBLISHED' },
      });

      // La file se vide : l'absence du poste est desormais couverte.
      await tx.absence.updateMany({
        where: { shiftId, status: 'OPEN' },
        data: { status: 'COVERED', coveredBy: swapper.id },
      });

      await tx.shiftChange.create({
        data: {
          shiftId,
          type: 'REPLACEMENT',
          initiatorId: actor.id,
          initiator: actor.fullName,
          stationId: occurrence.stationId,
          station: occurrence.station.name,
          outSwapper: previous?.fullName ?? null,
          inSwapper: swapper.fullName,
          outSwapperId: previous?.id ?? null,
          inSwapperId: swapper.id,
          before: JSON.stringify({ swapper: previous?.fullName ?? null }),
          after: JSON.stringify({ swapper: swapper.fullName }),
          reason:
            (payload.reason ?? '').trim() ||
            'Remplacement décidé par le superviseur',
        },
      });
    });

    await this.notifications.notifyStaff(
      [swapper.id, previous?.id].filter((id): id is string => Boolean(id)),
      {
        kind: NotificationKind.REPLACE_EXISTS,
        title: 'Remplacement confirmé',
        body: `${swapper.fullName} couvre ${occurrence.shiftLabel ?? 'un service'} à ${occurrence.station.name}.`,
        targetId: shiftId,
        targetUrl: '/remplacements',
        critical: true,
      },
    );
    await this.audit.record({
      actorId: actor.id,
      action: 'SHIFT_REPLACED',
      targetType: 'Occurrence',
      targetId: shiftId,
      stationId: occurrence.stationId,
      metadata: { from: previous?.fullName ?? null, to: swapper.fullName },
    });

    return {
      ok: true,
      shiftId,
      swapperId: swapper.id,
      revision: occurrence.revision + 1,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Historique des changements d'affectation (US 2046)                 */
  /* ---------------------------------------------------------------- */

  async changes(params: {
    from?: string;
    to?: string;
    type?: string;
    stationId?: string;
    swapperId?: string;
  }) {
    const from = params.from
      ? new Date(params.from)
      : new Date(Date.now() - 30 * 86_400_000);
    const to = params.to ? new Date(params.to) : new Date();

    const changes = await this.prisma.shiftChange.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        ...(params.type
          ? { type: params.type.toUpperCase() as never }
          : {}),
        ...(params.stationId ? { stationId: params.stationId } : {}),
        ...(params.swapperId
          ? {
              OR: [
                { outSwapperId: params.swapperId },
                { inSwapperId: params.swapperId },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    return changes.map(serializeChange);
  }

  /** Complete le motif d'un changement deja enregistre (post-traitement). */
  async annotateChange(changeId: string, reason: string | null) {
    const change = await this.prisma.shiftChange.findUnique({
      where: { id: changeId },
    });
    if (!change) {
      throw new NotFoundDomain(
        'CHANGE_NOT_FOUND',
        'Changement d’affectation introuvable.',
      );
    }
    const updated = await this.prisma.shiftChange.update({
      where: { id: changeId },
      data: { reason: (reason ?? '').trim() || (change.reason ?? null) },
    });
    return serializeChange(updated);
  }

  /* ---------------------------------------------------------------- */
  /* Interne                                                           */
  /* ---------------------------------------------------------------- */

  /** Urgence d'une absence selon l'heure de debut (US 2047). */
  private urgencyOf(startTime: string): 'CRITICAL' | 'HIGH' | 'NORMAL' {
    const hours = (Date.parse(startTime) - Date.now()) / HOUR_MS;
    if (hours <= 4) return 'CRITICAL';
    if (hours <= 24) return 'HIGH';
    return 'NORMAL';
  }

  private hoursUntil(startTime: string): number {
    return (
      Math.round(((Date.parse(startTime) - Date.now()) / HOUR_MS) * 10) / 10
    );
  }

  /** Duree d'un poste : exposee pour les rapports de couverture. */
  hours(occurrence: { startTime: Date; endTime: Date; breakMinutes: number }) {
    return durationHours(occurrence);
  }
}
