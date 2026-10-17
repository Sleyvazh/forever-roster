import { expect, test as base, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Mentions légales et confidentialité : pages publiques sur les deux adresses (Forever Roster et Roster), avec le nom du
 * site, liens du pied de page (site et accueils publics), de l'inscription et de Compte & sécurité, lisibles à 375 px.
 * Chaque test échoue s'il y a une erreur JavaScript ou une violation de la CSP.
 */
const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const problems: string[] = [];
    page.on("pageerror", e => problems.push(`Erreur JS : ${e.message}`));
    page.on("console", m => { if (m.type() === "error" && !(m.location().url ?? "").includes("/icons/")) problems.push(`Console : ${m.text().slice(0, 200)}`); });
    await use(page);
    expect(problems, "erreurs ou violations CSP pendant le test").toEqual([]);
  },
});

const SITES = [
  { name: "Forever Roster", origin: "http://localhost:4173" },
  { name: "Roster", origin: "http://127.0.0.1:4173" },
];
// Adresse par défaut (CONTACT_EMAIL non réglé dans e2e/start.mjs)
const CONTACT = "contact@sleyvazh.fr";
const LOG = path.resolve("test-results/api.log");

for (const site of SITES) {
  test(`pages légales sans connexion sur ${site.name}`, async ({ page }) => {
    await test.step("mentions légales", async () => {
      await page.goto(`${site.origin}/mentions-legales`);
      await expect(page).toHaveURL(`${site.origin}/mentions-legales`);
      await expect(page.getByRole("heading", { level: 1, name: "Mentions légales" })).toBeVisible();
      await expect(page.locator(".legal .eyebrow")).toHaveText(site.name);
      await expect(page).toHaveTitle(`Mentions légales · ${site.name}`);
      await expect(page.locator("#editeur")).toContainText("Sleyvazh (pseudonyme), particulier, à titre non professionnel");
      await expect(page.locator("#editeur").getByRole("link", { name: CONTACT })).toHaveAttribute("href", `mailto:${CONTACT}`);
      await expect(page.locator("#hebergeur")).toContainText("OVH SAS");
      await expect(page.locator("#hebergeur")).toContainText(/2 rue Kellermann,\s59100\sRoubaix, France/);
      await expect(page.locator("#propriete")).toContainText("Pahpool");
      // Les deux adresses du site sont nommées, celle qu'on visite d'abord
      await expect(page.locator(".legal-lead b").first()).toHaveText(site.name);
    });
    await test.step("confidentialité", async () => {
      await page.locator(".legal").getByRole("link", { name: "politique de confidentialité" }).click();
      await expect(page).toHaveURL(`${site.origin}/confidentialite`);
      await expect(page.getByRole("heading", { level: 1, name: "Politique de confidentialité" })).toBeVisible();
      await expect(page.locator(".legal .eyebrow")).toHaveText(site.name);
      await expect(page).toHaveTitle(`Confidentialité · ${site.name}`);
      await expect(page.locator("#responsable").getByRole("link", { name: CONTACT })).toBeVisible();
      const table = page.locator("#donnees table");
      await expect(table.getByRole("rowheader", { name: /Ton compte/ })).toBeVisible();
      await expect(table.getByRole("rowheader", { name: /Inscrits depuis Discord, sans compte/ })).toBeVisible();
      await expect(table.getByRole("rowheader", { name: /Sécurité\s:\sjournal et sessions/ })).toBeVisible();
      await expect(page.locator("#cookies")).toContainText("__Host-fr_sid");
      await expect(page.locator("#droits").getByRole("link", { name: "cnil.fr/fr/plaintes" })).toHaveAttribute("href", "https://www.cnil.fr/fr/plaintes");
    });
  });
}

test("liens du pied de page : site, accueils publics, inscription", async ({ page }) => {
  for (const site of SITES) {
    await test.step(`accueil public de ${site.name}`, async () => {
      await page.goto(`${site.origin}/`);
      const foot = page.locator("footer nav[aria-label='Informations légales']");
      await expect(foot.getByRole("link", { name: "Mentions légales" })).toHaveAttribute("href", "/mentions-legales");
      await foot.getByRole("link", { name: "Confidentialité" }).click();
      await expect(page).toHaveURL(`${site.origin}/confidentialite`);
      await expect(page.locator(".legal .eyebrow")).toHaveText(site.name);
    });
    await test.step(`pied de page du site sur ${site.name}`, async () => {
      await page.goto(`${site.origin}/login`);
      const foot = page.locator(".site-foot");
      await expect(foot).toContainText("Icônes de classes et de spécialisations réalisées par Pahpool");
      await foot.getByRole("link", { name: "Mentions légales" }).click();
      await expect(page).toHaveURL(`${site.origin}/mentions-legales`);
      await page.locator(".site-foot").getByRole("link", { name: "Confidentialité" }).click();
      await expect(page).toHaveURL(`${site.origin}/confidentialite`);
    });
  }
  await test.step("inscription : la phrase sous le bouton mène à la confidentialité", async () => {
    await page.goto("/register");
    await page.locator("form").getByRole("link", { name: "politique de confidentialité" }).click();
    await expect(page).toHaveURL(/\/confidentialite$/);
  });
});

test("Compte & sécurité mène à la confidentialité", async ({ page }) => {
  const email = `e2e-legal-${Date.now()}@example.test`;
  const password = "une phrase de passe pour la confidentialité";
  await page.goto("/register");
  await page.fill("#dn", "Lectrice");
  await page.fill("#em", email);
  await page.fill("#pw", password);
  await page.fill("#pw2", password);
  await page.getByRole("button", { name: /créer/i }).click();
  const token = () => readFileSync(LOG, "utf8").split("\n").filter(l => l.includes(email) && l.includes("verify-email")).at(-1)?.match(/verify-email#([A-Za-z0-9_-]{20,})/)?.[1] ?? "";
  await expect.poll(token).not.toBe("");
  await page.goto(`/verify-email#${token()}`);
  await expect(page.getByText("Adresse confirmée")).toBeVisible();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page.getByRole("heading", { name: "Mes personnages" })).toBeVisible();
  await page.goto("/account");
  await page.locator(".page-head").getByRole("link", { name: "confidentialité" }).click();
  await expect(page).toHaveURL(/\/confidentialite$/);
  // Connecté : la page reste la même, avec la barre du site
  await expect(page.getByRole("heading", { level: 1, name: "Politique de confidentialité" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).first()).toBeVisible();
});

test.describe("sur téléphone (375 px)", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  test("pas de défilement horizontal, tableaux en fiches", async ({ page }) => {
    for (const p of ["/mentions-legales", "/confidentialite"]) {
      await page.goto(p);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${p} : défilement horizontal`).toBeLessThanOrEqual(0);
    }
    // Les intitulés des colonnes passent au-dessus de chaque valeur
    const cell = page.locator("#donnees td[data-l='Combien de temps']").first();
    expect(await cell.evaluate(td => getComputedStyle(td, "::before").content)).toBe('"Combien de temps"');
  });
});
