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

/** Piece jointe d'un e-mail transactionnel (rapports programmes). */
export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

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
      const user = this.config.get('smtpUser', { infer: true });
      const pass = this.config.get('smtpPassword', { infer: true });
      const host = this.config.get('smtpHost', { infer: true });
      if (!host) {
        // Un SMTP sans hote bascule silencieusement en mode console : les
        // invitations et notifications ne partent jamais. On le dit une fois,
        // en clair, au lieu de laisser l'exploitant chercher.
        this.logger.error(
          'MAIL_DRIVER=smtp mais SMTP_HOST est vide : aucun e-mail ne sera envoye.',
        );
      } else if (!user || !pass) {
        this.logger.error(
          'MAIL_DRIVER=smtp sans SMTP_USER / SMTP_PASS : Gmail refusera la connexion.',
        );
      }
      this.transporter = nodemailer.createTransport({
        host,
        port: this.config.get('smtpPort', { infer: true }),
        secure: this.config.get('smtpSecure', { infer: true }),
        requireTLS: this.config.get('smtpRequireTls', { infer: true }),
        auth: user ? { user, pass } : undefined,
        // Delais courts : un SMTP lent ne doit pas immobiliser un worker
        // pendant 90 s. Un lot de notifications part en parallele, un echec
        // apres 20 s est journalise puis abandonne (une nouvelle tentative
        // est faite par l'appelant si necessaire).
        connectionTimeout: 8_000,
        greetingTimeout: 8_000,
        socketTimeout: 20_000,
        pool: true,
        maxConnections: 3,
        maxMessages: 50,
      });
      this.transporter
        .verify()
        .then(() =>
          this.logger.log(`Canal e-mail SMTP operationnel (${host}).`),
        )
        .catch((error: unknown) =>
          this.logger.error(
            `SMTP injoignable (${host}) : ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
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

  /**
   * Cree la notification interne puis lance sa distribution.
   *
   * La distribution (SMTP compris) est **asynchrone** : un envoi Gmail prenait
   * jusqu'a 90 s par destinataire, ce qui bloquait la requete HTTP d'un
   * incident, d'une demande de conge ou d'un pointage. La promesse retournee
   * par `distribute` est volontairement non attendue : le journal
   * `NotificationDelivery`/`EmailLog` est ecrit dans tous les cas.
   */
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

    void this.distribute(options, notification.id).catch((error: unknown) =>
      this.logger.warn(
        `Distribution de la notification ${notification.id} en echec : ${
          error instanceof Error ? error.message : error
        }`,
      ),
    );

    return notification;
  }

  /** Envoi e-mail / push selon les preferences, journalise par canal. */
  private async distribute(
    options: NotifyOptions,
    notificationId: string,
  ): Promise<void> {
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
    await this.recordDelivery(notificationId, options.userId, 'INTERNAL', {
      status: preference.internalEnabled ? 'SENT' : 'SKIPPED',
      sentAt: preference.internalEnabled ? new Date() : null,
      error: preference.internalEnabled
        ? null
        : 'Canal interne desactive par l’utilisateur.',
    });

    // Un compte desactive ne recoit plus rien par messagerie, mais conserve sa
    // notification interne. Le test porte sur `isActive` ET `disabledAt`.
    const recipientActive = await this.isRecipientActive(options.userId);
    if (recipientActive && user?.email) {
      // Une notification critique (acces, securite, suppression de donnees)
      // ne doit jamais etre filtree par un reglage fin : seul l'interrupteur
      // global de l'e-mail peut la retenir.
      const mailAllowed = options.critical
        ? preference.emailEnabled
        : preference.emailEnabled && categoryPrefs.email && !quiet;
      if (mailAllowed) {
        await this.sendToChannel(
          notificationId,
          options.userId,
          'EMAIL',
          user.email,
          options,
        );
      } else {
        await this.recordDelivery(notificationId, options.userId, 'EMAIL', {
          status: 'SKIPPED',
          error: this.skipReason(preference, categoryPrefs.email, quiet),
        });
      }

      const pushAllowed =
        preference.pushEnabled && categoryPrefs.push && !quiet;
      if (pushAllowed) {
        await this.sendToChannel(
          notificationId,
          options.userId,
          'PUSH',
          user.email,
          options,
        );
      } else {
        await this.recordDelivery(notificationId, options.userId, 'PUSH', {
          status: 'SKIPPED',
          error: this.skipReason(preference, categoryPrefs.push, quiet),
        });
      }
    }

    await this.enforceRetention(options.userId, preference.retentionDays);
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
    // Le super administrateur recoit aussi ce que recoit l'administrateur.
    const admins = await this.prisma.user.findMany({
      where: {
        role: { in: ['SUPER_ADMIN', 'ADMIN'] },
        isActive: true,
        disabledAt: null,
      },
      select: { id: true },
    });
    return this.notifyMany(
      [...supervisors, ...admins].map((item) => item.id).concat(extraUserIds),
      options,
    );
  }

  async notifyAdmins(options: Omit<NotifyOptions, 'userId'>): Promise<number> {
    const admins = await this.prisma.user.findMany({
      where: {
        role: { in: ['SUPER_ADMIN', 'ADMIN'] },
        isActive: true,
        disabledAt: null,
      },
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
    attachments: MailAttachment[] = [],
  ): Promise<void> {
    const { subject, html, text } = renderTemplate(template, variables);
    // `deliver` cree et met a jour la ligne EmailLog (PENDING -> SENT/FAILED).
    // Ne PAS en creer une seconde ici : elle resterait bloquee en PENDING et
    // ferait croire a un envoi en attente qui n'arrivera jamais.
    try {
      await this.deliver(to, subject, html, text, template, attachments);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Echec d’envoi.';
      this.logger.error(`E-mail ${template} vers ${to} non envoye : ${message}`);
      // Le mot de passe oublie ne doit pas dependre du SMTP : le lien est
      // ecrit dans ce message pour que l'exploitant teste meme si le
      // fournisseur refuse le message.
      if (template === 'PASSWORD_RESET' || template === 'INVITATION') {
        this.logger.log(`[LIEN ${template}] ${to} → ${variables.url}`);
      }
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
        await this.deliver(recipient, subject, html, text, 'NOTIFICATION');
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

  /** Le destinataire peut-il encore recevoir des messages ? */
  private async isRecipientActive(userId: string): Promise<boolean> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, disabledAt: true },
    });
    return Boolean(row?.isActive && !row.disabledAt);
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
    attachments: MailAttachment[] = [],
  ): Promise<void> {
    const log = await this.prisma.emailLog.create({
      data: { to, subject, template, status: 'PENDING' },
    });
    try {
      const accepted = await this.transmit(to, subject, html, text, attachments);
      // `SENT` ne doit signifier qu'une chose : le serveur SMTP a accepté le
      // message. En mode console/json, rien n'est livré au destinataire : le
      // journal le dit, au lieu de laisser croire à un envoi réussi.
      await this.prisma.emailLog.update({
        where: { id: log.id },
        data: accepted
          ? { status: 'SENT', sentAt: new Date() }
          : {
              status: 'SKIPPED',
              error:
                'Canal e-mail non configuré pour l’envoi réel (MAIL_DRIVER ≠ smtp).',
            },
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
    attachments: MailAttachment[] = [],
  ): Promise<boolean> {
    const driver = this.config.get('mailDriver', { infer: true });
    const from = this.config.get('mailFrom', { infer: true });

    if (driver === 'smtp' && this.transporter) {
      const payload = {
        from,
        to,
        subject,
        html,
        text,
        ...(attachments.length
          ? {
              attachments: attachments.map((attachment) => ({
                filename: attachment.filename,
                content: attachment.content,
                contentType:
                  attachment.contentType ?? mimeForFilename(attachment.filename),
              })),
            }
          : {}),
      };
      // Deux tentatives : un incident reseau ponctuel (reset de connexion
      // SMTP, coupure Wi-Fi) ne doit pas faire perdre le lien de
      // reinitialisation ni le rapport du jour.
      try {
        await this.transporter.sendMail(payload);
      } catch (first) {
        this.logger.warn(
          `SMTP : premier envoi vers ${to} en echec (${
            first instanceof Error ? first.message : first
          }), nouvelle tentative.`,
        );
        await this.transporter.sendMail(payload);
      }
      // `sendMail` ne resout qu'apres acceptation par le serveur SMTP.
      return true;
    }

    if (driver === 'smtp') {
      // Ne JAMAIS pretendre a un envoi quand le transport n'existe pas :
      // c'est ce silence qui faisait croire que les e-mails partaient.
      throw new Error(
        'Canal e-mail SMTP indisponible : verifiez SMTP_HOST, SMTP_USER et SMTP_PASS dans backend_new/.env.',
      );
    }

    if (driver === 'json') {
      // Mode fichier (recette) : le contenu est ecrit a cote du message pour
      // pouvoir verifier que la piece jointe existe et n'est pas vide.
      const stamp = Date.now();
      const file = path.join(
        this.mailDir,
        `${stamp}-${to.replace(/[^a-z0-9]/gi, '_')}.json`,
      );
      const saved = attachments.map((attachment, index) => {
        const name = path.join(this.mailDir, `${stamp}-${index}-${attachment.filename}`);
        fs.writeFileSync(name, attachment.content);
        // Le type MIME est conserve dans la trace : sans lui, on ne pourrait
        // pas verifier que le fichier recu est bien celui annonce.
        return {
          filename: attachment.filename,
          contentType: attachment.contentType ?? mimeForFilename(attachment.filename),
          bytes: attachment.content.length,
          file: name,
        };
      });
      fs.writeFileSync(
        file,
        JSON.stringify({ to, from, subject, html, text, attachments: saved }, null, 2),
        'utf8',
      );
      // Écrit sur disque uniquement : le destinataire n'a rien reçu.
      return false;
    }

    this.logger.log(
      `[MAIL] ${to} · ${subject}${attachments.length ? ` · pieces jointes : ${attachments.map((a) => a.filename).join(', ')}` : ''}\n${text}`,
    );
    return false;
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
      // Roles de pilotage : alertes d'acces et rapports par e-mail.
      ACCESS: { email: role !== 'SWAPPER', push: false },
      REPORT: { email: role !== 'SWAPPER', push: false },
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
 * Type MIME d'une piece jointe deduit de son extension.
 * L'appelant peut le preciser ; a defaut, c'est ce type qui est transmis au
 * SMTP (et trace dans le canal `json`).
 */
export function mimeForFilename(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.csv') return 'text/csv; charset=utf-8';
  if (extension === '.xlsx')
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (extension === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

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
