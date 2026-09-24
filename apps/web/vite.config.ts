import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // En dev, le front et l'API partagent la même origine grâce au proxy : cookies SameSite et CSRF identiques à la prod.
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } },
  },
  build: { sourcemap: false },
});
