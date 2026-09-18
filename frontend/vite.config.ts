import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared/plans": path.resolve(__dirname, "./src/shared/plans.ts"),
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [path.resolve(__dirname)],
    },
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
