import { expect, test as base, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Un site, deux adresses : Forever Roster (localhost) et Roster, pour WoW Retail (127.0.0.1 en test).
 * Accueil public propre à chaque adresse, même compte sur les deux, Roster limité au compte avant son ouverture.
 * Chaque test échoue s'il y a une erreur JavaScript ou une violation de la CSP.
 */
const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const problems: string[] = [];
    page.on("pageerror", e => problems.push(`Erreur JS : ${e.message}`));
    page.on("console", m => {
      if (m.type() !== "error") return;
      if ((m.location().url ?? "").includes("/icons/")) return; // icônes du jeu absentes en test
      problems.push(`Console : ${m.text().slice(0, 200)}`);
    });
    await use(page);
    expect(problems, "erreurs ou violations CSP pendant le test").toEqual([]);
  },
});

const FOREVER = "http://localhost:4173";
const RETAIL = "http://127.0.0.1:4173";
const LOG = path.resolve("test-results/api.log");

/** Dernier e-mail de confirmation journalisé pour cette adresse : lien et texte. */
function lastVerifyMail(email: string) {
  const line = readFileSync(LOG, "utf8").split("\n").filter(l => l.includes(email) && l.includes("verify-email")).at(-1);
  const m = line?.match(/(https?:\/\/[^\s"\\]+)\/verify-email#([A-Za-z0-9_-]{20,})/);
  if (!line || !m) throw new Error(`Aucun lien verify-email pour ${email}`);
  return { origin: m[1]!, token: m[2]!, line };
}

test("accueil public propre à chaque adresse", async ({ page }) => {
  await test.step("Forever Roster", async () => {
    await page.goto(`${FOREVER}/`);
    await expect(page).toHaveTitle(/^Forever Roster/);
    await expect(page.locator("html")).not.toHaveClass(/retail/);
    await expect(page.locator("meta[name=description]")).toHaveAttribute("content", /WoW Forever/);
    await expect(page.locator(".cta a.primary")).toHaveAttribute("href", "/register");
    await expect(page.locator("figure.shot img")).toHaveJSProperty("complete", true);
    expect(await page.locator("figure.shot img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  });
  await test.step("Roster", async () => {
    await page.goto(`${RETAIL}/`);
    await expect(page).toHaveTitle(/^Roster/);
    await expect(page.locator("html")).toHaveClass(/retail/);
    await expect(page.getByText("Déjà un compte sur Forever Roster ?")).toBeVisible();
    expect(await page.locator("figure.shot img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await page.locator("header .btn", { hasText: "Se connecter" }).click();
    await expect(page).toHaveURL(`${RETAIL}/login`);
    await expect(page).toHaveTitle(/Roster/);
  });
  await test.step("robots.txt", async () => {
    const r = await page.request.get(`${RETAIL}/robots.txt`);
    expect(await r.text()).toContain("Disallow: /api/");
  });
});

test("même compte sur les deux adresses, Roster pas encore ouvert", async ({ page }) => {
  const email = `e2e-sites-${Date.now()}@example.test`;
  const password = "une phrase de passe pour les deux sites";

  await test.step("inscription sur Roster : l'e-mail renvoie vers Roster", async () => {
    await page.goto(`${RETAIL}/register`);
    await page.fill("#dn", "Voyageuse");
    await page.fill("#em", email);
    await page.fill("#pw", password);
    await page.fill("#pw2", password);
    await page.getByRole("button", { name: /créer/i }).click();
    await expect(page.getByText("Vérifie tes e-mails")).toBeVisible();
    await expect.poll(() => { try { return lastVerifyMail(email).token; } catch { return ""; } }).not.toBe("");
    const mail = lastVerifyMail(email);
    expect(mail.origin).toBe(RETAIL);
    expect(mail.line).toContain("Roster");
    expect(mail.line).not.toContain("Forever Roster");
    await page.goto(`${RETAIL}/verify-email#${mail.token}`);
    await expect(page.getByText("Adresse confirmée")).toBeVisible();
  });

  await test.step("connexion sur Roster : seulement le compte pour l'instant", async () => {
    await page.goto(`${RETAIL}/login`);
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await expect(page.getByRole("heading", { name: "Roster arrive bientôt" })).toBeVisible();
    await expect(page.locator(".soon a", { hasText: "Forever Roster" })).toHaveAttribute("href", FOREVER);
    await expect(page.getByRole("link", { name: "Mes persos" })).toHaveCount(0);
    await page.goto(`${RETAIL}/groups`);
    await expect(page.getByRole("heading", { name: "Roster arrive bientôt" })).toBeVisible();
    await page.getByRole("link", { name: "Compte et sécurité" }).click();
    await expect(page).toHaveURL(`${RETAIL}/account`);
    await expect(page.getByRole("heading", { name: "Roster arrive bientôt" })).toHaveCount(0);
    // Accueil public : un visiteur connecté file vers le site
    await page.goto(`${RETAIL}/`);
    await expect(page).toHaveURL(`${RETAIL}/persos`);
  });

  await test.step("même compte sur Forever Roster (connexion à refaire sur cette adresse)", async () => {
    await page.goto(`${FOREVER}/persos`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await expect(page.getByRole("heading", { name: "Mes personnages" })).toBeVisible();
    await expect(page.locator(".brand")).toHaveAccessibleName(/^Forever Roster/);
  });
});
