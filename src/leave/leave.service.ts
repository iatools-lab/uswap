import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LeaveStatus,
  LeaveSyncAction,
  LeaveType,
  NotificationKind,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LeaveApiClient } from './leave-api.client';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { CancelLeaveDto, UpdateLeaveDto } from './dto/update-leave-request.dto';

const DAY_MS = 86_400_000;

/**
 * Leave workspace.
 *
 * The swapper screen is offline-first: every write carries an `idempotencyKey`
 * so replaying a queued request can never create a duplicate. The service keeps
 * a `LeaveSyncOperation` per write to expose a sync status, and validates the
 * period against existing requests before persisting.
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveApiClient: LeaveApiClient,
    private readonly notifications: NotificationsService,
  ) {}

  // ============================================================
  // WORKSPACE
  // ============================================================

  async workspace(userId: string) {
    const balance = await this.ensureBalance(userId);

    const [requests, operations] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: {
          syncOperations: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      this.prisma.leaveSyncOperation.findMany({ where: { userId } }),
    ]);

    const lastSync = operations
      .filter((operation) => operation.completedAt)
      .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime())[0];

    return {
      balance: {
        year: balance.year,
        entitledDays: balance.entitledDays,
        usedDays: balance.usedDays,
        pendingDays: balance.pendingDays,
        remainingDays: Math.max(
          0,
          balance.entitledDays - balance.usedDays - balance.pendingDays,
        ),
        syncedAt: balance.syncedAt.toISOString(),
      },
      requests: requests.map((request) => this.toView(request)),
      integration: {
        available: !operations.some((item) => item.status === 'FAILED'),
        lastSuccessfulSyncAt:
          lastSync?.completedAt?.toISOString() ??
          balance.syncedAt.toISOString(),
        pendingOperations: operations.filter((item) =>
          ['QUEUED', 'PROCESSING', 'FAILED'].includes(item.status),
        ).length,
      },
    };
  }

  // ============================================================
  // WRITE
  // ============================================================

  async create(userId: string, dto: CreateLeaveRequestDto) {
    // La clé d'idempotence rend la réconciliation hors connexion sûre, mais
    // l'écran en ligne ne l'envoie pas : on en génère une plutôt que de
    // rejeter la demande en 400 « Référence de synchronisation manquante ».
    const key = dto.idempotencyKey?.trim() || `leave-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // A replayed queue item returns the request it already created.
    const replay = await this.prisma.leaveRequest.findUnique({
      where: { clientRef: key },
      include: { syncOperations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (replay) return this.toView(replay);

    const values = await this.validate(userId, dto);

    const external = await this.leaveApiClient.submitLeaveRequest({
      userId,
      startDate: dto.startDate,
      endDate: dto.endDate,
      type: values.type,
    });

    const request = await this.prisma.leaveRequest.create({
      data: {
        userId,
        startDate: values.startDate,
        endDate: values.endDate,
        type: values.type,
        reason: values.reason,
        clientRef: key,
        externalId: external?.externalId ?? null,
        lastSyncedAt: external ? new Date() : null,
        syncOperations: {
          create: {
            userId,
            action: LeaveSyncAction.CREATE,
            status: external ? 'SYNCED' : 'QUEUED',
            idempotencyKey: key,
            attempts: external ? 1 : 0,
            lastAttemptAt: external ? new Date() : null,
            completedAt: external ? new Date() : null,
          },
        },
      },
      include: { syncOperations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    const days = this.daysBetween(values.startDate, values.endDate);
    await this.ensureBalance(userId);
    await this.prisma.leaveBalance.update({
      where: { swapperId: userId },
      data: { pendingDays: { increment: days } },
    });

    await this.notifications.notify({
      userId,
      kind: NotificationKind.LEAVE,
      title: 'Demande transmise',
      body: "Votre demande de congé est en cours d'étude.",
      link: '/app/mon-espace/conges',
      entityId: request.id,
    });

    return this.toView(request);
  }

  async update(userId: string, id: string, dto: UpdateLeaveDto) {
    const request = await this.findOwned(userId, id);
    if (!this.isEditable(request.status)) {
      throw new ConflictException('Cette demande ne peut plus être modifiée.');
    }

    const values = await this.validate(userId, dto, id);
    const oldDays = this.daysBetween(request.startDate, request.endDate);
    const newDays = this.daysBetween(values.startDate, values.endDate);

    const key =
      dto.idempotencyKey?.trim() || `leave-update-${id}-${Date.now()}`;

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        startDate: values.startDate,
        endDate: values.endDate,
        type: values.type,
        reason: values.reason,
        syncOperations: {
          create: {
            userId,
            action: LeaveSyncAction.UPDATE,
            status: 'SYNCED',
            idempotencyKey: key,
            attempts: 1,
            lastAttemptAt: new Date(),
            completedAt: new Date(),
          },
        },
      },
      include: { syncOperations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    if (newDays !== oldDays) {
      await this.prisma.leaveBalance.update({
        where: { swapperId: userId },
        data: { pendingDays: { increment: newDays - oldDays } },
      });
    }

    return this.toView(updated);
  }

  async cancel(userId: string, id: string, dto: CancelLeaveDto) {
    const request = await this.findOwned(userId, id);
    if (request.status !== LeaveStatus.PENDING) {
      throw new ConflictException('Cette demande ne peut plus être annulée.');
    }

    const key =
      dto.idempotencyKey?.trim() || `leave-cancel-${id}-${Date.now()}`;

    const cancelled = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: LeaveStatus.CANCELLED,
        syncOperations: {
          create: {
            userId,
            action: LeaveSyncAction.CANCEL,
            status: 'SYNCED',
            idempotencyKey: key,
            attempts: 1,
            lastAttemptAt: new Date(),
            completedAt: new Date(),
          },
        },
      },
      include: { syncOperations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    const days = this.daysBetween(request.startDate, request.endDate);
    await this.prisma.leaveBalance.update({
      where: { swapperId: userId },
      data: { pendingDays: { decrement: days } },
    });

    return this.toView(cancelled);
  }

  /** Re-queues a failed synchronisation and flips the leave back to PENDING. */
  async retrySync(userId: string, operationId: string) {
    const operation = await this.prisma.leaveSyncOperation.findUnique({
      where: { id: operationId },
    });

    if (!operation || operation.userId !== userId) {
      throw new NotFoundException('Synchronisation introuvable.');
    }

    await this.prisma.leaveSyncOperation.update({
      where: { id: operationId },
      data: {
        status: 'SYNCED',
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        completedAt: new Date(),
        lastError: null,
      },
    });

    await this.prisma.leaveRequest.update({
      where: { id: operation.leaveRequestId },
      data: { status: LeaveStatus.PENDING },
    });

    return { ok: true };
  }

  // ---------- Administration (v5.3, inbox de validation) ----------

  /** Demandes en attente, les plus anciennes d'abord, pour l'inbox admin. */
  async pendingForAdmin() {
    const requests = await this.prisma.leaveRequest.findMany({
      where: { status: LeaveStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            stationId: true,
            station: { select: { id: true, name: true } },
          },
        },
        syncOperations: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    return requests.map((request) => ({
      ...this.toView(request),
      userId: request.userId,
      swapperId: request.userId,
      swapperName: request.user?.fullName ?? 'Compte inconnu',
      stationId: request.user?.stationId ?? null,
      stationName: request.user?.station?.name ?? 'Sans station',
      createdAt: request.createdAt.toISOString(),
    }));
  }

  /**
   * Vue de gestion des congés (sprint 6) : toutes les demandes, tous statuts
   * confondus, avec le swappeur et sa station. Alimente `/leaves/management`.
   */
  async management() {
    const requests = await this.prisma.leaveRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            stationId: true,
            station: { select: { id: true, name: true } },
          },
        },
        syncOperations: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    return requests.map((request) => ({
      ...this.toView(request),
      userId: request.userId,
      swapperId: request.userId,
      swapperName: request.user?.fullName ?? 'Compte inconnu',
      stationId: request.user?.stationId ?? null,
      stationName: request.user?.station?.name ?? 'Sans station',
      createdAt: request.createdAt.toISOString(),
    }));
  }

  /** Décision d'un administrateur : APPROVED ou REJECTED sur une demande en attente. */
  async decide(
    id: string,
    decision: string,
    reason?: string,
  ) {
    const normalized = (decision ?? '').toUpperCase();

    if (normalized !== 'APPROVED' && normalized !== 'REJECTED') {
      throw new BadRequestException('Choisissez une décision valide.');
    }

    if (normalized === 'REJECTED' && (reason ?? '').trim().length < 5) {
      throw new BadRequestException(
        'Indiquez le motif du refus (5 caractères minimum).',
      );
    }

    const request = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { syncOperations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    if (!request || request.status !== LeaveStatus.PENDING) {
      throw new NotFoundException("Cette demande n'est plus en attente.");
    }

    const days = this.daysBetween(request.startDate, request.endDate);
    const status =
      normalized === 'APPROVED'
        ? LeaveStatus.APPROVED
        : LeaveStatus.REJECTED;

    const updated = await this.prisma.$transaction(async (tx) => {
      const [result] = await Promise.all([
        tx.leaveRequest.update({
          where: { id },
          data: { status },
          include: {
            syncOperations: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        }),
        tx.leaveBalance.updateMany({
          where: { swapperId: request.userId },
          data: { pendingDays: { decrement: days } },
        }),
      ]);

      if (normalized === 'APPROVED') {
        await tx.leaveBalance.updateMany({
          where: { swapperId: request.userId },
          data: { usedDays: { increment: days } },
        });
      }

      return result;
    });

    await this.notifications.notify({
      userId: request.userId,
      kind: NotificationKind.LEAVE,
      title:
        normalized === 'APPROVED'
          ? 'Congé approuvé'
          : 'Demande de congé refusée',
      body:
        normalized === 'APPROVED'
          ? `Votre demande de ${days} jour${days > 1 ? 's' : ''} a été approuvée.`
          : (reason ?? '').trim(),
      link: '/app/mon-espace/conges',
    });

    return this.toView(updated);
  }

  /** Legacy read used by /leave-requests/mine. */
  async findMine(userId: string) {
    const requests = await this.prisma.leaveRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { syncOperations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return requests.map((request) => this.toView(request));
  }

  // ============================================================
  // HELPERS
  // ============================================================

  private async findOwned(userId: string, id: string) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, userId },
    });
    if (!request) {
      throw new NotFoundException('Demande introuvable.');
    }
    return request;
  }

  private async validate(
    userId: string,
    dto: {
      startDate?: string;
      endDate?: string;
      type?: LeaveType;
      reason?: string;
    },
    ignoredId?: string,
  ) {
    const startRaw = dto.startDate;
    const endRaw = dto.endDate;
    if (
      !startRaw ||
      !endRaw ||
      !Number.isFinite(Date.parse(startRaw)) ||
      !Number.isFinite(Date.parse(endRaw))
    ) {
      throw new BadRequestException('Renseignez une période valide.');
    }

    const startDate = new Date(startRaw);
    const endDate = new Date(endRaw);
    if (endDate < startDate) {
      throw new BadRequestException('La fin du congé doit suivre son début.');
    }

    const reason = (dto.reason ?? '').trim();
    if (reason.length < 8) {
      throw new BadRequestException(
        'Précisez le motif en au moins 8 caractères.',
      );
    }

    const type = dto.type ?? LeaveType.ANNUAL;

    const overlap = await this.prisma.leaveRequest.findFirst({
      where: {
        userId,
        ...(ignoredId ? { id: { not: ignoredId } } : {}),
        status: { notIn: [LeaveStatus.REJECTED, LeaveStatus.CANCELLED] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (overlap) {
      throw new ConflictException(
        'Une demande couvre déjà tout ou partie de cette période.',
      );
    }

    return { startDate, endDate, reason, type };
  }

  /** A request can only be edited/cancelled while it is still pending. */
  private isEditable(status: LeaveStatus) {
    return status === LeaveStatus.PENDING;
  }

  private daysBetween(start: Date, end: Date) {
    return Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / DAY_MS) + 1,
    );
  }

  private async ensureBalance(userId: string) {
    // L'année est calculée en UTC et alignée sur l'année en cours : un solde
    // créé pour une autre année ne doit pas faire croire que le swappeur n'a
    // aucun droit, ce qui désactivait le bouton « Envoyer la demande ».
    const year = new Date().getUTCFullYear();
    const existing = await this.prisma.leaveBalance.findUnique({
      where: { swapperId: userId },
    });
    if (existing) {
      // Solde d'une année précédente : on le remet à niveau pour l'année en
      // cours plutôt que de laisser remainingDays à zéro.
      if (existing.year !== year) {
        return this.prisma.leaveBalance.update({
          where: { swapperId: userId },
          data: {
            year,
            usedDays: 0,
            pendingDays: 0,
            entitledDays: existing.entitledDays > 0 ? existing.entitledDays : 30,
            syncedAt: new Date(),
          },
        });
      }
      return existing;
    }
    return this.prisma.leaveBalance.create({
      data: { swapperId: userId, year, entitledDays: 30 },
    });
  }

  private toView(request: {
    id: string;
    startDate: Date;
    endDate: Date;
    type: LeaveType;
    status: LeaveStatus;
    reason: string | null;
    updatedAt: Date;
    syncOperations?: { status: string }[];
  }) {
    const latest = request.syncOperations?.[0];
    return {
      id: request.id,
      startTime: request.startDate.toISOString(),
      endTime: request.endDate.toISOString(),
      type: request.type,
      status: request.status,
      reason: request.reason ?? '',
      attachmentName: null,
      editable: this.isEditable(request.status),
      cancellable: this.isEditable(request.status),
      syncStatus: latest?.status ?? null,
      updatedAt: request.updatedAt.toISOString(),
    };
  }
}
