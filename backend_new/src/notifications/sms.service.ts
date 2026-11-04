import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';

/**
 * Envoi de SMS.
 *
 * Deux modes, choisis par `SMS_DRIVER` :
 *
 *  - `console` (défaut) : le message est écrit dans les journaux et jamais
 *    transmis. Permet de valider le parcours sans compte opérateur ni coût.
 *  - `http` : un `POST` vers `SMS_ENDPOINT`, avec un jeton `SMS_TOKEN`.
 *    C'est le contrat commun à la plupart des agrégateurs (Orange SMS API,
 *    Twilio, Infobip, Vonage) : l'adaptation se limite au corps de la requête.
 *
 * Aucun SDK n'est ajouté : un `fetch` suffit et évite une dépendance de plus
 * dans l'image de production.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  /** Le canal est-il réellement capable d'envoyer ? */
  configured(): boolean {
    if (this.config.get('smsDriver', { infer: true }) !== 'http') return false;
    return Boolean(
      this.config.get('smsEndpoint', { infer: true }) &&
      this.config.get('smsToken', { infer: true }),
    );
  }

  /**
   * Envoie un SMS. Retourne `true` si le fournisseur a accepté le message.
   *
   * Ne lève jamais : un SMS en échec ne doit pas faire échouer la création de
   * la notification (le canal interne, lui, a déjà été enregistré).
   */
  async send(to: string, body: string): Promise<boolean> {
    const phone = this.normalize(to);
    if (!phone) {
      this.logger.warn(`SMS ignoré : numéro invalide (${to || 'vide'})`);
      return false;
    }

    const driver = this.config.get('smsDriver', { infer: true });

    if (driver !== 'http') {
      // Mode recette : visible dans les journaux, aucun envoi réel.
      this.logger.log(`[SMS:console] ${phone} — ${body.slice(0, 160)}`);
      return true;
    }

    const endpoint = this.config.get('smsEndpoint', { infer: true });
    const token = this.config.get('smsToken', { infer: true });
    if (!endpoint || !token) {
      this.logger.warn(
        'SMS non configuré : SMS_ENDPOINT ou SMS_TOKEN manquant.',
      );
      return false;
    }

    try {
      const controller = new AbortController();
      // Un fournisseur lent ne doit pas retenir la requête HTTP qui déclenche
      // la notification.
      const timer = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: phone,
          message: body,
          sender: this.config.get('smsSender', { infer: true }),
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        this.logger.error(
          `SMS refusé par le fournisseur : HTTP ${response.status} pour ${phone}`,
        );
        return false;
      }
      this.logger.log(`SMS envoyé à ${phone}`);
      return true;
    } catch (error) {
      this.logger.error(
        `SMS en échec pour ${phone} : ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }

  /**
   * Normalise un numéro au format international sans « + ».
   *
   * Les numéros saisis par les utilisateurs sont souvent locaux (0 6 xx xx xx
   * xx) ; le fournisseur exige le format international. On accepte les deux
   * et on nettoie les séparateurs.
   */
  private normalize(raw: string): string | null {
    if (!raw) return null;
    const digits = String(raw).replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) return digits.slice(1);
    // Numéro camerounais local : 9 chiffres commençant par 6 -> 237 6...
    if (/^6\d{8}$/.test(digits)) return `237${digits}`;
    if (/^0[6-9]\d{8}$/.test(digits)) return `237${digits.slice(1)}`;
    return digits.length >= 8 ? digits : null;
  }
}
