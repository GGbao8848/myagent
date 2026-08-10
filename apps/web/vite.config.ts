import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 9005,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:9004",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 9005,
    strictPort: true,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: "http://localhost:9004",
        changeOrigin: true,
      },
    },
  },
});
