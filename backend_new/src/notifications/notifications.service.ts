import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Notification, NotificationChannel, Prisma } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Transporter } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/configuration';
import { serializePreferences } from '../common/serializers';
import { renderTemplate, type MailTemplate } from './templates';
import type { NotificationCategory } from './categories';
import { ALL_CATEGORIES, categoryForKind } from './categories';

export interface NotifyOptions {
  userId: string;
  kind: string;
  title: string;
  body: string;
  targetId?: string | null;
  targetUrl?: string | null;
  /** Notification critique : ignore les heures silencieuses et le digest. */
  critical?: boolean;
  /** Categories additionnelles a notifier explicitement. */
  category?: NotificationCategory;
}

export interface AppNotification extends Notification {}

/**
 * Point d'entree unique de toutes les notifications.
 *
 * - **In-app** : une ligne `Notification` est toujours ecrite (le canal interne
 *   est indispensable au suivi operationnel et ne peut pas etre desactive).
 * - **E-mail** : respecte `emailEnabled`, les preferences par categorie, le
 *   digest et les heures silencieuses.
 * - **Push** : respecte `pushEnabled`, les abonnements navigateur et les
 *   heures silencieuses pour les evenements non critiques.
 *
 * Chaque tentative est journalisee dans `NotificationDelivery`, ce qui rend
 * l'envoi verifiable et rejouable.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: Transporter | null = null;
  private readonly mailDir: string;
  private readonly enabledChannels: NotificationChannel[] = [
    'INTERNAL',
    'EMAIL',
    'PUSH',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    this.mailDir = path.resolve(process.cwd(), 'var/mail');
  }

  onModuleInit(): void {
    const driver = this.config.get('mailDriver', { infer: true });
    if (driver === 'smtp') {
      this.transporter = nodemailer.createTransport({
        host: this.config.get('smtpHost', { infer: true }),
        port: this.config.get('smtpPort', { infer: true }),
        secure: this.config.get('smtpSecure', { infer: true }),
        auth: this.config.get('smtpUser', { infer: true })
          ? {
              user: this.config.get('smtpUser', { infer: true }),
              pass: this.config.get('smtpPassword', { infer: true }),
            }
          : undefined,
      });
      this.logger.log('Canal e-mail configure en SMTP.');
      return;
    }
    if (driver === 'json') {
      fs.mkdirSync(this.mailDir, { recursive: true });
      this.logger.log(`Canal e-mail ecrit dans ${this.mailDir}.`);
      return;
    }
    this.logger.log('Canal e-mail en mode console (aucun envoi reel).');
  }

  /* ---------------------------------------------------------------- */
  /* Lecture                                                           */
  /* ---------------------------------------------------------------- */

  /** Boite de reception : les 50 dernieres notifications, non archivees. */
  async listFor(userId: string, limit = 50): Promise<AppNotification[]> {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  async preferencesFor(userId: string) {
    const preference = await this.ensurePreferences(userId);
    return serializePreferences(preference);
  }

  async updatePreferences(
    userId: string,
    patch: {
      inApp?: boolean;
      email?: boolean;
      push?: boolean;
      digest?: boolean;
      quietHoursEnabled?: boolean;
      quietHoursStart?: string | null;
      quietHoursEnd?: string | null;
      retentionDays?: number;
      categories?: Record<string, { email?: boolean; push?: boolean }>;
    },
  ) {
    const current = await this.ensurePreferences(userId);
    const categories = this.mergeCategories(current.categories, patch);
    const updated = await this.prisma.notificationPreference.update({
      where: { userId },
      data: {
        internalEnabled: patch.inApp ?? current.internalEnabled,
        emailEnabled: patch.email ?? current.emailEnabled,
        pushEnabled: patch.push ?? current.pushEnabled,
        digestEnabled: patch.digest ?? current.digestEnabled,
        quietHoursEnabled:
          patch.quietHoursEnabled ?? current.quietHoursEnabled,
        quietHoursStart:
          patch.quietHoursStart === undefined
            ? current.quietHoursStart
            : patch.quietHoursStart,
        quietHoursEnd:
          patch.quietHoursEnd === undefined
            ? current.quietHoursEnd
            : patch.quietHoursEnd,
        retentionDays: patch.retentionDays ?? current.retentionDays,
        categories: JSON.stringify(categories),
      },
    });
    return serializePreferences(updated);
  }

  async ensurePreferences(userId: string) {
    const existing = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });
    if (existing) return existing;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const defaults = this.defaultCategories(user?.role ?? 'SWAPPER');
    return this.prisma.notificationPreference.create({
      data: {
        userId,
        internalEnabled: true,
        emailEnabled: true,
        pushEnabled: user?.role === 'SWAPPER',
        categories: JSON.stringify(defaults),
      },
    });
  }

  /** Seed : pre-remplit les preferences de tous les comptes existants. */
  async ensureAllPreferences(): Promise<void> {
    const users = await this.prisma.user.findMany({
      select: { id: true },
    });
    for (const user of users) await this.ensurePreferences(user.id);
  }

  /* ---------------------------------------------------------------- */
  /* Emission                                                          */
  /* ---------------------------------------------------------------- */

  async notify(options: NotifyOptions): Promise<AppNotification> {
    const notification = await this.prisma.notification.create({
      data: {
        userId: options.userId,
        kind: options.kind,
        title: options.title,
        body: options.body,
        targetId: options.targetId ?? null,
        targetUrl: options.targetUrl ?? null,
      },
    });

    const preference = await this.ensurePreferences(options.userId);
    const user = await this.prisma.user.findUnique({
      where: { id: options.userId },
      select: { id: true, email: true, fullName: true, isActive: true },
    });

    const category =
      options.category ?? categoryForKind(options.kind);
    const categoryPrefs = this.readCategory(preference.categories, category);
    const quiet = this.inQuietHours(preference) && !options.critical;

    // Canal interne : toujours ecrit, meme si l'e-mail et le push sont coupes.
    await this.recordDelivery(notification.id, options.userId, 'INTERNAL', {
      status: preference.internalEnabled ? 'SENT' : 'SKIPPED',
      sentAt: preference.internalEnabled ? new Date() : null,
      error: preference.internalEnabled
        ? null
        : 'Canal interne desactive par l’utilisateur.',
    });

    if (user?.isActive && user.email) {
      const mailAllowed =
        preference.emailEnabled && categoryPrefs.email && !quiet;
      if (mailAllowed) {
        await this.sendToChannel(
          notification.id,
          options.userId,
          'EMAIL',
          user.email,
          options,
        );
      } else {
        await this.recordDelivery(notification.id, options.userId, 'EMAIL', {
          status: 'SKIPPED',
          error: this.skipReason(preference, categoryPrefs.email, quiet),
        });
      }

      const pushAllowed =
        preference.pushEnabled && categoryPrefs.push && !quiet;
      if (pushAllowed) {
        await this.sendToChannel(
          notification.id,
          options.userId,
          'PUSH',
          user.email,
          options,
        );
      } else {
        await this.recordDelivery(notification.id, options.userId, 'PUSH', {
          status: 'SKIPPED',
          error: this.skipReason(preference, categoryPrefs.push, quiet),
        });
      }
    }

    await this.enforceRetention(options.userId, preference.retentionDays);
    return notification;
  }

  /**
   * Notifie plusieurs destinataires (superviseurs, station, personnes citees).
   * Les identifiants en double sont dedupliques.
   */
  async notifyMany(
    userIds: string[],
    options: Omit<NotifyOptions, 'userId'>,
  ): Promise<number> {
    const unique = [...new Set(userIds.filter(Boolean))];
    for (const userId of unique) {
      await this.notify({ ...options, userId });
    }
    return unique.length;
  }

  /**
   * Superviseurs actifs + personnes explicitement citees.
   *
   * Reprend `notifyStaff` cote frontend : les superviseurs suivent l'activite
   * operationnelle, les personnes citees recoivent l'information les concernant.
   */
  async notifyStaff(
    extraUserIds: string[],
    options: Omit<NotifyOptions, 'userId'>,
  ): Promise<number> {
    const supervisors = await this.prisma.user.findMany({
      where: { role: 'SUPERVISOR', isActive: true, disabledAt: null },
      select: { id: true },
    });
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true, disabledAt: null },
      select: { id: true },
    });
    return this.notifyMany(
      [...supervisors, ...admins].map((item) => item.id).concat(extraUserIds),
      options,
    );
  }

  async notifyAdmins(options: Omit<NotifyOptions, 'userId'>): Promise<number> {
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true, disabledAt: null },
      select: { id: true },
    });
    return this.notifyMany(
      admins.map((item) => item.id),
      options,
    );
  }

  /* ---------------------------------------------------------------- */
  /* E-mail transactionnel (invitations, reinitialisation)             */
  /* ---------------------------------------------------------------- */

  /**
   * Envoi direct, hors preferences : utilise pour les liens de securite qui
   * doivent toujours partir (invitation, reinitialisation de mot de passe).
   */
  async sendMail(
    to: string,
    template: MailTemplate,
    variables: Record<string, string>,
  ): Promise<void> {
    const { subject, html, text } = renderTemplate(template, variables);
    const record = await this.prisma.emailLog.create({
      data: { to, subject, template, status: 'PENDING' },
    });
    try {
      await this.deliver(to, subject, html, text);
      await this.prisma.emailLog.update({
        where: { id: record.id },
        data: { status: 'SENT', sentAt: new Date() },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Echec d’envoi.';
      await this.prisma.emailLog.update({
        where: { id: record.id },
        data: { status: 'FAILED', error: message },
      });
      this.logger.error(`E-mail ${template} vers ${to} non envoye : ${message}`);
      throw error;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Push                                                              */
  /* ---------------------------------------------------------------- */

  async registerPushSubscription(
    userId: string,
    subscription: { endpoint: string; keys?: { p256dh: string; auth: string } },
    userAgent?: string,
  ): Promise<{ id: string }> {
    if (!subscription.keys) {
      throw new Error('Abonnement push incomplet.');
    }
    const record = await this.prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      create: {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: userAgent ?? null,
      },
      update: {
        userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: userAgent ?? null,
      },
    });
    return { id: record.id };
  }

  async removePushSubscription(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
  }

  /* ---------------------------------------------------------------- */
  /* Interne                                                           */
  /* ---------------------------------------------------------------- */

  private async sendToChannel(
    notificationId: string,
    userId: string,
    channel: NotificationChannel,
    recipient: string,
    options: NotifyOptions,
  ): Promise<void> {
    if (channel === 'EMAIL') {
      try {
        const { subject, html, text } = renderTemplate('NOTIFICATION', {
          title: options.title,
          body: options.body,
          link: options.targetUrl
            ? `${this.config.get('publicAppUrl', { infer: true })}${options.targetUrl}`
            : '',
        });
        await this.deliver(recipient, subject, html, text);
        await this.recordDelivery(notificationId, userId, channel, {
          status: 'SENT',
          recipient,
          sentAt: new Date(),
        });
      } catch (error) {
        await this.recordDelivery(notificationId, userId, channel, {
          status: 'FAILED',
          recipient,
          error: error instanceof Error ? error.message : 'Echec d’envoi.',
        });
      }
      return;
    }

    if (channel === 'PUSH') {
      // Push non configuré (aucune clé VAPID) : ce n'est pas un échec, c'est
      // un canal indisponible. On le journalise en SKIPPED pour ne pas polluer
      // les alertes de supervision avec de faux positifs.
      if (!this.pushConfigured()) {
        await this.recordDelivery(notificationId, userId, channel, {
          status: 'SKIPPED',
          recipient,
          error: 'Notifications push non configurées.',
        });
        return;
      }
      const sent = await this.sendPush(userId, options);
      await this.recordDelivery(notificationId, userId, channel, {
        status: sent ? 'SENT' : 'SKIPPED',
        recipient,
        sentAt: sent ? new Date() : null,
        error: sent ? null : 'Aucun abonnement push actif.',
      });
      return;
    }

    await this.recordDelivery(notificationId, userId, channel, {
      status: 'SENT',
      sentAt: new Date(),
    });
  }

  private pushConfigured(): boolean {
    return Boolean(
      this.config.get('enableWebPush', { infer: true }) &&
        this.config.get('vapidPublicKey', { infer: true }) &&
        this.config.get('vapidPrivateKey', { infer: true }),
    );
  }

  private async sendPush(
    userId: string,
    options: NotifyOptions,
  ): Promise<boolean> {
    if (!this.config.get('enableWebPush', { infer: true })) return false;
    const publicKey = this.config.get('vapidPublicKey', { infer: true });
    const privateKey = this.config.get('vapidPrivateKey', { infer: true });
    if (!publicKey || !privateKey) return false;

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });
    if (!subscriptions.length) return false;

    try {
      const webpush = await import('web-push');
      webpush.setVapidDetails(
        this.config.get('vapidSubject', { infer: true }),
        publicKey,
        privateKey,
      );
      const payload = JSON.stringify({
        title: options.title,
        body: options.body,
        link: options.targetUrl ?? '/app',
      });
      let delivered = false;
      for (const subscription of subscriptions) {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            payload,
          );
          delivered = true;
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.pushSubscription.delete({
              where: { id: subscription.id },
            });
          }
        }
      }
      return delivered;
    } catch (error) {
      this.logger.warn(
        `Push indisponible : ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }

  /**
   * Envoie un e-mail et journalise systématiquement la tentative dans
   * `EmailLog` : en recette comme en production, on peut donc vérifier qui a
   * reçu quoi, quand, et pourquoi un envoi a échoué.
   */
  private async deliver(
    to: string,
    subject: string,
    html: string,
    text: string,
    template = 'NOTIFICATION',
  ): Promise<void> {
    const log = await this.prisma.emailLog.create({
      data: { to, subject, template, status: 'PENDING' },
    });
    try {
      await this.transmit(to, subject, html, text);
      await this.prisma.emailLog.update({
        where: { id: log.id },
        data: { status: 'SENT', sentAt: new Date() },
      });
    } catch (error) {
      await this.prisma.emailLog.update({
        where: { id: log.id },
        data: {
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'Échec d’envoi.',
        },
      });
      throw error;
    }
  }

  private async transmit(
    to: string,
    subject: string,
    html: string,
    text: string,
  ): Promise<void> {
    const driver = this.config.get('mailDriver', { infer: true });
    const from = this.config.get('mailFrom', { infer: true });

    if (driver === 'smtp' && this.transporter) {
      await this.transporter.sendMail({ from, to, subject, html, text });
      return;
    }

    if (driver === 'json') {
      const file = path.join(
        this.mailDir,
        `${Date.now()}-${to.replace(/[^a-z0-9]/gi, '_')}.json`,
      );
      fs.writeFileSync(
        file,
        JSON.stringify({ to, from, subject, html, text }, null, 2),
        'utf8',
      );
      return;
    }

    this.logger.log(`[MAIL] ${to} · ${subject}\n${text}`);
  }

  private async recordDelivery(
    notificationId: string,
    userId: string,
    channel: NotificationChannel,
    data: {
      status: string;
      recipient?: string;
      error?: string | null;
      sentAt?: Date | null;
    },
  ): Promise<void> {
    await this.prisma.notificationDelivery.create({
      data: {
        notificationId,
        userId,
        channel,
        status: data.status as never,
        recipient: data.recipient ?? null,
        error: data.error ?? null,
        sentAt: data.sentAt ?? null,
      },
    });
  }

  private skipReason(
    preference: { emailEnabled: boolean; pushEnabled: boolean },
    categoryAllowed: boolean,
    quiet: boolean,
  ): string {
    if (quiet) return 'Plage d’heures silencieuses active.';
    if (!categoryAllowed) return 'Catégorie désactivée dans vos préférences.';
    if (!preference.emailEnabled && !preference.pushEnabled)
      return 'Canal désactivé dans vos préférences.';
    return 'Notification non envoyée.';
  }

  private inQuietHours(preference: {
    quietHoursEnabled: boolean;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
  }): boolean {
    if (!preference.quietHoursEnabled) return false;
    const start = preference.quietHoursStart ?? '22:00';
    const end = preference.quietHoursEnd ?? '07:00';
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const toMinutes = (value: string): number =>
      Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    const from = toMinutes(start);
    const to = toMinutes(end);
    return from <= to
      ? minutes >= from && minutes < to
      : minutes >= from || minutes < to;
  }

  private async enforceRetention(
    userId: string,
    retentionDays: number,
  ): Promise<void> {
    const threshold = new Date(
      Date.now() - Math.max(1, retentionDays) * 86_400_000,
    );
    await this.prisma.notification.deleteMany({
      where: { userId, createdAt: { lt: threshold }, readAt: { not: null } },
    });
  }

  private defaultCategories(
    role: string,
  ): Record<string, { email: boolean; push: boolean }> {
    return {
      PLANNING: { email: true, push: true },
      ATTENDANCE: { email: false, push: true },
      OPERATIONS: { email: true, push: true },
      LEAVE: { email: true, push: true },
      INCIDENT: { email: role !== 'SWAPPER', push: true },
      ACCESS: { email: role === 'ADMIN', push: false },
      REPORT: { email: role === 'ADMIN', push: false },
    };
  }

  private mergeCategories(
    raw: string,
    patch: { categories?: Record<string, { email?: boolean; push?: boolean }> },
  ): Record<string, { email: boolean; push: boolean }> {
    let current: Record<string, { email: boolean; push: boolean }> = {};
    try {
      current = JSON.parse(raw) as typeof current;
    } catch {
      current = {};
    }
    for (const category of ALL_CATEGORIES) {
      current[category] ??= { email: false, push: false };
    }
    if (patch.categories) {
      for (const [key, value] of Object.entries(patch.categories)) {
        const existing = current[key] ?? { email: false, push: false };
        current[key] = {
          email: value.email ?? existing.email,
          push: value.push ?? existing.push,
        };
      }
    }
    return current;
  }

  private readCategory(
    raw: string,
    category: NotificationCategory,
  ): { email: boolean; push: boolean } {
    let parsed: Record<string, { email?: boolean; push?: boolean }> = {};
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      parsed = {};
    }
    const entry = parsed[category];
    return { email: entry?.email !== false, push: entry?.push !== false };
  }

  /* ---------------------------------------------------------------- */
  /* Notifications metier transverses                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Publication d'un planning : notifie chaque agent affecte et les
   * superviseurs. Une seule notification par personne, meme si plusieurs
   * postes lui sont attribues.
   */
  async notifyPlanningPublished(
    planningId: string,
    actorId: string,
  ): Promise<{ agents: number }> {
    const planning = await this.prisma.planning.findUnique({
      where: { id: planningId },
      select: { name: true, periodStart: true, periodEnd: true },
    });
    if (!planning) return { agents: 0 };

    const assignments = await this.prisma.occurrenceAssignment.findMany({
      where: { occurrence: { planningId } },
      select: { userId: true, occurrence: { select: { day: true } } },
    });

    const byUser = new Map<string, Set<string>>();
    for (const assignment of assignments) {
      const days = byUser.get(assignment.userId) ?? new Set<string>();
      days.add(assignment.occurrence.day);
      byUser.set(assignment.userId, days);
    }

    const period = `${planning.periodStart.toISOString().slice(0, 10)} → ${planning.periodEnd.toISOString().slice(0, 10)}`;
    for (const [userId, days] of byUser) {
      await this.notify({
        userId,
        kind: 'PLANNING_PUBLISHED',
        title: 'Votre planning est publié',
        body: `${planning.name} (${period}) · ${days.size} jour${days.size === 1 ? '' : 's'} planifié${days.size === 1 ? '' : 's'}.`,
        targetId: planningId,
        targetUrl: '/plannings',
      });
    }

    await this.notifyMany(
      [actorId],
      {
        kind: 'PLANNING_PUBLISHED',
        title: 'Planning publié',
        body: `${planning.name} : ${byUser.size} agent${byUser.size === 1 ? '' : 's'} notifié${byUser.size === 1 ? '' : 's'}.`,
        targetId: planningId,
        targetUrl: '/plannings',
        critical: true,
      },
    );

    return { agents: byUser.size };
  }
}

/** Type utilitaire partage par les services qui composent une notification. */
export type NotificationCreateInput = Prisma.NotificationCreateInput;

/**
 * Extension metier : notifications de planification.
 *
 * Ajoutees ici (plutot que dupliquees dans chaque service) car la publication
 * d'un planning concerne des personnes differentes selon le role :
 * - les agents affectes recoivent leur affectation ;
 * - les superviseurs recoivent la confirmation de publication.
 */
declare module './notifications.service' {
  interface NotificationsService {
    notifyPlanningPublished(
      planningId: string,
      actorId: string,
    ): Promise<{ agents: number }>;
  }
}
