import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { addonSha256, addonVersion, addonZip } from "./addon-zip";

export default defineConfig({
  plugins: [react(), addonZip()],
  define: {
    __ADDON_VERSION__: JSON.stringify(addonVersion()), __ADDON_SHA256__: JSON.stringify(addonSha256()),
    // Addon Roster (WoW Retail, lot R3) : page Addon de roster.sleyvazh.fr
    __ROSTER_ADDON_VERSION__: JSON.stringify(addonVersion("Roster")), __ROSTER_ADDON_SHA256__: JSON.stringify(addonSha256("Roster")),
  },
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
