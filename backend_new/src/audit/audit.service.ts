import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditRecord {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  stationId?: string | null;
  metadata?: Record<string, unknown>;
  message?: string;
}

/**
 * Journal d'audit transversal.
 *
 * Chaque action sensible (creation de compte, publication de planning, decision
 * de conge, correction de pointage) laisse une trace horodatee. L'ecran
 * d'audit de l'administrateur s'appuie sur ces lignes pour reconstituer
 * « qui a fait quoi, quand, et sur quel objet ».
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditRecord): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        stationId: entry.stationId ?? null,
        metadata: (entry.metadata ?? {}) as never,
        message: entry.message ?? null,
      },
    });
  }

  /** Ecriture groupee : utile lorsqu'une action produit plusieurs traces. */
  async recordMany(entries: AuditRecord[]): Promise<void> {
    if (!entries.length) return;
    await this.prisma.auditLog.createMany({
      data: entries.map((entry) => ({
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        stationId: entry.stationId ?? null,
        metadata: (entry.metadata ?? {}) as never,
        message: entry.message ?? null,
      })),
    });
  }

  async list(params: {
    stationId?: string;
    actorId?: string;
    action?: string;
    from?: string;
    to?: string;
    limit?: number;
  }) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(params.stationId ? { stationId: params.stationId } : {}),
        ...(params.actorId ? { actorId: params.actorId } : {}),
        ...(params.action ? { action: params.action } : {}),
        ...(params.from || params.to
          ? {
              createdAt: {
                ...(params.from ? { gte: new Date(params.from) } : {}),
                ...(params.to ? { lte: new Date(params.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(params.limit ?? 200, 500),
      include: { actor: { select: { id: true, fullName: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      stationId: row.stationId,
      actorId: row.actorId,
      actorName: row.actor?.fullName ?? null,
      message: row.message,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
