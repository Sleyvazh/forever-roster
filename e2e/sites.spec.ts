import { expect, test as base, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
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
const E2E_DB = process.env.DATABASE_URL_E2E ?? "postgres://forever:forever@localhost:5432/forever_e2e";

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

test.describe("Roster en accès anticipé", () => {
  test.use({ locale: "fr-FR" });

  test("persos et raid de WoW Retail, noms en français ou en anglais", async ({ page }) => {
    const email = `e2e-retail-${Date.now()}@example.test`;
    const password = "une phrase de passe pour Roster";

    await test.step("compte créé sur Roster, puis accès anticipé donné sur le serveur", async () => {
      await page.goto(`${RETAIL}/register`);
      await page.fill("#dn", "Officière");
      await page.fill("#em", email);
      await page.fill("#pw", password);
      await page.fill("#pw2", password);
      await page.getByRole("button", { name: /créer/i }).click();
      await expect.poll(() => { try { return lastVerifyMail(email).token; } catch { return ""; } }).not.toBe("");
      await page.goto(`${RETAIL}/verify-email#${lastVerifyMail(email).token}`);
      await expect(page.getByText("Adresse confirmée")).toBeVisible();
      await page.goto(`${RETAIL}/login`);
      await page.fill("#email", email);
      await page.fill("#password", password);
      await page.getByRole("button", { name: /se connecter/i }).click();
      await expect(page.getByRole("heading", { name: "Roster arrive bientôt" })).toBeVisible();
      // Commande du serveur (docs/operations.md) : node dist/roster-preview.js add <e-mail>
      const out = execFileSync("node", ["apps/api/dist/roster-preview.js", "add", email], { env: { ...process.env, DATABASE_URL: E2E_DB }, encoding: "utf8" });
      expect(out).toContain("accès anticipé à Roster donné");
      await page.reload();
      await expect(page.getByText("Accès anticipé")).toBeVisible();
      await expect(page.getByRole("link", { name: "Addon" })).toHaveCount(0);
    });

    await test.step("perso créé à la main : classe et spé en français (navigateur en français)", async () => {
      await page.goto(`${RETAIL}/persos`);
      await page.fill("#rcn-name", "Brumelune");
      await page.fill("#rcn-realm", "Hyjal");
      await page.selectOption("#rcn-cls", "Monk");
      await expect(page.locator("#rcn-cls option:checked")).toHaveText("Moine");
      await page.selectOption("#rcn-spec", "Mistweaver");
      await expect(page.locator("#rcn-spec option:checked")).toHaveText("Tisse-brume");
      await page.getByRole("button", { name: "Créer le perso" }).click();
      const sheet = page.getByRole("region", { name: "Fiche de Brumelune" });
      await expect(sheet).toContainText("Moine");
      await expect(sheet.getByRole("link", { name: "Raider.IO" })).toHaveAttribute("href", "https://raider.io/characters/eu/hyjal/brumelune");
      if (process.env.SHOTS) await page.screenshot({ path: "test-results/shots/roster-perso.png", fullPage: true });
    });

    await test.step("groupe et raid Héroïque : effectif, inscription, buffs de Midnight", async () => {
      await page.getByRole("link", { name: "Groupes" }).first().click();
      await page.fill("#g-name", "Pasta e Basta");
      await page.getByRole("button", { name: "Créer" }).click();
      await expect(page.getByRole("tab", { name: "Personnages" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Artisans" })).toHaveCount(0);
      await page.getByRole("button", { name: "+ Nouveau raid" }).click();
      await page.getByRole("button", { name: "Flèche du Vide" }).click();
      await page.getByRole("group", { name: "Difficulté" }).getByRole("button", { name: "Héroïque" }).click();
      await expect(page.locator("#gr-size")).toHaveValue("20");
      await page.fill("#gr-size", "25");
      await page.getByRole("button", { name: "Créer le raid" }).click();
      await expect(page.getByRole("heading", { name: "Flèche du Vide" })).toBeVisible();
      await expect(page.locator(".rp-meta")).toContainText("Héroïque · 25 joueurs");
      await expect(page.getByRole("tab", { name: "Butin" })).toHaveCount(0);
      await page.getByRole("tab", { name: /Inscriptions/ }).click();
      await page.selectOption("#su-spec", "Mistweaver");
      await page.getByRole("group", { name: "Mon statut" }).getByRole("button", { name: "Présent" }).click();
      await expect(page.getByText("Tu es inscrit : Présent avec Brumelune (Tisse-brume)")).toBeVisible();
      await page.getByRole("tab", { name: "Compo" }).click();
      await page.getByRole("button", { name: "Ajouter Brumelune au raid" }).click();
      await expect(page.getByText("1 effet couvert sur 14")).toBeVisible();
      await page.getByText("Détail des 14 effets").click();
      await expect(page.getByText("Toucher mystique")).toBeVisible();
      await expect(page.locator(".rgroup")).toHaveCount(5);
      if (process.env.SHOTS) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: "test-results/shots/roster-raid.png", fullPage: true }); }
    });

    await test.step("noms en anglais au choix du compte", async () => {
      const raid = page.url();
      await page.goto(`${RETAIL}/account`);
      await page.selectOption("#gl", "en");
      await expect(page.getByText("Enregistré.")).toBeVisible();
      await page.goto(raid);
      await page.getByText("Détail des 14 effets").click();
      await expect(page.getByText("Mystic Touch")).toBeVisible();
      await expect(page.locator(".rp-meta")).toContainText("Heroic · 25 joueurs");
    });
  });
});
