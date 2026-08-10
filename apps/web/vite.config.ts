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
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "vendor-react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "vendor-radix", test: /node_modules[\\/](radix-ui|@radix-ui)[\\/]/ },
            { name: "vendor-lucide", test: /node_modules[\\/]lucide-react[\\/]/ },
            { name: "vendor-markdown", test: /node_modules[\\/](react-markdown|remark-gfm|remark-parse|remark-rehype|rehype-raw|rehype-sanitize|micromark|unified|unist-util|hast-util|mdast-util|vfile)[\\/]/ },
          ],
        },
      },
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
