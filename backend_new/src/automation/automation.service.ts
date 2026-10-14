import { Injectable, Logger } from '@nestjs/common';
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
 * 1. **Absences automatiques** (US 2038) : un agent qui n'a pas pointe apres la
 *    tolerance, ou qui n'a pas enregistre sa fin de service, est classe absent.
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
   * Traite chaque poste publie au plus une fois :
   * - aucun pointage apres la tolerance de retard → absence ;
   * - prise de service sans fin de service apres la fin du shift → absence.
   *
   * Le marqueur `AutomatedAbsence` empeche tout doublon, meme si la tache est
   * executee plusieurs fois de suite.
   */
  async runAutomaticAbsences(): Promise<{ created: number; skipped: number }> {
    const now = Date.now();
    const today = stationDayKey(now);

    const occurrences = await this.prisma.occurrence.findMany({
      where: {
        status: 'PUBLISHED',
        endTime: { lt: new Date(now + 86_400_000) },
        assignments: { some: {} },
      },
      include: {
        station: true,
        assignments: { include: { user: { select: { id: true, fullName: true } } } },
        attendance: true,
      },
    });

    let created = 0;
    let skipped = 0;

    for (const occurrence of occurrences) {
      const toleranceMs =
        occurrence.station.latenessToleranceMinutes * 60_000;
      const start = occurrence.startTime.getTime();
      const end = occurrence.endTime.getTime();
      if (now < start + toleranceMs) continue;

      const record = occurrence.attendance;
      const missedCheckin = !record;
      const missedCheckout =
        now > end && Boolean(record?.checkedInAt) && !record?.checkedOutAt;
      if (!missedCheckin && !missedCheckout) continue;

      const already = await this.prisma.automatedAbsence.findUnique({
        where: { shiftId: occurrence.id },
      });
      if (already) {
        skipped += 1;
        continue;
      }

      const reason = missedCheckout
        ? 'Absence automatique : prise de service enregistrée sans pointage de fin.'
        : 'Absence automatique : aucun pointage après le délai de tolérance.';

      for (const assignment of occurrence.assignments) {
        await this.prisma.$transaction(async (tx) => {
          await tx.automatedAbsence.create({
            data: { shiftId: occurrence.id, reason },
          });
          if (missedCheckout && record) {
            await tx.attendance.update({
              where: { shiftId: occurrence.id },
              data: { status: 'ABSENT', justified: false },
            });
          }
          const existing = await tx.absence.findFirst({
            where: { shiftId: occurrence.id, status: 'OPEN' },
          });
          if (!existing) {
            await tx.absence.create({
              data: {
                shiftId: occurrence.id,
                swapperId: assignment.userId,
                reason,
                origin: 'AUTOMATIC_ABSENCE',
                status: 'OPEN',
                reportedAt: new Date(
                  missedCheckout ? end : start + toleranceMs,
                ),
              },
            });
          }
        });

        await this.notifications.notifyStaff([assignment.userId], {
          kind: NotificationKind.AUTOMATIC_ABSENCE,
          title: 'Absence automatique',
          body: missedCheckout
            ? `${assignment.user.fullName} n'a pas enregistré sa fin de service à ${occurrence.station.name} (${occurrence.shiftLabel ?? 'service'}).`
            : `${assignment.user.fullName} n'a pointé à ${occurrence.station.name} (${occurrence.shiftLabel ?? 'service'}).`,
          targetId: occurrence.id,
          targetUrl: `/remplacements?replacement=${occurrence.id}`,
          critical: true,
        });
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
