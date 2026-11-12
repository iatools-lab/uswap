import { defineConfig } from "vitest/config";

/**
 * Tests avec la MAQUETTE LOCALE active.
 *
 * Le profil d'environnement courant (`.env.local`) peut définir `VITE_API_URL`
 * pour viser un vrai backend ; les tests de connexion par espace ont besoin de
 * la maquette, qui applique les mêmes règles sans serveur. La variable est donc
 * forcée à une valeur vide ici, sans toucher aux fichiers d'environnement.
 *
 *   npx vitest run --config vitest.mock.config.ts
 *
 * Le projet n'a pas de plugin particuliers (JSX géré par esbuild) : cette
 * configuration autonome évite de dépendre du profil Vite courant.
 */
export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify("test"),
    "import.meta.env.VITE_API_URL": JSON.stringify(""),
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
  },
});
