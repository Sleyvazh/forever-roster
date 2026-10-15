import { expect, test as base, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Sorties donjon (Forever) : créer une sortie avec « + Sortie », s'inscrire d'un clic, liste d'attente et place libérée.
 * Les autres joueurs sont écrits directement en base ; les sorties sont pour demain (le test passe à toute heure).
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
const PASSWORD = "une phrase de passe pour les sorties";
const PROFS = JSON.stringify({ prof1: { name: "", skill: 0 }, prof2: { name: "", skill: 0 }, cooking: 0, fishing: 0, firstAid: 0 });
const lastVerifyToken = (email: string) => readFileSync(path.resolve("test-results/api.log"), "utf8").split("\n")
  .filter(l => l.includes(email) && l.includes("verify-email")).at(-1)?.match(/verify-email#([A-Za-z0-9_-]{20,})/)?.[1] ?? "";
/** Demain (heure de Paris) : « AAAA-MM-JJ » et l'instant d'une heure ce jour-là. */
function tomorrow(time: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 86400e3));
  const [h, m] = time.split(":").map(Number) as [number, number];
  // Décalage de Paris ce jour-là (heure d'été ou d'hiver)
  const guess = new Date(`${parts}T${time}:00Z`);
  const local = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(guess);
  const [lh, lm] = local.split(":").map(Number) as [number, number];
  const at = new Date(guess.getTime() - ((lh * 60 + lm) - (h * 60 + m)) * 60e3);
  return { day: parts, at };
}

test("sorties : créer, s'inscrire d'un clic, liste d'attente, place libérée", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `sorties-${Date.now()}@example.test`;
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
  await expect(page.getByRole("heading", { name: "Mes personnages" })).toBeVisible();

  // Groupe de Forever : Thalion officier (Brindille, druide 55 tank/heal, et Pikou, mage 33), d'autres joueurs et deux sorties
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const me = (await db.query("SELECT id FROM users WHERE email = $1", [email])).rows[0].id as string;
  const group = (await db.query("INSERT INTO groups (name) VALUES ('Les Lanternes') RETURNING id")).rows[0].id as string;
  await db.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'officer')", [group, me]);
  const chars = new Map<string, { id: string; user: string; cls: string }>();
  const addChar = async (user: string, name: string, cls: string, spec1: string, spec2: string, level: number, main: boolean) => {
    const id = (await db.query("INSERT INTO characters (user_id, name, race, cls, spec1, spec2, level, professions) VALUES ($1, $2, 'Troll', $3, $4, $5, $6, $7) RETURNING id",
      [user, name, cls, spec1, spec2, level, PROFS])).rows[0].id as string;
    await db.query("INSERT INTO group_characters (group_id, character_id, user_id, is_main) VALUES ($1, $2, $3, $4)", [group, id, user, main]);
    chars.set(name, { id, user, cls });
  };
  await addChar(me, "Brindille", "Druid", "Feral Bear", "Restoration", 55, true);
  await addChar(me, "Pikou", "Mage", "Frost", "", 33, false);
  const player = async (name: string, cls: string, spec: string, level: number, role = "member") => {
    const u = (await db.query("INSERT INTO users (email, email_verified_at, password_hash, display_name) VALUES ($1, now(), 'demo', $2) RETURNING id",
      [`${name.toLowerCase()}-${Date.now()}@example.test`, name])).rows[0].id as string;
    await db.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)", [group, u, role]);
    await addChar(u, name, cls, spec, "", level, true);
  };
  await player("Grimbald", "Paladin", "Protection", 55, "owner");
  for (const [n, c, s, l] of [["Morwen", "Mage", "Frost", 54], ["Rempart", "Warrior", "Protection", 50], ["Nessa", "Shaman", "Restoration", 49],
    ["Oddo", "Warlock", "Affliction", 48], ["Ashka", "Hunter", "Marksmanship", 52], ["Fenrik", "Hunter", "Survival", 50]] as const) await player(n, c, s, l);
  const outing = async (dungeon: string, title: string, min: number, max: number, time: string, creator: string, list: [string, string][]) => {
    const t = tomorrow(time);
    const c = chars.get(creator)!;
    const id = (await db.query(`INSERT INTO outings (group_id, dungeon, title, min_level, max_level, day, scheduled_at, expires_at, created_by, creator_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`, [group, dungeon, title, min, max, t.day, t.at, new Date(t.at.getTime() + 7200e3), c.user, creator])).rows[0].id as string;
    for (const [name, role] of list) {
      const ch = chars.get(name)!;
      await db.query("INSERT INTO outing_signups (outing_id, user_id, display_name, character_id, character_name, cls, role) VALUES ($1, $2, $3, $4, $3, $5, $6)", [id, ch.user, name, ch.id, ch.cls, role]);
    }
    return id;
  };
  await outing("blackrock-depths", "Blackrock Depths", 52, 60, "20:00", "Grimbald", [["Grimbald", "Tank"], ["Morwen", "DPS"]]);
  await outing("maraudon", "Maraudon", 46, 55, "21:30", "Oddo", [["Oddo", "DPS"], ["Rempart", "Tank"], ["Nessa", "Heal"], ["Ashka", "DPS"], ["Fenrik", "DPS"]]);
  await db.end();

  await page.goto(`/groups/${group}`);
  await page.getByRole("tab", { name: "Sorties" }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${group}/sorties$`));
  await expect(page.getByRole("button", { name: "Toutes (2)" })).toBeVisible();

  await test.step("s'inscrire d'un clic avec le perso qui a le niveau", async () => {
    const brd = page.locator("article.so-card", { hasText: "Blackrock Depths" });
    await expect(brd).toHaveClass(/\bcan\b/);
    // Brindille (tank/heal) : le rôle heal est libre ; Pikou (33) n'a pas le niveau, pas de bouton en DPS
    await expect(brd.getByRole("button", { name: "+ Brindille" })).toHaveCount(1);
    await brd.getByRole("button", { name: "+ Brindille" }).click();
    await expect(brd).toContainText("Tu viens en heal avec Brindille");
    await expect(brd.locator(".so-slot.me")).toContainText("Brindille");
    await expect(brd.locator(".so-count")).toHaveText("3/5");
  });

  await test.step("complète : liste d'attente, puis la place libérée revient au premier en attente", async () => {
    const mara = page.locator("article.so-card", { hasText: "Maraudon" });
    await expect(mara.locator(".tag")).toHaveText("Complète");
    await mara.getByRole("button", { name: "Me mettre en attente" }).click();
    await expect(mara.locator(".so-wait")).toContainText("1er en attente");
    await expect(mara).toContainText("Brindille prendra la première place libérée");
    // Officier : « Gérer » → retirer le tank ; Brindille (en attente pour tank) prend sa place
    await mara.getByRole("button", { name: "Gérer" }).click();
    await mara.getByRole("button", { name: "Retirer Rempart" }).click();
    await expect(mara).toContainText("Tu viens en tank avec Brindille");
    await expect(mara.locator(".so-wait")).toHaveCount(0);
  });

  await test.step("« + Sortie » : perso pré-choisi, donjon trié pour lui, demain 21:00, publier", async () => {
    await page.getByRole("button", { name: "+ Sortie" }).click();
    await expect(page).toHaveURL(new RegExp(`/groups/${group}/sorties/nouvelle$`));
    const form = page.locator("form.gr-form");
    await expect(form.getByRole("button", { name: /Brindille/ })).toHaveAttribute("aria-pressed", "true");
    await expect(form.locator(".dg-sub").first()).toContainText("À ton niveau · Brindille 55");
    // Hors fourchette, grisés avec la raison : les plus proches d'abord, les autres derrière « Voir les … autres »
    await expect(form.locator(".dg.off", { hasText: "Zul'Farrak" })).toContainText("trop bas pour Brindille");
    await form.getByRole("button", { name: /^Voir les \d+ autres donjons$/ }).click();
    await expect(form.locator(".dg.off", { hasText: "Stratholme" })).toContainText("dès le niveau 58");
    await form.getByRole("option", { name: /Dire Maul/ }).click();
    await expect(form.locator(".dg-chosen")).toContainText("Dire Maul");
    await form.getByRole("button", { name: "Demain", exact: true }).click();
    await form.getByRole("button", { name: "Demain 21:00" }).click();
    await form.locator("#so-note").fill("Aile est et quêtes.");
    await expect(form.locator(".gr-sum")).toContainText("Dire Maul · demain 21:00 · 1 tank (toi), 1 heal, 3 DPS");
    await form.getByRole("button", { name: "Publier" }).click();
    await expect(page).toHaveURL(new RegExp(`/groups/${group}/sorties$`));
    const dm = page.locator("article.so-card.mine", { hasText: "Dire Maul" });
    await expect(dm).toContainText("« Aile est et quêtes. »");
    await expect(dm.locator(".so-slot.me")).toContainText("Brindille");
    await expect(page.getByRole("button", { name: "Les miennes (1)" })).toBeVisible();
  });
});
