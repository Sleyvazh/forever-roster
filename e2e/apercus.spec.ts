import { expect, test, type Page } from "@playwright/test";
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

/** ICONES_ROLES=1 : dessins provisoires à la place des icônes de rôle du jeu (absentes ici), pour voir leur place. */
async function roleIcons(page: Page) {
  if (!process.env.ICONES_ROLES) return;
  const svg = (body: string, c: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="#1b2340" stroke="${c}" stroke-width="4"/>${body}</svg>`;
  const files: Record<string, string> = {
    tank: svg('<path d="M32 14l14 6v10c0 10-6 17-14 20-8-3-14-10-14-20V20z" fill="#5f95ff"/>', "#5f95ff"),
    heal: svg('<path d="M27 16h10v11h11v10H37v11H27V37H16V27h11z" fill="#4fd35f"/>', "#4fd35f"),
    dps: svg('<path d="M17 43l19-19 4 4-19 19zM38 16h10v10l-5 5-10-10z" fill="#ff5a4d"/>', "#ff5a4d"),
  };
  await page.route("**/icons/roles/*.png", r => r.fulfill({ status: 200, contentType: "image/svg+xml", body: files[/roles\/(\w+)\.png/.exec(r.request().url())?.[1] ?? ""] ?? "" }));
}

test("aperçus des lots D1 et D2", async ({ page }) => {
  test.setTimeout(120_000);
  await page.context().route("**/icons/**", r => r.fulfill({ status: 404, body: "" }));
  await roleIcons(page);
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
 * Aperçus du lot F (après ceux des lots D1 et D2, mêmes données) : commandes d'artisanat, absences déclarées,
 * présence dans Membres, salon des commandes, ligne de synchro et choix des parties à l'import.
 */
test("aperçus du lot F", async ({ page }) => {
  test.setTimeout(120_000);
  await page.context().route("**/icons/**", r => r.fulfill({ status: 404, body: "" }));
  await roleIcons(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1360, height: 900 });
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const me = (await db.query("SELECT id FROM users WHERE email = $1", [EMAIL])).rows[0].id as string;
  const group = (await db.query("SELECT group_id FROM group_members WHERE user_id = $1 ORDER BY joined_at LIMIT 1", [me])).rows[0].group_id as string;
  const user = async (name: string) => (await db.query("SELECT id FROM users WHERE display_name = $1", [name])).rows[0].id as string;
  const char = async (name: string) => (await db.query("SELECT id FROM characters WHERE name = $1", [name])).rows[0].id as string;
  await db.query("UPDATE users SET discord_id = '800000000000000099', discord_username = 'thalion' WHERE id = $1", [me]);
  // Objets et recettes (noms du jeu), artisans du groupe
  await db.query(`INSERT INTO game_items (id, name, quality, item_level, req_level, class_id, subclass_id, inventory_type) VALUES
    (18263, 'Flarecore Wraps', 4, 66, 60, 4, 1, 9), (14342, 'Mooncloth', 2, 50, 0, 7, 0, 0), (17010, 'Fiery Core', 3, 60, 0, 7, 0, 0), (14227, 'Ironweb Spider Silk', 1, 50, 0, 7, 0, 0),
    (13510, 'Flask of the Titans', 1, 60, 50, 0, 0, 0), (8846, 'Gromsblood', 1, 47, 0, 7, 0, 0), (13423, 'Stonescale Oil', 1, 50, 0, 7, 0, 0), (13468, 'Black Lotus', 2, 60, 0, 7, 0, 0), (8925, 'Crystal Vial', 1, 50, 0, 7, 0, 0),
    (13446, 'Major Healing Potion', 1, 55, 45, 0, 0, 0), (13464, 'Golden Sansam', 1, 52, 0, 7, 0, 0), (13465, 'Mountain Silversage', 1, 54, 0, 7, 0, 0),
    (14152, 'Robe of the Archmage', 4, 62, 57, 4, 1, 20) ON CONFLICT DO NOTHING`);
  await db.query(`INSERT INTO game_recipes (spell_id, skill_line, name, req_skill, trivial_low, trivial_high, created_item_id, reagents) VALUES
    (23666, 197, 'Flarecore Wraps', 300, 300, 320, 18263, '[{"id":14342,"n":4},{"id":17010,"n":2},{"id":14227,"n":2}]'),
    (17635, 171, 'Flask of the Titans', 300, 300, 315, 13510, '[{"id":8846,"n":30},{"id":13423,"n":10},{"id":13468,"n":1},{"id":8925,"n":1}]'),
    (17556, 171, 'Major Healing Potion', 275, 275, 295, 13446, '[{"id":13464,"n":2},{"id":13465,"n":1},{"id":8925,"n":1}]'),
    (18457, 197, 'Robe of the Archmage', 300, 300, 315, 14152, '[]') ON CONFLICT DO NOTHING`);
  const prof = (name: string) => JSON.stringify({ prof1: { name, skill: 300 }, prof2: { name: "", skill: 0 }, cooking: 0, fishing: 0, firstAid: 0 });
  for (const [c, p, spells] of [["Sylvaë", "Tailoring", [23666]], ["Tavish", "Alchemy", [17635, 17556]], ["Hadrien", "Alchemy", [17556]]] as const) {
    const id = await char(c);
    await db.query("UPDATE characters SET professions = $2 WHERE id = $1", [id, prof(p)]);
    for (const s of spells) await db.query("INSERT INTO character_recipes (character_id, spell_id, status) VALUES ($1, $2, 'known') ON CONFLICT DO NOTHING", [id, s]);
  }
  // Commandes : ouverte (composants en partie fournis), prise, faite, sans artisan
  const reag = (list: [number, string, number, boolean][]) => JSON.stringify(list.map(([itemId, name, n, provided]) => ({ itemId, name, n, provided })));
  const order = (spell: number, recipe: string, item: number, qty: number, by: string, ch: string | null, reagents: string, note: string, status: string, taker: string | null, ago: number) =>
    db.query(`INSERT INTO craft_orders (group_id, spell_id, recipe_name, item_id, item_name, quantity, requester_id, character_id, reagents, note, status, taker_id, created_at, taken_at, done_at)
      VALUES ($1, $2, $3, $4, $3, $5, $6, $7, $8, $9, $10, $11, now() - make_interval(hours => $12), CASE WHEN $11::uuid IS NULL THEN NULL ELSE now() - make_interval(hours => $12 - 1) END, CASE WHEN $10 = 'done' THEN now() - interval '2 hours' END)`,
      [group, spell, recipe, item, qty, by, ch, reagents, note, status, taker, ago]);
  await order(23666, "Flarecore Wraps", 18263, 1, await user("Gorrak"), await char("Gorrak"), reag([[14342, "Mooncloth", 4, true], [17010, "Fiery Core", 2, false], [14227, "Ironweb Spider Silk", 2, true]]),
    "Il me manque les Fiery Core, je rembourse à la prochaine MC.", "open", null, 3);
  await order(18457, "Robe of the Archmage", 14152, 1, await user("Morvan"), await char("Morvh"), "[]", "", "open", null, 20);
  await order(17635, "Flask of the Titans", 13510, 2, me, await char("Thalwen"), reag([[8846, "Gromsblood", 60, true], [13423, "Stonescale Oil", 20, true], [13468, "Black Lotus", 2, false], [8925, "Crystal Vial", 2, true]]),
    "Pour mercredi si possible.", "taken", await user("Tavish"), 26);
  await order(17556, "Major Healing Potion", 13446, 10, await user("Orlane"), await char("Vesper"), reag([[13464, "Golden Sansam", 20, true], [13465, "Mountain Silversage", 10, true], [8925, "Crystal Vial", 10, true]]),
    "", "done", await user("Hadrien"), 50);
  // Absence de Gorrak (motif visible du groupe) ; persos synchronisés ou non
  await db.query("INSERT INTO absences (user_id, start_date, end_date, weekdays, reason, reason_visibility) VALUES ($1, (now() AT TIME ZONE 'Europe/Paris')::date + 5, (now() AT TIME ZONE 'Europe/Paris')::date + 9, '[]', 'Déménagement', 'group')",
    [await user("Gorrak")]);
  await db.query("UPDATE characters SET addon_synced_at = now() - interval '3 hours' WHERE name NOT IN ('Morvh', 'Tavish', 'Hadrien')");
  // Présence variée : Rissa manque les deux raids relevés, Elwin et Maëlle le premier
  await db.query(`UPDATE raid_logs l SET attendees = (SELECT coalesce(jsonb_agg(a), '[]') FROM jsonb_array_elements(l.attendees) a
    WHERE a->>'name' <> 'Rissa' AND (a->>'name' NOT IN ('Elwin', 'Maëlle') OR l.started_at > now() - interval '10 days'))
    WHERE raid_id IN (SELECT id FROM raids WHERE group_id = $1)`, [group]);
  const thalwen = await char("Thalwen");
  await db.end();

  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page.getByRole("heading", { name: "Mes personnages" })).toBeVisible();

  // 1. Onglet Artisans : commandes en cours, composants dépliés
  await page.goto(`/groups/${group}/artisans`);
  const co = page.locator("section.co");
  await expect(co).toContainText("Flarecore Wraps");
  await co.locator(".co-reag-sum").first().click();
  await co.screenshot({ path: `${OUT}/apercu-commandes.png` });
  // 2. Nouvelle commande : recherche, recette choisie, composants à cocher
  await co.getByRole("button", { name: "+ Demander une fabrication" }).click();
  await page.fill("#co-q", "titans");
  await co.locator(".co-hits button").first().click();
  await co.locator(".co-reagpick label").first().click();
  await co.locator(".co-form").screenshot({ path: `${OUT}/apercu-nouvelle-commande.png` });

  // 3. Mes absences : formulaire « chaque semaine », puis la liste
  await page.goto("/persos");
  await page.getByRole("button", { name: "+ Déclarer une absence" }).click();
  await page.getByRole("button", { name: "Chaque semaine" }).click();
  await page.getByRole("button", { name: "ven." }).click();
  await page.fill("#ab-why", "Soirée jeux de société");
  await page.selectOption("#ab-vis", "group");
  await page.locator("section.ab").screenshot({ path: `${OUT}/apercu-absence-formulaire.png` });
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("section.ab")).toContainText("chaque vendredi");
  await page.getByRole("button", { name: "+ Déclarer une absence" }).click();
  await page.getByRole("button", { name: "Une période" }).click();
  await page.locator("#ab-from").click();
  await page.getByRole("button", { name: "Mois suivant" }).click();
  await page.getByRole("button", { name: "9", exact: true }).click();
  await page.locator("#ab-to").click();
  await page.getByRole("button", { name: "15", exact: true }).click();
  await page.fill("#ab-why", "Vacances");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("section.ab .ab-chip")).toHaveCount(2);
  await page.locator("section.ab").screenshot({ path: `${OUT}/apercu-absences.png` });

  // 4. Membres : colonne Présence ; fiche joueur avec son absence
  await page.goto(`/groups/${group}/membres`);
  await expect(page.locator("table.data")).toContainText("Présence");
  await page.locator("table.data").screenshot({ path: `${OUT}/apercu-membres-presence.png` });
  await page.getByRole("button", { name: "Gorrak" }).click();
  await expect(page.locator(".ps")).toContainText("Déménagement");
  await page.locator(".ps").screenshot({ path: `${OUT}/apercu-fiche-absence.png` });

  // 5. Administration : salon des commandes
  await page.goto(`/groups/${group}/admin`);
  await page.locator(".adm-nav").getByRole("button", { name: "Discord et relances" }).click();
  const oc = page.locator("section[aria-labelledby=oc-title]");
  await oc.getByRole("button", { name: "Générer un code de liaison" }).click();
  await expect(oc.getByRole("textbox")).toHaveValue(/forever-lier code:/);
  await oc.screenshot({ path: `${OUT}/apercu-salon-commandes.png` });

  // 6. Fiche perso : ligne de synchro, puis Ctrl+V avec le choix des parties
  await page.goto(`/persos/${thalwen}`);
  await expect(page.locator(".ce-sync")).toBeVisible();
  await page.locator(".ce-sync").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/apercu-ligne-synchro.png` });
  await page.evaluate(text => {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    (document.activeElement as HTMLElement | null)?.blur();
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  }, readFileSync(path.resolve("addon/tests/sample.frc"), "utf8"));
  const pasted = page.getByRole("dialog", { name: "Export de l'addon" });
  await pasted.getByText("Choisir quoi importer").click();
  await pasted.screenshot({ path: `${OUT}/apercu-import-choix.png` });
});

/** Aperçus du lot G (mêmes données) : onglet Préparation (consommables, qui est prêt, fiches de boss), conseil du butin. */
test("aperçus du lot G", async ({ page }) => {
  test.setTimeout(120_000);
  await page.context().route("**/icons/**", r => r.fulfill({ status: 404, body: "" }));
  await roleIcons(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1360, height: 900 });
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const me = (await db.query("SELECT id FROM users WHERE email = $1", [EMAIL])).rows[0].id as string;
  const group = (await db.query("SELECT group_id FROM group_members WHERE user_id = $1 ORDER BY joined_at LIMIT 1", [me])).rows[0].group_id as string;
  const char = async (name: string) => (await db.query("SELECT id, user_id, cls, spec1 FROM characters WHERE name = $1", [name])).rows[0] as { id: string; user_id: string; cls: string; spec1: string };
  await db.query(`INSERT INTO game_items (id, name, quality, item_level, req_level, class_id, subclass_id, inventory_type) VALUES
    (13457, 'Greater Fire Protection Potion', 1, 48, 38, 0, 0, 0), (13446, 'Major Healing Potion', 1, 55, 45, 0, 0, 0), (13510, 'Flask of the Titans', 1, 60, 50, 0, 0, 0),
    (13444, 'Major Mana Potion', 1, 59, 49, 0, 0, 0), (13452, 'Elixir of the Mongoose', 1, 56, 46, 0, 0, 0) ON CONFLICT DO NOTHING`);
  const names = ["Thalwen", "Grumdal", "Sylvaë", "Hadrien", "Gorrak", "Vesper", "Nyssaël", "Tavish", "Morvh"];
  const chars = Object.fromEntries(await Promise.all(names.map(async n => [n, await char(n)] as const)));
  const prep = {
    instance: "mc",
    consumables: [
      { itemId: 13457, name: "Greater Fire Protection Potion", n: 5, for: "all" }, { itemId: 13446, name: "Major Healing Potion", n: 5, for: "all" },
      { itemId: 13510, name: "Flask of the Titans", n: 1, for: "tank" }, { itemId: 13444, name: "Major Mana Potion", n: 10, for: "heal" },
      { itemId: 13452, name: "Elixir of the Mongoose", n: 2, for: "melee" },
    ],
    bosses: [
      { name: "Lucifron", encounterId: 663, npcIds: [12118], rows: [{ label: "Tank principal", characterIds: [chars.Grumdal!.id], text: "" }, { label: "Décurse", characterIds: [chars.Morvh!.id], text: "" }] },
      { name: "Magmadar", encounterId: 664, npcIds: [11982], rows: [{ label: "Tranquillisant", characterIds: [chars.Nyssaël!.id], text: "" }, { label: "Consigne", characterIds: [], text: "Tremor Totem près des tanks" }] },
      { name: "Ragnaros", encounterId: 672, npcIds: [11502], rows: [
        { label: "Tank principal", characterIds: [chars.Grumdal!.id], text: "" }, { label: "Tank de relève", characterIds: [chars.Thalwen!.id], text: "" },
        { label: "Soins des tanks", characterIds: [chars.Sylvaë!.id, chars.Hadrien!.id], text: "" },
        { label: "Fils de la flamme", characterIds: [], text: "Groupes 3 et 4, côté gauche" }, { label: "Consigne", characterIds: [], text: "Corps à corps dehors à chaque Wrath of Ragnaros" }] },
    ],
  };
  const at = new Date(Date.now() + 3 * 86400e3); at.setHours(20, 30, 0, 0);
  const raid = (await db.query("INSERT INTO raids (group_id, name, scheduled_at, size, created_by, loot_mode, prep) VALUES ($1, 'Molten Core', $2, 40, $3, 'council', $4) RETURNING id",
    [group, at, me, JSON.stringify(prep)])).rows[0].id as string;
  const counts: Record<string, [Record<number, number>, number] | null> = {
    Thalwen: [{ 13457: 5, 13446: 3, 13510: 0 }, 1], Grumdal: [{ 13457: 8, 13446: 12, 13510: 2 }, 3], Sylvaë: [{ 13457: 6, 13446: 5, 13444: 14 }, 2],
    Hadrien: [{ 13457: 5, 13446: 7, 13444: 4 }, 3], Gorrak: [{ 13457: 10, 13446: 9, 13452: 4 }, 1], Vesper: [{ 13457: 2, 13446: 6, 13452: 3 }, 50],
    Nyssaël: [{ 13457: 5, 13446: 5 }, 4], Tavish: null, Morvh: [{ 13457: 5, 13446: 6 }, 2],
  };
  for (const n of names) {
    const c = chars[n]!;
    await db.query("INSERT INTO raid_signups (raid_id, user_id, display_name, character_id, cls, spec, status) VALUES ($1, $2, $3, $4, $5, $6, 'present')", [raid, c.user_id, n, c.id, c.cls, c.spec1]);
    const k = counts[n];
    await db.query("UPDATE characters SET consumables = $2, consumables_at = $3 WHERE id = $1", [c.id, JSON.stringify(k ? k[0] : {}), k ? new Date(Date.now() - k[1] * 3600e3) : null]);
  }
  await db.end();

  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page.getByRole("heading", { name: "Mes personnages" })).toBeVisible();

  await page.goto(`/groups/${group}/raids/${raid}/preparation`);
  const cons = page.locator("section[aria-labelledby=pr-cons]");
  await expect(cons).toContainText("Qui est prêt");
  await cons.screenshot({ path: `${OUT}/apercu-consommables.png` });
  const boss = page.locator("section[aria-labelledby=pr-boss]");
  await boss.getByRole("tab", { name: /^Ragnaros/ }).click();
  await expect(boss.locator(".pr-arow")).toHaveCount(5);
  await boss.screenshot({ path: `${OUT}/apercu-fiches-boss.png` });
  await page.goto(`/groups/${group}/raids/${raid}/butin`);
  const council = page.locator("section[aria-labelledby=pr-council]");
  await expect(council).toContainText("Conseil du butin");
  await council.screenshot({ path: `${OUT}/apercu-conseil.png` });
  // Téléphone : onglet Préparation
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/groups/${group}/raids/${raid}/preparation`);
  await expect(boss).toBeVisible();
  await page.screenshot({ path: `${OUT}/apercu-preparation-mobile.png`, fullPage: true });
});

/**
 * Tour de toutes les pages (TOUR=1, après les aperçus) : captures pleine page, bureau et téléphone, pour la revue UX.
 * Sortie : test-results/tour/.
 */
test("tour des pages", async ({ page }) => {
  test.skip(!process.env.TOUR, "tour seulement sur demande (TOUR=1)");
  test.setTimeout(180_000);
  await page.context().route("**/icons/**", r => r.fulfill({ status: 404, body: "" }));
  await roleIcons(page);
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
