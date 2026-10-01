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
      // Le lien est journalisé même sans fournisseur configuré, pour que
      // l'activation reste possible en developpement (voir sendEmail).
      debugLink: activationUrl,
    });
  }

  private async sendEmail(input: {
    to: string;
    subject: string;
    html: string;
    /** Lien d'action, journalise lorsque l'envoi reel est indisponible. */
    debugLink?: string;
  }): Promise<boolean> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM;

    if (!apiKey || !from) {
      // Sans fournisseur, le compte est bien cree mais l'utilisateur ne peut
      // pas activer son compte. On expose donc le lien pour ne pas le perdre.
      this.logger.warn(
        'Service e-mail non configuré (RESEND_API_KEY manquante). ' +
          `Aucun e-mail envoyé à ${input.to}.` +
          (input.debugLink ? ` Lien d'action : ${input.debugLink}` : ''),
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
