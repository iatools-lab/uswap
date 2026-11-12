import { defineConfig } from 'vitest/config';

/**
 * Configuration Vitest du backend.
 *
 * Le projet n'en avait aucune : `npm test` s'arrêtait sur
 * « No test files found », et un test ajouté aurait échoué sur
 * « describe is not defined ». Ce fichier ne change pas le code métier ; il
 * rend simplement les tests exécutables.
 *
 * `globals: true` : les tests s'écrivent avec `describe`/`it`/`expect`, comme
 * dans les projets NestJS, sans import obligatoire (les imports explicites
 * restent valides).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['node_modules', 'dist'],
    // Les tests n'ouvrent aucun port : ils s'exécutent l'un après l'autre pour
    // garder une sortie lisible et des durées stables sur un poste Windows.
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
