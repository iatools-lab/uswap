import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IncidentActionType,
  IncidentCategory,
  IncidentSeverity,
  IncidentStatus,
  NotificationKind,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { QueryIncidentsDto } from './dto/query-incidents.dto';
import { UpdateIncidentDto } from './dto/update-incident.dto';
type Actor = { id: string; role: Role };

/**
 * Allowed transitions, mirrored from the frontend IncidentCenter state machine.
 * Keeping the table server-side means a stale client cannot push an incident
 * into an impossible state.
 */
const ALLOWED_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  REPORTED: ['TO_REVIEW', 'ACKNOWLEDGED'],
  TO_REVIEW: ['ACKNOWLEDGED'],
  ACKNOWLEDGED: ['IN_PROGRESS'],
  IN_PROGRESS: ['RESOLVED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: [],
};

const OPEN_STATUSES: IncidentStatus[] = [
  'REPORTED',
  'TO_REVIEW',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
];

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Full list plus the KPIs and reference data the incident screen renders. */
  async list(actor: Actor, query: QueryIncidentsDto) {
    const stationId = await this.resolveStationFilter(actor, query.stationId);

    const rows = await this.prisma.incident.findMany({
      where: stationId ? { stationId } : undefined,
      orderBy: { updatedAt: 'desc' },
      include: {
        station: { select: { id: true, name: true } },
        reporter: { select: { id: true, fullName: true } },
        assignee: { select: { id: true, fullName: true } },
        affectedSwapper: { select: { id: true, fullName: true } },
        actions: { orderBy: { createdAt: 'desc' } },
      },
    });

    const serialized = rows.map((row) => this.serialize(row));
    const resolved = rows.filter((row) => row.resolvedAt);
    const meanResolutionHours = resolved.length
      ? Math.round(
          (resolved.reduce(
            (sum, row) =>
              sum +
              (row.resolvedAt!.getTime() - row.createdAt.getTime()) / 3_600_000,
            0,
          ) /
            resolved.length) *
            10,
        ) / 10
      : 0;

    const stations =
      actor.role === Role.SUPERVISOR
        ? await this.prisma.station.findMany({
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
          })
        : [];

    const scopeStationId =
      actor.role === Role.STATION_CHIEF
        ? (await this.primaryStationOf(actor.id)) ?? undefined
        : stationId;

    const swappers = await this.prisma.user.findMany({
      where: {
        role: Role.SWAPPER,
        isActive: true,
        ...(scopeStationId ? { stationId: scopeStationId } : {}),
      },
      select: { id: true, fullName: true, stationId: true },
      orderBy: { fullName: 'asc' },
    });

    return {
      incidents: serialized,
      metrics: {
        total: rows.length,
        open: rows.filter((row) => OPEN_STATUSES.includes(row.status)).length,
        critical: rows.filter(
          (row) =>
            row.severity === IncidentSeverity.CRITICAL &&
            row.status !== IncidentStatus.CLOSED,
        ).length,
        meanResolutionHours,
      },
      stations,
      swappers,
    };
  }

  /** Declares an incident. Only a station chief raises one, for its own staff. */
  async create(actor: Actor, dto: CreateIncidentDto) {
    if (actor.role !== Role.STATION_CHIEF) {
      throw new ForbiddenException(
        'Seul un chef de station peut déclarer un incident.',
      );
    }

    const stationId = await this.primaryStationOf(actor.id);
    if (!stationId) {
      throw new BadRequestException('Sélectionnez une station valide.');
    }

    const affected = await this.prisma.user.findFirst({
      where: {
        id: dto.affectedSwapperId,
        role: Role.SWAPPER,
        isActive: true,
        stationId,
      },
      select: { id: true, fullName: true },
    });
    if (!affected) {
      throw new BadRequestException(
        'Sélectionnez un swappeur actif rattaché à cette station.',
      );
    }

    const title = dto.title?.trim() ?? '';
    const description = dto.description?.trim() ?? '';
    if (title.length < 5 || description.length < 12) {
      throw new BadRequestException(
        'Décrivez précisément l’incident et son impact.',
      );
    }

    const now = new Date();
    const incident = await this.prisma.incident.create({
      data: {
        stationId,
        affectedSwapperId: affected.id,
        reporterId: actor.id,
        category: dto.category ?? IncidentCategory.OTHER,
        severity: dto.severity ?? IncidentSeverity.MEDIUM,
        status: IncidentStatus.REPORTED,
        title,
        description,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : now,
        actions: {
          create: {
            authorId: actor.id,
            type: IncidentActionType.CREATED,
            fromStatus: null,
            toStatus: IncidentStatus.REPORTED,
            comment: 'Incident déclaré.',
          },
        },
      },
      include: {
        station: { select: { id: true, name: true } },
        reporter: { select: { id: true, fullName: true } },
        assignee: { select: { id: true, fullName: true } },
        affectedSwapper: { select: { id: true, fullName: true } },
        actions: { orderBy: { createdAt: 'desc' } },
      },
    });

    await this.notifications.notifyRoles({
      roles: [Role.SUPERVISOR, Role.ADMIN],
      stationIds: [stationId],
      kind: NotificationKind.INCIDENT,
      title: `Nouvel incident · ${incident.severity}`,
      body: `${affected.fullName} · ${title} à ${incident.station.name}.`,
      link: '/app/supervision/incidents',
      entityId: incident.id,
      excludeUserId: actor.id,
    });

    return this.serialize(incident);
  }

  /** Advances an incident along its state machine (supervisors only). */
  async update(actor: Actor, id: string, dto: UpdateIncidentDto) {
    if (actor.role !== Role.SUPERVISOR) {
      throw new ForbiddenException(
        'Seul un superviseur peut faire évoluer un incident.',
      );
    }

    const incident = await this.prisma.incident.findUnique({ where: { id } });
    if (!incident) {
      throw new NotFoundException('Incident introuvable.');
    }

    const nextStatus = dto.status ?? incident.status;
    if (
      nextStatus !== incident.status &&
      !ALLOWED_TRANSITIONS[incident.status].includes(nextStatus)
    ) {
      throw new ConflictException(
        'Cette transition de statut n’est pas autorisée.',
      );
    }

    const comment = dto.comment?.trim() ?? '';
    if (
      (nextStatus === IncidentStatus.RESOLVED ||
        nextStatus === IncidentStatus.CLOSED) &&
      comment.length < 10
    ) {
      throw new BadRequestException(
        'Documentez la résolution en au moins 10 caractères.',
      );
    }

    const before = incident.status;
    const now = new Date();
    const updated = await this.prisma.incident.update({
      where: { id },
      data: {
        status: nextStatus,
        ...(dto.severity ? { severity: dto.severity } : {}),
        ...(dto.assigneeId !== undefined
          ? { assigneeId: dto.assigneeId || null }
          : {}),
        ...(nextStatus === IncidentStatus.RESOLVED
          ? { resolvedAt: now, resolution: comment }
          : {}),
        ...(nextStatus === IncidentStatus.CLOSED ? { closedAt: now } : {}),
        actions: {
          create: {
            authorId: actor.id,
            type:
              nextStatus === IncidentStatus.CLOSED
                ? IncidentActionType.CLOSED
                : nextStatus === IncidentStatus.RESOLVED
                  ? IncidentActionType.RESOLVED
                  : before === nextStatus
                    ? IncidentActionType.COMMENT
                    : IncidentActionType.QUALIFIED,
            fromStatus: before,
            toStatus: nextStatus,
            comment: comment || 'Statut mis à jour.',
          },
        },
      },
      include: {
        station: { select: { id: true, name: true } },
        reporter: { select: { id: true, fullName: true } },
        assignee: { select: { id: true, fullName: true } },
        affectedSwapper: { select: { id: true, fullName: true } },
        actions: { orderBy: { createdAt: 'desc' } },
      },
    });

    await this.notifications.notifyRoles({
      roles: [Role.STATION_CHIEF, Role.SUPERVISOR, Role.ADMIN],
      stationIds: [incident.stationId],
      kind: NotificationKind.INCIDENT,
      title: `Incident ${nextStatus.toLowerCase()}`,
      body: `${incident.title} · ${comment || 'Suivi mis à jour'}`,
      link: '/app/supervision/incidents',
      entityId: incident.id,
      excludeUserId: actor.id,
    });

    return this.serialize(updated);
  }

  /** Supervisors and admins read the whole network; a chief only its station. */
  private async resolveStationFilter(
    actor: Actor,
    requested?: string,
  ): Promise<string | undefined> {
    if (actor.role === Role.STATION_CHIEF) {
      const stationId = await this.primaryStationOf(actor.id);
      if (!stationId) {
        throw new BadRequestException('Aucune station associée à ce compte.');
      }
      return stationId;
    }
    if (actor.role === Role.SUPERVISOR || actor.role === Role.ADMIN) {
      return requested || undefined;
    }
    throw new ForbiddenException('Accès non autorisé aux incidents.');
  }

  private async primaryStationOf(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { stationId: true },
    });
    return user?.stationId ?? null;
  }

  private serialize(row: {
    stationId: string;
    station?: { name: string } | null;
    reporter?: { fullName: string } | null;
    assignee?: { fullName: string } | null;
    affectedSwapper?: { fullName: string } | null;
  } & Record<string, unknown>) {    const { station, reporter, assignee, affectedSwapper, ...rest } = row;
    return {
      ...rest,
      stationName: station?.name ?? 'Station inconnue',
      reporterName: reporter?.fullName ?? 'Compte inconnu',
      assigneeName: assignee?.fullName ?? null,
      affectedSwapperName: affectedSwapper?.fullName ?? 'Swappeur inconnu',
    };
  }
}
