/**
 * Identifiant OAuth Google — source unique de vérité côté backend.
 *
 * Le client OAuth est public : il figure dans le HTML servi au navigateur. Il
 * est donc embarqué ici pour que la protection par audience (`aud` du jeton
 * Google) fonctionne même si `GOOGLE_CLIENT_ID` a été oublié dans le fichier
 * `.env` du serveur — l'oubli produisait « OAuth client not found » au moment
 * de la connexion Google.
 *
 * Priorité : `GOOGLE_CLIENT_ID` (environnement) puis la valeur par défaut.
 * Elle doit rester identique à `frontend/src/config/google.ts`
 * (`GOOGLE_CLIENT_ID_DEFAULT`) ; le test `google-client.spec.ts` le vérifie.
 */
export const GOOGLE_CLIENT_ID_DEFAULT =
  '739196811493-uswap5k2v9q4g8c1r7tqb3hj0m6dpl.apps.googleusercontent.com';

/** Identifiant réellement utilisé pour vérifier l'audience des jetons. */
export function googleClientId(env: string | undefined): string {
  const value = (env ?? '').trim();
  return value || GOOGLE_CLIENT_ID_DEFAULT;
}

/** Un identifiant client Google finit toujours par `.apps.googleusercontent.com`. */
export function isGoogleClientId(value: string | undefined | null): boolean {
  return Boolean(
    value && /^\d+-[a-z0-9._-]+\.apps\.googleusercontent\.com$/i.test(value.trim()),
  );
}
