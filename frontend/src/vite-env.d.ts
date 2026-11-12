/// <reference types="vite/client" />

/** Identifiant du build (date + commit), rempli par vite.config.ts. */
declare const __BUILD_ID__: string;

/**
 * Variables Vite lues par l'application.
 *
 * Déclarées ici pour que TypeScript signale une faute de frappe
 * (`VITE_GOOGLE_CLIENTID`) au lieu de laisser un bouton Google silencieusement
 * absent au déploiement.
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Identifiant OAuth Google (console Google Cloud). Absent = SSO désactivé. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /**
   * Clé Google Maps (Maps JavaScript API + Places). Absente = la carte de
   * création de station utilise OpenStreetMap, sans perte de fonctionnalité.
   */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
