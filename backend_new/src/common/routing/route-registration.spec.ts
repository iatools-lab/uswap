import { Controller, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AgentRoute,
  CONTROLLER_SPACES,
  PilotRoute,
  SupervisionRoute,
  ensurePathList,
} from './role-route';

/**
 * Vérifie ce que Nest enregistre réellement (préfixe + méthodes), sans
 * démarrer d'application : instance, réflexion de métadonnées.
 *
 * Les décorateurs de méthode sont ceux de Nest ; seule la lecture est faite
 * ici, pour garantir qu'un contrôleur migré expose bien :
 *   - son ancien chemin (compatibilité),
 *   - son espace de travail (`/pilot/users`…),
 *   - ses méthodes HTTP existantes (aucune perte).
 */
class UsersProbe {
  list() {
    return [];
  }

  page() {
    return {};
  }
}
Get2(UsersProbe.prototype, 'list');
GetPath('page')(
  UsersProbe.prototype,
  'page',
  Object.getOwnPropertyDescriptor(UsersProbe.prototype, 'page')!,
);

function Get2(proto: object, key: string): void {
  Reflect.defineMetadata(
    METHOD_METADATA,
    RequestMethod.GET,
    proto[key as never],
  );
}

function GetPath(path: string) {
  return (_target: object, key: string, _descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(
      PATH_METADATA,
      path,
      (UsersProbe.prototype as never)[key as never],
    );
  };
}

// Ordre EXACT de `users.controller.ts`, qui est l'usage réel du projet :
//   @Controller()
//   @PilotRoute('users', 'users')
//   @SupervisionRoute('users')
//   @AgentRoute('users')
// TypeScript applique de bas en haut : Agent, Supervision, Pilot, Controller.
// `Controller()` est donc appliqué en DERNIER et pose `/` par-dessus la liste
// des espaces. L'enregistrement réel (Nest déclare la classe) la restaure via
// `ensurePathList` : c'est ce que vérifie ce test.
AgentRoute('users')(UsersProbe);
SupervisionRoute('users')(UsersProbe);
PilotRoute('users', 'users')(UsersProbe);
Controller()(UsersProbe);

/** Préfixes tels que les lit Nest (constructeur, métadonnée propre). */
const pathsOf = () => ensurePathList(UsersProbe);

describe("enregistrement des routes d'un contrôleur migré", () => {
  it('conserve les anciens chemins', () => {
    expect(pathsOf()).toContain('users');
  });

  it('ajoute un chemin par espace de travail', () => {
    expect(pathsOf()).toContain('pilot/users');
    expect(pathsOf()).toContain('supervision/users');
    expect(pathsOf()).toContain('agent/users');
  });

  it('ne déclare jamais deux fois le même préfixe', () => {
    const paths = pathsOf() as string[];
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('chaque chemin reste un segment valide (pas de slash initial ni final)', () => {
    for (const path of pathsOf() as string[]) {
      expect(path).not.toMatch(/^\/|\/$/);
    }
  });

  it('ne touche pas aux méthodes HTTP des handlers', () => {
    expect(
      Reflect.getMetadata(METHOD_METADATA, UsersProbe.prototype.list),
    ).toBe(RequestMethod.GET);
  });
});

/* -------------------------------------------------------------------------- */
/* Contrôleurs RÉELS du projet                                               */
/* -------------------------------------------------------------------------- */

/**
 * Lecture des contrôleurs réellement déclarés dans `src`, sans démarrer Nest.
 *
 * Chaque classe est chargée et ses préfixes sont relus par `ensurePathList`
 * (ce que Nest fait au moment d'enregistrer le contrôleur). Ces tests
 * garantissent qu'aucune route métier n'a été perdue ni rangée dans le
 * mauvais espace lors de la migration.
 */
type LoadedController = {
  name: string;
  paths: string[];
  handlers: { method: RequestMethod | undefined; path: string }[];
};

async function loadControllers(): Promise<LoadedController[]> {
  const modules = await Promise.all([
    import('../../admin/admin.controller'),
    import('../../attendance/attendance.controller'),
    import('../../dashboard/dashboard.module'),
    import('../../incidents/incidents.controller'),
    import('../../leaves/leaves.controller'),
    import('../../maintenance/data-cleanup.controller'),
    import('../../operations/operations.controller'),
    import('../../planning/plannings.controller'),
    import('../../reports/reports.controller'),
    import('../../stations/shift-templates.controller'),
    import('../../stations/stations.controller'),
    import('../../users/users.controller'),
  ]);

  const result: LoadedController[] = [];
  for (const module of modules) {
    for (const exported of Object.values(module as Record<string, unknown>)) {
      if (typeof exported !== 'function') continue;
      const prototype = (exported as { prototype?: object }).prototype;
      // Module qui n'est pas un contrôleur (service, module Nest…) : il n'a
      // ni `@Controller`, ni décorateurs de méthode.
      if (!prototype) continue;
      const paths = ensurePathList(exported as object);
      if (paths.length === 0) continue;
      const handlers = Object.getOwnPropertyNames(prototype)
        .filter((key) => key !== 'constructor')
        .map((key) => {
          const handler = (prototype as Record<string, unknown>)[key];
          return {
            method: Reflect.getMetadata(METHOD_METADATA, handler as object) as
              RequestMethod | undefined,
            path: String(Reflect.getMetadata(PATH_METADATA, handler as object)),
          };
        })
        .filter((handler) => handler.method !== undefined);
      result.push({
        name: (exported as { name: string }).name,
        paths,
        handlers,
      });
    }
  }
  return result;
}

let CONTROLLERS: LoadedController[] = [];
const find = (name: string) => CONTROLLERS.find((item) => item.name === name);

describe('contrôleurs réels du projet', () => {
  beforeAll(async () => {
    CONTROLLERS = await loadControllers();
  });

  it('charge bien les contrôleurs attendus', () => {
    expect(CONTROLLERS.map((item) => item.name).sort()).toEqual([
      'AdminController',
      'AttendanceController',
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
    ]);
  });

  it('chaque contrôleur conserve son ancien chemin ET son espace', () => {
    // Le contrôleur DÉCLARE `/agent/users` pour `/agent/users/self`, mais la
    // TABLE DU GARDE l'exclut de l'espace agent : l'annuaire complet n'est pas
    // une donnée d'agent. Un agent obtient donc un 404 neutre sur
    // `/agent/users` et garde accès à son propre profil.
    expect(find('UsersController')?.paths).toEqual([
      'users',
      'superadmin/users',
      'pilot/users',
      'supervision/users',
    ]);
    // Contrôleur à plat : ses méthodes portent déjà `/admin/...`, seul
    // l'espace est ajouté (le préfixe historique resterait `/pilot/pilot/...`).
    //   /pilot/admin/settings       administrateur
    //   /superadmin/admin/settings  super administrateur (ajouté le 2026-10-31)
    expect(find('AdminController')?.paths).toEqual([
      'superadmin/admin',
      'pilot/admin',
    ]);
    expect(find('DataCleanupController')?.paths).toEqual([
      'super-admin/cleanup',
      'superadmin/cleanup',
    ]);
    // `stations` porte aussi un décorateur `SuperAdminRoute` : l'espace
    // `/superadmin/stations` est déclaré (voir `CONTROLLER_SPACES.superadmin`).
    expect(find('StationsController')?.paths).toEqual([
      'stations',
      'superadmin/stations',
      'pilot/stations',
      'supervision/stations',
    ]);
    expect(find('AttendanceController')?.paths).toEqual([
      'attendance',
      'superadmin/attendance',
      'supervision/attendance',
      'agent/attendance',
    ]);
  });

  it('aucune route métier n’est restée hors des espaces', () => {
    for (const controller of CONTROLLERS) {
      const scoped = controller.paths.filter((path) =>
        /^(pilot|supervision|agent|superadmin)\//.test(path),
      );
      expect({ name: controller.name, scoped: scoped.length }).not.toEqual({
        name: controller.name,
        scoped: 0,
      });
    }
  });

  it('les contrôleurs contiennent encore leurs routes d’origine', () => {
    // Pointage et cartographie : les routes critiques sont présentes.
    const attendance = find('AttendanceController')?.handlers ?? [];
    // `workspace` déclare DEUX chemins (`workspace` et `attendance/workspace`) :
    // la métadonnée PATH_METADATA est alors un tableau, que le chargeur
    // convertit en chaîne séparée par des virgules.
    expect(
      attendance.some((handler) => handler.path.includes('workspace')),
    ).toBe(true);
    // Comparaison par INCLUSION, pas d'égalité : une route qui déclare
    // plusieurs chemins (`@Get(['history', 'attendance/history'])`) produit une
    // chaîne qui les contient tous, séparés par des virgules.
    for (const method of [
      'shifts',
      'attendance',
      'attendance/monitor',
      'attendance/history',
      'corrections/shifts/:shiftId',
      'shifts/validate',
    ]) {
      expect(attendance.some((handler) => handler.path.includes(method))).toBe(
        true,
      );
    }
    const stations = find('StationsController')?.handlers ?? [];
    expect(
      stations.some((handler) => handler.method === RequestMethod.GET),
    ).toBe(true);
  });

  /**
   * Chaque chemin métier appelé par le frontend est préfixé par l'espace du
   * rôle connecté (`frontend_new/frontend/src/api/role-routes.ts`) :
   *   /users/...          -> /superadmin/users/...   pour un SUPER_ADMIN
   *   /reports/dashboard  -> /superadmin/reports/dashboard
   *
   * Un contrôleur déclaré dans `CONTROLLER_SPACES.superadmin` mais SANS
   * `@SuperAdminRoute` répondait 404 à son propre super administrateur.
   * Régression constatée le 2026-10-31 sur le tableau de bord :
   * `/superadmin/users/page` et `/superadmin/reports/dashboard` -> 404.
   */
  it('les contrôleurs déclarés dans l’espace superadmin y exposent une route', () => {
    const missing: string[] = [];
    for (const name of CONTROLLER_SPACES.superadmin) {
      const paths = find(name)?.paths ?? [];
      const declared = paths.some((path) => path.startsWith('superadmin/'));
      // `AdminController` et `DataCleanupController` sont à plat : leur route
      // est réenregistrée par `registerFlatSuperAdminRoutes` dans main.ts.
      const flat =
        name === 'AdminController' || name === 'DataCleanupController';
      if (!declared && !flat) missing.push(name);
    }
    expect(missing).toEqual([]);
  });

  it('le suivi des congés existe sous deux formes dans chaque espace', () => {
    const paths = find('LeavesController')?.handlers.map((h) => h.path) ?? [];
    // `@Get([...])` donne un tableau : on compare les valeurs à plat.
    const flat = paths.join('|');
    expect(flat).toContain('leaves/management');
    expect(flat).toContain('management');
  });

  it('les contrôleurs de chaque espace sont inscrits dans la table du garde', () => {
    for (const [space, names] of Object.entries(CONTROLLER_SPACES) as [
      keyof typeof CONTROLLER_SPACES,
      string[],
    ][]) {
      void space;
      for (const name of names) {
        expect(CONTROLLERS.some((item) => item.name === name)).toBe(true);
      }
      // Réciproque : tout contrôleur DÉCLARÉ dans un espace doit y figurer.
      // Sans elle, une route peut être enregistrée (`/agent/reports/...`) tout
      // en répondant 404 par le garde — ou l'inverse — sans qu'aucun test ne
      // le signale.
      //
      // Excepté `UsersController` : ses routes agent (`/agent/users/self`) sont
      // INSCRIPTES mais le garde les refuse (l'annuaire n'est pas une donnée
      // d'agent). Ce cas est vérifié explicitement ci-dessous.
      for (const controller of CONTROLLERS) {
        if (controller.name === 'UsersController') continue;
        const declared = controller.paths.some(
          (path) => path === space || path.startsWith(`${space}/`),
        );
        expect({ name: controller.name, registered: names.includes(controller.name) }).toEqual({
          name: controller.name,
          registered: declared,
        });
      }
      if (space === 'agent') {
        expect(names.includes('UsersController')).toBe(false);
      }
    }
  });
});
