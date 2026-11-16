/**
 * Identifiant OAuth Google — source unique de vérité côté frontend.
 *
 * POURQUOI CE FICHIER
 * -------------------
 * La connexion Google échouait en production avec « OAuth client not found » :
 * le bundle avait été construit sans `VITE_GOOGLE_CLIENT_ID` (variable absente
 * du fichier `.env` du serveur, ou oubliée dans les arguments de build Docker).
 * L'identifiant n'est pas un secret : Google exige qu'il soit présent dans le
 * HTML servi. Il est donc embarqué ici comme valeur par défaut, ce qui rend la
 * connexion Google fonctionnelle même si l'environnement de build est
 * incomplet.
 *
 * Ordre de priorité :
 *   1. `VITE_GOOGLE_CLIENT_ID` (environnement / build Docker) — permet de
 *      changer de client OAuth sans toucher au code ;
 *   2. `GOOGLE_CLIENT_ID_DEFAULT` ci-dessous.
 *
 * Le backend vérifie le même identifiant (`GOOGLE_CLIENT_ID`) : les deux
 * valeurs DOIVENT rester identiques, sinon Google émet un jeton dont l'audience
 * ne correspond pas et `/auth/google` répond 401. Le test
 * `frontend/src/config/google.spec.ts` verrouille cette égalité.
 */

/** Identifiant OAuth du client Web uSwap (projet Google Cloud uPowa). */
export const GOOGLE_CLIENT_ID_DEFAULT =
  "739196811493-uswap5k2v9q4g8c1r7tqb3hj0m6dpl.apps.googleusercontent.com";

const fromEnv = (import.meta.env as Record<string, string | undefined>)
  ?.VITE_GOOGLE_CLIENT_ID;

/**
 * Identifiant effectivement utilisé par Google Identity Services.
 *
 * Une valeur d'environnement vide (`VITE_GOOGLE_CLIENT_ID=`) ne doit pas
 * désactiver le bouton : elle est traitée comme absente.
 */
export const GOOGLE_CLIENT_ID = (fromEnv?.trim() || GOOGLE_CLIENT_ID_DEFAULT).trim();

/** Un identifiant Google doit finir par `.apps.googleusercontent.com`. */
export function isGoogleClientId(value: string | undefined | null): boolean {
  return Boolean(
    value && /^\d+-[a-z0-9._-]+\.apps\.googleusercontent\.com$/i.test(value.trim()),
  );
}
