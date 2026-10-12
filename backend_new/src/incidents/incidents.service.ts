import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../common/scope.service';
import {
  ConflictDomain,
  ErrorCode,
  ForbiddenDomain,
  NotFoundDomain,
} from '../common/errors/domain-errors';
import { serializeIncident } from '../common/serializers';
import type { AuthenticatedUser } from '../common/guards/roles.guard';
import { NotificationKind } from '../notifications/categories';
import type { IncidentSeverity, IncidentStatus } from '@prisma/client';

/**
 * Transitions autorisees du cycle de vie d'un incident.
 *
 * Le sens est volontairement lineaire : un incident cloture ne peut plus etre
 * modifie, et un incident resolu peut etre rouvert si le probleme reapparait.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  REPORTED: ['TO_REVIEW', 'ACKNOWLEDGED'],
  TO_REVIEW: ['ACKNOWLEDGED'],
  ACKNOWLEDGED: ['IN_PROGRESS'],
  IN_PROGRESS: ['RESOLVED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: [],
};

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const CATEGORIES = [
  'ATTENDANCE',
  'HEALTH',
  'SAFETY',
  'BEHAVIOR',
  'SCHEDULING',
  'OTHER',
];

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Liste et metriques                                                */
  /* ---------------------------------------------------------------- */

  async list(user: AuthenticatedUser, stationId?: string) {
    const incidents = await this.prisma.incident.findMany({
      where: stationId ? { stationId } : {},
      orderBy: { updatedAt: 'desc' },
      include: {
        station: { select: { id: true, name: true } },
        affectedSwapper: { select: { id: true, fullName: true } },
        reporter: { select: { id: true, fullName: true } },
        assignee: { select: { id: true, fullName: true } },
        actions: { orderBy: { createdAt: 'desc' } },
      },
    });

    const ctx = await this.scope.serializeContext();
    const rows = incidents.map((incident) => serializeIncident(incident, ctx));

    const resolved = incidents.filter((incident) => incident.resolvedAt);
    const meanHours = resolved.length
      ? Math.round(
          (resolved.reduce(
            (total, incident) =>
              total +
              (incident.resolvedAt!.getTime() - incident.createdAt.getTime()) /
                3_600_000,
            0,
          ) /
            resolved.length) *
            10,
        ) / 10
      : 0;

    // Les agents proposes pour un signalement servent la station concernee.
    const stationSwappers = stationId
      ? await this.servantsOf(stationId)
      : [];

    return {
      incidents: rows,
      metrics: {
        total: rows.length,
        open: rows.filter(
          (row) => !['RESOLVED', 'CLOSED'].includes(row.status),
        ).length,
        critical: rows.filter(
          (row) => row.severity === 'CRITICAL' && row.status !== 'CLOSED',
        ).length,
        meanResolutionHours: meanHours,
      },
      stations:
        user.role === 'SUPERVISOR' || user.role === 'ADMIN'
          ? (
              await this.prisma.station.findMany({
                where: { isActive: true },
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
              })
            ).map((station) => ({ id: station.id, name: station.name }))
          : [],
      swappers: stationSwappers,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Signalement                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Cree un incident. Un agent ne peut signaler qu'une situation qui le
   * concerne ; un superviseur peut signaler pour un membre de son perimetre.
   */
  async create(
    user: AuthenticatedUser,
    payload: {
      stationId: string;
      affectedSwapperId: string;
      category?: string;
      severity?: string;
      title: string;
      description: string;
      occurredAt?: string;
      attachmentIds?: string[];
    },
  ) {
    const station = await this.prisma.station.findUnique({
      where: { id: payload.stationId },
      select: { id: true, name: true, isActive: true },
    });
    if (!station) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Sélectionnez une station valide.',
        400,
      );
    }

    const affected = await this.prisma.user.findFirst({
      where: {
        id: payload.affectedSwapperId,
        role: 'SWAPPER',
        isActive: true,
        disabledAt: null,
      },
      select: { id: true, fullName: true, stationId: true },
    });
    if (!affected) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Sélectionnez un agent actif rattaché ou affecté à cette station.',
        400,
      );
    }
    const serves = await this.scope.servesStation(
      affected.id,
      station.id,
      affected.stationId,
    );
    if (!serves) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Sélectionnez un agent actif rattaché ou affecté à cette station.',
        400,
      );
    }
    if (user.role === 'SWAPPER' && affected.id !== user.id) {
      throw new ForbiddenDomain(
        'INCIDENT_SELF_ONLY',
        'Vous pouvez uniquement signaler une situation qui vous concerne.',
      );
    }

    const title = (payload.title ?? '').trim();
    const description = (payload.description ?? '').trim();
    if (title.length < 5 || description.length < 12) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Décrivez précisément l’incident et son impact.',
        400,
      );
    }

    const severity = SEVERITIES.includes((payload.severity ?? '').toUpperCase())
      ? (payload.severity!.toUpperCase() as IncidentSeverity)
      : ('MEDIUM' as IncidentSeverity);
    const category = CATEGORIES.includes((payload.category ?? '').toUpperCase())
      ? (payload.category!.toUpperCase() as never)
      : ('OTHER' as never);

    const incident = await this.prisma.$transaction(async (tx) => {
      const created = await tx.incident.create({
        data: {
          stationId: station.id,
          affectedSwapperId: affected.id,
          reporterId: user.id,
          category,
          severity,
          status: 'REPORTED',
          title,
          description,
          attachmentIds: JSON.stringify(payload.attachmentIds ?? []),
          occurredAt: payload.occurredAt
            ? new Date(payload.occurredAt)
            : new Date(),
        },
      });
      await tx.incidentAction.create({
        data: {
          incidentId: created.id,
          authorId: user.id,
          type: 'CREATED',
          fromStatus: null,
          toStatus: 'REPORTED',
          comment: 'Incident déclaré.',
        },
      });
      return created;
    });

    const full = await this.prisma.incident.findUniqueOrThrow({
      where: { id: incident.id },
      include: {
        station: { select: { id: true, name: true } },
        affectedSwapper: { select: { id: true, fullName: true } },
        reporter: { select: { id: true, fullName: true } },
        actions: true,
      },
    });

    await this.notifications.notifyStaff([user.id], {
      kind: NotificationKind.INCIDENT,
      title: `Nouvel incident · ${severity}`,
      body: `${affected.fullName} · ${title} à ${station.name}.`,
      targetId: incident.id,
      targetUrl: `/incidents?incident=${incident.id}`,
      critical: severity === 'CRITICAL' || severity === 'HIGH',
    });
    await this.audit.record({
      actorId: user.id,
      action: 'INCIDENT_REPORTED',
      targetType: 'Incident',
      targetId: incident.id,
      stationId: station.id,
      metadata: { severity, category, title },
    });

    const ctx = await this.scope.serializeContext();
    return serializeIncident(full, ctx);
  }

  /* ---------------------------------------------------------------- */
  /* Traitement                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Fait avancer un incident. Toute transition est controlee : un changement
   * non prevu est refuse avec le statut courant rappele.
   */
  async update(
    user: AuthenticatedUser,
    id: string,
    payload: {
      status?: string;
      severity?: string;
      assigneeId?: string | null;
      comment?: string;
    },
  ) {
    const incident = await this.prisma.incident.findUnique({ where: { id } });
    if (!incident) {
      throw new NotFoundDomain(
        ErrorCode.NOT_FOUND,
        'Incident introuvable.',
      );
    }

    const nextStatus = (
      payload.status ? payload.status.toUpperCase() : incident.status
    ) as IncidentStatus;
    if (
      nextStatus !== incident.status &&
      !ALLOWED_TRANSITIONS[incident.status]?.includes(nextStatus)
    ) {
      throw new ConflictDomain(
        'INVALID_STATUS_TRANSITION',
        `Cette transition de statut n’est pas autorisée (statut actuel : ${incident.status}).`,
        409,
      );
    }

    const comment = (payload.comment ?? '').trim();
    if (
      ['RESOLVED', 'CLOSED'].includes(nextStatus) &&
      comment.length < 10
    ) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Documentez la résolution en au moins 10 caractères.',
        400,
      );
    }

    const before = incident.status;
    const actionType = this.actionTypeFor(before, nextStatus);

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.incident.update({
        where: { id },
        data: {
          status: nextStatus,
          ...(payload.severity
            ? { severity: payload.severity.toUpperCase() as IncidentSeverity }
            : {}),
          ...(payload.assigneeId !== undefined
            ? { assigneeId: payload.assigneeId || null }
            : {}),
          ...(nextStatus === 'RESOLVED'
            ? { resolvedAt: new Date(), resolution: comment }
            : {}),
          ...(nextStatus === 'CLOSED' ? { closedAt: new Date() } : {}),
        },
      });
      await tx.incidentAction.create({
        data: {
          incidentId: id,
          authorId: user.id,
          type: actionType,
          fromStatus: before,
          toStatus: nextStatus,
          comment: comment || 'Statut mis à jour.',
        },
      });
      return next;
    });

    const full = await this.prisma.incident.findUniqueOrThrow({
      where: { id },
      include: {
        station: { select: { id: true, name: true } },
        affectedSwapper: { select: { id: true, fullName: true } },
        reporter: { select: { id: true, fullName: true } },
        assignee: { select: { id: true, fullName: true } },
        actions: { orderBy: { createdAt: 'desc' } },
      },
    });

    await this.notifications.notifyStaff([incident.reporterId], {
      kind: NotificationKind.INCIDENT,
      title: `Incident ${nextStatus.toLowerCase()}`,
      body: `${incident.title} · ${comment || 'Suivi mis à jour'}`,
      targetId: id,
      targetUrl: `/incidents?incident=${id}`,
      critical: ['RESOLVED', 'CLOSED'].includes(nextStatus),
    });
    await this.audit.record({
      actorId: user.id,
      action: 'INCIDENT_UPDATED',
      targetType: 'Incident',
      targetId: id,
      stationId: incident.stationId,
      metadata: { from: before, to: nextStatus, comment },
    });

    const ctx = await this.scope.serializeContext();
    return serializeIncident(full, ctx);
  }

  /** Incident unique, avec son fil d'actions complet. */
  async detail(id: string) {
    const incident = await this.prisma.incident.findUnique({
      where: { id },
      include: {
        station: { select: { id: true, name: true } },
        affectedSwapper: { select: { id: true, fullName: true } },
        reporter: { select: { id: true, fullName: true } },
        assignee: { select: { id: true, fullName: true } },
        actions: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!incident) {
      throw new NotFoundDomain(ErrorCode.NOT_FOUND, 'Incident introuvable.');
    }
    const ctx = await this.scope.serializeContext();
    return serializeIncident(incident, ctx);
  }

  /* ---------------------------------------------------------------- */
  /* Interne                                                           */
  /* ---------------------------------------------------------------- */

  /** Agents rattaches a la station ou ponctuellement affectes dessus. */
  private async servantsOf(stationId: string) {
    const occurrences = await this.prisma.occurrence.findMany({
      where: { stationId, status: 'PUBLISHED' },
      select: { assignments: { select: { userId: true } } },
    });
    const assignedIds = new Set(
      occurrences.flatMap((occurrence) =>
        occurrence.assignments.map((assignment) => assignment.userId),
      ),
    );
    const users = await this.prisma.user.findMany({
      where: {
        role: 'SWAPPER',
        isActive: true,
        disabledAt: null,
        OR: [{ stationId }, { id: { in: [...assignedIds] } }],
      },
      select: { id: true, fullName: true, stationId: true },
      orderBy: { fullName: 'asc' },
    });
    return users;
  }

  /** Type d'action deduit de la transition effectuee. */
  private actionTypeFor(from: string, to: string): never {
    if (to === 'CLOSED') return 'CLOSED' as never;
    if (to === 'RESOLVED') return 'RESOLVED' as never;
    if (from === to) return 'COMMENT' as never;
    return 'QUALIFIED' as never;
  }
}
