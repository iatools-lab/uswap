import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  private get frontendUrl(): string {
    return (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
  }

  async sendPasswordReset(email: string, token: string): Promise<boolean> {
    const resetUrl = `${this.frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
    return this.sendEmail({
      to: email,
      subject: 'Réinitialisation de votre mot de passe Uswap',
      html: [
        '<p>Une demande de réinitialisation de mot de passe a été reçue pour votre compte Uswap.</p>',
        `<p><a href="${resetUrl}">Réinitialiser mon mot de passe</a></p>`,
        '<p>Ce lien expire dans 15 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.</p>',
      ].join(''),
    });
  }

  async sendInvitation(email: string, token: string): Promise<boolean> {
    const activationUrl = `${this.frontendUrl}/activate-account?token=${encodeURIComponent(token)}`;
    return this.sendEmail({
      to: email,
      subject: 'Activation de votre compte Uswap',
      html: [
        '<p>Un compte Uswap a été créé pour vous.</p>',
        `<p><a href="${activationUrl}">Activer mon compte</a></p>`,
        '<p>Ce lien expire dans 48 heures.</p>',
      ].join(''),
    });
  }

  private async sendEmail(input: { to: string; subject: string; html: string }): Promise<boolean> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM;

    if (!apiKey || !from) {
      this.logger.warn(
        'Service e-mail non configuré. Définissez RESEND_API_KEY et MAIL_FROM pour activer les e-mails transactionnels.',
      );
      return false;
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`Échec d'envoi e-mail (${response.status}): ${errorBody}`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(
        `Échec d'envoi e-mail: ${error instanceof Error ? error.message : 'erreur inconnue'}`,
      );
      return false;
    }
  }
}
