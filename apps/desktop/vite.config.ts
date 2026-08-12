import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// renderer 进程（本地 React UI）打包；main 进程由 tsc 编译
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src/renderer",
  base: "./",
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/renderer", import.meta.url)),
    },
    // 强制 React 单实例，避免双 React 导致 useState 读到 null
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
});
