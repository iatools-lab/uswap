import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService } from '../auth/auth.service';
import { PasswordsService } from '../auth/passwords.service';
import {
  ConflictDomain,
  ErrorCode,
  NotFoundDomain,
} from '../common/errors/domain-errors';
import {
  serializeSettings,
  serializeSettingsRevision,
} from '../common/serializers';
import type { AuthenticatedUser } from '../common/guards/roles.guard';
import { createHash } from 'node:crypto';

/** Champs modifiables des reglages globaux, avec leurs bornes. */
const NUMERIC_BOUNDS = {
  sessionMinutes: { min: 15, max: 720 },
  invitationValidityHours: { min: 1, max: 168 },
  maxAttachmentMb: { min: 1, max: 25 },
  notificationRetentionDays: { min: 7, max: 365 },
} as const;

/** Libelles francais utilises par l'ecran d'audit. */
const FIELD_LABELS: Record<string, string> = {
  fullName: 'nom',
  role: 'rôle',
  stationId: 'station',
  phoneNumber: 'téléphone',
  address: 'adresse',
  email: 'adresse e-mail',
  isActive: 'statut du compte',
  disabledAt: 'statut du compte',
  invitationStatus: 'invitation',
  supportEmail: 'adresse de support',
  sessionMinutes: 'durée de session',
  invitationValidityHours: 'validité des invitations',
  maxAttachmentMb: 'taille des pièces jointes',
  notificationRetentionDays: 'rétention des notifications',
  webhookSecretConfigured: 'configuration du webhook',
  passwordUpdated: 'mot de passe',
};

const STATUS_LABELS: Record<string, string> = {
  REPORTED: 'Signalé',
  TO_REVIEW: 'À analyser',
  ACKNOWLEDGED: 'Pris en charge',
  IN_PROGRESS: 'En traitement',
  RESOLVED: 'Résolu',
  CLOSED: 'Clôturé',
};

const ACCOUNT_ACTIONS: Record<string, string> = {
  CREATED: 'Création de compte',
  IMPORTED: 'Import de compte',
  UPDATED: 'Modification de compte',
  ACTIVATED: 'Activation de compte',
  REACTIVATED: 'Réactivation de compte',
  DISABLED: 'Désactivation de compte',
  PASSWORD_UPDATED: 'Changement de mot de passe',
  PASSWORD_RESET: 'Mot de passe oublié',
  INVITATION_RESENT: 'Renvoi d’invitation',
};

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Nomme `auditLog` pour ne pas entrer en collision avec la methode
    // publique `audit()` qui alimente l'ecran d'administration.
    private readonly auditLog: AuditService,
    private readonly notifications: NotificationsService,
    private readonly auth: AuthService,
    private readonly passwords: PasswordsService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Reglages globaux                                                  */
  /* ---------------------------------------------------------------- */

  /** Parametres courants et les huit dernieres revisions. */
  async settings() {
    const settings = await this.ensureSettings();
    const history = await this.prisma.settingsRevision.findMany({
      orderBy: { revision: 'desc' },
      take: 8,
    });
    return {
      settings: serializeSettings(settings),
      history: history.map(serializeSettingsRevision),
    };
  }

  /**
   * Met a jour les reglages. Chaque enregistrement incremente la revision et
   * conserve l'etat precedent : l'historique reste consultable et comparable.
   */
  async updateSettings(
    actor: AuthenticatedUser,
    payload: Record<string, unknown>,
  ) {
    const current = await this.ensureSettings();

    const number = (key: keyof typeof NUMERIC_BOUNDS): number => {
      const bounds = NUMERIC_BOUNDS[key];
      const value = Number(payload[key]);
      if (!Number.isFinite(value) || value < bounds.min || value > bounds.max) {
        throw new ConflictDomain(
          ErrorCode.VALIDATION,
          `La valeur « ${key} » doit être comprise entre ${bounds.min} et ${bounds.max}.`,
          400,
        );
      }
      return Math.round(value);
    };

    const supportEmail = String(payload.supportEmail ?? '').trim();
    if (!/^\S+@\S+\.\S+$/.test(supportEmail)) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        "L'adresse de support est invalide.",
        400,
      );
    }

    const webhookSecret = String(payload.webhookSecret ?? '').trim();
    const before = {
      sessionMinutes: current.sessionMinutes,
      invitationValidityHours: current.invitationValidityHours,
      maxAttachmentMb: current.maxAttachmentMb,
      notificationRetentionDays: current.notificationRetentionDays,
      supportEmail: current.supportEmail,
      webhookSecretConfigured: Boolean(current.webhookSecretHash),
    };

    const next = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.globalSettings.update({
        where: { id: 'global' },
        data: {
          sessionMinutes: number('sessionMinutes'),
          invitationValidityHours: number('invitationValidityHours'),
          maxAttachmentMb: number('maxAttachmentMb'),
          notificationRetentionDays: number('notificationRetentionDays'),
          supportEmail,
          // Le secret n'est jamais stocke en clair : seul son empreinte reste.
          webhookSecretHash: webhookSecret
            ? createHash('sha256').update(webhookSecret).digest('hex')
            : current.webhookSecretHash,
          revision: current.revision + 1,
          updatedById: actor.id,
        },
      });

      const after = {
        sessionMinutes: updated.sessionMinutes,
        invitationValidityHours: updated.invitationValidityHours,
        maxAttachmentMb: updated.maxAttachmentMb,
        notificationRetentionDays: updated.notificationRetentionDays,
        supportEmail: updated.supportEmail,
        webhookSecretConfigured: Boolean(updated.webhookSecretHash),
      };

      await tx.settingsRevision.create({
        data: {
          revision: updated.revision,
          actorId: actor.id,
          before: JSON.stringify(before),
          after: JSON.stringify(after),
        },
      });

      return updated;
    });

    await this.auditLog.record({
      actorId: actor.id,
      action: 'SETTINGS_UPDATED',
      targetType: 'GlobalSettings',
      targetId: 'global',
      metadata: { before, after: serializeSettings(next) },
    });

    const history = await this.prisma.settingsRevision.findMany({
      orderBy: { revision: 'desc' },
      take: 8,
    });
    return {
      settings: serializeSettings(next),
      history: history.map(serializeSettingsRevision),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Journal d'audit (US supervision)                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Vue unifiee de l'audit : actions sur les comptes, suivi d'incidents,
   * changements d'affectation et modifications de reglages. Le frontend
   * consomme directement cette liste plate.
   */
  async audit(param: {
    from?: string;
    to?: string;
    category?: string;
    actorId?: string;
  }) {
    const from = param.from
      ? new Date(param.from)
      : new Date(Date.now() - 90 * 86_400_000);
    const to = param.to ? new Date(param.to) : new Date(Date.now() + 86_400_000);

    const [accounts, incidents, changes, revisions, daily] = await Promise.all([
      this.prisma.accountAudit.findMany({
        where: { createdAt: { gte: from, lte: to } },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              stationId: true,
              station: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.incidentAction.findMany({
        where: { createdAt: { gte: from, lte: to } },
        include: {
          author: { select: { id: true, fullName: true } },
          incident: {
            include: {
              affectedSwapper: { select: { id: true, fullName: true } },
              station: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.shiftChange.findMany({
        where: { createdAt: { gte: from, lte: to } },
      }),
      this.prisma.settingsRevision.findMany({
        where: { createdAt: { gte: from, lte: to } },
      }),
      this.auditLog.list({
        from: from.toISOString(),
        to: to.toISOString(),
      }),
    ]);

    const actorIds = new Set<string>();
    const collect = (id: string | null | undefined) => {
      if (id) actorIds.add(id);
    };
    accounts.forEach((entry) => collect(entry.actorId));
    incidents.forEach((entry) => collect(entry.authorId));
    changes.forEach((entry) => collect(entry.initiatorId));
    revisions.forEach((entry) => collect(entry.actorId));

    const actors = await this.prisma.user.findMany({
      where: { id: { in: [...actorIds] } },
      select: { id: true, fullName: true },
    });
    const nameOf = new Map(actors.map((actor) => [actor.id, actor.fullName]));

    const changedFields = (
      before: Record<string, unknown>,
      after: Record<string, unknown>,
    ) =>
      [
        ...new Set([...Object.keys(before), ...Object.keys(after)]),
      ]
        .filter((key) => key !== 'webhookSecret' && before[key] !== after[key])
        .map((key) => FIELD_LABELS[key] ?? key)
        .filter((value, index, values) => values.indexOf(value) === index);

    const events = [
      ...accounts.map((entry) => ({
        id: `account:${entry.id}`,
        category: 'ACCOUNT',
        action: ACCOUNT_ACTIONS[entry.action] ?? entry.action,
        title: ACCOUNT_ACTIONS[entry.action] ?? 'Action sur un compte',
        objectName: entry.user?.fullName ?? 'Compte',
        actorId: entry.actorId,
        actorName: nameOf.get(entry.actorId ?? '') ?? null,
        targetUserId: entry.userId,
        stationId: entry.user?.stationId ?? null,
        stationName: entry.user?.station?.name ?? null,
        description: entry.message ?? this.describeChange(entry.before, entry.after, changedFields),
        result: 'Enregistrée',
        createdAt: entry.createdAt.toISOString(),
      })),
      ...incidents.map((entry) => ({
        id: `incident:${entry.id}`,
        category: 'INCIDENT',
        action: entry.type,
        title: `Suivi d’incident · ${entry.incident.title}`,
        objectName: `${entry.incident.affectedSwapper.fullName} · ${entry.incident.title}`,
        actorId: entry.authorId,
        actorName: entry.author?.fullName ?? null,
        targetUserId: entry.incident.affectedSwapperId,
        stationId: entry.incident.stationId,
        stationName: entry.incident.station?.name ?? null,
        description: [
          entry.fromStatus
            ? `${STATUS_LABELS[entry.fromStatus] ?? entry.fromStatus} → ${STATUS_LABELS[entry.toStatus] ?? entry.toStatus}`
            : (STATUS_LABELS[entry.toStatus] ?? entry.toStatus),
          entry.comment,
        ]
          .filter(Boolean)
          .join(' · '),
        result: 'Enregistrée',
        createdAt: entry.createdAt.toISOString(),
      })),
      ...changes.map((change) => ({
        id: `assignment:${change.id}`,
        category: 'ASSIGNMENT',
        action:
          change.type === 'REPLACEMENT'
            ? 'Remplacement'
            : change.type === 'PERMUTATION'
              ? 'Permutation'
              : 'Changement d’affectation',
        title:
          change.type === 'REPLACEMENT'
            ? 'Remplacement de swappeur'
            : change.type === 'PERMUTATION'
              ? 'Permutation de service'
              : 'Changement d’affectation',
        objectName: change.inSwapper ?? change.outSwapper ?? 'Affectation',
        actorId: change.initiatorId,
        actorName: change.initiator || nameOf.get(change.initiatorId) || null,
        targetUserId: change.inSwapperId ?? change.outSwapperId,
        stationId: change.stationId,
        stationName: change.station,
        description: [
          [change.outSwapper, change.inSwapper].filter(Boolean).join(' → '),
          change.reason,
        ]
          .filter(Boolean)
          .join(' · '),
        result: 'Enregistrée',
        createdAt: change.createdAt.toISOString(),
      })),
      ...revisions.map((revision) => ({
        id: `settings:${revision.id}`,
        category: 'SETTINGS',
        action: `Révision ${revision.revision}`,
        title: 'Modification des réglages globaux',
        objectName: 'Réglages globaux',
        actorId: revision.actorId,
        actorName: nameOf.get(revision.actorId) ?? null,
        targetUserId: null,
        stationId: null,
        stationName: null,
        description: this.describeChange(
          revision.before,
          revision.after,
          changedFields,
          'Paramètres concernés',
        ),
        result: 'Enregistrée',
        createdAt: revision.createdAt.toISOString(),
      })),
      // Les actions applicatives (planning, pointage, incident) complettent
      // la vue : elles proviennent du journal transversal.
      ...daily.map((entry) => ({
        id: `audit:${entry.id}`,
        category: this.categoryForAction(entry.action),
        action: entry.action,
        title: this.titleForAction(entry.action),
        objectName: entry.targetType,
        actorId: entry.actorId,
        actorName: entry.actorName,
        targetUserId: null,
        stationId: entry.stationId,
        stationName: null,
        description: entry.message ?? JSON.stringify(entry.metadata ?? {}),
        result: 'Enregistrée',
        createdAt: entry.createdAt,
      })),
    ]
      .filter((event) => (param.category ? event.category === param.category : true))
      .filter((event) => (param.actorId ? event.actorId === param.actorId : true))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const people = await this.prisma.user.findMany({
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });

    return { events: events.slice(0, 500), people };
  }

  /* ---------------------------------------------------------------- */
  /* Integrations                                                      */
  /* ---------------------------------------------------------------- */

  /** Etat des dependances externes, agrege pour l'ecran d'administration. */
  async integrations() {
    const settings = await this.ensureSettings();
    const [failedNotifications, failedEmails, failedSync] = await Promise.all([
      this.prisma.notificationDelivery.count({ where: { status: 'FAILED' } }),
      this.prisma.emailLog.count({ where: { status: 'FAILED' } }),
      this.prisma.leaveSyncOperation.count({ where: { status: 'FAILED' } }),
    ]);

    return {
      email: {
        driver: process.env.MAIL_DRIVER ?? process.env.MAIL_TRANSPORT ?? 'console',
        from: process.env.MAIL_FROM ?? null,
        failed: failedEmails,
        status: failedEmails ? 'DEGRADED' : 'OPERATIONAL',
      },
      notifications: {
        failedDelivery: failedNotifications,
        status: failedNotifications ? 'DEGRADED' : 'OPERATIONAL',
      },
      leaveSync: {
        enabled: process.env.LEAVE_SYNC_ENABLED === 'true',
        failed: failedSync,
        status: failedSync ? 'DEGRADED' : 'OPERATIONAL',
      },
      webhook: {
        configured: Boolean(settings.webhookSecretHash),
      },
      revision: settings.revision,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Maintenance                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Retablit l'acces du compte administrateur principal et ferme ses sessions.
   * Operation volontairement explicite : elle est journalisee.
   */
  async restoreAdminAccess(actor: AuthenticatedUser) {
    const admin = await this.prisma.user.findFirst({
      where: { role: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
    });
    if (!admin) {
      throw new NotFoundDomain(
        'ADMIN_NOT_FOUND',
        'Aucun compte administrateur à restaurer.',
      );
    }
    const password =
      process.env.ADMIN_BOOTSTRAP_PASSWORD ?? PasswordsService.generateTemporary();
    await this.prisma.user.update({
      where: { id: admin.id },
      data: {
        isActive: true,
        disabledAt: null,
        passwordHash: await this.passwords.hash(password),
        invitationStatus: 'ACTIVATED',
        invitationExpiresAt: null,
      },
    });
    await this.prisma.accountAudit.create({
      data: {
        userId: admin.id,
        actorId: actor.id,
        action: 'REACTIVATED',
        before: JSON.stringify({ isActive: false }),
        after: JSON.stringify({ isActive: true, passwordUpdated: true }),
        message: 'Acces administrateur restaure manuellement.',
      },
    });
    await this.auditLog.record({
      actorId: actor.id,
      action: 'ADMIN_ACCESS_RESTORED',
      targetType: 'User',
      targetId: admin.id,
    });
    return { ok: true, email: admin.email };
  }

  /** Diagnostics de plateforme : volumes et sante des files. */
  async platform() {
    const [
      users,
      stations,
      plannings,
      occurrences,
      notifications,
      queuedOperations,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.station.count(),
      this.prisma.planning.count(),
      this.prisma.occurrence.count(),
      this.prisma.notification.count(),
      this.prisma.leaveSyncOperation.count({ where: { status: 'QUEUED' } }),
    ]);

    return {
      users,
      stations,
      plannings,
      occurrences,
      notifications,
      queuedOperations,
      uptimeSeconds: Math.round(process.uptime()),
      environment: process.env.NODE_ENV ?? 'development',
    };
  }

  /* ---------------------------------------------------------------- */
  /* Interne                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Les reglages sont un singleton : la ligne est creee a la premiere lecture
   * si la base vient d'etre initialisee.
   */
  async ensureSettings() {
    const existing = await this.prisma.globalSettings.findUnique({
      where: { id: 'global' },
    });
    if (existing) return existing;
    return this.prisma.globalSettings.create({
      data: { id: 'global', supportEmail: 'support@uswap.local' },
    });
  }

  private describeChange(
    before: string,
    after: string,
    changedFields: (
      before: Record<string, unknown>,
      after: Record<string, unknown>,
    ) => string[],
    label = 'Champs concernés',
  ): string {
    let beforeJson: Record<string, unknown> = {};
    let afterJson: Record<string, unknown> = {};
    try {
      beforeJson = JSON.parse(before) as typeof beforeJson;
    } catch {
      beforeJson = {};
    }
    try {
      afterJson = JSON.parse(after) as typeof afterJson;
    } catch {
      afterJson = {};
    }
    const fields = changedFields(beforeJson, afterJson);
    return fields.length
      ? `${label} : ${fields.join(', ')}.`
      : 'Action enregistrée.';
  }

  private categoryForAction(action: string): string {
    if (action.startsWith('LEAVE')) return 'LEAVE';
    if (action.startsWith('INCIDENT')) return 'INCIDENT';
    if (action.startsWith('PLANNING')) return 'PLANNING';
    if (action.includes('CHECKIN') || action.includes('CHECKOUT') || action.includes('ABSENCE'))
      return 'ATTENDANCE';
    if (action.includes('SHIFT')) return 'ASSIGNMENT';
    if (action.includes('SETTINGS')) return 'SETTINGS';
    return 'SYSTEM';
  }

  private titleForAction(action: string): string {
    const labels: Record<string, string> = {
      PLANNING_CREATED: 'Création de planification',
      PLANNING_PUBLISHED: 'Publication de planification',
      SHIFT_REPLACED: 'Remplacement de swappeur',
      CHECKIN: 'Prise de service',
      CHECKIN_LATE: 'Prise de service (retard)',
      CHECKOUT: 'Fin de service',
      ATTENDANCE_CORRECTED: 'Correction de pointage',
      ABSENCE_DECLARED: 'Déclaration d’absence',
      LEAVE_SUBMITTED: 'Demande de congé',
      LEAVE_APPROVED: 'Congé approuvé',
      LEAVE_REJECTED: 'Congé refusé',
      INCIDENT_REPORTED: 'Signalement d’incident',
      INCIDENT_UPDATED: 'Suivi d’incident',
      SETTINGS_UPDATED: 'Modification des réglages',
      ADMIN_ACCESS_RESTORED: 'Restauration d’accès administrateur',
    };
    return labels[action] ?? action;
  }
}
