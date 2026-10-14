import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import {
  ConflictDomain,
  ErrorCode,
  NotFoundDomain,
} from '../common/errors/domain-errors';
import {
  serializeLeave,
  serializeLeaveBalance,
  serializeLeaveSyncOperation,
} from '../common/serializers';
import { dayCount, consumedDaysWithin } from '../common/utils/datetime';
import type { AuthenticatedUser } from '../common/guards/roles.guard';
import { NotificationKind } from '../notifications/categories';

const LEAVE_TYPES = ['ANNUAL', 'SICK', 'FAMILY', 'UNPAID', 'OTHER'] as const;
type LeaveType = (typeof LEAVE_TYPES)[number];

/** Statuts qui bloquent une nouvelle demande sur la meme periode. */
const ACTIVE_STATUSES = ['PENDING', 'APPROVED', 'QUEUED', 'SYNCING'];

export interface LeaveRequestInput {
  startDate: string;
  endDate: string;
  type: string;
  reason: string;
  attachmentId?: string | null;
}

@Injectable()
export class LeavesService {
  private readonly logger = new Logger(LeavesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Espace de l'agent : solde, demandes, sante de l'integration         */
  /* ---------------------------------------------------------------- */

  /** Consomme par l'ecran « Mes conges » : solde, demandes et integration. */
  async workspace(user: AuthenticatedUser) {
    const balance = await this.ensureBalance(user.id);
    const operations = await this.prisma.leaveSyncOperation.findMany({
      where: { userId: user.id },
      orderBy: { queuedAt: 'desc' },
    });
    const lastCompleted = operations
      .filter((item) => item.completedAt)
      .sort(
        (a, b) =>
          (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
      )[0];

    const leaves = await this.prisma.leave.findMany({
      where: { swapperId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    const attachments = await this.attachmentNames(
      leaves.map((leave) => leave.attachmentId),
    );

    return {
      balance: serializeLeaveBalance(balance),
      requests: leaves.map((leave) =>
        serializeLeave(
          leave,
          leave.attachmentId
            ? (attachments.get(leave.attachmentId) ?? null)
            : null,
          this.latestSyncStatus(operations, leave.id),
        ),
      ),
      integration: {
        // L'integration est declaree indisponible des qu'une operation a echoue.
        available: !operations.some((item) => item.status === 'FAILED'),
        lastSuccessfulSyncAt:
          lastCompleted?.completedAt?.toISOString() ?? balance.syncedAt.toISOString(),
        pendingOperations: operations.filter((item) =>
          ['QUEUED', 'PROCESSING', 'FAILED'].includes(item.status),
        ).length,
      },
    };
  }

  async balance(user: AuthenticatedUser) {
    const balance = await this.ensureBalance(user.id);
    return serializeLeaveBalance(balance);
  }

  /* ---------------------------------------------------------------- */
  /* Demandes                                                          */
  /* ---------------------------------------------------------------- */

  /** Cree une demande : periode future, sans chevauchement, solde suffisant. */
  async submit(user: AuthenticatedUser, input: LeaveRequestInput) {
    const type = this.requireType(input.type);
    const reason = (input.reason ?? '').trim();
    if (reason.length < 8) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Précisez le motif de votre demande (8 caractères minimum).',
        400,
      );
    }
    const period = this.requestPeriod(input.startDate, input.endDate);
    await this.assertNoOverlap(user.id, period.startTime, period.endTime);

    const balance = await this.ensureBalance(user.id);
    const days = dayCount(period.startTime, period.endTime);
    const available = balance.remainingDays - balance.pendingDays;
    if (days > available) {
      throw new ConflictDomain(
        ErrorCode.INSUFFICIENT_BALANCE,
        'Cette demande dépasse votre solde disponible après prise en compte des demandes en attente.',
        409,
        { requested: days, available },
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const leave = await tx.leave.create({
        data: {
          swapperId: user.id,
          startTime: new Date(period.startTime),
          endTime: new Date(period.endTime),
          type: type as never,
          status: 'PENDING',
          reason,
          attachmentId: input.attachmentId ?? null,
          clientRef: `leave-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          submittedAt: new Date(),
          cancellable: true,
          editable: true,
        },
      });
      await tx.leaveBalance.update({
        where: { swapperId: user.id },
        data: { pendingDays: { increment: days } },
      });
      // L'integration RH est alimentee des la soumission (RM-15).
      await tx.leaveSyncOperation.create({
        data: {
          leaveId: leave.id,
          userId: user.id,
          action: 'CREATE',
          status: 'QUEUED',
          idempotencyKey: `leave-create-${leave.id}`,
          nextAttemptAt: new Date(Date.now() + 60_000),
        },
      });
      return leave;
    });

    // Les administrateurs et superviseurs sont preveus de la demande.
    await this.notifications.notifyStaff([], {
      kind: NotificationKind.LEAVE_SUBMITTED,
      title: 'Nouvelle demande de congé',
      body: `${user.fullName} · ${days} jour${days === 1 ? '' : 's'} demandé${days === 1 ? '' : 's'}.`,
      targetId: created.id,
      targetUrl: `/conges?leave=${created.id}`,
    });
    await this.audit.record({
      actorId: user.id,
      action: 'LEAVE_SUBMITTED',
      targetType: 'Leave',
      targetId: created.id,
      metadata: { days, type, reason },
    });

    return serializeLeave(created, null, 'QUEUED');
  }

  /** Modifie une demande encore en attente (periode, type, motif). */
  async update(user: AuthenticatedUser, id: string, input: LeaveRequestInput) {
    const leave = await this.prisma.leave.findUnique({ where: { id } });
    if (!leave || leave.swapperId !== user.id) {
      throw new NotFoundDomain(
        'LEAVE_NOT_FOUND',
        'Demande de congé introuvable.',
      );
    }
    if (leave.status !== 'PENDING' || !leave.editable) {
      throw new ConflictDomain(
        'LEAVE_NOT_EDITABLE',
        'Cette demande n’est plus modifiable.',
        409,
      );
    }

    const type = this.requireType(input.type);
    const reason = (input.reason ?? '').trim();
    if (reason.length < 8) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Précisez le motif de votre demande (8 caractères minimum).',
        400,
      );
    }
    const period = this.requestPeriod(input.startDate, input.endDate);
    await this.assertNoOverlap(user.id, period.startTime, period.endTime, leave.id);

    const balance = await this.ensureBalance(user.id);
    const previousDays = dayCount(
      leave.startTime.toISOString(),
      leave.endTime.toISOString(),
    );
    const nextDays = dayCount(period.startTime, period.endTime);
    const available =
      balance.remainingDays - balance.pendingDays + previousDays;
    if (nextDays > available) {
      throw new ConflictDomain(
        ErrorCode.INSUFFICIENT_BALANCE,
        'Cette demande dépasse votre solde disponible après prise en compte des demandes en attente.',
        409,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.leave.update({
        where: { id },
        data: {
          startTime: new Date(period.startTime),
          endTime: new Date(period.endTime),
          type: type as never,
          reason,
          attachmentId: input.attachmentId ?? leave.attachmentId,
        },
      });
      await tx.leaveBalance.update({
        where: { swapperId: user.id },
        data: {
          pendingDays: { increment: nextDays - previousDays },
        },
      });
      await tx.leaveSyncOperation.create({
        data: {
          leaveId: id,
          userId: user.id,
          action: 'UPDATE',
          status: 'QUEUED',
          idempotencyKey: `leave-update-${id}-${Date.now()}`,
          nextAttemptAt: new Date(Date.now() + 60_000),
        },
      });
      return next;
    });

    return serializeLeave(updated, null, 'QUEUED');
  }

  /** Annule une demande en attente et libere les jours reserves. */
  async cancel(user: AuthenticatedUser, id: string) {
    const leave = await this.prisma.leave.findUnique({ where: { id } });
    if (!leave || leave.swapperId !== user.id) {
      throw new NotFoundDomain(
        'LEAVE_NOT_FOUND',
        'Demande de congé introuvable.',
      );
    }
    if (leave.status !== 'PENDING' || !leave.cancellable) {
      throw new ConflictDomain(
        'LEAVE_NOT_CANCELLABLE',
        'Cette demande ne peut plus être annulée.',
        409,
      );
    }

    const days = dayCount(
      leave.startTime.toISOString(),
      leave.endTime.toISOString(),
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.leave.update({
        where: { id },
        data: { status: 'CANCELLED', cancellable: false, editable: false },
      });
      await tx.leaveBalance.update({
        where: { swapperId: user.id },
        data: { pendingDays: { decrement: days } },
      });
      await tx.leaveSyncOperation.create({
        data: {
          leaveId: id,
          userId: user.id,
          action: 'CANCEL',
          status: 'QUEUED',
          idempotencyKey: `leave-cancel-${id}-${Date.now()}`,
          nextAttemptAt: new Date(Date.now() + 60_000),
        },
      });
      return next;
    });

    return serializeLeave(updated, null, 'QUEUED');
  }

  /* ---------------------------------------------------------------- */
  /* Decision (administration et supervision)                          */
  /* ---------------------------------------------------------------- */

  async decide(
    actor: AuthenticatedUser,
    id: string,
    body: { decision: string; reason?: string },
  ) {
    const decision = (body.decision ?? '').toUpperCase();
    const reason = (body.reason ?? '').trim();
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Choisissez une décision valide.',
        400,
      );
    }
    if (decision === 'REJECTED' && reason.length < 5) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Indiquez le motif du refus (5 caractères minimum).',
        400,
      );
    }

    const leave = await this.prisma.leave.findUnique({
      where: { id },
      include: { swapper: { select: { id: true, fullName: true, stationId: true } } },
    });
    if (!leave) {
      throw new NotFoundDomain(
        'LEAVE_NOT_FOUND',
        'Cette demande n’est pas accessible dans votre périmètre.',
      );
    }
    if (leave.status !== 'PENDING') {
      throw new ConflictDomain(
        'LEAVE_ALREADY_DECIDED',
        'Cette demande n’est plus en attente.',
        409,
      );
    }

    const days = dayCount(
      leave.startTime.toISOString(),
      leave.endTime.toISOString(),
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.leave.update({
        where: { id },
        data: {
          status: decision as never,
          decisionReason:
            decision === 'REJECTED' ? reason : 'Demande approuvée.',
          decidedAt: new Date(),
          decidedById: actor.id,
          cancellable: false,
          editable: false,
        },
      });

      const balance = await tx.leaveBalance.findUnique({
        where: { swapperId: leave.swapperId },
      });
      if (balance) {
        if (decision === 'APPROVED') {
          // Les jours passent de « en attente » a « consommes ».
          await tx.leaveBalance.update({
            where: { swapperId: leave.swapperId },
            data: {
              pendingDays: Math.max(0, balance.pendingDays - days),
              usedDays: balance.usedDays + days,
              remainingDays: Math.max(0, balance.remainingDays - days),
            },
          });
        } else {
          await tx.leaveBalance.update({
            where: { swapperId: leave.swapperId },
            data: { pendingDays: Math.max(0, balance.pendingDays - days) },
          });
        }
      }

      await tx.leaveSyncOperation.create({
        data: {
          leaveId: id,
          userId: leave.swapperId,
          action: 'REFRESH',
          status: 'QUEUED',
          idempotencyKey: `leave-decision-${id}-${Date.now()}`,
          nextAttemptAt: new Date(Date.now() + 60_000),
        },
      });

      return updated;
    });

    // L'agent est informe de la decision (in-app + e-mail selon preferences).
    await this.notifications.notify({
      userId: leave.swapperId,
      kind:
        decision === 'APPROVED'
          ? NotificationKind.LEAVE_APPROVED
          : NotificationKind.LEAVE_REJECTED,
      title: decision === 'APPROVED' ? 'Congé approuvé' : 'Demande de congé refusée',
      body:
        decision === 'APPROVED'
          ? `Votre demande de ${days} jour${days === 1 ? '' : 's'} a été approuvée.`
          : `Votre demande de congé a été refusée : ${reason}`,
      targetId: id,
      targetUrl: `/mon-espace/conges?leave=${id}`,
      critical: true,
    });
    await this.audit.record({
      actorId: actor.id,
      action: `LEAVE_${decision}`,
      targetType: 'Leave',
      targetId: id,
      metadata: { days, reason: decision === 'REJECTED' ? reason : null },
    });

    return {
      ...serializeLeave(result, null, 'QUEUED'),
      decidedBy: actor.fullName,
    };
  }

  /**
   * File des demandes en attente pour les administrateurs, ou liste complete
   * pour un superviseur restreint a son perimetre.
   */
  async management(actor: AuthenticatedUser) {
    const leaves = await this.prisma.leave.findMany({
      where: { status: { in: ['PENDING', 'APPROVED', 'REJECTED'] } },
      orderBy: { startTime: 'desc' },
      include: {
        swapper: {
          select: {
            id: true,
            fullName: true,
            stationId: true,
            station: { select: { name: true } },
          },
        },
      },
    });

    const attachments = await this.attachmentNames(
      leaves.map((leave) => leave.attachmentId),
    );
    const operations = await this.prisma.leaveSyncOperation.findMany();

    return leaves.map((leave) => ({
      ...serializeLeave(
        leave,
        leave.attachmentId ? (attachments.get(leave.attachmentId) ?? null) : null,
        this.latestSyncStatus(operations, leave.id),
      ),
      swapperId: leave.swapperId,
      swapperName: leave.swapper.fullName,
      stationId: leave.swapper.stationId,
      stationName: leave.swapper.station?.name ?? 'Station non affectée',
      createdAt: leave.createdAt.toISOString(),
    }));
  }

  /** Demandes en attente uniquement (carte d'action de l'accueil admin). */
  async pending(actor: AuthenticatedUser) {
    const rows = await this.management(actor);
    return rows
      .filter((row) => row.status === 'PENDING')
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  /* ---------------------------------------------------------------- */
  /* Integration RH (RM-15)                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Sante de l'integration externe : les echecs degradent l'etat, le taux de
   * succes est expose pour diagnostic.
   */
  async integrationHealth() {
    const operations = await this.prisma.leaveSyncOperation.findMany({
      orderBy: { queuedAt: 'desc' },
      include: { user: { select: { fullName: true } } },
    });
    const failed = operations.filter((item) => item.status === 'FAILED');
    const balances = await this.prisma.leaveBalance.findMany({
      orderBy: { syncedAt: 'desc' },
      take: 1,
    });

    return {
      status: failed.length ? 'DEGRADED' : 'OPERATIONAL',
      enabled: this.config.get('leaveSyncEnabled', { infer: true }),
      lastSyncAt: balances[0]?.syncedAt.toISOString() ?? null,
      pending: operations.filter((item) =>
        ['QUEUED', 'PROCESSING'].includes(item.status),
      ).length,
      failed: failed.length,
      successRate: operations.length
        ? Math.round(
            (operations.filter((item) => item.status === 'SYNCED').length /
              operations.length) *
              100,
          )
        : 100,
      operations: operations.slice(0, 8).map((item) => ({
        ...serializeLeaveSyncOperation(item),
        userName: item.user.fullName,
      })),
    };
  }

  /** Rejeu manuel des operations echouees (bouton « Réessayer »). */
  async retrySync(operationId: string) {
    const operation = await this.prisma.leaveSyncOperation.findUnique({
      where: { id: operationId },
    });
    if (!operation) {
      throw new NotFoundDomain(
        'SYNC_OPERATION_NOT_FOUND',
        'Opération de synchronisation introuvable.',
      );
    }
    const updated = await this.prisma.leaveSyncOperation.update({
      where: { id: operationId },
      data: {
        status: 'QUEUED',
        nextAttemptAt: new Date(),
        lastError: null,
      },
    });
    if (operation.status === 'FAILED') {
      await this.prisma.leave.update({
        where: { id: operation.leaveId },
        data: { status: 'PENDING' },
      });
    }
    return serializeLeaveSyncOperation(updated);
  }

  /** Webhook entrant : le systeme RH confirme la prise en compte. */
  async syncWebhook(payload: {
    idempotencyKey?: string;
    externalId?: string;
    status?: string;
  }) {
    const operation = payload.idempotencyKey
      ? await this.prisma.leaveSyncOperation.findUnique({
          where: { idempotencyKey: payload.idempotencyKey },
        })
      : null;
    if (!operation) {
      throw new NotFoundDomain(
        'SYNC_OPERATION_NOT_FOUND',
        'Opération de synchronisation introuvable.',
      );
    }
    const succeeded = (payload.status ?? 'SYNCED').toUpperCase() === 'SYNCED';
    await this.prisma.$transaction(async (tx) => {
      await tx.leaveSyncOperation.update({
        where: { id: operation.id },
        data: {
          status: succeeded ? 'SYNCED' : 'FAILED',
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          completedAt: succeeded ? new Date() : null,
          lastError: succeeded ? null : 'Refusé par le système RH.',
        },
      });
      if (succeeded && payload.externalId) {
        await tx.leave.update({
          where: { id: operation.leaveId },
          data: { externalId: payload.externalId },
        });
      }
      if (!succeeded) {
        await tx.leave.update({
          where: { id: operation.leaveId },
          data: { status: 'SYNC_FAILED' },
        });
      }
    });
    return { ok: true };
  }

  /* ---------------------------------------------------------------- */
  /* Interne                                                           */
  /* ---------------------------------------------------------------- */

  /** Solde annuele, cree a la demande avec la dotation par defaut. */
  async ensureBalance(swapperId: string) {
    const existing = await this.prisma.leaveBalance.findUnique({
      where: { swapperId },
    });
    if (existing) return this.reconcileBalance(existing);

    const year = new Date().getUTCFullYear();
    return this.prisma.leaveBalance.create({
      data: {
        swapperId,
        year,
        entitledDays: 24,
        usedDays: 0,
        pendingDays: 0,
        remainingDays: 24,
      },
    });
  }

  /**
   * Recalcule `usedDays` a partir des conges approuves et passes, afin que le
   * solde reste coherent meme si une donnee a ete modifiee hors application.
   */
  private async reconcileBalance(balance: {
    id: string;
    swapperId: string;
    year: number;
    entitledDays: number;
    usedDays: number;
    pendingDays: number;
    remainingDays: number;
    syncedAt: Date;
    updatedAt: Date;
  }) {
    const leaves = await this.prisma.leave.findMany({
      where: {
        swapperId: balance.swapperId,
        status: 'APPROVED',
        endTime: { lt: new Date() },
      },
    });
    const now = Date.now();
    const consumed = leaves.reduce(
      (total, leave) =>
        total +
        consumedDaysWithin(
          leave.startTime.toISOString(),
          leave.endTime.toISOString(),
          balance.year,
          now,
        ),
      0,
    );
    if (consumed === balance.usedDays) return balance;

    return this.prisma.leaveBalance.update({
      where: { id: balance.id },
      data: {
        usedDays: consumed,
        remainingDays: Math.max(0, balance.entitledDays - consumed),
      },
    });
  }

  private requireType(value: string): LeaveType {
    const type = (value ?? '').toUpperCase() as LeaveType;
    if (!LEAVE_TYPES.includes(type)) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Choisissez un type de congé valide.',
        400,
      );
    }
    return type;
  }

  /** La periode doit etre future, valide et ordonnee. */
  private requestPeriod(startDate: string, endDate: string) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(startDate ?? '') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(endDate ?? '')
    ) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Choisissez une date de début et de fin valides.',
        400,
      );
    }
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T23:59:59.999Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'Choisissez une date de début et de fin valides.',
        400,
      );
    }
    const today = new Date();
    const todayUtc = Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate(),
    );
    if (start.getTime() < todayUtc || end < start) {
      throw new ConflictDomain(
        ErrorCode.VALIDATION,
        'La période doit être future et sa fin ne peut pas précéder son début.',
        400,
      );
    }
    return { startTime: start.toISOString(), endTime: end.toISOString() };
  }

  /** Deux demandes actives ne peuvent pas couvrir la meme periode. */
  private async assertNoOverlap(
    swapperId: string,
    startTime: string,
    endTime: string,
    exceptId?: string,
  ) {
    const overlap = await this.prisma.leave.findFirst({
      where: {
        swapperId,
        status: { in: ACTIVE_STATUSES as never },
        ...(exceptId ? { id: { not: exceptId } } : {}),
        startTime: { lte: new Date(endTime) },
        endTime: { gte: new Date(startTime) },
      },
    });
    if (overlap) {
      throw new ConflictDomain(
        ErrorCode.LEAVE_OVERLAP,
        'Une demande ou un congé approuvé chevauche déjà cette période.',
        409,
      );
    }
  }

  private latestSyncStatus(
    operations: { leaveId: string; status: string; queuedAt: Date }[],
    leaveId: string,
  ): string | null {
    const latest = operations
      .filter((item) => item.leaveId === leaveId)
      .sort((a, b) => b.queuedAt.getTime() - a.queuedAt.getTime())[0];
    return latest?.status ?? null;
  }

  /** Resout les noms de pieces jointes en une seule requete. */
  private async attachmentNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!unique.length) return new Map<string, string>();
    const rows = await this.prisma.attachment.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
