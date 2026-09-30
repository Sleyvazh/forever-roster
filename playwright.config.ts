import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout sur le site construit comme en production (CSP de Caddy comprise).
 * Prérequis : npm run build, et une base PostgreSQL vide (DATABASE_URL_E2E).
 */
export default defineConfig({
  testDir: "e2e",
  // Captures de la documentation : seulement avec CAPTURES=1 (voir e2e/captures.spec.ts)
  testIgnore: process.env.CAPTURES ? [] : ["**/captures.spec.ts"],
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    ...devices["Desktop Chrome"],
    // Navigateur déjà installé ailleurs (ex. conteneur de dev) : PW_CHROMIUM_PATH=/chemin/vers/chrome
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: "node e2e/start.mjs",
    url: "http://localhost:4173/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
