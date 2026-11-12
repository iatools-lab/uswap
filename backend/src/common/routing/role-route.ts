import { ExecutionContext, SetMetadata } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Role } from '../enums';

/**
 * Routes métier par espace de travail.
 *
 *   SUPER_ADMIN  -> /superadmin/<route>
 *   ADMIN        -> /pilot/<route>
 *   SUPERVISOR   -> /supervision/<route>
 *   SWAPPER      -> /agent/<route>
 *
 * Les anciens chemins (`/admin/...`, `/supervisor/...`) restent exposés
 * pendant la transition : les clients internes sont adaptés en même temps que
 * ces routes sont ajoutées, et un ancien chemin ne doit jamais répondre 404.
 *
 * Deux règles de conception :
 *
 * 1. Le préfixe est ajouté au niveau du CONTRÔLEUR, pas de chaque méthode :
 *    `@Controller('pilot/users')` réutilise la même classe qu'un contrôleur
 *    historique, et Nest peut la déclarer plusieurs fois, une fois par
 *    préfixe. Aucune méthode n'est réécrite (voir `PilotRoute`, `AgentRoute`,
 *    `SupervisionRoute`).
 *
 * 2. Le préfixe n'est pas décoratif : `RoleRouteAccessGuard` refuse une
 *    requête authentifiée dont le rôle ne correspond pas à l'espace de
 *    travail appelé (un agent sur `/pilot/users` reçoit 403).
 */

export type RouteSpace = 'superadmin' | 'pilot' | 'supervision' | 'agent';

const SPACE_ALIASES: Record<string, RouteSpace> = {
  'super-admin': 'superadmin',
  superadmin: 'superadmin',
  admin: 'pilot',
  pilot: 'pilot',
  supervisor: 'supervision',
  supervision: 'supervision',
  swapper: 'agent',
  agent: 'agent',
};

/** Préfixe canonique de l'espace de travail d'un rôle. */
export const ROLE_SPACE: Record<Role, RouteSpace> = {
  SUPER_ADMIN: 'superadmin',
  ADMIN: 'pilot',
  SUPERVISOR: 'supervision',
  SWAPPER: 'agent',
};

/** Rôles autorisés dans chaque espace de travail. */
export const SPACE_ALLOWED_ROLES: Record<RouteSpace, Role[]> = {
  superadmin: [Role.SUPER_ADMIN],
  pilot: [Role.SUPER_ADMIN, Role.ADMIN],
  supervision: [Role.SUPER_ADMIN, Role.ADMIN, Role.SUPERVISOR],
  agent: [Role.SUPER_ADMIN, Role.ADMIN, Role.SUPERVISOR, Role.SWAPPER],
};

/**
 * Contrôleurs déclarés dans chaque espace.
 *
 * Sert au garde `RoleRouteAccessGuard` : un contrôleur absent de la liste de
 * l'espace appelé répond 404, même si son URL est techniquement enregistrée
 * (ex. `/agent/users` si le contrôleur users n'était pas déclaré là). Les
 * noms sont ceux des classes Nest ; oublier d'en inscrire un nouveau rend
 * seulement son URL inaccessible, jamais une faille.
 */
export const CONTROLLER_SPACES: Record<RouteSpace, string[]> = {
  // Super administrateur : son espace propre, PLUS les espaces de pilotage,
  // de supervision et d'agent ” c'est le sens de `SPACE_ALLOWED_ROLES`.
  superadmin: [
    'AttendanceController',
    'AdminController',
    'DashboardController',
    'DataCleanupController',
    'IncidentsController',
    'LeavesController',
    'OperationsController',
    'PlanningsController',
    'ReportsController',
    'ShiftTemplatesController',
    'StationsController',
    'UsersController',
  ],
  pilot: [
    'AdminController',
    'DashboardController',
    'LeavesController',
    // Absences / remplacements : `/pilot/operations/...` est enregistré (voir
    // `OperationsController`) ; l'omettre ici rendait ces routes 404 alors
    // qu'elles sont bien déclarées pour le pilotage.
    'OperationsController',
    'PlanningsController',
    'ReportsController',
    'ShiftTemplatesController',
    'StationsController',
    'UsersController',
  ],
  supervision: [
    'AttendanceController',
    'DashboardController',
    'IncidentsController',
    'LeavesController',
    'OperationsController',
    'PlanningsController',
    'ReportsController',
    'ShiftTemplatesController',
    'StationsController',
    'UsersController',
  ],
  agent: [
    'AttendanceController',
    'DashboardController',
    'IncidentsController',
    'LeavesController',
    'OperationsController',
    'PlanningsController',
  ],
};

/** Nom de contrôleur -> espaces où il est déclaré (index construit une fois). */
export const CONTROLLER_SPACES_INDEX: Map<string, RouteSpace[]> = (() => {
  const index = new Map<string, RouteSpace[]>();
  for (const [space, names] of Object.entries(CONTROLLER_SPACES) as [
    RouteSpace,
    string[],
  ][]) {
    for (const name of names) {
      const list = index.get(name) ?? [];
      list.push(space);
      index.set(name, list);
    }
  }
  return index;
})();

/** Normalise un préfixe reçu (URL) en espace de travail. */
export function normalizeSpace(raw: string): RouteSpace | null {
  return SPACE_ALIASES[raw.trim().toLowerCase()] ?? null;
}

/**
 * Segment d'URL d'un espace.
 *
 * `superadmin` (sans tiret) est la forme canonique, identique à côté frontend
 * (`api/role-routes.ts`). `/super-admin` reste accepté en LECTURE par le garde
 * d'accès (alias historique) mais aucune route n'est plus enregistrée dessus ”
 * sauf le contrôleur de nettoyage, dont le chemin historique est conservé.
 */
export function spaceSegment(space: RouteSpace): string {
  return space;
}

/** Concatène deux segments d'URL en ignorant les slashs superflus. */
function join(prefix: string, base: string): string {
  return [prefix, base]
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

/** `/pilot/users`, `/agent/users`… */
export function spacePrefix(space: RouteSpace, base: string): string {
  return join(spaceSegment(space), base);
}

/**
 * Préfixe d'espace d'un contrôleur, pour un chemin de méthode donné.
 *
 * Deux familles coexistent dans le projet :
 *  - contrôleur préfixé (`@Controller('users')` + `@Get('page')`) : la méthode
 *    ne porte qu'un segment, il faut donc ajouter le nom métier ;
 *  - contrôleur À PLAT (`@Controller()` + `@Get('admin/settings')`) : la méthode
 *    porte déjà le chemin complet, l'ajouter le doublerait
 *    (`/superadmin/reports/reports/dashboard`).
 *
 * Le premier segment de la méthode départage : s'il est déjà le préfixe
 * métier, le chemin est complet.
 */
export function scopedBaseFor(base: string, methodPath: string): string {
  if (!base) return '';
  const head = methodPath.replace(/^\/+/, '').split('/')[0] ?? '';
  return head === base ? '' : base;
}

/*
 * Faits NestJS qui dictent la forme de ce fichier.
 *
 *  - `RouterExplorer.extractRouterPath` lit `Reflect.getMetadata(PATH_METADATA,
 *    metatype)` : une métadonnée HÉRITÉE compte, et un TABLEAU y est accepté
 *    (une route par préfixe).
 *  - `@Controller(...)` fait `Reflect.defineMetadata(PATH_METADATA, path,
 *    target)`, et décore la CLASSE : sa cible est le constructeur.
 *  - Nos décorateurs de classe sont appelés avec le PROTOTYPE (cible d'un
 *    décorateur de classe). Écrire `PATH_METADATA` sur le prototype ne sert à
 *    rien : `getMetadata` cherche sur le constructeur, puis sur
 *    `Function.prototype` — et TypeScript applique `@Controller` en DERNIER,
 *    si bien que la métadonnée propre du constructeur finissait par être la
 *    seule chaîne du nom métier (`users`). D'où des routes d'espace jamais
 *    déclarées. La liste canonique est donc posée sur le CONSTRUCTEUR.
 */

/**
 * Constructeur d'un contrôleur à partir de la cible d'un décorateur.
 *
 * Un décorateur de CLASSE reçoit le prototype (`target`), pas la classe : ses
 * `constructor` est alors la classe. Mais `@Controller(...)` est implémenté
 * comme un décorateur de CLASSE appelé manuellement, `Controller(path)(target)`,
 * et il traite `target` comme la classe elle-même. Son résultat est donc posé
 * sur un constructeur factice dont le `prototype` EST notre constructeur :
 * c'est `target.constructor.prototype` qu'il faut écrire dans ce cas.
 */
const constructorOf = (target: object): object => {
  if (typeof target === 'function') return target;
  const ctor: unknown = (target as { constructor?: unknown }).constructor;
  if (typeof ctor !== 'function') return target;
  const parent: unknown = (ctor as { prototype?: unknown }).prototype;
  return typeof parent === 'function' ||
    (typeof parent === 'object' && parent !== null)
    ? (parent)
    : ctor;
};

/**
 * Ajoute un préfixe d'espace et écrit la liste canonique sur le constructeur.
 *
 * La liste commence par l'ancien chemin (compatibilité) et se termine par les
 * espaces ; `ensurePathList` est appelé par cette fonction, si bien que la
 * dernière application (celle de `@Controller`) est toujours annulée.
 */
function defineScopes(target: object, extra: string[]): void {
  const known = readScopedList(target);
  /*
   * Chaque appel est indépendant : il relit la décision des appels PRÉCÉDENTS
   * (aucun ne fournit `base`) puis ajoute le(s) chemin(s) demandé(s). `extra`
   * vaut donc soit `[scoped]`, soit `[scopedA, scopedB]`. Le premier élément
   * n'a rien d'un préfixe de base : il ne doit jamais être écarté, sous peine
   * de perdre `/pilot/users` (les espaces sont réappliqués à l'envers).
   */
  const merged = [...known];
  for (const value of extra) {
    if (value && !merged.includes(value)) merged.push(value);
  }
  Reflect.defineMetadata(SCOPED_KEY, merged, target);
  const ordered = orderedLegacyFirst(merged);
  const ctor = constructorOf(target);
  Reflect.defineMetadata(SCOPED_KEY, ordered, ctor);
  Reflect.defineMetadata(PATH_METADATA, ordered, ctor);
}

/** Décorateur d'un seul préfixe d'espace (sans ancien chemin). */
function scopedController(scoped: string): ClassDecorator {
  return (target) => defineScopes(target, [scoped]);
}

/**
 * Décorateur de contrôleur pour un espace de travail.
 *
 *   @PilotRoute('users')            -> /pilot/users
 *   @PilotRoute('users', 'users')   -> /users ET /pilot/users (compatibilité)
 *
 * Quand `legacyBase` est fourni, le chemin historique est déclaré en premier.
 */
export function spaceController(
  space: RouteSpace,
  base: string,
  legacyBase?: string,
): ClassDecorator {
  const scoped = spacePrefix(space, base);
  const legacy = (legacyBase ?? '').replace(/^\/+|\/+$/g, '');
  if (!legacy || legacy === scoped) return scopedController(scoped);
  // `@Controller` étant appliqué en DERNIER, `legacy` doit être réécrit lui
  // aussi : c'est lui que Nest verrait sinon.
  return (target) => defineScopes(target, [legacy, scoped]);
}

/**
 * Place les anciens chemins (`users`, `super-admin/cleanup`) en tête, puis les
 * espaces dans l'ordre du rôle le plus large au plus étroit. Le tri ne trie
 * jamais la liste d'origine (mutation interdite : elle est partagée).
 */
export const SPACE_ORDER = [
  'superadmin',
  'pilot',
  'supervision',
  'agent',
] as const;
function orderedLegacyFirst(paths: string[]): string[] {
  const rank = (path: string) => {
    // Le chemin historique peut être le nom métier NU (`users`) : il doit
    // passer en tête comme les autres anciens chemins, sinon il se range
    // derrière les espaces et l'ordre de déclaration n'est plus celui qui est
    // documenté (et testé).
    const space = SPACE_ORDER.findIndex(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
    return space === -1 ? -1 : space;
  };
  return [...paths].sort((a, b) => rank(a) - rank(b));
}

const SCOPED_KEY = 'uswap:route-scopes';

/**
 * Préfixes déclarés sur une classe (chaîne ou tableau).
 *
 * `getOwnMetadata` uniquement : sur le constructeur, `getMetadata` remonte à
 * `Function.prototype`, qui porte elle-même un préfixe (`/`) hérité de Node ”
 * d'où une liste polluée et des routes parasites.
 *
 * La valeur `/` est écartée : c'est celle que pose `@Controller()` sans
 * argument (contrôleur à plat), pas un préfixe métier.
 */
export function readPathMetadata(target: object): string[] {
  const value = Reflect.getOwnMetadata(PATH_METADATA, target);
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((v): v is string => typeof v === 'string' && v !== '/');
}

/**
 * Espaces déjà ajoutés par nos décorateurs.
 *
 * Ils sont conservés sous une clé PROPRE, que `@Controller` ne touche jamais :
 * il réécrit `PATH_METADATA` en dernier, et une liste posée dans cette clé
 * serait remplacée par la simple chaîne du nom métier.
 */
export function readScopedList(target: object): string[] {
  const value = Reflect.getOwnMetadata(SCOPED_KEY, target);
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
}

/**
 * Préfixes RÉELLEMENT enregistrés par Nest pour un contrôleur.
 *
 * `@Controller` a pu être appliqué après nos décorateurs et remplacer la
 * métadonnée par `/` : la liste des espaces, conservée sous `SCOPED_KEY`, est
 * alors réappliquée. À appeler depuis la classe concrète (Nest la crée en
 * dernier) ou depuis les tests qui simulent ce dernier passage.
 */
export function ensurePathList(target: object): string[] {
  const scoped = readScopedList(target);
  if (scoped.length > 0) {
    const ordered = orderedLegacyFirst(scoped);
    // Constructeur ET prototype : `getMetadata` (hérité) est ce que lit Nest.
    const ctor = constructorOf(target);
    Reflect.defineMetadata(SCOPED_KEY, ordered, target);
    Reflect.defineMetadata(SCOPED_KEY, ordered, ctor);
    Reflect.defineMetadata(PATH_METADATA, ordered, ctor);
    return ordered;
  }
  return readPathMetadata(target);
}

/** `/pilot/...` ” administrateur (et super administrateur). */
export const PilotRoute = (base: string, legacyBase?: string) =>
  spaceController('pilot', base, legacyBase);

/** `/supervision/...` ” superviseur, administrateur, super administrateur. */
export const SupervisionRoute = (base: string, legacyBase?: string) =>
  spaceController('supervision', base, legacyBase);

/** `/agent/...` ” agent (et rôles de pilotage). */
export const AgentRoute = (base: string, legacyBase?: string) =>
  spaceController('agent', base, legacyBase);

/** `/superadmin/...` ” super administrateur. */
export const SuperAdminRoute = (base: string, legacyBase?: string) =>
  spaceController('superadmin', base, legacyBase);

/** Table des décorateurs, pour les tests et la génération de routes. */
export const SpaceRouteDecorators = {
  superadmin: SuperAdminRoute,
  pilot: PilotRoute,
  supervision: SupervisionRoute,
  agent: AgentRoute,
} as const;

/* -------------------------------------------------------------------------- */
/* Contrôle d'accès aux routes préfixées par espace de travail                */
/* -------------------------------------------------------------------------- */

export const ROLE_ROUTE_KEY = 'uswap:role-route';

/**
 * Marque une route pour `RoleRouteAccessGuard` :
 *   - `PUBLIC`  : route ouverte (connexion, inscription initiale) ;
 *   - `DORMANT` : route prévue mais non implémentée -> 404 côté client.
 */
export const RoleRoute = (state: 'PUBLIC' | 'DORMANT') =>
  SetMetadata(ROLE_ROUTE_KEY, state);

export interface RoleRouteState {
  space: RouteSpace | null;
  state: 'PUBLIC' | 'DORMANT' | null;
}

/** Espace de travail et état d'une requête, lus sur l'URL et le handler. */
export function readRoleRoute(
  reflector: Reflector,
  context: ExecutionContext,
): RoleRouteState {
  const state =
    reflector.getAllAndOverride<'PUBLIC' | 'DORMANT'>(ROLE_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? null;
  const request = context.switchToHttp().getRequest<Request>();
  const segment = (request.path ?? '').replace(/^\/+/, '').split('/')[0] ?? '';
  return { space: normalizeSpace(segment), state };
}
