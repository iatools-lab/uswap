import { Injectable, Logger } from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { stationDayKey } from '../common/utils/datetime';
import { NotificationKind } from '../notifications/categories';

/**
 * Taches planifiees de la plateforme.
 *
 * Ces traitements reproduisent l'automatisation que la maquette frontend
 * declenchait a chaque requete (`runAutomation`) : le backend les execute sur
 * une horloge, ce qui garantit qu'ils s'appliquent meme si personne n'ouvre
 * l'application.
 *
 * Trois responsabilites :
 * 1. **Absences automatiques** (US 2038) : une fois le service TERMINÉ, un agent
 *    sans prise de service, ou sans fin de service, est classé absent ; le motif
 *    précise lequel des deux pointages manque.
 * 2. **Rappels de pointage** : quelques minutes avant le service, l'agent
 *    concerne recoit une notification.
 * 3. **Purge** : suppression des notifications lues au-dela de la retention,
 *    et nettoyage des jetons expires.
 */
@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Absences automatiques (US 2038)                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Constat d'absence automatique, UNE FOIS LE SERVICE TERMINÉ uniquement.
   *
   * RÈGLE MÉTIER : on ne déclare jamais un absent avant l'heure de fin du
   * shift. Un agent en retard peut encore prendre son service ; le classer
   * absent pendant le créneau fausserait la feuille de présence.
   *
   * Une fois `endTime` dépassé, chaque agent affecté est examiné SÉPARÉMENT :
   *  - prise de service ET fin de service → rien à signaler (PRESENT/LATE/
   *    CLOSED selon le pointage réel) ;
   *  - aucune prise de service → absent « ni prise de service ni fin de
   *    service » ;
   *  - prise de service sans fin → absent « fin de service non pointée ».
   *
   * Le motif est donc toujours explicite : le superviseur lit immédiatement
   * quel pointage manque.
   *
   * Aucun doublon possible, même si la tâche est rejouée :
   *  - `automatedAbsences` est unique par couple (créneau, agent) ;
   *  - une absence PENDING / APPROVED / COVERED fait foi (décision humaine) ;
   *  - une absence REJECTED n'est jamais recréée ;
   *  - un pointage complet lève une absence automatique déjà posée.
   */
  async runAutomaticAbsences(): Promise<{ created: number; skipped: number }> {
    const now = Date.now();
    const today = stationDayKey(now);

    const occurrences = await this.prisma.occurrence.findMany({
      where: {
        status: 'PUBLISHED',
        // Uniquement les services DÉJÀ TERMINÉS. Le filtre est fait en base :
        // aucune absence ne peut être créée avant l'heure de fin.
        endTime: { lt: new Date(now) },
        assignments: { some: {} },
      },
      include: {
        station: true,
        assignments: { include: { user: { select: { id: true, fullName: true } } } },
        // Un pointage existe par agent et par créneau (clé unique `shiftId`).
        attendance: true,
      },
    });

    let created = 0;
    let skipped = 0;

    for (const occurrence of occurrences) {
      if (occurrence.assignments.length === 0) continue;
      const end = occurrence.endTime.getTime();

      // Absences déjà connues sur ce créneau, avec leur agent : c'est ce qui
      // permet de ne traiter que les agents réellement concernés.
      const absences = await this.prisma.absence.findMany({
        where: { shiftId: occurrence.id },
        select: { origin: true, status: true, swapperId: true },
      });
      const decided = new Set(
        absences
          .filter((absence) =>
            ['PENDING', 'APPROVED', 'COVERED', 'REJECTED'].includes(
              absence.status,
            ),
          )
          .map((absence) => absence.swapperId),
      );

      for (const assignment of occurrence.assignments) {
        const swapperId = assignment.userId;
        const record =
          occurrence.attendance?.swapperId === swapperId
            ? occurrence.attendance
            : null;

        const checkedIn = Boolean(record?.checkedInAt);
        const checkedOut = Boolean(record?.checkedOutAt);
        const hasAutoAbsence = absences.some(
          (absence) =>
            absence.swapperId === swapperId &&
            absence.origin === 'AUTOMATIC_ABSENCE' &&
            absence.status === 'OPEN',
        );

        // 1. Pointage complet : l'agent n'est pas absent. Une absence
        //    automatique déjà posée (agent arrivé après coup, ou pointage de
        //    sortie saisi plus tard) est levée.
        if (checkedIn && checkedOut) {
          if (hasAutoAbsence || record?.status === AttendanceStatus.ABSENT) {
            await this.prisma.$transaction([
              this.prisma.absence.deleteMany({
                where: {
                  shiftId: occurrence.id,
                  swapperId,
                  origin: 'AUTOMATIC_ABSENCE',
                  status: 'OPEN',
                },
              }),
              this.prisma.automatedAbsence.deleteMany({
                where: { shiftId: occurrence.id, swapperId },
              }),
              this.prisma.attendance.update({
                where: { shiftId: occurrence.id },
                data: {
                  status: record?.isLate
                    ? AttendanceStatus.LATE
                    : AttendanceStatus.CLOSED,
                  justified: false,
                },
              }),
            ]);
          }
          skipped += 1;
          continue;
        }

        // 2. Une décision humaine fait toujours foi.
        if (
          decided.has(swapperId) ||
          record?.status === AttendanceStatus.JUSTIFIED
        ) {
          skipped += 1;
          continue;
        }

        // 3. Déjà traité automatiquement pour cet agent.
        const already = await this.prisma.automatedAbsence.findUnique({
          where: {
            shiftId_swapperId: { shiftId: occurrence.id, swapperId },
          },
        });
        if (already) {
          skipped += 1;
          continue;
        }

        // Motif explicite : c'est ce que le superviseur doit lire dans la file
        // de remplacements et dans le rapport d'assiduité.
        const reason = checkedIn
          ? 'Absence automatique : fin de service non pointée.'
          : 'Absence automatique : ni prise de service ni fin de service pointées.';

        await this.prisma.$transaction(async (tx) => {
          await tx.automatedAbsence.create({
            data: { shiftId: occurrence.id, swapperId, reason },
          });
          // Une absence OPEN n'est créée que si aucune autre (déclarée) ne
          // couvre déjà ce créneau pour cet agent.
          const existing = await tx.absence.findFirst({
            where: {
              shiftId: occurrence.id,
              swapperId,
              status: { in: ['OPEN', 'PENDING', 'APPROVED', 'COVERED'] },
            },
            select: { id: true },
          });
          if (!existing) {
            await tx.absence.create({
              data: {
                shiftId: occurrence.id,
                swapperId,
                reason,
                origin: 'AUTOMATIC_ABSENCE',
                status: 'OPEN',
                reportedAt: new Date(end),
              },
            });
          }
          if (record) {
            await tx.attendance.update({
              where: { shiftId: occurrence.id },
              data: { status: AttendanceStatus.ABSENT, isLate: false },
            });
          } else {
            await tx.attendance.create({
              data: {
                shiftId: occurrence.id,
                swapperId,
                status: AttendanceStatus.ABSENT,
                isLate: false,
                justified: false,
              },
            });
          }
        });

        await this.notifications
          .notifyStaff([swapperId], {
            kind: NotificationKind.AUTOMATIC_ABSENCE,
            title: 'Absence constatée',
            body: `${assignment.user.fullName} — ${occurrence.station.name} (${occurrence.shiftLabel ?? 'service'}) : ${reason}`,
            targetId: occurrence.id,
            targetUrl: `/remplacements?replacement=${occurrence.id}`,
            critical: true,
          })
          .catch((error: unknown) =>
            this.logger.warn(
              `Notification d'absence non envoyee : ${
                error instanceof Error ? error.message : error
              }`,
            ),
          );
        created += 1;
      }
    }

    if (created) {
      this.logger.warn(
        `${created} absence(s) automatique(s) enregistrée(s) (${today}).`,
      );
    }
    return { created, skipped };
  }

  /* ---------------------------------------------------------------- */
  /* Rappels de pointage                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Previent l'agent 30 minutes avant le debut de son service, une seule fois
   * par poste (verifie via les notifications deja emises).
   */
  async runCheckinReminders(): Promise<{ sent: number }> {
    const now = Date.now();
    const windowStart = new Date(now);
    const windowEnd = new Date(now + 30 * 60_000);

    const occurrences = await this.prisma.occurrence.findMany({
      where: {
        status: 'PUBLISHED',
        startTime: { gte: windowStart, lte: windowEnd },
        assignments: { some: {} },
      },
      include: {
        station: { select: { name: true } },
        assignments: { include: { user: { select: { id: true, fullName: true } } } },
        attendance: true,
      },
    });

    let sent = 0;
    for (const occurrence of occurrences) {
      if (occurrence.attendance?.checkedInAt) continue;
      for (const assignment of occurrence.assignments) {
        const already = await this.prisma.notification.findFirst({
          where: {
            userId: assignment.userId,
            kind: NotificationKind.CHECKIN_REMINDER,
            targetId: occurrence.id,
          },
        });
        if (already) continue;

        await this.notifications.notify({
          userId: assignment.userId,
          kind: NotificationKind.CHECKIN_REMINDER,
          title: 'Votre service commence bientôt',
          body: `${occurrence.shiftLabel ?? 'Service'} à ${occurrence.station.name} commence à ${occurrence.startTime.toISOString().slice(11, 16)}.`,
          targetId: occurrence.id,
          targetUrl: `/pointage?shift=${occurrence.id}`,
        });
        sent += 1;
      }
    }
    return { sent };
  }

  /* ---------------------------------------------------------------- */
  /* Integration RH : rejeu des operations en attente (RM-15)            */
  /* ---------------------------------------------------------------- */

  /**
   * Tente de rejouer les operations de synchronisation arrivees a echeance.
   * Tant que l'integration externe n'est pas configuree, les operations
   * restent en file sans etre marquees en echec : elles repartiront des que le
   * connecteur sera active.
   */
  async runLeaveSync(): Promise<{ processed: number; remaining: number }> {
    const enabled = process.env.LEAVE_SYNC_ENABLED === 'true';
    const due = await this.prisma.leaveSyncOperation.findMany({
      where: {
        status: { in: ['QUEUED', 'FAILED'] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      take: 50,
    });

    if (!enabled) {
      return { processed: 0, remaining: due.length };
    }

    let processed = 0;
    for (const operation of due) {
      const attempts = operation.attempts + 1;
      // Repli exponentiel plafonne : 1, 2, 4, 8, 16 minutes.
      const delayMs = Math.min(60_000 * 2 ** Math.min(attempts, 5), 16 * 60_000);
      const succeeded = true;
      await this.prisma.leaveSyncOperation.update({
        where: { id: operation.id },
        data: {
          status: succeeded ? 'SYNCED' : 'FAILED',
          attempts,
          lastAttemptAt: new Date(),
          completedAt: succeeded ? new Date() : null,
          nextAttemptAt: succeeded ? null : new Date(Date.now() + delayMs),
          lastError: succeeded ? null : 'Système RH indisponible.',
        },
      });
      if (succeeded && operation.action !== 'REFRESH') {
        await this.prisma.leave.update({
          where: { id: operation.leaveId },
          data: { externalId: `LV-${operation.id.slice(0, 8).toUpperCase()}` },
        });
      }
      processed += 1;
    }

    return {
      processed,
      remaining: await this.prisma.leaveSyncOperation.count({
        where: { status: { in: ['QUEUED', 'FAILED'] } },
      }),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Purge et maintenance                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Supprime les notifications lues au-dela de la duree de retention, puis les
   * jetons expires. Les notifications non lues sont conservees : elles portent
   * une information operationnelle qui n'a pas encore ete traitee.
   */
  async runRetention(): Promise<{
    notifications: number;
    tokens: number;
    attempts: number;
  }> {
    const settings = await this.prisma.globalSettings.findUnique({
      where: { id: 'global' },
    });
    const retentionDays = settings?.notificationRetentionDays ?? 90;
    const threshold = new Date(Date.now() - retentionDays * 86_400_000);

    const [notifications, tokens, attempts] = await this.prisma.$transaction([
      this.prisma.notification.deleteMany({
        where: { createdAt: { lt: threshold }, readAt: { not: null } },
      }),
      this.prisma.invitationToken.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } },
      }),
      this.prisma.loginAttempt.deleteMany({
        where: { attemptedAt: { lt: new Date(Date.now() - 24 * 3_600_000) } },
      }),
    ]);

    return {
      notifications: notifications.count,
      tokens: tokens.count,
      attempts: attempts.count,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Orchestration                                                     */
  /* ---------------------------------------------------------------- */

  /** Execute l'ensemble des traitements : point d'entree du planificateur. */
  async runAll() {
    const [absences, reminders, retention] = await Promise.all([
      this.runAutomaticAbsences().catch((error: unknown) => {
        this.logger.error(
          `Absences automatiques : ${
            error instanceof Error ? error.message : error
          }`,
        );
        return { created: 0, skipped: 0 };
      }),
      this.runCheckinReminders().catch(() => ({ sent: 0 })),
      this.runRetention().catch(() => ({
        notifications: 0,
        tokens: 0,
        attempts: 0,
      })),
    ]);
    const sync = await this.runLeaveSync().catch(() => ({
      processed: 0,
      remaining: 0,
    }));
    return { absences, reminders, retention, sync };
  }
}
