import {
  NotificationKind,
  Role,
} from '@prisma/client';
import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

const LIST_LIMIT = 50;

export type NotifyInput = {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string | null;
  entityId?: string | null;
};

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  // ============================================================
  // WRITE
  // ============================================================

  /**
   * Creates a notification. Never throws: a notification is a side effect,
   * so a failure here must not roll back the business action that triggered
   * it (assigning a replacement, recording an absence...).
   */
  async notify(input: NotifyInput): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          userId: input.userId,
          kind: input.kind,
          title: input.title,
          body: input.body,
          link: input.link ?? null,
          entityId: input.entityId ?? null,
        },
      });
    } catch {
      // Swallowed on purpose — see the method contract above.
    }
  }

  /**
   * Fan-out helper: notifies every user holding one of `roles`, restricted
   * to the given stations when provided.
   */
  async notifyRoles(params: {
    roles: Role[];
    stationIds?: string[];
    kind: NotificationKind;
    title: string;
    body: string;
    link?: string | null;
    entityId?: string | null;
    excludeUserId?: string;
  }): Promise<void> {
    try {
      const recipients = await this.prisma.user.findMany({
        where: {
          role: { in: params.roles },
          isActive: true,
          ...(params.excludeUserId
            ? { id: { not: params.excludeUserId } }
            : {}),
          ...(params.stationIds && params.stationIds.length
            ? {
                OR: [
                  { stationId: { in: params.stationIds } },
                  {
                    stationScopes: {
                      some: {
                        stationId: { in: params.stationIds },
                      },
                    },
                  },
                ],
              }
            : {}),
        },
        select: { id: true },
      });

      if (!recipients.length) return;

      await this.prisma.notification.createMany({
        data: recipients.map((user) => ({
          userId: user.id,
          kind: params.kind,
          title: params.title,
          body: params.body,
          link: params.link ?? null,
          entityId: params.entityId ?? null,
        })),
      });
    } catch {
      // Same rationale as notify().
    }
  }

  // ============================================================
  // READ
  // ============================================================

  async findMine(userId: string) {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        link: true,
        entityId: true,
        readAt: true,
        createdAt: true,
      },
    });

    return rows;
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });

    return { unread: count };
  }

  async markAsRead(userId: string, id: string) {
    // Scoped by userId so one user cannot mark another's notification.
    const existing = await this.prisma.notification.findFirst({
      where: { id, userId },
      select: { id: true, readAt: true },
    });

    if (!existing) {
      throw new NotFoundException('Notification introuvable');
    }

    if (existing.readAt) {
      return { id: existing.id, readAt: existing.readAt };
    }

    const updated = await this.prisma.notification.update({
      where: { id: existing.id },
      data: { readAt: new Date() },
      select: { id: true, readAt: true },
    });

    return updated;
  }

  async markAllAsRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    return { updated: result.count };
  }

  /**
   * Notification preferences of one account. The row is created lazily with
   * the frontend defaults (in-app + e-mail on, push off) so the settings
   * screen always has a complete object to bind to.
   */
  async getPreferences(userId: string) {
    const existing = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });
    if (existing) return this.serialize(existing);

    const created = await this.prisma.notificationPreference.create({
      data: { userId },
    });
    return this.serialize(created);
  }

  async updatePreferences(
    userId: string,
    patch: Partial<{
      inApp: boolean;
      email: boolean;
      push: boolean;
      digest: boolean;
      quietHoursEnabled: boolean;
      quietHoursStart: string | null;
      quietHoursEnd: string | null;
      retentionDays: number;
    }>,
  ) {
    await this.getPreferences(userId);
    const updated = await this.prisma.notificationPreference.update({
      where: { userId },
      data: {
        ...(patch.inApp !== undefined ? { inApp: patch.inApp } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.push !== undefined ? { push: patch.push } : {}),
        ...(patch.digest !== undefined ? { digest: patch.digest } : {}),
        ...(patch.quietHoursEnabled !== undefined
          ? { quietHoursEnabled: patch.quietHoursEnabled }
          : {}),
        ...(patch.quietHoursStart !== undefined
          ? { quietHoursStart: patch.quietHoursStart }
          : {}),
        ...(patch.quietHoursEnd !== undefined
          ? { quietHoursEnd: patch.quietHoursEnd }
          : {}),
        ...(patch.retentionDays !== undefined
          ? { retentionDays: Math.min(365, Math.max(7, patch.retentionDays)) }
          : {}),
      },
    });
    return this.serialize(updated);
  }

  private serialize(row: {
    inApp: boolean;
    email: boolean;
    push: boolean;
    digest: boolean;
    quietHoursEnabled: boolean;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    retentionDays: number;
    updatedAt: Date;
  }) {
    return {
      inApp: row.inApp,
      email: row.email,
      push: row.push,
      digest: row.digest,
      quietHoursEnabled: row.quietHoursEnabled,
      quietHoursStart: row.quietHoursStart,
      quietHoursEnd: row.quietHoursEnd,
      retentionDays: row.retentionDays,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
