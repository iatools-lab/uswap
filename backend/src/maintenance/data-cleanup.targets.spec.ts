import { describe, expect, it } from 'vitest';
import {
  CLEANUP_TARGETS,
  PURGE_ORDER,
  type CleanupTarget,
} from './data-cleanup.targets';

/**
 * Verrouille les règles du nettoyage super administrateur.
 *
 * Régression corrigée : l'écran de maintenance ne proposait que des données de
 * recette. Un superviseur qui quittait uPowa, une station fermée, un swappeur
 * parti ne pouvaient PAS être supprimés — alors même que l'application tourne
 * en production. Ces tests empêchent la réapparition de cette limitation.
 */

const target = (id: CleanupTarget) => {
  const found = CLEANUP_TARGETS.find((item) => item.id === id);
  if (!found) throw new Error(`Cible ${id} absente du catalogue.`);
  return found;
};

describe('catalogue de nettoyage', () => {
  it('propose la suppression réelle des comptes et des stations', () => {
    expect(CLEANUP_TARGETS.map((item) => item.id)).toEqual(
      expect.arrayContaining(['ACCOUNTS', 'STATIONS']),
    );
  });

  it('marque comptes et stations comme cibles sensibles (données de production)', () => {
    expect(target('ACCOUNTS').sensitive).toBe(true);
    expect(target('STATIONS').sensitive).toBe(true);
    // Les données de recette ne doivent pas exiger la double confirmation.
    expect(target('PLANNINGS').sensitive).toBeFalsy();
  });

  it('chaque cible destructive s’annonce comme irréversible', () => {
    for (const item of CLEANUP_TARGETS) {
      if (item.id === 'DEMO_ACCOUNTS') continue;
      expect({ id: item.id, destructive: item.destructive }).toEqual({
        id: item.id,
        destructive: true,
      });
    }
  });

  it('l’ordre de purge couvre toutes les cibles destructives', () => {
    const destructive = CLEANUP_TARGETS.filter(
      (item) => item.destructive,
    ).map((item) => item.id);
    for (const id of destructive) {
      expect(PURGE_ORDER).toContain(id);
    }
  });

  it('le journal d’audit est purgé en dernier', () => {
    expect(PURGE_ORDER[PURGE_ORDER.length - 1]).toBe('AUDIT');
  });

  it('les comptes sont purgés avant les stations', () => {
    expect(PURGE_ORDER.indexOf('ACCOUNTS')).toBeLessThan(
      PURGE_ORDER.indexOf('STATIONS'),
    );
    // … et APRÈS les objets qui les référencent (aucune clé étrangère orpheline).
    for (const id of ['PLANNINGS', 'ATTENDANCE', 'LEAVES', 'INCIDENTS'] as CleanupTarget[]) {
      expect(PURGE_ORDER.indexOf(id)).toBeLessThan(
        PURGE_ORDER.indexOf('ACCOUNTS'),
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Comportement de purge, sur un client Prisma simulé                          */
/* -------------------------------------------------------------------------- */

type Call = { model: string; action: string; args: unknown };

/** Client Prisma factice : enregistre les appels, renvoie des volumes fixes. */
function fakePrisma() {
  const calls: Call[] = [];
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, model) {
      return new Proxy(
        {},
        {
          get(_ignored, action) {
            return async (args?: unknown) => {
              calls.push({ model: String(model), action: String(action), args });
              if (String(action) === 'count') return 3;
              if (String(action) === 'findMany') {
                return [{ id: 'user-1' }, { id: 'user-2' }];
              }
              return { count: 2 };
            };
          },
        },
      );
    },
  };
  return { prisma: new Proxy({}, handler) as never, calls };
}

describe('purge des comptes', () => {
  it('ne supprime jamais le compte de l’exécutant', async () => {
    const { prisma, calls } = fakePrisma();
    await target('ACCOUNTS').purge(prisma, ['actor-id']);

    const deletions = calls.filter(
      (call) => call.model === 'user' && call.action === 'deleteMany',
    );
    expect(deletions).toHaveLength(1);
    const where = JSON.stringify((deletions[0].args as { where: unknown }).where);
    expect(where).toContain('actor-id');
    // La clause doit être une EXCLUSION (`notIn`), jamais une suppression.
    expect(where).toContain('notIn');
  });

  it('supprime l’historique avant les comptes (clés étrangères sans cascade)', async () => {
    const { prisma, calls } = fakePrisma();
    await target('ACCOUNTS').purge(prisma, ['actor-id']);

    const firstUserDeletion = calls.findIndex(
      (call) => call.model === 'user' && call.action === 'deleteMany',
    );
    expect(firstUserDeletion).toBeGreaterThan(-1);

    for (const model of [
      'occurrenceAssignment',
      'incidentAction',
      'leave',
      'attendance',
      'auditLog',
      'importBatch',
    ]) {
      const index = calls.findIndex((call) => call.model === model);
      expect({ model, beforeUser: index >= 0 && index < firstUserDeletion }).toEqual({
        model,
        beforeUser: true,
      });
    }
  });

  it('détache les références facultatives au lieu de bloquer la suppression', async () => {
    const { prisma, calls } = fakePrisma();
    await target('ACCOUNTS').purge(prisma, ['actor-id']);
    // `occurrence.swapperId` / `supervisorId`, `planning.createdById`… sont des
    // relations `SetNull` : on les met à `null` explicitement.
    const nulling = calls.filter(
      (call) => call.action === 'updateMany' && call.model !== 'user',
    );
    expect(nulling.length).toBeGreaterThanOrEqual(4);
  });
});

describe('purge des stations', () => {
  it('supprime le réseau, ses modèles et ses plannings', async () => {
    const { prisma, calls } = fakePrisma();
    await target('STATIONS').purge(prisma, []);

    const models = calls.map((call) => call.model);
    for (const model of [
      'planning',
      'occurrence',
      'incident',
      'scheduledReport',
      'shiftTemplate',
      'station',
    ]) {
      expect(models).toContain(model);
    }
  });

  it('détache les utilisateurs de la station supprimée', async () => {
    const { prisma, calls } = fakePrisma();
    await target('STATIONS').purge(prisma, []);
    const detach = calls.find(
      (call) => call.model === 'user' && call.action === 'updateMany',
    );
    expect(detach).toBeDefined();
    expect(JSON.stringify((detach?.args as { data: unknown }).data)).toContain(
      '"stationId":null',
    );
  });
});
