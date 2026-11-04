// Configuration ESLint dediee a backend_new.
//
// Elle remplace volontairement celle du depot parent : ce projet est une API
// NestJS autonome, avec ses propres versions et son propre style. Sans ce
// fichier, ESLint remonterait jusqu'a la racine et appliquerait des regles
// prevues pour un autre projet.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    /*
     * Les fichiers de test sont EXCLUS de `tsconfig.json` (voir `exclude`) : le
     * linter typé échoue sur eux avec « parserOptions.project has been
     * provided ». On les retire donc de l'analyse ESLint ; Vitest les exécute
     * et les vérifie à part.
     */
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '**/*.spec.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Les decorateurs NestJS generent des signatures larges : ces regles
      // produisent surtout du bruit sur du code applicatif correct.
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/require-await': 'off',
      /*
       * Bruit de typage sur du code applicatif correct :
       *  - `no-unsafe-enum-comparison` : Prisma renvoie des champs `string`,
       *    comparés aux enums metier (`role === Role.ADMIN`). Le controle de
       *    valeur est fait a l'entree (pipes de validation), pas ici.
       *  - `restrict-template-expressions` / `no-base-to-string` : quelques
       *    interpolations de `Date`/`object` dans des messages de journal.
       * Ces regles sont deja partiellement couvertes par les `no-unsafe-*`
       * desactivees juste au-dessus ; elles n'ont jamais revele de defaut ici.
       */
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
