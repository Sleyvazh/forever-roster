import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Interface de Roster Companion (servie par Tauri). En navigateur seul (npm run dev), un faux appareil
// permet de voir tous les écrans (src/demo.ts).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: "es2022",
    sourcemap: false,
    // Polices servies en fichiers (CSP font-src 'self')
    assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
});
