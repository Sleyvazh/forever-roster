import { expect, test as base, type Page } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * Quêtes de guilde (Forever, Guilde › Quêtes, maquette du 27/11) : publier depuis « + Nouvelle quête », prendre la quête
 * d'un autre et la rendre avec un mot, valider le preneur de la sienne puis « C'est remis » ; filtres Disponibles / En
 * cours ; pastille de l'onglet ; rien ne déborde à 390 px. Noms inventés.
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
const PROFS = JSON.stringify({ prof1: { name: "", skill: 0 }, prof2: { name: "", skill: 0 }, cooking: 0, fishing: 0, firstAid: 0 });

test("quêtes : publier, prendre, rendre, valider, remettre", async ({ page, context }) => {
  test.setTimeout(90_000);
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const email = `orwen-${Date.now()}@example.test`;
  const me = (await db.query("INSERT INTO users (email, email_verified_at, password_hash, display_name) VALUES ($1, now(), 'x', 'Orwen') RETURNING id", [email])).rows[0].id as string;
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')",
    [me, createHash("sha256").update(token).digest("hex"), randomBytes(32).toString("base64url")]);
  await context.addCookies([{ name: "fr_sid", value: token, url: "http://localhost:4173" }]);

  const group = (await db.query("INSERT INTO groups (name) VALUES ('Les Veilleurs') RETURNING id")).rows[0].id as string;
  await db.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')", [group, me]);
  const addMain = async (user: string, name: string) => {
    const id = (await db.query("INSERT INTO characters (user_id, name, race, cls, spec1, spec2, level, professions) VALUES ($1, $2, 'Troll', 'Mage', 'Frost', '', 60, $3) RETURNING id",
      [user, name, PROFS])).rows[0].id as string;
    await db.query("INSERT INTO group_characters (group_id, character_id, user_id, is_main) VALUES ($1, $2, $3, true)", [group, id, user]);
  };
  await addMain(me, "Orwen");
  const other = (await db.query("INSERT INTO users (email, display_name, email_verified_at, password_hash) VALUES ($1, 'Brisa', now(), 'x') RETURNING id", [`brisa-${Date.now()}@example.test`])).rows[0].id as string;
  await db.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')", [group, other]);
  await addMain(other, "Brisa");
  // La quête de Brisa, à prendre
  await db.query(`INSERT INTO quests (group_id, type, title, description, objective_text, reward_copper, places, created_by, creator_name)
    VALUES ($1, 'help', 'Abattre Mor''Ladim', 'Il me tue à chaque fois.', 'Vaincre Mor''Ladim', 15000, 1, $2, 'Brisa')`, [group, other]);

  await test.step("publier une quête depuis « + Nouvelle quête »", async () => {
    await page.goto(`/groups/${group}/membres/quetes`);
    await expect(page.getByRole("tab", { name: /Quêtes/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Tableau des quêtes" })).toBeVisible();
    await page.getByRole("button", { name: "+ Nouvelle quête" }).click();
    const dlg = page.getByRole("dialog", { name: /Nouvelle quête/ });
    await dlg.getByLabel("Titre").fill("Escorte jusqu'à Gadgetzan");
    await dlg.getByRole("button", { name: "Coup de main" }).click();
    await dlg.getByLabel("… ou une phrase").fill("Arriver à Gadgetzan");
    await dlg.getByLabel("Pièces d'or").fill("2");
    await dlg.getByRole("button", { name: "Publier la quête" }).click();
    // La fiche s'ouvre sur parchemin
    const fiche = page.getByRole("dialog", { name: "Escorte jusqu'à Gadgetzan" });
    await expect(fiche.getByText("Arriver à Gadgetzan")).toBeVisible();
    await expect(fiche.getByText("Personne ne l'a encore prise.")).toBeVisible();
    await fiche.getByRole("button", { name: "Fermer" }).click();
  });

  await test.step("prendre la quête de Brisa et la rendre avec un mot", async () => {
    const card = page.locator(".qu-card", { hasText: "Abattre Mor'Ladim" });
    await card.getByRole("button", { name: "Prendre" }).click();
    await expect(page.locator(".qu-card", { hasText: "Abattre Mor'Ladim" })).toHaveCount(0);
    await page.getByRole("button", { name: /^En cours/ }).click();
    await page.locator(".qu-card", { hasText: "Abattre Mor'Ladim" }).getByRole("button", { name: "Abattre Mor'Ladim" }).click();
    const fiche = page.getByRole("dialog", { name: "Abattre Mor'Ladim" });
    await fiche.getByLabel(/Un mot pour Brisa/).fill("Fait avec Kaelys hier soir.");
    await fiche.getByRole("button", { name: "Je l'ai faite" }).click();
    await expect(fiche.getByText("Tu as rendu la quête")).toBeVisible();
    await fiche.getByRole("button", { name: "Fermer" }).click();
    await expect(page.locator(".qu-side").getByText("Rendue · à valider")).toBeVisible();
  });

  await test.step("valider le preneur de sa quête, puis « C'est remis »", async () => {
    const [mine] = (await db.query("SELECT id FROM quests WHERE title = 'Escorte jusqu''à Gadgetzan' AND group_id = $1", [group])).rows as { id: string }[];
    await db.query("INSERT INTO quest_takers (quest_id, user_id, name, state, note, turned_in_at) VALUES ($1, $2, 'Brisa', 'turned_in', 'On y est !', now())", [mine!.id, other]);
    await page.reload();
    await expect(page.getByRole("tab", { name: /Quêtes/ }).locator(".av-badge")).toHaveText("1");
    await page.locator(".qu-side").getByRole("button", { name: /Escorte jusqu'à Gadgetzan/ }).click();
    const fiche = page.getByRole("dialog", { name: "Escorte jusqu'à Gadgetzan" });
    await expect(fiche.getByText("« On y est ! »")).toBeVisible();
    await fiche.getByRole("button", { name: "Valider" }).click();
    await fiche.getByRole("button", { name: "C'est remis" }).click();
    await expect(fiche.getByText("Récompense remise · à confirmer")).toBeVisible();
    await fiche.getByRole("button", { name: "Fermer" }).click();
    await expect(page.getByRole("tab", { name: /Quêtes/ }).locator(".av-badge")).toHaveCount(0);
  });

  await test.step("téléphone : rien ne déborde", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: /^Disponibles/ }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
  await db.end();
});
