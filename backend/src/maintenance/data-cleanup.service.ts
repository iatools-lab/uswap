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
import {
  CLEANUP_TARGETS,
  PURGE_ORDER,
  type CleanupTarget,
} from './data-cleanup.targets';

/**
 * Nettoyage de la plateforme — reserve au super administrateur.
 *
 * L'ecran de maintenance couvre DEUX besoins distincts :
 *
 * 1. **Donnees de test** (`PLANNINGS`, `ATTENDANCE`, `LEAVES`, `INCIDENTS`,
 *    `NOTIFICATIONS`, `AUDIT`, `DEMO_ACCOUNTS`) : remettre l'application en
 *    configuration reelle apres une recette.
 * 2. **Donnees reelles** (`ACCOUNTS`, `STATIONS`) : le super administrateur
 *    doit pouvoir supprimer un compte (un superviseur qui n'est plus en
 *    service, un swappeur parti) ou une station, MEME si l'application est en
 *    production. La suppression emporte tout ce qui depend de l'objet
 *    (plannings, pointages, conges, incidents, notifications, journal
 *    d'audit) : aucune ligne orpheline ne subsiste.
 *
 * Garde-fous non negociables :
 * 1. `dryRun` est la valeur par defaut : la reponse decrit les volumes qui
 *    seraient supprimes sans ecrire une seule ligne ;
 * 2. une suppression reelle exige la confirmation explicite `"EFFACER"` ;
 * 3. une suppression de COMPTES ou de STATIONS exige en plus `"SUPPRIMER"` :
 *    ce sont des ecritures irreversibles sur des donnees de production ;
 * 4. le compte de l'executant n'est jamais supprime (ni detache de sa station
 *    s'il en a une... voir `STATIONS`) : il ne peut pas se verrouiller dehors ;
 * 5. tout s'execute dans UNE transaction : soit la purge est complete, soit
 *    rien n'est touche.
 *
 * Chaque execution est journalisee dans `AuditLog` ; un e-mail est envoye a
 * l'executant et aux autres super administrateurs.
 */

export type { CleanupTarget } from './data-cleanup.targets';

/** Confirmation exigee pour une suppression reelle. */
const CONFIRM_DELETE = 'EFFACER';
/** Confirmation supplementaire exigee pour supprimer des comptes/stations. */
const CONFIRM_SENSITIVE = 'SUPPRIMER';

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
      CLEANUP_TARGETS.map(
        async ({ id, count }) => [id, await count(this.prisma)] as const,
      ),
    );
    return {
      counts: Object.fromEntries(counts) as Record<CleanupTarget, number>,
      targets: this.targets(),
      // Les cibles qui touchent aux comptes ou aux stations sont signalees :
      // l'interface demande alors la confirmation renforcee.
      sensitiveTargets: CLEANUP_TARGETS.filter(
        (target) => target.sensitive,
      ).map((target) => target.id),
      executable: true,
    };
  }

  /**
   * Previsualise ou execute un nettoyage.
   *
   * @param target        cible unique (compatibilite)
   * @param targets       liste de cibles
   * @param dryRun        `true` (defaut) : compte seulement
   * @param confirm       doit valoir « EFFACER » pour supprimer reellement
   * @param confirmSensitive doit valoir « SUPPRIMER » si la selection contient
   *                      des comptes ou des stations
   */
  async run(
    actor: AuthenticatedUser,
    input: {
      target?: string;
      targets?: string[];
      dryRun?: boolean;
      confirm?: string;
      confirmSensitive?: string;
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
    ].map((value) => String(value).trim().toUpperCase());

    const selectedIds = new Set(requested);
    const selected = CLEANUP_TARGETS.filter((target) =>
      selectedIds.has(target.id),
    );
    if (!selected.length) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Choisissez au moins une catégorie de données à nettoyer.',
        400,
      );
    }

    const unknown = requested.filter(
      (value) => !CLEANUP_TARGETS.some((target) => target.id === value),
    );
    if (unknown.length) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        `Catégorie inconnue : ${unknown.join(', ')}.`,
        400,
      );
    }

    const dryRun = input.dryRun !== false;
    const keptIds = [actor.id];
    const hasSensitive = selected.some((target) => target.sensitive);

    if (dryRun) {
      const preview = await Promise.all(
        selected.map(async (target) => ({
          id: target.id,
          label: target.label,
          affected: await target.count(this.prisma),
          destructive: target.destructive,
          sensitive: Boolean(target.sensitive),
        })),
      );
      return {
        dryRun: true,
        executedAt: new Date().toISOString(),
        targets: preview,
        total: preview.reduce((sum, row) => sum + row.affected, 0),
        requiresSensitiveConfirmation: hasSensitive,
        // « ACCOUNTS » conserve le compte de l'operateur : on l'annonce pour
        // qu'aucun super administrateur ne s'attende a disparaitre lui aussi.
        preservedAccount: hasSensitive ? actor.email : null,
        message:
          'Simulation uniquement : aucune donnée n’a été supprimée. Saisissez « EFFACER » pour confirmer.',
      };
    }

    if ((input.confirm ?? '').trim().toUpperCase() !== CONFIRM_DELETE) {
      throw new ConflictDomain(
        'CONFIRMATION_REQUIRED',
        'Confirmez la suppression en saisissant « EFFACER ».',
        400,
      );
    }
    if (
      hasSensitive &&
      (input.confirmSensitive ?? '').trim().toUpperCase() !== CONFIRM_SENSITIVE
    ) {
      throw new ConflictDomain(
        'SENSITIVE_CONFIRMATION_REQUIRED',
        `La suppression de comptes ou de stations est irréversible. Saisissez « ${CONFIRM_SENSITIVE} » pour confirmer.`,
        400,
      );
    }

    // Ordre impose par les dependances : voir PURGE_ORDER.
    const ordered = [...selected].sort(
      (a, b) => PURGE_ORDER.indexOf(a.id) - PURGE_ORDER.indexOf(b.id),
    );

    // Une seule transaction : si une seule suppression echoue (contrainte,
    // base indisponible), rien n'est supprime. Une purge a moitie faite est
    // plus dangereuse qu'une purge refusee.
    const results = await this.prisma.$transaction(
      async (tx) => {
        const out: { id: CleanupTarget; label: string; deleted: number }[] = [];
        for (const target of ordered) {
          // `$transaction` fournit un client transactionnel : exactement
          // l'interface dont les cibles ont besoin, et les ecritures METIER
          // (audit, notifications) restent hors de la transaction.
          const deleted = await target.purge(tx, keptIds);
          out.push({ id: target.id, label: target.label, deleted });
        }
        return out;
      },
      { timeout: 120_000 },
    );

    for (const row of results) {
      this.logger.warn(
        `Nettoyage ${row.id} par ${actor.email} : ${row.deleted} enregistrement(s).`,
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
      metadata: { targets: results, total, sensitive: hasSensitive },
      message: `Nettoyage des données : ${total} enregistrement(s) supprimé(s).`,
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
