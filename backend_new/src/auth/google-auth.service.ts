import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';

/**
 * Vérification d'un jeton d'identité Google.
 *
 * Le frontend obtient un `id_token` via Google Identity Services, puis le
 * transmet au backend. On NE fait pas confiance au contenu : le jeton est
 * vérifié auprès de Google (`tokeninfo`), ce qui garantit :
 *   - qu'il n'est pas forgé (signature validée par Google) ;
 *   - qu'il est destiné À CETTE application (`aud` = client ID) ;
 *   - qu'il n'est pas expiré.
 *
 * Aucune dépendance supplémentaire : un `fetch` suffit.
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

  /** Authentification Google activée (client ID renseigné) ? */
  enabled(): boolean {
    return Boolean(this.config.get('googleClientId', { infer: true }));
  }

  /**
   * Vérifie un jeton Google et renvoie l'identité, ou `null` si le jeton est
   * invalide, expiré, émis pour une autre application, ou si l'adresse e-mail
   * n'est pas vérifiée par Google.
   */
  async verify(idToken: string): Promise<GoogleIdentity | null> {
    if (!idToken) return null;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
        { signal: controller.signal },
      );
      clearTimeout(timer);

      if (!response.ok) return null;
      const info = (await response.json()) as {
        aud?: string;
        email?: string;
        email_verified?: string | boolean;
        name?: string;
        picture?: string;
        exp?: string;
      };

      // Le jeton doit avoir été émis pour NOTRE application.
      const expected = this.config.get('googleClientId', { infer: true });
      if (info.aud !== expected) {
        this.logger.warn(
          `Jeton Google refusé : audience ${info.aud ?? 'absente'} ≠ ${expected}.`,
        );
        return null;
      }

      const verified =
        info.email_verified === true || info.email_verified === 'true';
      if (!info.email || !verified) return null;

      return {
        email: info.email.toLowerCase(),
        emailVerified: verified,
        name: info.name,
        picture: info.picture,
      };
    } catch (error) {
      this.logger.error(
        `Vérification Google impossible : ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }
}
