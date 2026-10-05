import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Aperçus des nouveautés (lots D1 et D2) avec des données fictives, pour les montrer avant déploiement.
 * Lancement : APERCUS=1 npx playwright test e2e/apercus.spec.ts (base e2e vide, site construit). Sortie : test-results/shots/.
 */
test.skip(!process.env.APERCUS, "aperçus seulement sur demande (APERCUS=1)");

const OUT = path.resolve("test-results/shots");
const EMAIL = "thalion@example.test", PASSWORD = "une phrase de passe pour la démo";
const DB = process.env.DATABASE_URL_E2E ?? "postgres://forever:forever@localhost:5432/forever_e2e";
const PROFS = JSON.stringify({ prof1: { name: "", skill: 0 }, prof2: { name: "", skill: 0 }, cooking: 0, fishing: 0, firstAid: 0 });

/** [joueur, perso, race, classe, spé, off-spec, alt éventuel [nom, classe, spé, off]] */
const ROSTER: [string, string, string, string, string, string, [string, string, string, string]?][] = [
  ["Brunehilde", "Grumdal", "Tauren", "Warrior", "Protection", "Fury", ["Brindille", "Druid", "Restoration", "Feral Bear"]],
  ["Kaelis", "Sylvaë", "Troll", "Priest", "Holy", "Shadow"],
  ["Morvan", "Morvh", "Undead", "Mage", "Frost", "Fire"],
  ["Gorrak", "Gorrak", "Orc", "Warrior", "Fury", "Protection"],
  ["Nyssa", "Nyssaël", "Troll", "Hunter", "Marksmanship", "Survival", ["Nyx", "Rogue", "Combat", ""]],
  ["Orlane", "Vesper", "Undead", "Rogue", "Combat", ""],
  ["Tavish", "Tavish", "Undead", "Warlock", "Affliction", "Destruction"],
  ["Sorcha", "Sorcha", "Troll", "Shaman", "Enhancement DPS", "Restoration"],
  ["Hadrien", "Hadrien", "Undead", "Priest", "Shadow", "Holy"],
  ["Lysandre", "Lysandre", "Troll", "Mage", "Fire", "Frost"],
  ["Elwin", "Elwin", "Tauren", "Druid", "Balance", "Restoration"],
  // Lot D2 : pas encore répondu au raid à 10
  ["Maëlle", "Maëlle", "Troll", "Priest", "Holy", "Discipline"],
  ["Rissa", "Rissa", "Undead", "Warlock", "Demonology", "Affliction"],
];
/** Joueurs sans réponse (lot D2) : Elwin n'a pas lié Discord, Rissa a coupé les messages du bot. */
const SILENT = ["Elwin", "Maëlle", "Rissa"];

function lastVerifyToken() {
  const lines = readFileSync(path.resolve("test-results/api.log"), "utf8").split("\n").filter(l => l.includes(EMAIL) && l.includes("verify-email"));
  return lines.at(-1)?.match(/verify-email#([A-Za-z0-9_-]{20,})/)?.[1] ?? "";
}

test("aperçus des lots D1 et D2", async ({ page }) => {
  test.setTimeout(120_000);
  await page.context().route("**/icons/**", r => r.fulfill({ status: 404, body: "" }));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto("/register");
  await page.fill("#dn", "Thalion");
  await page.fill("#em", EMAIL);
  await page.fill("#pw", PASSWORD);
  await page.fill("#pw2", PASSWORD);
  await page.getByRole("button", { name: /créer/i }).click();
  await expect.poll(lastVerifyToken).not.toBe("");
  await page.goto(`/verify-email#${lastVerifyToken()}`);
  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page.getByRole("heading", { name: "Mes personnages" })).toBeVisible();

  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const me = (await db.query("SELECT id FROM users WHERE email = $1", [EMAIL])).rows[0].id as string;
  await db.query(`INSERT INTO game_items (id, name, quality, item_level, req_level, class_id, subclass_id, inventory_type) VALUES
    (19865, 'Warblade of the Hakkari', 4, 66, 60, 2, 7, 21), (19863, 'Primalist''s Seal', 4, 65, 60, 4, 0, 11) ON CONFLICT DO NOTHING`);
  const group = (await db.query("INSERT INTO groups (name) VALUES ('Les Veilleurs du Crépuscule') RETURNING id")).rows[0].id as string;
  await db.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')", [group, me]);
  type C = { id: string; cls: string; spec: string; user: string; name: string; main: boolean };
  const chars: C[] = [];
  const addChar = async (u: string, name: string, race: string, cls: string, spec: string, off: string, main: boolean) => {
    const id = (await db.query("INSERT INTO characters (user_id, name, race, cls, spec1, spec2, level, professions) VALUES ($1, $2, $3, $4, $5, $6, 60, $7) RETURNING id",
      [u, name, race, cls, spec, off, PROFS])).rows[0].id as string;
    await db.query("INSERT INTO group_characters (group_id, character_id, user_id, is_main) VALUES ($1, $2, $3, $4)", [group, id, u, main]);
    chars.push({ id, cls, spec, user: u, name, main });
    return id;
  };
  await addChar(me, "Thalwen", "Tauren", "Druid", "Feral Bear", "Restoration", true);
  const users = new Map<string, string>();
  for (const [player, name, race, cls, spec, off, alt] of ROSTER) {
    const u = (await db.query("INSERT INTO users (email, email_verified_at, password_hash, display_name) VALUES ($1, now(), 'demo', $2) RETURNING id",
      [`${player.toLowerCase()}@example.test`, player])).rows[0].id as string;
    users.set(player, u);
    if (player !== "Elwin") await db.query("UPDATE users SET discord_id = $2, discord_reminders = $3 WHERE id = $1", [u, String(800000000000000000n + BigInt(users.size)), player !== "Rissa"]);
    await db.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)", [group, u, player === "Brunehilde" ? "officer" : "member"]);
    await addChar(u, name, race, cls, spec, off, true);
    if (alt) await addChar(u, alt[0], "Troll", alt[1], alt[2], alt[3], false);
  }
  const at = (days: number) => { const d = new Date(Date.now() + days * 86400e3); d.setHours(20, 30, 0, 0); return d; };
  const mains = chars.filter(c => c.main);
  const signAll = async (raid: string, status: (c: C) => string) => {
    for (const c of mains) {
      const st = status(c);
      if (st) await db.query("INSERT INTO raid_signups (raid_id, user_id, display_name, character_id, cls, spec, status) VALUES ($1, $2, $3, $4, $5, $6, $7)", [raid, c.user, c.name, c.id, c.cls, c.spec, st]);
    }
  };
  // Deux raids passés, avec banc et bilan
  for (const [days, benched] of [[-14, "Morvh"], [-7, "Lysandre"]] as const) {
    const r = (await db.query("INSERT INTO raids (group_id, name, scheduled_at, size, created_by) VALUES ($1, 'Zul''Gurub', $2, 20, $3) RETURNING id", [group, at(days), me])).rows[0].id as string;
    await signAll(r, c => (c.name === benched ? "bench" : "present"));
    const start = Math.floor(at(days).getTime() / 1000);
    await db.query("INSERT INTO raid_logs (raid_id, recorded_by, recorder, started_at, ended_at, attendees, loot) VALUES ($1, $2, 'Thalwen', to_timestamp($3), to_timestamp($4), $5, $6)",
      [r, me, start, start + 3 * 3600, JSON.stringify(mains.filter(c => c.name !== benched).map(c => ({ name: c.name, first: start, last: start + 3 * 3600, samples: 180 }))),
        JSON.stringify(days === -7 ? [{ itemId: 19865, name: "Gorrak", at: start + 3600, boss: "Hakkar" }] : [{ itemId: 19863, name: "Gorrak", at: start + 1800, boss: "Bloodlord Mandokir" }])]);
  }
  // Raid à 10 de mercredi : 11 inscrits pour 10 places, peu de heals
  const raid = (await db.query("INSERT INTO raids (group_id, name, scheduled_at, size, created_by) VALUES ($1, 'Raid à 10 · nouveau', $2, 10, $3) RETURNING id", [group, at(2), me])).rows[0].id as string;
  await signAll(raid, c => (SILENT.includes(c.name) ? "" : c.name === "Vesper" ? "late" : "present"));
  // Lot D2 : salon Discord lié, une demande déjà envoyée (Brindille, l'alt heal de Brunehilde)
  await db.query("UPDATE groups SET discord_guild_id = '100000000000000001', discord_channel_id = '100000000000000002' WHERE id = $1", [group]);
  await db.query("INSERT INTO raid_asks (raid_id, character_id, user_id, spec, asked_by, asked_by_name, sent_at) VALUES ($1, $2, $3, 'Restoration', $4, 'Thalion', now())",
    [raid, chars.find(c => c.name === "Brindille")!.id, users.get("Brunehilde"), me]);
  const slot = (g: number, p: number, name: string) => ({ group: g, pos: p, characterId: chars.find(c => c.name === name)!.id });
  await db.query("UPDATE raids SET slots = $2 WHERE id = $1", [raid, JSON.stringify([slot(1, 1, "Thalwen"), slot(1, 2, "Sylvaë"), slot(1, 3, "Morvh"), slot(2, 1, "Grumdal"), slot(2, 2, "Vesper")])]);
  await db.end();

  // 1. Page du raid : besoins, propositions, banc
  await page.goto(`/groups/${group}/raids/${raid}`);
  await expect(page.locator(".ra")).toContainText("raid à 10");
  await page.locator(".ra").getByRole("button", { name: "Voir les propositions" }).click();
  await page.evaluate(() => { const r = document.querySelector(".ra")!.getBoundingClientRect(); window.scrollTo(0, r.top + window.scrollY - 90); });
  await page.setViewportSize({ width: 1360, height: 1200 });
  await page.screenshot({ path: `${OUT}/apercu-compo-assistee.png` });
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/apercu-format.png` });

  // 1 bis. Lot D2 : pas encore répondu, relance, demandes ; réglage dans l'Administration
  await page.locator(".ra").screenshot({ path: `${OUT}/apercu-demander.png` });
  await page.getByRole("tab", { name: /Inscriptions/ }).click();
  await expect(page.locator(".rr")).toContainText("Pas encore répondu");
  await page.locator(".rr").screenshot({ path: `${OUT}/apercu-sans-reponse.png` });
  await page.goto(`/groups/${group}/admin`);
  await page.locator(".adm-nav").getByRole("button", { name: "Discord et relances" }).click();
  const dc = page.locator("section[aria-labelledby=dc-title]");
  await expect(dc).toContainText("Relances");
  await dc.screenshot({ path: `${OUT}/apercu-reglage-relances.png` });

  // 2. Fiche joueur
  await page.goto(`/groups/${group}/membres`);
  await page.getByRole("button", { name: "Gorrak" }).click();
  await expect(page.locator(".ps")).toContainText("raids venus");
  await page.locator(".ps").scrollIntoViewIfNeeded();
  await page.locator(".ps").screenshot({ path: `${OUT}/apercu-fiche-joueur.png` });
});

/**
 * Tour de toutes les pages (TOUR=1, après les aperçus) : captures pleine page, bureau et téléphone, pour la revue UX.
 * Sortie : test-results/tour/.
 */
test("tour des pages", async ({ page }) => {
  test.skip(!process.env.TOUR, "tour seulement sur demande (TOUR=1)");
  test.setTimeout(180_000);
  await page.context().route("**/icons/**", r => r.fulfill({ status: 404, body: "" }));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page.getByRole("heading", { name: "Mes personnages" })).toBeVisible();
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const me = (await db.query("SELECT id FROM users WHERE email = $1", [EMAIL])).rows[0].id as string;
  const group = (await db.query("SELECT group_id FROM group_members WHERE user_id = $1", [me])).rows[0].group_id as string;
  const raid = (await db.query("SELECT id FROM raids WHERE group_id = $1 ORDER BY scheduled_at DESC LIMIT 1", [group])).rows[0].id as string;
  // Un alt dans le groupe, un perso sans groupe, et un second groupe
  const g2 = (await db.query("INSERT INTO groups (name) VALUES ('Pick-up du dimanche') RETURNING id")).rows[0].id as string;
  await db.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')", [g2, me]);
  const add = async (name: string, race: string, cls: string, s1: string, s2: string, g: string | null, main: boolean) => {
    const id = (await db.query("INSERT INTO characters (user_id, name, race, cls, spec1, spec2, level, professions) VALUES ($1, $2, $3, $4, $5, $6, 60, $7) RETURNING id",
      [me, name, race, cls, s1, s2, PROFS])).rows[0].id as string;
    if (g) await db.query("INSERT INTO group_characters (group_id, character_id, user_id, is_main) VALUES ($1, $2, $3, $4)", [g, id, me, main]);
    return id;
  };
  await add("Brumelame", "Undead", "Rogue", "Combat", "", group, false);
  await add("Ombrefeu", "Undead", "Warlock", "Destruction", "Affliction", g2, true);
  const thalwen = (await db.query("SELECT id FROM characters WHERE user_id = $1 AND name = 'Thalwen'", [me])).rows[0].id as string;
  await add("Pansoufle", "Tauren", "Druid", "", "", null, false);
  await db.end();

  const OUT_T = path.resolve("test-results/tour");
  const pages: [string, string][] = [
    ["persos", "/persos"], ["perso-profil", `/persos/${thalwen}`], ["perso-metiers", `/persos/${thalwen}/metiers`], ["perso-equipement", `/persos/${thalwen}/equipement`],
    ["perso-notes", `/persos/${thalwen}/notes`], ["groupes", "/groups"], ["groupe-raids", `/groups/${group}`], ["groupe-membres", `/groups/${group}/membres`],
    ["groupe-persos", `/groups/${group}/persos`], ["groupe-artisans", `/groups/${group}/artisans`], ["groupe-presence", `/groups/${group}/presence`],
    ["groupe-admin", `/groups/${group}/admin`], ["raid", `/groups/${group}/raids/${raid}`], ["raid-inscriptions", `/groups/${group}/raids/${raid}/inscriptions`],
    ["raid-butin", `/groups/${group}/raids/${raid}/butin`], ["raid-reglages", `/groups/${group}/raids/${raid}/reglages`], ["compte", "/account"], ["addon", "/addon"],
  ];
  for (const [w, suffix] of [[1360, ""], [390, "-mobile"]] as const) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const [name, url] of pages) {
      if (suffix && !["persos", "groupe-raids", "raid", "groupes"].includes(name)) continue;
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT_T}/${name}${suffix}.png`, fullPage: true });
    }
  }
  // Formulaire « Nouveau raid » et sélecteur de date
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto(`/groups/${group}`);
  await page.getByRole("button", { name: "+ Nouveau raid" }).click();
  await page.fill("#gr-name", "Molten Core");
  await page.locator(".dt-day").nth(2).click();
  await page.locator(".gr-tog").click();
  await page.locator(".gr-form").screenshot({ path: `${OUT_T}/nouveau-raid.png` });
  await page.getByRole("button", { name: "Autre date" }).click();
  await page.locator(".gr-form").screenshot({ path: `${OUT_T}/nouveau-raid-calendrier.png` });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: `${OUT_T}/nouveau-raid-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto(`/groups/${group}/raids/${raid}/reglages`);
  await page.locator("#rw").click();
  await page.screenshot({ path: `${OUT_T}/raid-date.png` });
  await page.goto(`/groups/${group}/membres`);
  await page.locator(".mb-menu summary").first().click();
  await page.screenshot({ path: `${OUT_T}/membres-menu.png` });
});
