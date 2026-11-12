import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ConflictDomain,
  ErrorCode,
  ForbiddenDomain,
} from '../common/errors/domain-errors';
import type { AuthenticatedUser } from '../common/guards/roles.guard';
import { NotificationKind } from '../notifications/categories';

/**
 * Nettoyage de la plateforme — reserve au super administrateur.
 *
 * L'objectif est de remettre l'application en configuration reelle apres une
 * phase de recette : effacer les plannings, les releves de pointage et les
 * operations de demonstration, **sans jamais** effacer les comptes, les
 * stations, les modeles de shift ni les reglages.
 *
 * Deux garde-fous non negociables :
 * 1. `dryRun` est la valeur par defaut : la reponse decrit les volumes qui
 *    seraient supprimes, byte pour byte, sans ecrire une seule ligne.
 * 2. Une suppression reelle exige la confirmation explicite `"EFFACER"`.
 *
 * Chaque execution est journalisee dans `AuditLog` ; un e-mail est envoye a
 * l'executant et aux autres super administrateurs.
 */

export type CleanupTarget =
  | 'PLANNINGS'
  | 'ATTENDANCE'
  | 'LEAVES'
  | 'INCIDENTS'
  | 'NOTIFICATIONS'
  | 'AUDIT'
  | 'DEMO_ACCOUNTS';

interface TargetDefinition {
  id: CleanupTarget;
  label: string;
  description: string;
  /** Action irreversible : toujours signalee dans l'interface. */
  destructive: boolean;
  count: (prisma: PrismaService) => Promise<number>;
  purge: (prisma: PrismaService, keepIds: string[]) => Promise<number>;
}

const EMAIL_DEMO_PATTERN = /@(uswap\.local|example\.(com|org)|upowa\.org)$/i;

export const CLEANUP_TARGETS: TargetDefinition[] = [
  {
    id: 'PLANNINGS',
    label: 'Plannings et créneaux',
    description:
      'Supprime les plannings, leurs créneaux, affectations, postes vacants et la file de remplacement associée.',
    destructive: true,
    count: (prisma) => prisma.planning.count(),
    purge: async (prisma) => {
      const plannings = await prisma.planning.count();
      await prisma.planningVacancy.deleteMany({});
      await prisma.shiftChange.deleteMany({});
      await prisma.occurrenceAssignment.deleteMany({});
      await prisma.attendance.deleteMany({});
      await prisma.occurrence.deleteMany({});
      await prisma.planning.deleteMany({});
      return plannings;
    },
  },
  {
    id: 'ATTENDANCE',
    label: 'Pointages et absences',
    description:
      'Efface les relevés de présence et les déclarations d’absence justifiées.',
    destructive: true,
    count: (prisma) =>
      prisma.attendance.count().then(async (attendance) => {
        const absences = await prisma.absence.count();
        return attendance + absences;
      }),
    purge: async (prisma) => {
      const attendance = await prisma.attendance.deleteMany({});
      const absences = await prisma.absence.deleteMany({});
      return attendance.count + absences.count;
    },
  },
  {
    id: 'LEAVES',
    label: 'Congés',
    description:
      'Supprime les demandes de congé et leurs pièces jointes, sans toucher aux soldes annuels.',
    destructive: true,
    count: (prisma) => prisma.leave.count(),
    purge: async (prisma) => {
      const leaves = await prisma.leave.deleteMany({});
      return leaves.count;
    },
  },
  {
    id: 'INCIDENTS',
    label: 'Incidents',
    description: 'Supprime les incidents et leur historique de traitement.',
    destructive: true,
    count: (prisma) => prisma.incident.count(),
    purge: async (prisma) => {
      const incidents = await prisma.incident.deleteMany({});
      return incidents.count;
    },
  },
  {
    id: 'NOTIFICATIONS',
    label: 'Notifications',
    description:
      'Vide les boîtes de réception et l’historique de livraison (e-mail, push).',
    destructive: true,
    count: (prisma) =>
      prisma.notification
        .count()
        .then(async (notifications) => notifications + (await prisma.emailLog.count())),
    purge: async (prisma) => {
      const notifications = await prisma.notification.deleteMany({});
      const mails = await prisma.emailLog.deleteMany({});
      return notifications.count + mails.count;
    },
  },
  {
    id: 'AUDIT',
    label: 'Journal d’audit',
    description:
      'Efface les traces d’exploitation de la recette. L’action de nettoyage elle-même est réécrite juste après.',
    destructive: true,
    count: (prisma) => prisma.auditLog.count(),
    purge: async (prisma, keepIds) => {
      const result = await prisma.auditLog.deleteMany({
        where: { id: { notIn: keepIds } },
      });
      return result.count;
    },
  },
  {
    id: 'DEMO_ACCOUNTS',
    label: 'Comptes de démonstration',
    description:
      'Désactive les comptes de démonstration (adresses @upowa.org, @example.*, @uswap.local) en conservant leur historique. Aucun compte n’est supprimé.',
    destructive: false,
    count: (prisma) =>
      prisma.user
        .findMany({ select: { email: true, isActive: true, disabledAt: true } })
        .then(
          (users) =>
            users.filter(
              (user) => EMAIL_DEMO_PATTERN.test(user.email) && !user.disabledAt,
            ).length,
        ),
    purge: async (prisma, keepIds) => {
      const users = await prisma.user.findMany({
        select: { id: true, email: true },
      });
      const demoIds = users
        .filter((user) => EMAIL_DEMO_PATTERN.test(user.email))
        .map((user) => user.id)
        .filter((id) => !keepIds.includes(id));
      if (!demoIds.length) return 0;
      await prisma.refreshToken.deleteMany({ where: { userId: { in: demoIds } } });
      await prisma.user.updateMany({
        where: { id: { in: demoIds } },
        data: { isActive: false, disabledAt: new Date() },
      });
      return demoIds.length;
    },
  },
];

@Injectable()
export class DataCleanupService {
  private readonly logger = new Logger(DataCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Catalogue affiche par l'ecran de maintenance. */
  targets() {
    return CLEANUP_TARGETS.map(({ id, label, description, destructive }) => ({
      id,
      label,
      description,
      destructive,
    }));
  }

  /** Volumes actuels, sans aucune ecriture. */
  async overview() {
    const counts = await Promise.all(
      CLEANUP_TARGETS.map(async ({ id, count }) => [id, await count(this.prisma)] as const),
    );
    return {
      counts: Object.fromEntries(counts) as Record<CleanupTarget, number>,
      targets: this.targets(),
      executable: true,
    };
  }

  /**
   * Previsualise ou execute un nettoyage.
   *
   * @param target   tableau cible
   * @param dryRun   `true` (defaut) : compte seulement
   * @param confirm  doit valoir « EFFACER » pour supprimer reellement
   */
  async run(
    actor: AuthenticatedUser,
    input: {
      target?: string;
      targets?: string[];
      dryRun?: boolean;
      confirm?: string;
    },
  ) {
    if (actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenDomain(
        'ACCESS_DENIED',
        'Le nettoyage des données est réservé au super administrateur.',
      );
    }

    const requested = [
      ...(input.target ? [input.target] : []),
      ...(input.targets ?? []),
    ].map((value) => String(value).toUpperCase());

    // Tout nettoyage : les volumes decroissent dans un ordre sur, la cible
    // AUDIT passant en dernier pour conserver la trace de l'operation.
    const selected = CLEANUP_TARGETS.filter((target) =>
      requested.includes(target.id),
    );
    if (!selected.length) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Choisissez au moins une catégorie de données à nettoyer.',
        400,
      );
    }

    const dryRun = input.dryRun !== false;
    const keptIds = [actor.id];

    if (dryRun) {
      const preview = await Promise.all(
        selected.map(async (target) => ({
          id: target.id,
          label: target.label,
          affected: await target.count(this.prisma),
          destructive: target.destructive,
        })),
      );
      return {
        dryRun: true,
        executedAt: new Date().toISOString(),
        targets: preview,
        total: preview.reduce((sum, row) => sum + row.affected, 0),
        message:
          'Simulation uniquement : aucune donnée n’a été supprimée. Saisissez « EFFACER » pour confirmer.',
      };
    }

    if ((input.confirm ?? '').trim().toUpperCase() !== 'EFFACER') {
      throw new ConflictDomain(
        'CONFIRMATION_REQUIRED',
        'Confirmez la suppression en saisissant « EFFACER ».',
        400,
      );
    }

    const ordered = [...selected].sort(
      (a, b) => Number(a.id === 'AUDIT') - Number(b.id === 'AUDIT'),
    );
    const results: { id: CleanupTarget; label: string; deleted: number }[] = [];
    for (const target of ordered) {
      const deleted = await target.purge(this.prisma, keptIds);
      results.push({ id: target.id, label: target.label, deleted });
      this.logger.warn(
        `Nettoyage ${target.id} par ${actor.email} : ${deleted} enregistrement(s).`,
      );
    }

    const total = results.reduce((sum, row) => sum + row.deleted, 0);

    // La trace est ecrite APRES un eventuel nettoyage de l'audit : elle reste
    // donc lisible en toutes circonstances.
    await this.audit.record({
      actorId: actor.id,
      action: 'DATA_CLEANUP',
      targetType: 'PLATFORM',
      targetId: 'platform',
      metadata: { targets: results, total },
      message: `Nettoyage des données de test : ${total} enregistrement(s) supprimé(s).`,
    });

    const summary = results
      .map((row) => `${row.label} : ${row.deleted}`)
      .join(' · ');
    await this.notifications
      .notify({
        userId: actor.id,
        kind: NotificationKind.DATA_CLEANUP,
        title: 'Nettoyage des données effectué',
        body: summary || 'Aucune donnée à supprimer.',
        targetUrl: '/app/super-admin/nettoyage',
        critical: true,
      })
      .catch(() => undefined);
    // Les autres super administrateurs sont informes : une suppression de
    // donnees ne doit jamais passer inapercue.
    const others = await this.prisma.user.findMany({
      where: { role: 'SUPER_ADMIN', isActive: true, disabledAt: null },
      select: { email: true },
    });
    for (const other of others) {
      if (other.email === actor.email) continue;
      await this.notifications
        .sendMail(other.email, 'NOTIFICATION', {
          title: 'Nettoyage des données uSwap',
          body: `${actor.fullName} a lancé un nettoyage : ${summary}`,
          link: `${process.env.PUBLIC_APP_URL ?? ''}/app/super-admin/nettoyage`,
        })
        .catch(() => undefined);
    }

    return {
      dryRun: false,
      executedAt: new Date().toISOString(),
      targets: results,
      total,
      message: `Nettoyage terminé : ${total} enregistrement(s) supprimé(s).`,
    };
  }
}
