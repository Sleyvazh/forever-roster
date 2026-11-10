import { expect, test as base, type Page } from "@playwright/test";
import pg from "pg";

/**
 * Version anglaise (10/11/2026), lot E1 : accueil public en anglais (/?lang=en, puis le cookie fr-lang), connexion,
 * inscription, mot de passe oublié et pages légales en anglais ; FR | EN en bas de page ; langue gardée dans le compte
 * (retrouvée sans le cookie). Sur chaque page visitée en anglais : aucun texte français. Noms inventés.
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
const PASSWORD = "a passphrase for the english guild";

// Mots qui trahissent du français (les noms propres et « Français », libellé du choix de langue, sont permis)
const FRENCH = /\b(le|la|les|des|du|une|pour|avec|dans|sur|est|sont|tes|ton|ta|vos|votre|pas|aucun|aucune|déjà|être|et|au|aux|ou|ici|tu|mon|mes|ce|cette|connexion|compte|mot de passe)\b|[éèêàùç]/i;
const ALLOWED = [/^Français$/, /Métropole/];
async function expectEnglish(page: Page, where: string) {
  const text = await page.locator("body").innerText();
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean)
    .filter(l => !ALLOWED.some(a => a.test(l)) && FRENCH.test(l));
  expect(lines, `texte français sur ${where}`).toEqual([]);
}

test("accueil, connexion, inscription et pages légales en anglais ; langue gardée dans le compte", async ({ page, context }) => {
  // Accueil public : /?lang=en, puis le cookie garde le choix (même adresse sans ?lang)
  await page.goto("/?lang=en");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("organized without the headache");
  await expectEnglish(page, "l'accueil public");
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("banner").getByRole("link", { name: "Log in" }).click();

  // Connexion : le site suit le cookie
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expectEnglish(page, "la connexion");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page.getByRole("heading", { name: "Forgotten password" })).toBeVisible();
  await expectEnglish(page, "mot de passe oublié");
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
  await page.fill("#pw", "short");
  await expect(page.getByText("At least 12 characters")).toBeVisible();
  await expectEnglish(page, "l'inscription");

  // Pages légales
  await page.goto("/mentions-legales");
  await expect(page.getByRole("heading", { name: "Legal notice" })).toBeVisible();
  await expectEnglish(page, "les mentions légales");
  await page.goto("/confidentialite");
  await expect(page.getByRole("heading", { name: "Privacy policy" })).toBeVisible();
  await expect(page.getByText("fr-lang", { exact: true })).toBeVisible();

  // FR | EN en bas de page : retour au français, puis l'anglais de nouveau
  await page.goto("/login");
  await page.getByRole("contentinfo").getByRole("button", { name: "Français" }).click();
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page.getByRole("contentinfo").getByRole("button", { name: /English/ }).click();
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();

  // Compte créé et confirmé, connexion en anglais : page Bienvenue en anglais, et la langue part dans le compte
  const email = `english-${Date.now()}@example.test`;
  await page.goto("/register");
  await page.fill("#dn", "Aldric"); await page.fill("#em", email); await page.fill("#pw", PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page.getByRole("heading", { name: "Check your e-mails" })).toBeVisible();
  const db = new pg.Client({ connectionString: DB }); await db.connect();
  try {
    await expect.poll(async () => (await db.query("update users set email_verified_at = now() where email = $1", [email])).rowCount).toBe(1);
    await page.goto("/login");
    await page.fill("#email", email); await page.fill("#password", PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your guild" })).toBeVisible();
    await expectEnglish(page, "la page Bienvenue");
    // Menu du compte : Langue → EN (déjà choisi : le choix passe dans le compte)
    await page.locator(".acct-btn").click();
    await expect(page.getByRole("link", { name: "Account & security" })).toBeVisible();
    await page.locator(".acct-menu").getByRole("button", { name: "Français" }).click();
    await expect(page.getByRole("heading", { name: "Ta guilde" })).toBeVisible();
    await page.locator(".acct-btn").click();
    await page.locator(".acct-menu").getByRole("button", { name: /English/ }).click();
    await expect(page.getByRole("heading", { name: "Your guild" })).toBeVisible();
    await expect.poll(async () => (await db.query("select lang from users where email = $1", [email])).rows[0]?.lang).toBe("en");
  } finally { await db.end(); }

  // Sans le cookie (autre appareil) : le compte redonne l'anglais
  await context.clearCookies({ name: "fr-lang" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your guild" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
