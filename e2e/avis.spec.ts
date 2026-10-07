import { expect, test as base, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Avis Discord suivis par un groupe (Administration → Avis) : pastilles, avis anonyme, fil, réponse depuis le site
 * (en attente d'envoi par le bot), statut, lien d'un avis (?avis=). Les avis sont posés en base comme le ferait le bot.
 * Échoue s'il y a une erreur JavaScript ou une violation de la CSP. Captures dans test-results/shots/.
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

const OUT = path.resolve("test-results/shots");
const DB = process.env.DATABASE_URL_E2E ?? "postgres://forever:forever@localhost:5432/forever_e2e";
const PASSWORD = "une phrase de passe pour les avis";

async function account(page: Page, name: string) {
  const email = `e2e-${name.toLowerCase()}-${Date.now()}@example.test`;
  await page.goto("/register");
  await page.fill("#dn", name); await page.fill("#em", email); await page.fill("#pw", PASSWORD); await page.fill("#pw2", PASSWORD);
  await page.getByRole("button", { name: /créer/i }).click();
  const token = () => readFileSync(path.resolve("test-results/api.log"), "utf8").split("\n").filter(l => l.includes(email) && l.includes("verify-email")).at(-1)?.match(/verify-email#([A-Za-z0-9_-]{20,})/)?.[1] ?? "";
  await expect.poll(token).not.toBe("");
  await page.goto(`/verify-email#${token()}`);
  await page.goto("/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page.getByRole("heading", { name: "Mes personnages" })).toBeVisible();
}

test("avis du Discord : pastilles, fil, réponse depuis le site, statut", async ({ page }) => {
  test.setTimeout(90_000);
  mkdirSync(OUT, { recursive: true });
  await page.context().route("**/icons/**", r => r.fulfill({ status: 404, body: "" }));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1360, height: 900 });
  await account(page, "Sley");
  const groupId = await page.evaluate(async () => {
    const { csrfToken } = await (await fetch("/api/auth/me")).json();
    const r = await fetch("/api/groups", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify({ name: "Les Veilleurs" }) });
    return (await r.json()).group.id as string;
  });

  // Ce que fait le bot : serveur relié au groupe, deux avis (un anonyme avec une conversation, un signé tout neuf)
  const guild = String(910000000000000000n + BigInt(Date.now() % 1e9));
  const anon = randomUUID(), signed = randomUUID();
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  try {
    await db.query("update groups set discord_guild_id = $1, discord_channel_id = '920000000000000001' where id = $2", [guild, groupId]);
    await db.query("insert into feedback_settings (guild_id, guild_name, inbox_channel_id, allow_anonymous, group_id, updated_by) values ($1, 'Amis Forever', '920000000000000002', true, $2, '920000000000000003')", [guild, groupId]);
    const ins = "insert into feedbacks (id, guild_id, channel_id, message_id, anonymous, author_id, group_id, text, author_name, status, created_at, author_at) values ($1, $2, '920000000000000002', $3, $4, '920000000000000009', $5, $6, $7, $8, now() - $9::interval, now() - $10::interval)";
    await db.query(ins, [anon, guild, "920000000000000010", true, groupId, "Les raids finissent trop tard le mercredi, on pourrait commencer à 20 h 30 ?", null, "wip", "2 hours", "20 minutes"]);
    await db.query(ins, [signed, guild, "920000000000000011", false, groupId, "Merci pour le SR+ hier soir, c'était beaucoup plus clair que le /roll. Est-ce qu'on pourrait l'avoir aussi sur Onyxia ?", "Sfil", "new", "1 day", "1 day"]);
    await db.query("insert into feedback_messages (feedback_id, \"from\", name, text, source, delivered, created_at) values ($1, 'team', 'Brakka', 'Bonne idée, on en parle jeudi entre officiers. Tu viens d''habitude le mercredi ?', 'discord', true, now() - interval '90 minutes'), ($1, 'author', null, 'Oui, chaque semaine, mais je décroche vers minuit.', 'discord', null, now() - interval '20 minutes')", [anon]);
  } finally { await db.end(); }

  await test.step("pastilles sur l'onglet Administration et sur « Avis »", async () => {
    await page.goto(`/groups/${groupId}`);
    await expect(page.getByRole("tab", { name: /Administration/ }).locator(".av-badge")).toHaveText("2");
    await page.getByRole("tab", { name: /Administration/ }).click();
    const nav = page.getByRole("navigation", { name: "Sections de l'administration" });
    await expect(nav.getByRole("button", { name: /Avis/ }).locator(".av-badge")).toHaveText("2");
    await nav.getByRole("button", { name: /Avis/ }).click();
    await expect(page.getByRole("heading", { name: "Avis du Discord" })).toBeVisible();
    await expect(page.getByText("Amis Forever")).toBeVisible();
    // Vus : les pastilles s'en vont, les « Nouveau » restent pendant la lecture
    await expect(page.getByRole("tab", { name: /Administration/ }).locator(".av-badge")).toHaveCount(0);
    await expect(page.locator(".av-item").first().locator(".sg-new").first()).toBeVisible();
    await page.screenshot({ path: `${OUT}/apercu-avis.png`, fullPage: true });
  });

  await test.step("avis anonyme : fil complet, réponse depuis le site", async () => {
    const item = page.locator(".av-item", { hasText: "finissent trop tard" });
    await expect(item.locator(".av-anon")).toHaveText("Anonyme");
    await expect(item.getByText("Brakka")).toBeVisible();
    await expect(item.getByText("L'auteur répond")).toBeVisible();
    await item.getByLabel("Ta réponse").fill("On teste 20 h 30 dès mercredi prochain, merci !");
    await item.getByRole("button", { name: "Répondre" }).click();
    await expect(item.getByRole("status")).toContainText("Réponse envoyée");
    await expect(item.getByText("envoi en cours…")).toBeVisible();
    await expect(item.getByText("(depuis le site)")).toBeVisible();
  });

  await test.step("statut, filtre « Faits »", async () => {
    const item = page.locator(".av-item", { hasText: "finissent trop tard" });
    await item.getByLabel("Statut de l'avis").selectOption("done");
    await expect(page.locator(".av-item", { hasText: "finissent trop tard" })).toHaveCount(0);
    await page.getByRole("button", { name: /^Faits/ }).click();
    await expect(page.locator(".av-item", { hasText: "finissent trop tard" })).toBeVisible();
  });

  await test.step("lien d'un avis depuis Discord (?avis=) et téléphone", async () => {
    await page.goto(`/groups/${groupId}/admin?avis=${signed}`);
    const item = page.locator(".av-item.focus");
    await expect(item).toContainText("Sfil");
    await expect(item.getByLabel("Ta réponse")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${OUT}/apercu-avis-mobile.png`, fullPage: true });
  });
});
