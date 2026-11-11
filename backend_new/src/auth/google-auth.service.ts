import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';

/**
 * VÃ©rification d'un jeton d'identitÃ© Google.
 *
 * Le frontend obtient un `id_token` via Google Identity Services, puis le
 * transmet au backend. On NE fait pas confiance au contenu : le jeton est
 * vÃ©rifiÃ© auprÃ¨s de Google (`tokeninfo`), ce qui garantit :
 *   - qu'il n'est pas forgÃ© (signature validÃ©e par Google) ;
 *   - qu'il est destinÃ© Ã€ CETTE application (`aud` = client ID) ;
 *   - qu'il n'est pas expirÃ©.
 *
 * Aucune dÃ©pendance supplÃ©mentaire : un `fetch` suffit.
 */
export type GoogleIdentity = {
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
};

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  /** Authentification Google activÃ©e (client ID renseignÃ©) ? */
  enabled(): boolean {
    return Boolean(this.config.get('googleClientId', { infer: true }));
  }

  /**
   * VÃ©rifie un jeton Google et renvoie l'identitÃ©, ou `null` si le jeton est
   * invalide, expirÃ©, Ã©mis pour une autre application, ou si l'adresse e-mail
   * n'est pas vÃ©rifiÃ©e par Google.
   */
  async verify(idToken: string): Promise<GoogleIdentity | null> {
    if (!idToken) return null;

    // Declares AVANT le try : le `finally` doit pouvoir les liberer, et une
    // variable declaree dans le bloc try n'y serait pas visible.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
        { signal: controller.signal },
      );

      if (!response.ok) return null;
      const info = (await response.json()) as {
        aud?: string;
        email?: string;
        email_verified?: string | boolean;
        name?: string;
        picture?: string;
        exp?: string;
      };

      // Le jeton doit avoir Ã©tÃ© Ã©mis pour NOTRE application.
      const expected = this.config.get('googleClientId', { infer: true });
      if (info.aud !== expected) {
        this.logger.warn(
          `Jeton Google refuse : audience ${info.aud ?? 'absente'} differente de ${expected}.`,
        );
        return null;
      }

      const verified =
        info.email_verified === true || info.email_verified === 'true';
      if (!info.email || !verified) return null;

      const email = info.email.trim().toLowerCase();
      // Doit contenir exactement un '@'
      const atIndex = email.indexOf('@');
      if (atIndex <= 0 || atIndex === email.length - 1) return null;
      const domain = email.slice(atIndex + 1);
      if (domain !== 'upowa.org') {
        this.logger.warn(
          `Adresse e-mail non autorisÃ©e : domaine "${domain}" diffÃ©rent de "upowa.org".`,
        );
        return null;
      }

      return {
        email, // email normalise (trim + lowercase)
        emailVerified: verified,
        name: info.name,
        picture: info.picture,
      };
    } catch (error) {
      this.logger.error(
        `Verification Google impossible : ${error instanceof Error ? error.message : error}`,
      );
      return null;
    } finally {
      // Le minuteur est TOUJOURS libere, succes comme echec : sans cela une
      // requete lente laissait un timer actif et un AbortController en vie.
      clearTimeout(timer);
    }
  }
}

