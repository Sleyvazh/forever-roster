import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Captures d'écran de docs/screenshots, avec des données fictives (aucun vrai pseudo ni adresse).
 * Lancement : CAPTURES=1 npx playwright test e2e/captures.spec.ts (base e2e vide, site construit).
 */
test.skip(!process.env.CAPTURES, "captures seulement sur demande (CAPTURES=1)");

const OUT = path.resolve("docs/screenshots");
const EMAIL = "thalion@example.test", PASSWORD = "une phrase de passe pour la démo";
const DB = process.env.DATABASE_URL_E2E ?? "postgres://forever:forever@localhost:5432/forever_e2e";

type P = { name: string; skill: number };
const profs = (a: P, b: P) => JSON.stringify({ prof1: a, prof2: b, cooking: 0, fishing: 0, firstAid: 0 });
const none = { name: "", skill: 0 };

/** Joueurs et persos fictifs : [joueur, perso, race, classe, spé, off-spec]. */
const ROSTER: [string, string, string, string, string, string][] = [
  ["Brunehilde", "Grumdal", "Tauren", "Warrior", "Protection", "Fury"],
  ["Kaelis", "Sylvaë", "Troll", "Priest", "Holy", "Shadow"],
  ["Morvan", "Morvh", "Undead", "Mage", "Frost", "Fire"],
  ["Isendra", "Isendra", "Orc", "Shaman", "Restoration", "Elemental"],
  ["Gorrak", "Gorrak", "Orc", "Warrior", "Fury", "Arms"],
  ["Nyssa", "Nyssaël", "Troll", "Hunter", "Marksmanship", "Survival"],
  ["Orlane", "Vesper", "Undead", "Rogue", "Combat", ""],
  ["Tavish", "Tavish", "Undead", "Warlock", "Affliction", "Destruction"],
  ["Elwin", "Elwin", "Tauren", "Druid", "Restoration", "Balance"],
  ["Sorcha", "Sorcha", "Troll", "Shaman", "Enhancement DPS", "Restoration"],
  ["Hadrien", "Hadrien", "Undead", "Priest", "Shadow", "Holy"],
  ["Lysandre", "Lysandre", "Troll", "Mage", "Fire", "Frost"],
];

function lastVerifyToken() {
  const lines = readFileSync(path.resolve("test-results/api.log"), "utf8").split("\n").filter(l => l.includes(EMAIL) && l.includes("verify-email"));
  return lines.at(-1)?.match(/verify-email#([A-Za-z0-9_-]{20,})/)?.[1] ?? "";
}

test("captures d'écran de la documentation", async ({ page, browser }) => {
  test.setTimeout(120_000);
  // Icônes (Blizzard, Pahpool) : jamais dans le dépôt, donc absentes des captures (repli du site)
  await page.context().route("**/icons/**", r => r.fulfill({ status: 404, body: "" }));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1360, height: 900 });

  // Compte de démonstration
  await page.goto("/register");
  await page.fill("#dn", "Thalion");
  await page.fill("#em", EMAIL);
  await page.fill("#pw", PASSWORD);
  await page.fill("#pw2", PASSWORD);
  await page.getByRole("button", { name: /créer/i }).click();
  await expect.poll(lastVerifyToken).not.toBe("");
  await page.goto(`/verify-email#${lastVerifyToken()}`);
  await expect(page.getByText("Adresse confirmée")).toBeVisible();
  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page.getByRole("heading", { name: "Mes personnages" })).toBeVisible();

  // Données fictives insérées directement en base
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const me = (await db.query("SELECT id FROM users WHERE email = $1", [EMAIL])).rows[0].id as string;
  const mine = await db.query(
    `INSERT INTO characters (user_id, name, race, cls, spec1, spec2, level, talents, talent_link, talents2, professions, sort_order) VALUES
     ($1, 'Thalwen', 'Tauren', 'Druid', 'Feral Bear', 'Restoration', 60, '9/37/5', 'https://foreverchanges.pro/talents/druid?b=050022-5520002123032213051-05', '14/0/35', $2, 0),
     ($1, 'Korrin', 'Orc', 'Hunter', 'Beast Mastery', 'Marksmanship', 42, '31/2/0', '', '', $3, 1) RETURNING id`,
    [me, profs({ name: "Leatherworking", skill: 300 }, { name: "Skinning", skill: 300 }), profs({ name: "Engineering", skill: 210 }, { name: "Mining", skill: 225 })],
  );
  const group = (await db.query("INSERT INTO groups (name) VALUES ('Les Veilleurs du Crépuscule') RETURNING id")).rows[0].id as string;
  await db.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')", [group, me]);
  const chars: { id: string; cls: string; spec: string; user: string; name: string }[] = [
    { id: mine.rows[0].id, cls: "Druid", spec: "Feral Bear", user: me, name: "Thalwen" },
  ];
  for (const [player, name, race, cls, spec, off] of ROSTER) {
    const u = (await db.query("INSERT INTO users (email, email_verified_at, password_hash, display_name) VALUES ($1, now(), 'demo', $2) RETURNING id",
      [`${player.toLowerCase()}@example.test`, player])).rows[0].id as string;
    await db.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)", [group, u, player === "Brunehilde" ? "officer" : "member"]);
    const c = (await db.query("INSERT INTO characters (user_id, name, race, cls, spec1, spec2, level, professions) VALUES ($1, $2, $3, $4, $5, $6, 60, $7) RETURNING id",
      [u, name, race, cls, spec, off, profs(none, none)])).rows[0].id as string;
    chars.push({ id: c, cls, spec, user: u, name });
  }
  const when = new Date(Date.now() + 3 * 86400e3); when.setHours(20, 30, 0, 0);
  const layout = [[0, 1, 4, 6, 9], [3, 2, 7, 11, 5], [8, 10, 12]];
  const slots = layout.flatMap((g, gi) => g.map((ci, pi) => ({ group: gi + 1, pos: pi + 1, characterId: chars[ci]!.id })));
  const raid = (await db.query("INSERT INTO raids (group_id, name, scheduled_at, slots, description, created_by) VALUES ($1, 'Molten Core', $2, $3, $4, $5) RETURNING id",
    [group, when, JSON.stringify(slots), "Rendez-vous à Blackrock à 20 h 15, pull à 20 h 30. Potions de résistance au feu conseillées.", me])).rows[0].id as string;
  for (const c of chars) {
    await db.query("INSERT INTO raid_signups (raid_id, user_id, display_name, character_id, cls, spec, status) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [raid, c.user, c.name, c.id, c.cls, c.spec, c.name === "Vesper" ? "late" : "present"]);
  }
  await db.query("INSERT INTO raid_signups (raid_id, discord_user_id, display_name, cls, spec, status) VALUES ($1, '720000000000000009', 'Ardan', 'Paladin', 'Holy Heal', 'tentative')", [raid]);
  await db.end();

  // 1. Mes persos
  await page.reload();
  await page.getByRole("button", { name: /Thalwen/ }).first().click();
  await expect(page.getByRole("heading", { name: "Thalwen" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/01-persos.png` });

  // 2. Raid : compo, banc et couverture
  await page.goto(`/groups/${group}/raids/${raid}`);
  await expect(page.getByRole("heading", { name: "Molten Core" })).toBeVisible();
  await page.setViewportSize({ width: 1360, height: 1000 });
  await page.evaluate(() => { const r = document.querySelector(".raid")!.getBoundingClientRect(); window.scrollTo(0, r.top + window.scrollY - 130); });
  await page.getByRole("button", { name: /Groupe 1, place 1 : Thalwen/ }).hover();
  await expect(page.locator(".itip")).toBeVisible();
  await page.screenshot({ path: `${OUT}/02-raid.png` });
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.mouse.move(0, 0);

  // 3. Compte et sécurité
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Compte & sécurité" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/03-securite.png` });

  // 4. Mobile, thème clair « parchemin »
  const ctx = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 390, height: 844 }, colorScheme: "light", locale: "fr-FR" });
  await ctx.route("**/icons/**", r => r.fulfill({ status: 404, body: "" }));
  const mobile = await ctx.newPage();
  await mobile.goto("/");
  await expect(mobile.getByRole("heading", { name: "Mes personnages" })).toBeVisible();
  await mobile.screenshot({ path: `${OUT}/04-mobile.png` });
  await ctx.close();
});
