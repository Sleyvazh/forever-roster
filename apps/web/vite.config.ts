import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { addonVersion, addonZip } from "./addon-zip";

export default defineConfig({
  plugins: [react(), addonZip()],
  define: { __ADDON_VERSION__: JSON.stringify(addonVersion()) },
  server: {
    port: 5173,
    // En dev, le front et l'API partagent la même origine grâce au proxy : cookies SameSite et CSRF identiques à la prod.
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } },
  },
  build: {
    sourcemap: false,
    // Jamais de police intégrée en data: URL : la CSP de production (font-src 'self') les bloquerait.
    assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
});
