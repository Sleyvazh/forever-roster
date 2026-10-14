import { expect, test } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Captures d'écran de Roster (WoW Retail) : docs/screenshots/roster et l'image héros de l'accueil public
 * (apps/web/public/landing/img/retail.webp), avec des données fictives (aucun vrai pseudo ni adresse).
 * Lancement : CAPTURES=1 npx playwright test e2e/captures-roster.spec.ts (base e2e vide, site construit).
 */
test.skip(!process.env.CAPTURES, "captures seulement sur demande (CAPTURES=1)");

/** Adresse Roster en test (e2e/start.mjs : RETAIL_ORIGIN), à côté de Forever Roster sur localhost. */
const RETAIL = "http://127.0.0.1:4173";
const OUT = path.resolve("docs/screenshots/roster");
const HERO = path.resolve("apps/web/public/landing/img/retail.webp");
const EMAIL = "ysaline@example.test", PASSWORD = "une phrase de passe pour la démo de Roster";
const DB = process.env.DATABASE_URL_E2E ?? "postgres://forever:forever@localhost:5432/forever_e2e";

type Status = "present" | "late" | "tentative" | "absent" | "";
/** Joueurs et persos fictifs : [joueur, perso, royaume, classe, spé, off-spec, niveau d'objet, inscription, note]. */
const ROSTER: [string, string, string, string, string, string, number, Status, string?][] = [
  ["Brannoc", "Brannoc", "Norva", "Death Knight", "Blood", "Unholy", 718, "present"],
  ["Vaelora", "Vaelora", "Norva", "Demon Hunter", "Vengeance", "Havoc", 716, "present"],
  ["Tiamel", "Tiamel", "Sombreval", "Evoker", "Preservation", "Devastation", 711, "present"],
  ["Orenn", "Orenn", "Brumeval", "Monk", "Mistweaver", "Windwalker", 709, "present"],
  ["Séverine", "Aldarion", "Brumeval", "Paladin", "Holy", "Retribution", 713, "present"],
  ["Kerwan", "Kerwan", "Brumeval", "Warrior", "Fury", "Protection", 715, "present"],
  ["Lioré", "Lioré", "Sombreval", "Mage", "Frost", "Arcane", 717, "present"],
  ["Gwenaël", "Nocthys", "Brumeval", "Warlock", "Destruction", "Affliction", 712, "present"],
  ["Ilyss", "Ilyss", "Brumeval", "Hunter", "Marksmanship", "Beast Mastery", 710, "present"],
  ["Rhoswen", "Rhoswen", "Sombreval", "Rogue", "Assassination", "Outlaw", 714, "tentative", "garde d'enfants à confirmer"],
  ["Darsk", "Darsk", "Norva", "Demon Hunter", "Havoc", "", 706, "late", "j'arrive vers 20 h 45"],
  ["Mirabel", "Mirabel", "Sombreval", "Evoker", "Augmentation", "Devastation", 705, "tentative"],
  ["Elowen", "Elowen", "Brumeval", "Druid", "Balance", "Restoration", 711, "absent", "déplacement pro"],
  ["Thorvald", "Thorvald", "Brumeval", "Shaman", "Elemental", "Restoration", 708, ""],
];
const OFFICERS = ["Brannoc", "Séverine"];

function lastVerifyToken() {
  const lines = readFileSync(path.resolve("test-results/api.log"), "utf8").split("\n").filter(l => l.includes(EMAIL) && l.includes("verify-email"));
  return lines.at(-1)?.match(/verify-email#([A-Za-z0-9_-]{20,})/)?.[1] ?? "";
}

test("captures d'écran de Roster (WoW Retail)", async ({ page }) => {
  test.setTimeout(120_000);
  // Icônes (Blizzard, Pahpool) : jamais dans le dépôt, donc absentes des captures (repli du site)
  await page.context().route("**/icons/**", r => r.fulfill({ status: 404, body: "" }));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1360, height: 900 });

  // Compte de démonstration, créé sur l'adresse Roster
  await page.goto(`${RETAIL}/register`);
  await page.fill("#dn", "Ysaline");
  await page.fill("#em", EMAIL);
  await page.fill("#pw", PASSWORD);
  await page.fill("#pw2", PASSWORD);
  await page.getByRole("button", { name: /créer/i }).click();
  await expect.poll(lastVerifyToken).not.toBe("");
  await page.goto(`${RETAIL}/verify-email#${lastVerifyToken()}`);
  await expect(page.getByText("Adresse confirmée")).toBeVisible();
  await page.goto(`${RETAIL}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await expect(page.getByRole("heading", { name: "Mes personnages" })).toBeVisible();

  // Mon perso, créé à la main avec le formulaire de Roster (royaume obligatoire)
  await page.fill("#rcn-name", "Ysaline");
  await page.fill("#rcn-realm", "Brumeval");
  await page.selectOption("#rcn-cls", "Priest");
  await page.selectOption("#rcn-spec", "Holy");
  await page.getByRole("button", { name: "Créer le perso" }).click();
  await expect(page.getByRole("region", { name: "Fiche de Ysaline" })).toContainText("Prêtre");

  // La guilde, créée depuis la page Groupes (groupe de Roster)
  await page.goto(`${RETAIL}/groups`);
  await page.fill("#g-name", "Les Veilleurs d'Azeroth");
  await page.getByRole("button", { name: "Créer" }).click();
  await expect(page.getByRole("tab", { name: "Personnages" })).toBeVisible();
  const group = page.url().match(/\/groups\/([0-9a-f-]{36})/)![1]!;

  // Le reste des données fictives, inséré directement en base (comme pour les captures de Forever Roster)
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const me = (await db.query("SELECT id FROM users WHERE email = $1", [EMAIL])).rows[0].id as string;
  const mine = (await db.query("UPDATE characters SET spec2 = 'Shadow', ilvl = 714 WHERE user_id = $1 AND name = 'Ysaline' RETURNING id", [me])).rows[0].id as string;
  await db.query("INSERT INTO group_characters (group_id, character_id, user_id, is_main) VALUES ($1, $2, $3, true)", [group, mine, me]);
  type C = { id: string; user: string; name: string; cls: string; spec: string; status: Status; note: string };
  const chars: C[] = [{ id: mine, user: me, name: "Ysaline", cls: "Priest", spec: "Holy", status: "", note: "" }];
  for (const [player, name, realm, cls, spec, off, ilvl, status, note] of ROSTER) {
    const u = (await db.query("INSERT INTO users (email, email_verified_at, password_hash, display_name) VALUES ($1, now(), 'demo', $2) RETURNING id",
      [`${player.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}@example.test`, player])).rows[0].id as string;
    await db.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)", [group, u, OFFICERS.includes(player) ? "officer" : "member"]);
    const c = (await db.query("INSERT INTO characters (user_id, game, name, realm, cls, spec1, spec2, level, ilvl) VALUES ($1, 'retail', $2, $3, $4, $5, $6, 90, $7) RETURNING id",
      [u, name, realm, cls, spec, off, ilvl])).rows[0].id as string;
    await db.query("INSERT INTO group_characters (group_id, character_id, user_id, is_main) VALUES ($1, $2, $3, true)", [group, c, u]);
    chars.push({ id: c, user: u, name, cls, spec, status, note: note ?? "" });
  }
  // Raid Héroïque de Midnight à 20, conseil du butin, compo commencée (2 tanks, 3 heals, 5 DPS)
  const when = new Date(Date.now() + 3 * 86400e3); when.setHours(20, 30, 0, 0);
  const idOf = (name: string) => chars.find(c => c.name === name)!.id;
  const layout = [["Brannoc", "Ysaline", "Kerwan", "Lioré", "Darsk"], ["Vaelora", "Tiamel", "Orenn", "Nocthys", "Ilyss"]];
  const slots = layout.flatMap((g, gi) => g.map((n, pi) => ({ group: gi + 1, pos: pi + 1, characterId: idOf(n) })));
  const raid = (await db.query(`INSERT INTO raids (group_id, name, scheduled_at, slots, description, created_by, size, difficulty, loot_mode)
     VALUES ($1, 'L''Abîme Venimeux', $2, $3, $4, $5, 20, 'heroic', 'council') RETURNING id`,
    [group, when, JSON.stringify(slots), "Invitations à 20 h 15, premier pull à 20 h 30. Conseil du butin avec l'addon Roster : réponds BiS, Upgrade ou Off-Spec.", me])).rows[0].id as string;
  for (const c of chars) {
    if (!c.status) continue;
    await db.query("INSERT INTO raid_signups (raid_id, user_id, display_name, character_id, cls, spec, status, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [raid, c.user, ROSTER.find(r => r[1] === c.name)![0], c.id, c.cls, c.status === "absent" ? "" : c.spec, c.status, c.note]);
  }
  await db.end();

  // Mon inscription, depuis la page du raid
  const raidUrl = `${RETAIL}/groups/${group}/raids/${raid}`;
  await page.goto(`${raidUrl}/inscriptions`);
  await expect(page.getByRole("heading", { name: "L'Abîme Venimeux" })).toBeVisible();
  await page.selectOption("#su-spec", "Holy");
  await page.getByRole("group", { name: "Mon statut" }).getByRole("button", { name: "Présent" }).click();
  await expect(page.getByText("Tu es inscrit : Présent avec Ysaline (Sacré)")).toBeVisible();
  await expect(page.locator(".su-roles")).toContainText("Darsk");

  // Image héros de l'accueil public (1200 × 800) : les inscriptions rangées par rôle
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.mouse.move(0, 0);
  const { default: sharp } = await import("sharp");
  await sharp(await page.screenshot()).webp({ quality: 82 }).toFile(HERO);
  const meta = await sharp(HERO).metadata();
  expect([meta.width, meta.height]).toEqual([1200, 800]);
  expect(statSync(HERO).size).toBeLessThan(120_000);

  // 1. Inscriptions par rôle (avec les « peut-être » et les absents sous les colonnes)
  await page.setViewportSize({ width: 1360, height: 960 });
  await page.screenshot({ path: `${OUT}/01-inscriptions.png` });

  // 2. Compo : besoins par rôle, groupes, banc et couverture des buffs de Midnight
  await page.goto(raidUrl);
  await expect(page.getByRole("tab", { name: "Compo" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".rgroup")).toHaveCount(4);
  // Carte d'un joueur au survol (à droite de la place, sur des places libres du groupe 3)
  await page.getByRole("button", { name: /Groupe 2, place 4 : Nocthys/ }).hover();
  await expect(page.locator(".itip")).toBeVisible();
  await page.screenshot({ path: `${OUT}/02-compo.png` });
  await page.mouse.move(0, 0);

  // 3. Persos du groupe : classe, royaume, niveau d'objet, spés et joueur
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto(`${RETAIL}/groups/${group}/persos`);
  await expect(page.locator(".glist .grow")).toHaveCount(15);
  await page.screenshot({ path: `${OUT}/03-persos.png`, fullPage: true });

  // 4. Butin : conseil (distribution par l'addon Roster) et choix du conseil (page courte : fenêtre moins haute)
  await page.setViewportSize({ width: 1360, height: 740 });
  await page.goto(`${raidUrl}/butin`);
  await expect(page.getByRole("region", { name: "Conseil du butin" })).toContainText("Par défaut : les officiers du groupe.");
  await page.screenshot({ path: `${OUT}/04-butin.png` });
});
