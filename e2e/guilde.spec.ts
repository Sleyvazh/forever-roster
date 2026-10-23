import { expect, test as base, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Guilde du jeu (Forever, lot « Guilde ») : le relevé FRL collé sur le site (Ctrl+V) lie la guilde, Membres montre les
 * joueurs (main et alts, compte du site), la bande « À rattacher » accepte une suggestion de note, « Rattacher à… »
 * range un perso sous un joueur ; Course au 60, Historique, Accueil et Administration s'affichent. Noms inventés.
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
const guid = (n: number) => `Player-4620-${(0xA000 + n).toString(16).toUpperCase().padStart(8, "0")}`;

/** Relevé de la guilde comme l'addon 1.6.2 l'écrit (docs/addon-format.md, FRL v1). */
function frl(now: number) {
  const members: [string, string, number, string, number, string, number][] = [
    // nom complet, classe, niveau, rang, index du rang, note, n° du GUID
    ["Kaeldra Brisevent", "WARRIOR", 30, "Maître de guilde", 0, "", 1],
    ["Brindille Feuillevive", "DRUID", 28, "Officier", 1, "", 2],
    ["Vex Ombrelame", "ROGUE", 27, "Officier", 1, "", 3],
    ["Vexelle Ombrelame", "SHAMAN", 14, "Membre", 3, "Alt de Vex", 4],
    ["Pikou Patacuivre", "MAGE", 19, "Membre", 3, "", 5],
    ["Nessa Flotsombre", "SHAMAN", 22, "Membre", 3, "", 6],
    ["Zirta Pellerouge", "PRIEST", 8, "Recrue", 4, "", 7],
  ];
  const lines = [
    ...members.map(([name, cls, lv, rank, ri, note, g]) => ["M", name, cls, lv, rank, ri, g === 2 ? 1 : 0, g === 2 ? 0 : 3, note, "", guid(g)].join(";")),
    `J;${now};Brindille Feuillevive`,
    "E;invite;Kaeldra Brisevent;Zirta Pellerouge;;6",
    "E;join;Zirta Pellerouge;;;5",
    "E;promote;Kaeldra Brisevent;Brindille Feuillevive;1;30",
  ];
  return [`FRL;1;Les Lanternes;Horde;${now};Brindille Feuillevive;1;Officier;${members.length};Forever EU;1.6.2`, ...lines, `END;${lines.length}`].join("\n");
}

const paste = (page: Page, text: string) => page.evaluate(t => {
  const dt = new DataTransfer();
  dt.setData("text/plain", t);
  (document.activeElement as HTMLElement | null)?.blur();
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
}, text);

test("guilde : relevé collé, Membres, rattacher, Course au 60, Historique, Accueil", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `guilde-${Date.now()}@example.test`;
  await page.goto("/register");
  await page.fill("#dn", "Thalion");
  await page.fill("#em", email);
  await page.fill("#pw", PASSWORD);
  await page.fill("#pw2", PASSWORD);
  await page.getByRole("button", { name: /créer/i }).click();
  await expect.poll(() => lastVerifyToken(email)).not.toBe("");
  await page.goto(`/verify-email#${lastVerifyToken(email)}`);
  await expect(page.getByText("Adresse confirmée")).toBeVisible();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page.getByRole("heading", { name: "Ta guilde" })).toBeVisible();

  // Guilde du site : Thalion officier (sa fiche Brindille porte son GUID), Kael propriétaire (Kaeldra)
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const me = (await db.query("SELECT id FROM users WHERE email = $1", [email])).rows[0].id as string;
  const group = (await db.query("INSERT INTO groups (name) VALUES ('Les Lanternes') RETURNING id")).rows[0].id as string;
  await db.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'officer')", [group, me]);
  const kael = (await db.query("INSERT INTO users (email, email_verified_at, password_hash, display_name) VALUES ($1, now(), 'demo', 'Kael') RETURNING id",
    [`kael-${Date.now()}@example.test`])).rows[0].id as string;
  await db.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')", [group, kael]);
  const fiche = async (user: string, name: string, cls: string, race: string, spec: string, level: number, g: number) => {
    const id = (await db.query("INSERT INTO characters (user_id, name, race, cls, spec1, level, professions, guid) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
      [user, name, race, cls, spec, level, PROFS, guid(g)])).rows[0].id as string;
    await db.query("INSERT INTO group_characters (group_id, character_id, user_id, is_main) VALUES ($1, $2, $3, true)", [group, id, user]);
  };
  await fiche(me, "Brindille Feuillevive", "Druid", "Tauren", "Restoration", 28, 2);
  await fiche(kael, "Kaeldra Brisevent", "Warrior", "Orc", "Protection", 30, 1);
  await db.end();

  await test.step("Ctrl+V du relevé : la guilde du jeu se lie et la liste arrive", async () => {
    await paste(page, frl(Math.floor(Date.now() / 1000) - 60));
    // Rien à choisir : le relevé part tout de suite (refonte du 23/10), le résultat s'affiche
    const toast = page.getByRole("status", { name: "Export de l'addon" });
    await expect(toast).toContainText("Liste de guilde reçue");
    await expect(toast).toContainText("Les Lanternes (liée) : liste de 7 membres (complète)");
    await expect(page.getByRole("dialog", { name: "Export de l'addon" })).toHaveCount(0);
    await toast.getByRole("button", { name: "Détails" }).click();
    const dialog = page.getByRole("dialog", { name: "Export de l'addon" });
    await expect(dialog).toContainText("Guilde Les Lanternes : Les Lanternes (liée) : liste de 7 membres (complète)");
    await dialog.getByRole("link", { name: "Les Lanternes › Joueurs" }).click();
    await expect(page).toHaveURL(new RegExp(`/groups/${group}/membres$`));
  });

  const players = page.getByRole("table", { name: "Joueurs de la guilde" });
  await test.step("Guilde › Joueurs : mains, comptes du site, bande « À rattacher »", async () => {
    await expect(page.locator(".topnav").getByRole("link", { name: "Guilde" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Liste relevée par Brindille Feuillevive")).toBeVisible();
    await expect(players.getByRole("row").filter({ hasText: "Kaeldra Brisevent" })).toContainText("Kael");
    await expect(players.getByRole("row").filter({ hasText: "Brindille Feuillevive" })).toContainText("Toi");
    await expect(players.getByRole("row").filter({ hasText: "Nessa Flotsombre" })).toContainText("sans compte");
    // Note « Alt de Vex » : suggestion acceptée d'un clic, Vexelle rejoint Vex en alt
    const band = page.getByRole("region", { name: /À rattacher/ });
    await expect(band).toContainText("Vexelle Ombrelame");
    await expect(band).toContainText("Alt de Vex Ombrelame ?");
    await band.getByRole("button", { name: "Accepter" }).click();
    await expect(players.getByRole("row").filter({ hasText: "Vex Ombrelame" }).locator(".ac")).toContainText("Vexelle Ombrelame");
    await expect(page.getByRole("region", { name: /À rattacher/ })).toHaveCount(0);
  });

  await test.step("« Rattacher à… » : Pikou rejoint Thalion, en alt de Brindille", async () => {
    await players.getByRole("button", { name: "Actions pour Pikou Patacuivre" }).click();
    await page.getByRole("menuitem", { name: "Rattacher à…" }).click();
    const dialog = page.getByRole("dialog", { name: /Rattacher Pikou Patacuivre à/ });
    await dialog.getByRole("searchbox", { name: "Chercher un joueur ou un perso" }).fill("brind");
    await dialog.getByText("Brindille Feuillevive").click();
    await dialog.getByRole("button", { name: "Rattacher à Thalion" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(players.getByRole("row").filter({ hasText: "Brindille Feuillevive" }).locator(".ac")).toContainText("Pikou Patacuivre");
    // Persos : la liste du jeu, Pikou en alt de Thalion
    await page.getByRole("group", { name: "Par joueur ou par perso" }).getByRole("button", { name: "Par perso" }).click();
    await expect(page).toHaveURL(new RegExp(`/groups/${group}/membres/persos$`));
    await expect(page.getByRole("row").filter({ hasText: "Pikou Patacuivre" })).toContainText("Thalion");
  });

  await test.step("Course au 60 et Historique", async () => {
    // Adresse utilisée par le bot (annonces de la course) : /groups/:id/membres/course
    await page.getByRole("tab", { name: "Course au 60" }).click();
    await expect(page).toHaveURL(new RegExp(`/groups/${group}/membres/course$`));
    // Avant la sortie (5/11) : la date de départ ; après : le podium
    await expect(page.getByRole("heading", { name: /La course part|Premiers 60/ })).toBeVisible();
    await page.getByRole("tab", { name: "Historique" }).click();
    const zirta = page.locator(".gh li").filter({ hasText: "Zirta Pellerouge" });
    await expect(zirta).toContainText("rejoint la guilde");
    await expect(zirta).toContainText("invitation de Kaeldra Brisevent");
    await expect(page.locator(".gh li").filter({ hasText: "Brindille Feuillevive" })).toContainText("passe Officier");
  });

  await test.step("Accueil, Administration, téléphone", async () => {
    await page.locator(".topnav .nav").getByRole("link", { name: "Accueil" }).click();
    await expect(page).toHaveURL(new RegExp(`/groups/${group}$`));
    await expect(page.getByRole("heading", { name: /Aujourd'hui et demain/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Course au 60/ })).toBeVisible();
    await expect(page.getByRole("region", { name: /Arrivées et départs/ })).toContainText("Zirta Pellerouge rejoint la guilde");
    await page.locator(".topnav").getByRole("link", { name: "Guilde" }).click();
    await page.getByRole("link", { name: "Administration" }).click();
    await page.locator(".adm-nav").getByRole("button", { name: /^Guilde/ }).click();
    await expect(page.getByRole("region", { name: "Guilde du jeu" })).toContainText("liée le");
    await expect(page.getByRole("region", { name: "Guilde du jeu" })).toContainText("7 membres, relevée par Brindille Feuillevive");
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of [`/groups/${group}`, `/groups/${group}/membres`, `/groups/${group}/membres/course`]) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.scrollWidth), url).toBeLessThanOrEqual(390);
    }
  });
});
