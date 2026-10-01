import { defineConfig } from "vite";

export default defineConfig({
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
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
