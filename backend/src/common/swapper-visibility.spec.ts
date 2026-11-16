import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ScopeService } from './scope.service';
import type { AuthenticatedUser } from './guards/roles.guard';

/**
 * Perimetre d'un swappeur : planning ET pointage.
 *
 * Régression corrigée (audit 2026-11-13, §2.1, BLOQUANT) : un créneau affecté
 * par l'API n'écrivait QUE `occurrence_assignments`, jamais
 * `occurrences.swapperId`. Le périmètre de l'agent filtrait sur `swapperId` :
 * l'agent ne voyait pas son service et son pointage répondait « Affectation
 * introuvable ». Les deux sources sont désormais acceptées, et la création
 * alimente les deux.
 */

const swapper: AuthenticatedUser = {
  id: 'swapper-1',
  email: 'agent@upowa.org',
  fullName: 'Awa',
  role: 'SWAPPER',
  stationId: null,
  sessionId: 'sid',
} as AuthenticatedUser;

describe('ScopeService — périmètre du swappeur', () => {
  const scope = new ScopeService({} as never);

  it('filtre sur les affectations nominatives ET sur le raccourci swapperId', () => {
    const where = scope.occurrenceScope(swapper);
    const clauses = JSON.stringify(where);
    // Les deux sources : une seule suffit à devoir voir le créneau.
    expect(clauses).toContain('"swapperId":"swapper-1"');
    expect(clauses).toContain('"assignments"');
    expect(clauses).toContain('"userId":"swapper-1"');
    expect(where.OR).toHaveLength(2);
  });

  it('ne restreint rien pour les autres rôles', () => {
    for (const role of ['ADMIN', 'SUPERVISOR', 'SUPER_ADMIN'] as const) {
      expect(scope.occurrenceScope({ ...swapper, role } as AuthenticatedUser)).toEqual(
        {},
      );
    }
  });
});

/**
 * Verrou de NON-RÉGRESSION sur le code : toute écriture d'affectation doit
 * alimenter `occurrences.swapperId`. On lit la source (pas d'effet de bord) et
 * on vérifie que la mise à jour existe dans les deux chemins.
 */
describe('cohérence des affectations à l’écriture', () => {
  const source = readFileSync(
    resolve(__dirname, '../planning/planning.service.ts'),
    'utf8',
  );

  it('la création d’un planning renseigne swapperId', () => {
    expect(source).toMatch(/data:\s*\{\s*swapperId:\s*userIds\[0\]/);
  });

  it('la réaffectation d’un créneau met swapperId à jour', () => {
    expect(source).toMatch(/swapperId:\s*unique\[0\]\s*\?\?\s*null/);
  });

  it('le pointage accepte les deux sources d’affectation', () => {
    const attendance = readFileSync(
      resolve(__dirname, '../attendance/attendance.service.ts'),
      'utf8',
    );
    expect(attendance).toContain('occurrence.assignments.some');
    expect(attendance).toContain('occurrence.swapperId === user.id');
  });
});
