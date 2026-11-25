import { expect, test as base, type Page } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Module BiS, lot 2 (24/11) : vue « Objectif BiS » de Mes persos pour un Druide Feral Félin Tauren. Bandeau du toucher
 * (Nature's Reach lu sur les talents relevés), « Proposer la BiS » (aperçu puis valider), provenance sous les objets,
 * classement BiS de la fenêtre de choix, écran des poids avec import Pawn. Objets réels de Forever (base de Flo, 24/11).
 * Captures : SHOTS_DIR=/chemin npx playwright test bis
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
const PROFS = JSON.stringify({ prof1: { name: "Leatherworking", skill: 300 }, prof2: { name: "Skinning", skill: 300 }, cooking: 0, fishing: 0, firstAid: 0 });
const ITEMS_HASH = 0x919be54e;
const shot = async (page: Page, name: string, el?: string) => {
  if (!process.env.SHOTS_DIR) return;
  await (el ? page.locator(el).first() : page).screenshot({ path: path.join(process.env.SHOTS_DIR, name), ...(el ? {} : { fullPage: true }) });
};

test("BiS du Félin : toucher, proposition, classement et poids", async ({ page, context }) => {
  // Compte et session créés en base : la suite entière ne dépasse pas la limite de 20 connexions par quart d'heure
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const email = `tournicoti-${Date.now()}@example.test`;
  const me = (await db.query("INSERT INTO users (email, email_verified_at, password_hash, display_name) VALUES ($1, now(), '$argon2id$v=19$m=19456,t=2,p=1$aW5jb25udQ$aW5jb25udWluY29ubnVpbmNvbm51', 'Tournicoti') RETURNING id", [email])).rows[0].id as string;
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')",
    [me, createHash("sha256").update(token).digest("hex"), randomBytes(32).toString("base64url")]);
  await context.addCookies([{ name: "fr_sid", value: token, url: "http://localhost:4173" }]);

  // Objets réels (stats de Forever), vus en jeu ou non ; Nature's Reach 2/2 relevé par l'addon
  const items = JSON.parse(readFileSync(path.resolve("e2e/fixtures/bis-items.json"), "utf8")) as any[];
  for (const i of items) {
    await db.query(`INSERT INTO game_items (id, name, quality, item_level, req_level, class_id, subclass_id, inventory_type, kind, origin, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'forever', $10) ON CONFLICT (id) DO UPDATE SET details = EXCLUDED.details`,
    [i.id, i.name, i.quality, i.item_level, i.req_level, i.class_id, i.subclass_id, i.inventory_type, i.kind, JSON.stringify(i.details)]);
    if (i.seen) await db.query(`INSERT INTO game_hotfixes (table_hash, row_id, push, data, build) VALUES ($1, $2, 1, '\\x01', 71037) ON CONFLICT DO NOTHING`, [ITEMS_HASH, i.id]);
  }
  await db.query(`INSERT INTO game_talents (id, cls, tree, tier, col, link_index, max_rank, name, spell_id) VALUES (990001, 'Druid', 0, 1, 1, 3, 2, 'Nature''s Reach', 16819)
    ON CONFLICT DO NOTHING`);
  const char = (await db.query(`INSERT INTO characters (user_id, name, race, cls, spec1, spec2, level, professions, gear, talent_nodes)
    VALUES ($1, 'Tournicoti', 'Tauren', 'Druid', 'Feral Cat', 'Feral Bear', 60, $2, $3, $4) RETURNING id`,
  [me, PROFS, JSON.stringify({ Head: { cur: "Mask of the Unforgiven", curId: 13404, q: 3 }, "Trinket 2": { cur: "Hand of Justice", curId: 11815, q: 3 } }),
    JSON.stringify([{ id: 990001, rank: 2, max: 2, x: 0, y: 0, spell: 16819, sub: 0, tree: 0 }])])).rows[0].id as string;
  await db.end();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/persos/${char}/equipement`);
  await page.getByRole("button", { name: "Objectif BiS" }).click();

  // Bandeau : 4 % de talents, cap de 8 % contre un boss de raid
  const bar = page.getByRole("group", { name: "BiS : toucher et réglages" });
  await expect(bar).toContainText("4 % / 8 %");
  await expect(bar).toContainText("Nature's Reach 2/2");
  await expect(bar).toContainText("il manque 4 %");

  // Proposer la BiS : aperçu, puis Appliquer
  await page.getByRole("button", { name: "Proposer la BiS" }).click();
  const dlg = page.getByRole("dialog", { name: "Proposer la BiS" });
  await expect(dlg).toContainText("Feralheart Cap");
  await expect(dlg).toContainText("Timbermaw Tunic");
  await expect(dlg).not.toContainText("Guise of the Devourer"); // jamais vu, sans provenance
  await expect(dlg).not.toContainText("Marshal's Leather Leggings"); // Alliance
  await shot(page, "bis-proposer.png", "dialog");
  await dlg.getByRole("button", { name: /^Appliquer \d+ changements$/ }).click();
  await expect(dlg).toHaveCount(0);

  // Sous les objets : provenance, toucher, enchantement
  await expect(page.locator(".gslot[data-slot='Back']")).toContainText("Stratholme · Baron Rivendare");
  await expect(page.locator(".gslot[data-slot='Legs']")).toContainText("JcJ · rang 12");
  await expect(page.locator(".gslot[data-slot='Wrist']")).toContainText("✦ Agilité supérieure (+9)");
  await expect(bar).toContainText("Objectif BiS");
  // Set de donjon (Tier 0.5) : provenance de la quête, bonus par bonus au milieu
  await expect(page.locator(".gslot[data-slot='Head']")).toContainText("Feralheart Cap");
  await expect(page.locator(".gslot[data-slot='Head']")).toContainText("◆ Feralheart 1/8");
  await expect(page.locator(".gslot[data-slot='Head']")).toContainText("Saving the Best for Last");
  await expect(page.locator(".portrait")).toContainText("Ton équipement actuel");
  await expect(page.locator(".portrait")).toContainText("+40 Attack Power.encore 5 pièces+40");

  // Bijou 2 sans objectif : l'objet porté en pointillés, « En faire l'objectif »
  const t2 = page.locator(".gslot[data-slot='Trinket 2']");
  await expect(t2).toHaveClass(/nogoal/);
  await expect(t2).toContainText("pas d'objectif");
  await shot(page, "bis-fiche.png");
  await page.locator(".gwrap", { has: t2 }).getByRole("button", { name: "En faire l'objectif" }).click();
  await expect(t2).not.toHaveClass(/nogoal/);
  await expect(t2).toContainText("Hand of Justice");

  // Section à part : les objets à effet, utiles au Félin d'abord
  const fx = page.getByRole("region", { name: "Objets à effet" });
  await expect(fx.getByRole("button", { name: /^Utiles au Félin/ })).toHaveAttribute("aria-pressed", "true");
  await expect(fx).toContainText("Hand of Justice");
  await expect(fx).toContainText("sans l'effet");
  await shot(page, "bis-effets.png", ".bis-fx");

  // Fenêtre de choix : classement BiS par défaut, objets à effet à part
  await page.locator(".gslot[data-slot='Head']").click();
  const chooser = page.getByRole("dialog");
  await expect(chooser.getByRole("button", { name: "Classement BiS" })).toHaveAttribute("aria-pressed", "true");
  await expect(chooser.locator(".ic-row.bis").first()).toContainText("1. ");
  await expect(chooser.getByText("À effet · non chiffré")).toBeVisible();
  await expect(chooser).toContainText("Brewmancer Nightcap");
  await expect(chooser).toContainText("Feralheart Cap");
  await shot(page, "bis-classement.png", "dialog");
  await page.keyboard.press("Escape");

  // Poids : import d'une chaîne Pawn, puis enregistrement
  await bar.getByRole("button", { name: /Poids : défaut/ }).click();
  const wd = page.getByRole("dialog", { name: /Poids/ });
  await wd.getByLabel("Importer depuis un site de simulation").fill('( Pawn: v1: "Feral sim": Class=Druid, Strength=2.2, Agility=2.1, HitPercent=19.5 )');
  await wd.getByRole("button", { name: "Importer" }).click();
  await expect(wd.getByRole("status")).toContainText("3 caractéristiques reconnues");
  await wd.getByRole("button", { name: "Enregistrer mes poids" }).click();
  await expect(wd.getByRole("status")).toContainText("Poids enregistrés");
  await shot(page, "bis-poids.png", "dialog");
  await page.keyboard.press("Escape");
  await expect(bar.getByRole("button", { name: /Poids : les miens/ })).toBeVisible();

  // Téléphone : rien ne déborde
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, "bis-mobile.png");
});

// Les autres tests partagent la base : on retire les objets ajoutés ici (ils changeraient la liste des objets de la Tête)
test.afterAll(async () => {
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const ids = (JSON.parse(readFileSync(path.resolve("e2e/fixtures/bis-items.json"), "utf8")) as { id: number }[]).map(i => i.id);
  await db.query("DELETE FROM game_hotfixes WHERE table_hash = $1 AND row_id = ANY($2::int[])", [ITEMS_HASH, ids]);
  await db.query("DELETE FROM game_items WHERE id = ANY($1::int[]) AND NOT EXISTS (SELECT 1 FROM game_recipes WHERE created_item_id = game_items.id)", [ids]);
  await db.query("DELETE FROM game_talents WHERE id = 990001");
  await db.end();
});
