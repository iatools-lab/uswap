import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';

type MailType = 'INVITATION' | 'PASSWORD_RESET';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  private readonly transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  constructor(private readonly prisma: PrismaService) {}

  private get frontendUrl(): string {
    return (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(
      /\/$/,
      '',
    );
  }

  async sendPasswordReset(
    email: string,
    token: string,
    userId?: string,
  ): Promise<boolean> {
    const resetUrl = `${this.frontendUrl}/auth/reset-password?token=${encodeURIComponent(token)}`;
    return this.sendEmail({
      userId,
      to: email,
      subject: 'Réinitialisation de votre mot de passe uSwap',
      type: 'PASSWORD_RESET',
      html: [
        '<p>Une demande de réinitialisation de mot de passe a été reçue pour votre compte uSwap.</p>',
        `<p><a href="${resetUrl}">Réinitialiser mon mot de passe</a></p>`,
        '<p>Ce lien expire dans 15 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.</p>',
      ].join(''),
      actionUrl: resetUrl,
    });
  }

  async sendReportEmail(
    recipients: string[],
    subject: string,
    html: string,
    attachment: { filename: string; content: Buffer; contentType: string },
    userId?: string,
  ): Promise<boolean> {
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const from = process.env.MAIL_FROM ?? smtpUser;
    if (!smtpUser || !smtpPass || !from || !recipients.length) {
      return false;
    }
    try {
      const info = await this.transporter.sendMail({
        from: `"uSwap" <${from}>`,
        to: recipients.join(', '),
        subject,
        html,
        attachments: [attachment],
      });
      if (userId) {
        await this.prisma.communicationLog.create({
          data: {
            userId,
            channel: 'EMAIL',
            type: 'SCHEDULED_REPORT',
            recipient: recipients.join(', '),
            subject,
            status: 'SENT',
            providerMessageId: info.messageId,
          },
        });
      }
      return true;
    } catch (error) {
      if (userId) {
        await this.prisma.communicationLog.create({
          data: {
            userId,
            channel: 'EMAIL',
            type: 'SCHEDULED_REPORT',
            recipient: recipients.join(', '),
            subject,
            status: 'FAILED',
            errorMessage:
              error instanceof Error ? error.message : 'Erreur inconnue',
          },
        });
      }
      return false;
    }
  }

  async sendInvitation(
    email: string,
    token: string,
    userId?: string,
  ): Promise<boolean> {
    const activationUrl = `${this.frontendUrl}/auth/activate?token=${encodeURIComponent(token)}`;
    return this.sendEmail({
      userId,
      to: email,
      subject: 'Activation de votre compte uSwap',
      type: 'INVITATION',
      html: [
        '<p>Un compte uSwap a été créé pour vous.</p>',
        `<p><a href="${activationUrl}">Activer mon compte</a></p>`,
        '<p>Ce lien expire dans 48 heures.</p>',
      ].join(''),
      debugLink: activationUrl,
      actionUrl: activationUrl,
    });
  }

  private async sendEmail(input: {
    userId?: string;
    to: string;
    subject: string;
    type: MailType;
    html: string;
    debugLink?: string;
    actionUrl?: string;
  }): Promise<boolean> {
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const from = process.env.MAIL_FROM ?? smtpUser;

    if (!smtpUser || !smtpPass || !from) {
      await this.log(input, 'NOT_CONFIGURED', 'SMTP non configuré');
      this.logger.warn(
        `Service e-mail non configuré. Aucun e-mail envoyé à ${input.to}.` +
          (input.debugLink ? ` Lien d'action : ${input.debugLink}` : ''),
      );
      return false;
    }

    try {
      const info = await this.transporter.sendMail({
        from: `"uSwap" <${from}>`,
        to: input.to,
        subject: input.subject,
        html: input.html,
      });

      await this.log(input, 'SENT', undefined, info.messageId);
      this.logger.log(`E-mail envoyé avec succès à ${input.to}`);
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'erreur inconnue';
      await this.log(input, 'FAILED', message);
      this.logger.error(`Échec d'envoi e-mail à ${input.to}: ${message}`);
      return false;
    }
  }

  private async log(
    input: {
      userId?: string;
      to: string;
      subject: string;
      type: MailType;
      actionUrl?: string;
    },
    status: string,
    errorMessage?: string,
    providerMessageId?: string,
  ) {
    if (!input.userId) return;
    try {
      await this.prisma.communicationLog.create({
        data: {
          userId: input.userId,
          channel: 'EMAIL',
          type: input.type,
          recipient: input.to,
          subject: input.subject,
          status,
          providerMessageId: providerMessageId ?? null,
          errorMessage: errorMessage ?? null,
          actionUrl: input.actionUrl ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Impossible d'enregistrer l'historique de communication: ${
          error instanceof Error ? error.message : 'erreur inconnue'
        }`,
      );
    }
  }
}
