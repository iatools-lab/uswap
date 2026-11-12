import { Controller } from '@nestjs/common';
import { expect, describe, it } from 'vitest';
import { Role } from '../enums';
import {
  AgentRoute,
  CONTROLLER_SPACES_INDEX,
  ensurePathList,
  PilotRoute,
  ROLE_SPACE,
  SPACE_ALLOWED_ROLES,
  SpaceRouteDecorators,
  SuperAdminRoute,
  SupervisionRoute,
  normalizeSpace,
  spacePrefix,
} from './role-route';

/**
 * Lecture des préfixes réellement appliqués.
 *
 * `@nestjs/common/constants` du build chargé par Vitest n'expose pas la clé
 * utilisée par les décorateurs (deux résolutions du paquet : CJS/ESM) : la
 * vérification se fait donc sur les métadonnées visibles, avec la clé
 * historique `path` quand elle existe.
 */
function prefixesOf(target: object): string[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const constants = require('@nestjs/common/constants') as {
    PATH_METADATA?: string;
  };
  const keys = [
    constants.PATH_METADATA,
    'path',
    'PATH_METADATA',
  ].filter((key): key is string => typeof key === 'string');

  for (const key of keys) {
    const value = Reflect.getMetadata(key, target);
    if (value !== undefined) {
      const list = Array.isArray(value) ? value : [value];
      // Valeurs explicites uniquement (les tableaux viennent de nos tests).
      return list.filter((entry): entry is string => typeof entry === 'string');
    }
  }
  // Dernier recours : introspection des clés de métadonnées connues.
  const all = (Reflect as unknown as { getOwnMetadataKeys?: (o: object) => string[] })
    .getOwnMetadataKeys?.(target);
  for (const key of all ?? []) {
    if (!/path/i.test(key)) continue;
    const value = Reflect.getMetadata(key, target);
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.filter((e) => typeof e === 'string');
  }
  return [];
}

class LegacyUsers {}
PilotRoute('users', 'users')(LegacyUsers);

class ScopedSettings {}
PilotRoute('admin/settings')(ScopedSettings);

class Cleanup {}
SuperAdminRoute('cleanup', 'super-admin/cleanup')(Cleanup);

class AgentLeaves {}
AgentRoute('leaves')(AgentLeaves);

describe('routes métier par espace de travail', () => {
  it('associe chaque rôle à son espace', () => {
    expect(ROLE_SPACE).toEqual({
      SUPER_ADMIN: 'superadmin',
      ADMIN: 'pilot',
      SUPERVISOR: 'supervision',
      SWAPPER: 'agent',
    });
  });

  it('accepte les anciens préfixes et ignore `/auth`', () => {
    expect(normalizeSpace('admin')).toBe('pilot');
    expect(normalizeSpace('pilot')).toBe('pilot');
    expect(normalizeSpace('super-admin')).toBe('superadmin');
    expect(normalizeSpace('superadmin')).toBe('superadmin');
    expect(normalizeSpace('supervisor')).toBe('supervision');
    expect(normalizeSpace('swapper')).toBe('agent');
    expect(normalizeSpace('agent')).toBe('agent');
    expect(normalizeSpace('auth')).toBeNull();
  });

  it('les rôles sont ceux du code existant', () => {
    expect(Object.values(Role)).toEqual(
      expect.arrayContaining(['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'SWAPPER']),
    );
  });

  it('construit les préfixes attendus', () => {
    expect(spacePrefix('pilot', 'users')).toBe('pilot/users');
    expect(spacePrefix('superadmin', 'cleanup')).toBe('superadmin/cleanup');
    expect(spacePrefix('agent', '/leaves/')).toBe('agent/leaves');
  });

  it('un contrôleur migré expose son ancien chemin ET le nouveau', () => {
    expect(prefixesOf(LegacyUsers)).toEqual(['users', 'pilot/users']);
  });

  it("la liste des espaces survit à un `@Controller()` appliqué en dernier", () => {
    const fresh = class Published {};
    AgentRoute('users')(fresh);
    // `@Controller()` (sans argument) pose `/` et écrase la métadonnée.
    Controller()(fresh);
    expect(prefixesOf(fresh)).toEqual(['/']);
    expect(ensurePathList(fresh)).toEqual(['agent/users']);
    expect(prefixesOf(fresh)).toEqual(['agent/users']);
  });

  it('un contrôleur déjà préfixé reste sous son espace', () => {
    expect(prefixesOf(ScopedSettings)).toEqual(['pilot/admin/settings']);
    expect(prefixesOf(Cleanup)).toEqual(['super-admin/cleanup', 'superadmin/cleanup']);
    expect(prefixesOf(AgentLeaves)).toEqual(['agent/leaves']);
  });

  it('chaque contrôleur est classé dans ses espaces (garde d’accès)', () => {
    // Lecture seule de la table : un contrôleur absent répondrait 404.
    // L'annuaire complet n'est PAS ouvert à l'agent (seul `/agent/users/self`
    // est exposé) : il ne figure donc pas dans l'espace `agent`.
    expect(CONTROLLER_SPACES_INDEX.get('UsersController')).toEqual([
      'superadmin',
      'pilot',
      'supervision',
    ]);
    expect(CONTROLLER_SPACES_INDEX.get('DataCleanupController')).toEqual([
      'superadmin',
    ]);
    // Le super administrateur voit aussi les espaces de pilotage.
    expect(CONTROLLER_SPACES_INDEX.get('AdminController')).toEqual([
      'superadmin',
      'pilot',
    ]);

  });

  it('chaque espace n’autorise que les rôles annoncés', () => {
    expect(SPACE_ALLOWED_ROLES.agent).toContain(Role.SWAPPER);
    expect(SPACE_ALLOWED_ROLES.supervision).not.toContain(Role.SWAPPER);
    expect(SPACE_ALLOWED_ROLES.pilot).not.toContain(Role.SUPERVISOR);
    expect(SPACE_ALLOWED_ROLES.superadmin).toEqual([Role.SUPER_ADMIN]);
  });

  it('les quatre décorateurs d’espace existent', () => {
    expect(Object.keys(SpaceRouteDecorators).sort()).toEqual([
      'agent',
      'pilot',
      'superadmin',
      'supervision',
    ]);
  });
});
