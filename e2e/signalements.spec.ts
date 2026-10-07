import { expect, test as base, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

/**
 * « Signaler un bug ou une idée » : un joueur signale avec une capture, un admin du site répond,
 * le joueur voit la pastille puis la réponse. Échoue s'il y a une erreur JavaScript ou une violation de la CSP.
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

const LOG = path.resolve("test-results/api.log");
const E2E_DB = process.env.DATABASE_URL_E2E ?? "postgres://forever:forever@localhost:5432/forever_e2e";
const PASSWORD = "une phrase de passe pour signaler";

async function account(page: Page, name: string) {
  const email = `e2e-${name.toLowerCase()}-${Date.now()}@example.test`;
  await page.goto("/register");
  await page.fill("#dn", name);
  await page.fill("#em", email);
  await page.fill("#pw", PASSWORD);
  await page.fill("#pw2", PASSWORD);
  await page.getByRole("button", { name: /créer/i }).click();
  const token = () => readFileSync(LOG, "utf8").split("\n").filter(l => l.includes(email) && l.includes("verify-email")).at(-1)?.match(/verify-email#([A-Za-z0-9_-]{20,})/)?.[1] ?? "";
  await expect.poll(token).not.toBe("");
  await page.goto(`/verify-email#${token()}`);
  await expect(page.getByText("Adresse confirmée")).toBeVisible();
  return email;
}
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page.getByRole("heading", { name: "Mes personnages" })).toBeVisible();
}
const openMenu = (page: Page) => page.locator(".acct-btn").click();
const newPage = async (browser: Browser) => (await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris" })).newPage();

test("signaler un bug avec une capture, réponse de l'admin, pastille", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const player = await account(page, "Signaleuse");
  await login(page, player);

  await test.step("le joueur signale depuis le menu de son compte", async () => {
    await page.goto("/groups");
    await openMenu(page);
    await page.getByRole("button", { name: "Signaler un bug ou une idée" }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toHaveAccessibleName("Signaler un bug ou une idée");
    await expect(dlg.getByText("Joint automatiquement")).toContainText("/groups");
    await expect(dlg.getByText("Joint automatiquement")).toContainText("Forever Roster");
    await dlg.getByRole("button", { name: "Addon", exact: true }).click();
    await dlg.getByLabel("Titre").fill("La fenêtre du conseil se ferme");
    await dlg.getByLabel("Détails").fill("Quand je clique sur Passer, la fenêtre se ferme pour tout le monde.");
    const png = await sharp({ create: { width: 2400, height: 1350, channels: 3, background: { r: 40, g: 90, b: 200 } } }).png().toBuffer();
    await dlg.locator("input[type=file]").setInputFiles({ name: "capture.png", mimeType: "image/png", buffer: png });
    await expect(dlg.getByRole("img", { name: "Capture jointe" })).toBeVisible();
    await dlg.getByRole("button", { name: "Envoyer" }).click();
    await expect(dlg.getByRole("heading", { name: "Merci !" })).toBeVisible();
    await expect(dlg.getByRole("alert")).toHaveCount(0);
    await dlg.getByRole("link", { name: "Voir mes signalements" }).click();
    await expect(page.getByRole("heading", { name: "Mes signalements" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const item = page.locator(".sg-item").first();
    await expect(item).toContainText("La fenêtre du conseil se ferme");
    await expect(item).toContainText("Nouveau");
    await expect(item).toContainText("Pas encore lu par l'équipe.");
    const thumb = item.getByRole("img", { name: "Capture jointe" });
    await expect(thumb).toBeVisible();
    await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1600);
  });

  const adminPage = await newPage(browser);
  await test.step("un admin du site (ajouté par la commande du serveur) répond", async () => {
    const admin = await account(adminPage, "AdminDuSite");
    const out = execFileSync("node", ["apps/api/dist/site-admin.js", "add", admin], { env: { ...process.env, DATABASE_URL: E2E_DB }, encoding: "utf8" });
    expect(out).toContain("admin du site ajouté");
    await login(adminPage, admin);
    await openMenu(adminPage);
    await adminPage.getByRole("link", { name: "Signalements (admin)" }).click();
    await expect(adminPage.getByRole("heading", { name: "Signalements", exact: true })).toBeVisible();
    await expect(adminPage.getByText("/signalements-lier")).toBeVisible();
    const item = adminPage.locator(".sg-item", { hasText: "La fenêtre du conseil se ferme" });
    await expect(item).toContainText("Signaleuse");
    await expect(item).toContainText("/groups");
    await expect(item.getByRole("img", { name: "Capture jointe" })).toBeVisible();
    await item.getByLabel(/Réponse au joueur/).fill("Merci ! Corrigé dans la prochaine version de l'addon.");
    await item.getByRole("button", { name: "Répondre" }).click();
    await expect(item.getByRole("status")).toContainText("Réponse envoyée");
    await expect(item.getByLabel("Statut")).toHaveValue("wip");
    await item.getByLabel("Statut").selectOption("done");
    await expect(adminPage.locator(".sg-item", { hasText: "La fenêtre du conseil se ferme" })).toHaveCount(0);
    await adminPage.getByRole("button", { name: /^Faits/ }).click();
    await expect(adminPage.locator(".sg-item", { hasText: "La fenêtre du conseil se ferme" })).toContainText("Fait");
  });
  await test.step("un joueur n'a pas accès à la page des admins", async () => {
    await page.goto("/admin/signalements");
    await expect(page.getByRole("heading", { name: "Réservé aux admins du site" })).toBeVisible();
  });

  await test.step("le joueur voit la pastille, puis la réponse", async () => {
    await page.goto("/persos");
    await expect(page.locator(".acct-dot")).toBeVisible();
    await openMenu(page);
    await expect(page.getByRole("link", { name: /Mes signalements/ })).toContainText("1 réponse");
    await page.getByRole("link", { name: /Mes signalements/ }).click();
    const item = page.locator(".sg-item").first();
    await expect(item).toContainText("Réponse de AdminDuSite");
    await expect(item).toContainText("Corrigé dans la prochaine version");
    await expect(item.locator(".sg-new")).toBeVisible();
    await expect(page.locator(".acct-dot")).toHaveCount(0);
  });
  await adminPage.context().close();
});
