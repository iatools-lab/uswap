import { defineConfig } from "vite";

/**
 * Cible du proxy vers l'API NestJS.
 *
 * "localhost" est volontaire : le backend ecoute sur toutes les interfaces et
 * cette cible fonctionne quelle que soit la pile reseau du systeme. Une cible
 * litterale ("127.0.0.1" ou "::1") casse des que le backend n'ecoute que sur
 * l'autre pile — cas frequent sous Node >= 18, qui prefere IPv6 : Vite
 * remonte alors "AggregateError [ECONNREFUSED]" sur /auth/login.
 * Surchargeable par API_PROXY_TARGET pour un backend distant.
 */
const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3000";

const apiProxy = {
  "/api": {
    target: apiProxyTarget,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ""),
  },
};

export default defineConfig({
  server: {
    host: "127.0.0.1",
    /**
     * Le frontend et l'API sont servis sur la meme origine en developpement.
     * C'est indispensable au cookie de session HttpOnly : envoye depuis
     * http://localhost:3000 vers http://127.0.0.1:5173 il serait cross-site,
     * et un cookie SameSite=Lax n'est alors jamais joint a la requete.
     */
    proxy: apiProxy,
  },
  preview: {
    host: "127.0.0.1",
    proxy: apiProxy,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/xlsx")) return "xlsx";
          if (id.includes("node_modules/@phosphor-icons")) return "icons";
          if (id.includes("node_modules/@fontsource")) return "fonts";
          if (id.includes("node_modules/@dnd-kit")) return "dnd";
          if (
            id.includes("node_modules/react-dom") ||
            id.includes("node_modules/react/") ||
            id.includes("node_modules/scheduler")
          )
            return "react-vendor";
          if (id.includes("node_modules/react-router")) return "router";
        },
      },
    },
  },
});
