import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { sealText } from "../packages/game-data/src/seal";

/**
 * Rattacher, créer la fiche d'un joueur, donner une fiche (8/11) : dans Liste du jeu, l'officière coche deux persos et les
 * rattache d'un coup à un membre du site qui n'a encore rien ; « Créer sa fiche… » fait la fiche d'un perso sur le compte d'un
 * membre ; une fiche retrouvée par son nom rattache son perso (« · fiche ») ; « Donner la fiche à… » depuis Fiches du site ;
 * le receveur voit « Fiche donnée par… » dans Mes persos, et donne à son tour. Rien ne déborde à 390 px. Noms inventés.
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
const PASSWORD = "une phrase de passe pour la guilde";
const PROFS = JSON.stringify({ prof1: { name: "", skill: 0 }, prof2: { name: "", skill: 0 }, cooking: 0, fishing: 0, firstAid: 0 });
const lastVerifyToken = (email: string) => readFileSync(path.resolve("test-results/api.log"), "utf8").split("\n")
  .filter(l => l.includes(email) && l.includes("verify-email")).at(-1)?.match(/verify-email#([A-Za-z0-9_-]{20,})/)?.[1] ?? "";
// GUID propres à ce passage : une fiche d'un passage précédent (même base) ne les « prend » pas
const RUN = Math.floor(Math.random() * 0xFFFFF) * 16;
const guid = (n: number) => `Player-4620-${(RUN + n).toString(16).toUpperCase().padStart(8, "0")}`;

async function signUp(page: Page, name: string) {
  const email = `${name.toLowerCase()}-${Date.now()}@example.test`;
  await page.goto("/register");
  await page.fill("#dn", name); await page.fill("#em", email); await page.fill("#pw", PASSWORD);  await page.getByRole("button", { name: /créer/i }).click();
  await expect.poll(() => lastVerifyToken(email)).not.toBe("");
  await page.goto(`/verify-email#${lastVerifyToken(email)}`);
  await expect(page.getByText("Adresse confirmée")).toBeVisible();
  await page.goto("/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page.getByRole("heading", { name: "Ta guilde" })).toBeVisible();
  return email;
}
const paste = (page: Page, text: string) => page.evaluate(t => {
  const dt = new DataTransfer(); dt.setData("text/plain", t);
  (document.activeElement as HTMLElement | null)?.blur();
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
}, text);
/** Ctrl+V d'un texte de l'addon : aperçu dans le panneau Synchro, puis son bouton, jusqu'au résultat (refonte du 09/11). */
const pasteAndApply = async (page: Page, text: string) => {
  await paste(page, text);
  const panel = page.getByRole("dialog", { name: "Synchro" });
  await panel.locator(".sy-go").click();
  await expect(panel.getByRole("status", { name: "Résultat de la synchro" })).toBeVisible();
  return panel;
};
/** Captures pour la relecture : SHOTS_DIR=/chemin npx playwright test fiches */
const shot = async (target: Page | Locator, name: string) => {
  if (!process.env.SHOTS_DIR) return;
  await target.screenshot({ path: path.join(process.env.SHOTS_DIR, name) });
};
const noOverflow = async (page: Page, name?: string) => {
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  if (name && process.env.SHOTS_DIR) {
    await page.evaluate(() => document.querySelectorAll<HTMLElement>("body *").forEach(e => { if (getComputedStyle(e).position === "fixed" && e.getBoundingClientRect().top > 300) e.style.display = "none"; }));
    await page.screenshot({ path: path.join(process.env.SHOTS_DIR, name), fullPage: true });
    await page.evaluate(() => document.querySelectorAll<HTMLElement>("body *").forEach(e => { if (e.style.display === "none") e.style.display = ""; }));
  }
  await page.setViewportSize({ width: 1360, height: 900 });
};

const ROSTER: [string, string, number, number][] = [
  ["Kaeldra Brisevent", "WARRIOR", 38, 1], ["Morgrim Feudacier", "PALADIN", 33, 7], ["Pikou Patacuivre", "MAGE", 31, 4],
  ["Thorn Malvent", "HUNTER", 24, 11], ["Grumz Brisecrâne", "WARRIOR", 22, 6], ["Zirta Pellerouge", "PRIEST", 8, 10],
];
function frl(now: number) {
  const lines = ROSTER.map(([name, cls, lv, g], i) => ["M", name, cls, lv, i === 0 ? "Maître de guilde" : "Membre", i === 0 ? 0 : 3, 0, 5, "", "", guid(g)].join(";"));
  return sealText([`FRL;1;Les Fiches;Horde;${now};Kaeldra Brisevent;1;Officier;${lines.length};Forever EU;1.6.5`, ...lines, `END;${lines.length}`].join("\n"));
}

test("fiches : rattacher plusieurs persos, créer la fiche d'un joueur, donner une fiche", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const morwenPage = await (await browser.newContext()).newPage();
  const vexEmail = await signUp(page, "Vex");
  const morwenEmail = await signUp(morwenPage, "Morwen");
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const idOf = async (email: string) => (await db.query("SELECT id FROM users WHERE email = $1", [email])).rows[0].id as string;
  const [vex, morwen] = [await idOf(vexEmail), await idOf(morwenEmail)];
  const group = (await db.query("INSERT INTO groups (name) VALUES ('Les Fiches') RETURNING id")).rows[0].id as string;
  const pikou = (await db.query("INSERT INTO users (email, email_verified_at, password_hash, display_name) VALUES ($1, now(), 'demo', 'Pikou') RETURNING id", [`pikou-${Date.now()}@example.test`])).rows[0].id as string;
  await db.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'member')", [group, vex, morwen, pikou]);
  const fiche = async (user: string, name: string, cls: string, race: string, spec: string, level: number, g: number | null, main: boolean) => {
    const id = (await db.query("INSERT INTO characters (user_id, name, race, cls, spec1, level, professions, guid) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
      [user, name, race, cls, spec, level, PROFS, g === null ? null : guid(g)])).rows[0].id as string;
    await db.query("INSERT INTO group_characters (group_id, character_id, user_id, is_main) VALUES ($1, $2, $3, $4)", [group, id, user, main]);
    return id;
  };
  await fiche(vex, "Kaeldra Brisevent", "Warrior", "Orc", "Protection", 38, 1, true);
  await fiche(pikou, "Pikou", "Mage", "Troll", "Frost", 31, null, true);
  const grumz = await fiche(pikou, "Grumz", "Warrior", "Orc", "Arms", 22, null, false);
  await db.end();

  await pasteAndApply(page, frl(Math.floor(Date.now() / 1000) - 60));
  await expect(page.getByRole("dialog", { name: "Synchro" })).toContainText("Les Fiches (liée)");
  await page.goto(`/groups/${group}/membres/persos?vue=jeu`);
  const table = page.locator(".gx-table");
  const row = (name: string) => table.locator("tbody tr", { hasText: name });

  await test.step("une fiche retrouvée par son nom rattache son perso du jeu à son compte", async () => {
    await expect(row("Pikou Patacuivre").locator(".gx-pl")).toHaveText("Pikou · fiche");
    await expect(row("Grumz Brisecrâne").locator(".gx-pl")).toHaveText("Pikou · fiche");
  });

  await test.step("deux persos cochés, rattachés d'un coup à Morwen, qui n'avait encore aucun perso reconnu", async () => {
    await row("Morgrim Feudacier").getByRole("checkbox").check();
    await row("Thorn Malvent").getByRole("checkbox").check();
    const bar = page.getByRole("region", { name: "Persos cochés" });
    await expect(bar).toContainText("2 persos cochés");
    await expect(bar).toContainText("Morgrim Feudacier, Thorn Malvent");
    await shot(page.locator(".gm-bar").locator("xpath=..").first(), "fiches-liste-cochee.png");
    await noOverflow(page, "fiches-liste-cochee-390.png");
    await bar.getByRole("button", { name: "Rattacher à…" }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByRole("heading")).toHaveText("Rattacher 2 persos à…");
    await expect(dlg).toContainText("Sur le site, sans perso dans la liste");
    await dlg.getByLabel(/Morwen/).check();
    await expect(dlg).toContainText("« Est-ce ton perso ? » s'affichera pour chacun à sa prochaine visite");
    await shot(dlg, "fiches-rattacher-2.png");
    await dlg.getByRole("button", { name: "Rattacher les 2 à Morwen" }).click();
    await expect(dlg).toHaveCount(0);
    await expect(bar).toHaveCount(0);
    await expect(row("Morgrim Feudacier").locator(".gx-pl")).toHaveText("Morwen");
    // Morwen répond oui pour les deux
    await morwenPage.goto(`/groups/${group}/membres/joueurs`);
    for (const n of ["Morgrim Feudacier", "Thorn Malvent"]) {
      await morwenPage.getByRole("region", { name: `Est-ce ton perso ? ${n}` }).getByRole("button", { name: "Oui, c'est moi" }).click();
      await expect(morwenPage.getByRole("region", { name: `Est-ce ton perso ? ${n}` })).toHaveCount(0);
    }
  });

  await test.step("« Créer sa fiche… » : la fiche de Morgrim sur le compte de Morwen", async () => {
    await row("Morgrim Feudacier").getByRole("button", { name: "Actions pour Morgrim Feudacier" }).click();
    await page.getByRole("menuitem", { name: "Créer sa fiche…" }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByRole("heading")).toHaveText("Créer la fiche de Morgrim Feudacier");
    await expect(dlg.getByLabel("À qui est ce perso ?")).toHaveValue(morwen);
    await expect(dlg.getByLabel("Nom de la fiche")).toHaveValue("Morgrim Feudacier");
    await dlg.getByLabel(/Race/).selectOption("Undead");
    await shot(dlg, "fiches-creer.png");
    await dlg.getByRole("button", { name: "Créer la fiche pour Morwen" }).click();
    await expect(dlg).toHaveCount(0);
    // Plus de « Créer sa fiche… » pour Morgrim ; Thorn n'en a pas encore
    await row("Morgrim Feudacier").getByRole("button", { name: "Actions pour Morgrim Feudacier" }).click();
    await expect(page.getByRole("menuitem", { name: "Créer sa fiche…" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await morwenPage.goto("/persos");
    await expect(morwenPage.locator(".fi-head h2")).toHaveText("Morgrim Feudacier");
    await expect(morwenPage.locator(".fi-origin")).toContainText("Fiche créée par Vex, officier de Les Fiches,");
  });

  await test.step("Fiches du site : l'officier donne Grumz (fiche de Pikou) à Morwen", async () => {
    await page.goto(`/groups/${group}/membres/persos?vue=fiches&perso=${grumz}`);
    const bar = page.locator(".gm-act");
    await expect(bar).toContainText("niveau 22 relevé en jeu (Grumz Brisecrâne)");
    await bar.getByRole("button", { name: "Donner la fiche à…" }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByRole("heading")).toHaveText("Donner Grumz à…");
    await expect(dlg).toContainText("Elle n'a pas d'inscription à venir.");
    await expect(dlg.getByRole("list", { name: "Membres de la guilde" })).not.toContainText("Pikou");
    await dlg.getByLabel(/Morwen/).check();
    await shot(dlg, "fiches-donner.png");
    await dlg.getByRole("button", { name: "Donner Grumz à Morwen" }).click();
    await expect(dlg.getByRole("heading")).toHaveText("Grumz est à Morwen");
    await dlg.locator(".sg-actions").getByRole("button", { name: "Fermer" }).click();
    await expect(bar).toContainText("alt de Morwen dans cette guilde");
    // Liste du jeu : Grumz suit sa fiche
    await page.goto(`/groups/${group}/membres/persos?vue=jeu`);
    await expect(row("Grumz Brisecrâne").locator(".gx-pl")).toContainText("Morwen");
  });

  await test.step("Mes persos de Morwen : « Fiche donnée par Vex », puis Morwen la donne à son tour", async () => {
    await morwenPage.goto(`/persos/${grumz}`);
    await expect(morwenPage.locator(".fi-origin")).toContainText("Fiche donnée par Vex le");
    await shot(morwenPage, "fiches-mes-persos.png");
    // « Donner à un autre joueur… » est dans « Modifier le profil » (refonte du 09/11)
    await morwenPage.getByRole("button", { name: "✎ Modifier le profil" }).click();
    await morwenPage.getByRole("button", { name: "Donner à un autre joueur…" }).click();
    const dlg = morwenPage.getByRole("dialog");
    await expect(dlg.getByRole("heading")).toHaveText("Donner Grumz à…");
    await dlg.getByLabel(/Pikou/).check();
    await dlg.getByRole("button", { name: "Donner Grumz à Pikou" }).click();
    await expect(dlg).toHaveCount(0);
    await expect(morwenPage.locator(".fi-head h2")).toHaveText("Morgrim Feudacier");
    // Journal de la guilde
    await page.goto(`/groups/${group}/admin?section=journal`);
    const line = (text: string) => page.getByRole("row").filter({ hasText: text });
    await expect(line("a créé la fiche d'un joueur · Morgrim Feudacier (Paladin 33), pour Morwen")).toBeVisible();
    await expect(line("a donné une fiche · Grumz : Pikou → Morwen")).toBeVisible();
    await expect(line("a donné une fiche · Grumz : Morwen → Pikou")).toBeVisible();
  });
});
