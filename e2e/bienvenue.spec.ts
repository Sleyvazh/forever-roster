import { expect, test as base, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Première visite (Forever, refonte du 23/10) : le lien d'invitation nomme la guilde, le compte se crée en trois champs,
 * l'invitation survit à la confirmation de l'e-mail (autre onglet), le perso en trois champs, « Rejoindre », puis
 * l'inscription au prochain raid depuis l'Accueil. Noms inventés.
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

const DB = process.env.DATABASE_URL_E2E ?? "postgres://forever:forever@localhost:5432/forever_e2e";
const PASSWORD = "une phrase de passe pour la bienvenue";
const lastVerifyToken = (email: string) => readFileSync(path.resolve("test-results/api.log"), "utf8").split("\n")
  .filter(l => l.includes(email) && l.includes("verify-email")).at(-1)?.match(/verify-email#([A-Za-z0-9_-]{20,})/)?.[1] ?? "";

test("première visite : lien d'invitation, compte, e-mail, perso, Rejoindre, inscription au prochain raid", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const officer = `thalion-${stamp}@example.test`;

  await test.step("l'officier crée sa guilde et copie le lien de « Inviter »", async () => {
    await page.goto("/register");
    await page.fill("#dn", "Thalion");
    await page.fill("#em", officer);
    await page.fill("#pw", PASSWORD);
    await page.fill("#pw2", PASSWORD);
    await page.getByRole("button", { name: /créer/i }).click();
    await expect.poll(() => lastVerifyToken(officer)).not.toBe("");
    await page.goto(`/verify-email#${lastVerifyToken(officer)}`);
    await expect(page.getByText("Adresse confirmée")).toBeVisible();
    await page.goto("/login");
    await page.fill("#email", officer);
    await page.fill("#password", PASSWORD);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await expect(page.getByRole("heading", { name: "Ta guilde" })).toBeVisible();
    await page.getByRole("button", { name: "Créer ma guilde" }).click();
    await page.fill("#g-name", "Les Lanternes");
    await page.getByRole("button", { name: "Créer", exact: true }).click();
    await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}$/);
  });
  const group = new URL(page.url()).pathname.split("/")[2]!;

  // Le prochain raid de la guilde : demain soir
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  await db.query("INSERT INTO raids (group_id, name, scheduled_at, size) VALUES ($1, 'Upper Blackrock Spire', now() + interval '1 day', 10)", [group]);
  await db.end();

  await page.getByRole("button", { name: "Inviter" }).click();
  const pop = page.getByRole("dialog", { name: "Inviter dans Les Lanternes" });
  await expect(pop.getByRole("textbox", { name: "Lien d'invitation" })).toHaveValue(/\/join#[A-Za-z0-9_-]{20,}$/);
  await expect(pop).toContainText("5 utilisations · valable 3 jours");
  const link = new URL(await pop.getByRole("textbox", { name: "Lien d'invitation" }).inputValue());

  // Le joueur invité : un autre navigateur, sans compte
  const ctx = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris" });
  await ctx.route("**/icons/**", r => r.fulfill({ status: 404, body: "" }));
  const v = await ctx.newPage();
  const email = `elouan-${stamp}@example.test`;

  await test.step("le lien nomme la guilde ; compte en trois champs", async () => {
    await v.goto(link.pathname + link.hash);
    await expect(v.getByRole("heading", { level: 1, name: "Les Lanternes" })).toBeVisible();
    await expect(v.getByText("Invitation de Thalion")).toBeVisible();
    await expect(v.getByRole("list", { name: "Étapes" }).locator("[aria-current=step]")).toContainText("Compte");
    // Barre réduite : ni navigation ni synchro pendant la première visite
    await expect(v.locator(".topnav .nav a")).toHaveCount(0);
    expect(new URL(v.url()).hash).toBe(""); // le jeton quitte la barre d'adresse
    await v.setViewportSize({ width: 375, height: 740 });
    expect(await v.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await v.setViewportSize({ width: 1280, height: 900 });
    await v.fill("#wa-p", "Elouan");
    await v.fill("#wa-e", email);
    await v.fill("#wa-m", PASSWORD);
    await v.getByRole("button", { name: "Afficher" }).click();
    await expect(v.locator("#wa-m")).toHaveAttribute("type", "text");
    await v.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(v.getByRole("status")).toContainText(`Regarde tes e-mails (${email})`);
  });

  await test.step("le lien de l'e-mail s'ouvre dans un autre onglet : l'invitation est retrouvée", async () => {
    await expect.poll(() => lastVerifyToken(email)).not.toBe("");
    const tab = await ctx.newPage();
    await tab.goto(`/verify-email#${lastVerifyToken(email)}`);
    await expect(tab.getByText("Adresse confirmée")).toBeVisible();
    await tab.getByRole("link", { name: "Se connecter" }).click();
    await expect(tab).toHaveURL(/\/login\?next=(%2F|\/)bienvenue$/);
    await expect(tab.locator("#email")).toHaveValue(email); // e-mail prérempli
    await tab.fill("#password", PASSWORD);
    await tab.getByRole("button", { name: /se connecter/i }).click();
    await expect(tab).toHaveURL(/\/bienvenue$/);
    await expect(tab.getByRole("heading", { level: 1, name: "Les Lanternes" })).toBeVisible();
    await expect(tab.getByRole("list", { name: "Étapes" }).locator("[aria-current=step]")).toContainText("Perso");
    await v.close();

    // Ton perso : nom, classe et spé d'un clic ; « Rejoindre »
    const join = tab.getByRole("button", { name: "Rejoindre Les Lanternes" });
    await expect(tab.locator("#wl-n")).toHaveValue("Elouan");
    await expect(join).toBeDisabled();
    await tab.getByRole("group", { name: "Classe" }).getByRole("button", { name: "Druid" }).click();
    await tab.getByRole("group", { name: "Spé" }).getByRole("button", { name: /Restoration/ }).click();
    await expect(tab.getByRole("group", { name: "Spé" }).getByRole("button", { name: /Restoration/ })).toHaveAttribute("aria-pressed", "true");
    await join.click();
    await expect(tab).toHaveURL(new RegExp(`/groups/${group}$`));
    expect(await tab.evaluate(() => localStorage.getItem("fr-invite"))).toBeNull(); // effacé à l'acceptation

    await test.step("Accueil : le prochain raid, inscription en un clic", async () => {
      await expect(tab.getByRole("heading", { level: 1, name: /^(Bonjour|Bonsoir), Elouan$/ })).toBeVisible();
      await expect(tab.getByRole("region", { name: "Mes persos" })).toContainText("Elouan");
      await expect(tab.getByRole("region", { name: "Mes persos" }).locator(".gm-star")).toHaveCount(1); // main de la guilde
      const raid = tab.locator("li.ag").filter({ hasText: "Upper Blackrock Spire" });
      await raid.getByRole("button", { name: "Présent" }).click();
      await expect(raid.getByRole("button", { name: "Présent" })).toHaveAttribute("aria-pressed", "true");
      await expect(raid).toContainText("1 vient · 0 tank · 1 heal · 0 DPS");
      // La page du raid le confirme, avec le même choix de réponses
      await raid.getByRole("link", { name: /Upper Blackrock Spire/ }).click();
      const answer = tab.getByRole("region", { name: "Ta réponse" });
      await expect(answer.locator(".ans-state")).toHaveText("Présent avec Elouan");
      await expect(answer.getByRole("button", { name: "Changer de perso ou de spé" })).toContainText("Elouan · Restoration");
    });
  });
  await ctx.close();

  await test.step("l'officier voit le nouveau membre dans Guilde › Joueurs", async () => {
    await page.locator(".topnav").getByRole("link", { name: "Guilde" }).click();
    await expect(page.locator(".mb-table")).toContainText("Elouan");
  });

  await test.step("lien expiré : la page le dit", async () => {
    const ctx2 = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris" });
    const w = await ctx2.newPage();
    await w.goto(`/join#${"x".repeat(32)}`);
    await expect(w.getByRole("alert")).toContainText("Cette invitation n'est plus valable.");
    await expect(w.getByRole("link", { name: "Créer un compte" })).toBeVisible();
    await ctx2.close();
  });
});
