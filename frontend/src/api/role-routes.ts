/**
 * Correspondance entre les routes métier appelées par l'application et
 * l'espace de travail du rôle connecté.
 *
 *   SUPER_ADMIN -> /superadmin/...
 *   ADMIN       -> /pilot/...
 *   SUPERVISOR  -> /supervision/...
 *   SWAPPER     -> /agent/...
 *
 * Les composants continuent d'appeler les chemins métier (`/users`,
 * `/plannings`, `/attendance`…) : `api()` préfixe l'appel selon le rôle
 * réellement connecté. Un seul point de décision, donc :
 *   - aucun oubli possible dans les dizaines de composants qui appellent l'API ;
 *   - aucun chemin construit dynamiquement hors du contrôle (`"/users/" + id`) ;
 *   - les tests peuvent vérifier la table une seule fois.
 *
 * Les routes marquées `shared` ne sont jamais préfixées : `/auth` (connexion,
 * session, inscription) et `/notifications`/`/workspace` qui sont servies
 * telles quelles par le backend pour tous les rôles.
 */

import type { Role } from "./auth-api";

export type Workspace = "superadmin" | "pilot" | "supervision" | "agent";

/**
 * Note sur les segments : `superadmin` (et non `super-admin`) est la valeur
 * exposée par le backend pour l'espace du super administrateur (voir
 * `backend/src/common/routing/role-route.ts`). `/super-admin` reste
 * accepté en lecture par le garde d'accès, mais aucun appel ne l'utilise.
 */

export const ROLE_WORKSPACE: Record<Role, Workspace> = {
  SUPER_ADMIN: "superadmin",
  ADMIN: "pilot",
  SUPERVISOR: "supervision",
  SWAPPER: "agent",
};

/** Segment d'URL d'un espace : identique à `ROLE_WORKSPACE` (voir note). */
export function workspaceSegment(workspace: Workspace): string {
  return workspace;
}

/**
 * Routes qui n'appartiennent à aucun espace :
 *   - `/auth/*` : commune à tous, c'est elle qui détermine le rôle ;
 *   - `/notifications/*` : chaque compte, quel que soit son rôle ;
 *   - `/workspace` : vue d'accueil déjà filtrée par le rôle côté serveur.
 */
const SHARED_PREFIXES = ["/auth", "/notifications", "/workspace"];

/**
 * Contrôleurs déjà rangés sous leur espace (chemin complet connu) : le préfixe
 * du rôle ne doit pas être ajouté une seconde fois.
 */
const ALREADY_SCOPED = ["/super-admin/", "/superadmin/"];

/**
 * Espaces de travail qui ont leur propre route racine côté API.
 *
 * `admin` n'en fait PAS partie : côté serveur, `/admin/...` est un préfixe
 * métier raisonné par `AdminController` (flat), pas un espace. Le laisser ici
 * empêcherait le préfixage du super administrateur (voir `scopedPath`).
 */
const KNOWN_SPACES = [
  "/superadmin/",
  "/super-admin/",
  "/pilot/",
  "/supervision/",
  "/agent/",
];

/**
 * Chemins servis par `AdminController` (contrôleur à plat). Ce sont les seuls
 * chemins `/admin/...` qui doivent suivre l'espace du rôle ; les autres
 * (`/admin/leaves/pending`, `/admin/reports/schedules`) restent des chemins
 * métier ordinaires.
 *
 * Source : `backend/src/admin/admin.controller.ts` (`@Get`/`@Post`/
 * `@Patch` marqués `admin/...`).
 */
export const ADMIN_CONTROLLER_PATHS = new Set([
  "/admin/settings",
  "/admin/audit",
  "/admin/integrations",
  "/admin/platform",
  "/admin/access/restore",
]);

export function hasWorkspacePrefix(path: string): boolean {
  return [...KNOWN_SPACES, ...ALREADY_SCOPED].some((prefix) =>
    path.startsWith(prefix),
  );
}

/**
 * Retire le préfixe d'espace d'un chemin déjà construit.
 *
 *   stripWorkspace("/pilot/users/42?id=1") -> "/users/42?id=1"
 *
 * Sert à la maquette locale (`api/mock`) : elle déclare les chemins métier et
 * reçoit des chemins préfixés. Les routes hors espace (`/auth`, `/notifications`)
 * sont rendues inchangées.
 */
export function stripWorkspace(path: string): string {
  for (const prefix of KNOWN_SPACES) {
    const segment = prefix.slice(0, -1);
    if (path === segment) return "/";
    if (path.startsWith(prefix)) return path.slice(segment.length) || "/";
  }
  return path;
}

/**
 * Chemin réellement envoyé à l'API.
 *
 * @param path   chemin métier (`/users?role=SWAPPER`)
 * @param role   rôle de la session en cours
 */
export function scopedPath(
  path: string,
  role: Role | null | undefined,
): string {
  if (!path.startsWith("/")) return path;
  if (hasWorkspacePrefix(path)) return path;
  if (
    SHARED_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    )
  ) {
    return path;
  }
  const workspace = role ? ROLE_WORKSPACE[role] : undefined;
  /*
   * Routes servies par `AdminController`, un contrôleur À PLAT : ses handlers
   * portent déjà `admin/settings`, `admin/audit`… et n'existent que sous
   * `/pilot/...` ou `/superadmin/...` (aucun `/agent/admin/...`). Le préfixe
   * doit donc suivre l'espace RÉEL du rôle, pas être ajouté à un chemin
   * d'administration générique.
   *
   * La liste est EXACTE à dessein : `/admin/leaves/pending` et
   * `/admin/reports/schedules` sont, eux, des chemins métier ordinaires servis
   * par `LeavesController` / `ReportsController`. Les englober produisait
   * `/superadmin/admin/reports/schedules` — un segment `admin` en trop, donc
   * 404.
   */
  if (ADMIN_CONTROLLER_PATHS.has(path) && workspace) {
    return `/${workspaceSegment(workspace)}${path}`;
  }
  // Aucune session (écran de connexion) : le chemin brut est conservé, c'est
  // le backend qui répond 401 — jamais un 404 trompeur.
  if (!workspace) return path;
  return `/${workspaceSegment(workspace)}${path}`;
}
