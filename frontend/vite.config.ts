import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    /**
     * Le frontend et l'API sont servis sur la meme origine en developpement.
     * C'est indispensable au cookie de session HttpOnly : envoye depuis
     * http://localhost:3000 vers http://127.0.0.1:5173 il serait cross-site,
     * et un cookie SameSite=Lax n'est alors jamais joint a la requete.
     */
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/xlsx")) return "xlsx";
          if (id.includes("node_modules/qrcode")) return "qrcode";
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
