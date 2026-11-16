import { describe, expect, it, vi } from 'vitest';
import { DataCleanupService } from './data-cleanup.service';
import type { AuthenticatedUser } from '../common/guards/roles.guard';

/**
 * Garde-fous du nettoyage.
 *
 * Régression corrigée : la suppression de comptes / stations en production
 * exige une confirmation supplémentaire. Ces tests verrouillent le fait qu'un
 * simple « EFFACER » — saisi pour vider une recette — ne peut PAS effacer le
 * réseau réel, et qu'un rôle non super administrateur ne peut rien supprimer.
 */

const superAdmin: AuthenticatedUser = {
  id: 'actor-id',
  email: 'superadmin@upowa.org',
  fullName: 'Super Admin',
  role: 'SUPER_ADMIN',
  stationId: null,
  sessionId: 'sid',
} as AuthenticatedUser;

function buildService(overrides: { purge?: () => Promise<number> } = {}) {
  const tx = new Proxy(
    {},
    {
      get() {
        return new Proxy(
          {},
          {
            get(_ignored, action) {
              if (action === 'findMany') return async () => [];
              return async () => ({ count: overrides.purge ? 1 : 0 });
            },
          },
        );
      },
    },
  ) as never;

  const prisma = {
    $transaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) =>
      fn(tx),
    ),
    user: {
      count: async () => 9,
      findMany: vi.fn(async () => []),
    },
    planning: { count: async () => 4 },
    attendance: { count: async () => 2 },
    absence: { count: async () => 0 },
    automatedAbsence: { count: async () => 0 },
    leave: { count: async () => 1 },
    leaveBalance: { count: async () => 1 },
    incident: { count: async () => 1 },
    notification: { count: async () => 0 },
    emailLog: { count: async () => 0 },
    auditLog: { count: async () => 12 },
    station: { count: async () => 6 },
    demoAccounts: { count: async () => 2 },
  } as never;

  const audit = { record: vi.fn(async () => undefined) } as never;
  const notifications = {
    notify: vi.fn(async () => undefined),
    sendMail: vi.fn(async () => undefined),
  } as never;

  return new DataCleanupService(prisma, audit, notifications);
}

describe('nettoyage — contrôle d’accès', () => {
  it('refuse tout rôle autre que super administrateur', async () => {
    const service = buildService();
    for (const role of ['ADMIN', 'SUPERVISOR', 'SWAPPER'] as const) {
      await expect(
        service.run({ ...superAdmin, role } as AuthenticatedUser, {
          targets: ['PLANNINGS'],
        }),
      ).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    }
  });
});

describe('nettoyage — confirmations', () => {
  it('simule par défaut, sans rien supprimer', async () => {
    const service = buildService();
    const result = await service.run(superAdmin, { targets: ['ACCOUNTS'] });
    expect(result.dryRun).toBe(true);
    expect(result.targets.some((row) => row.id === 'ACCOUNTS')).toBe(true);
    expect(result.requiresSensitiveConfirmation).toBe(true);
    expect(result.preservedAccount).toBe(superAdmin.email);
  });

  it('exige « EFFACER » pour une suppression réelle', async () => {
    const service = buildService();
    await expect(
      service.run(superAdmin, { targets: ['PLANNINGS'], dryRun: false }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
  });

  it('exige « SUPPRIMER » en plus pour les données de production', async () => {
    const service = buildService();
    await expect(
      service.run(superAdmin, {
        targets: ['ACCOUNTS'],
        dryRun: false,
        confirm: 'EFFACER',
      }),
    ).rejects.toMatchObject({ code: 'SENSITIVE_CONFIRMATION_REQUIRED' });

    await expect(
      service.run(superAdmin, {
        targets: ['STATIONS'],
        dryRun: false,
        confirm: 'EFFACER',
        confirmSensitive: 'SUPPRIMER',
      }),
    ).resolves.toMatchObject({ dryRun: false });
  });

  it('un nettoyage de recette ne demande pas la double confirmation', async () => {
    const service = buildService();
    await expect(
      service.run(superAdmin, {
        targets: ['PLANNINGS', 'ATTENDANCE'],
        dryRun: false,
        confirm: 'EFFACER',
      }),
    ).resolves.toMatchObject({ dryRun: false });
  });

  it('refuse une catégorie inconnue au lieu de l’ignorer', async () => {
    const service = buildService();
    await expect(
      service.run(superAdmin, { targets: ['PLANNINGS', 'SUPPRIMER_TOUT'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
