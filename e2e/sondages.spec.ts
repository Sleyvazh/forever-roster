import { expect, test as base, type Page } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * Sondages sur le site (Guilde › Sondages, maquettes B et C du 27/11) : l'officier pose un sondage à choix et un sondage
 * de disponibilités depuis la fenêtre « + Sondage », vote d'un clic, répond Oui / Si besoin / Non par créneau, voit
 * « Qui a répondu ? », crée le raid sur le meilleur créneau ; la pastille de l'onglet compte les sondages sans réponse ;
 * rien ne déborde à 360 et 390 px (onglets de Guilde en deux rangées). Noms inventés.
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

test("sondages : poser, voter, disponibilités, raid sur ★", async ({ page, context }) => {
  test.setTimeout(90_000);
  // Compte et session créés en base : la suite entière ne dépasse pas la limite de 20 connexions par quart d'heure
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const email = `thalion-${Date.now()}@example.test`;
  const me = (await db.query("INSERT INTO users (email, email_verified_at, password_hash, display_name) VALUES ($1, now(), 'x', 'Thalion') RETURNING id", [email])).rows[0].id as string;
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')",
    [me, createHash("sha256").update(token).digest("hex"), randomBytes(32).toString("base64url")]);
  await context.addCookies([{ name: "fr_sid", value: token, url: "http://localhost:4173" }]);

  // Guilde de Forever liée à un salon des raids : Thalion officier (Brindille, druide tank), trois membres
  const group = (await db.query("INSERT INTO groups (name, discord_guild_id, discord_channel_id, discord_channel_name) VALUES ('Les Lanternes', '111111111111111111', '222222222222222222', 'raids') RETURNING id")).rows[0].id as string;
  await db.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'officer')", [group, me]);
  const addMain = async (user: string, name: string, cls: string, spec: string) => {
    const id = (await db.query("INSERT INTO characters (user_id, name, race, cls, spec1, spec2, level, professions) VALUES ($1, $2, 'Troll', $3, $4, '', 60, $5) RETURNING id",
      [user, name, cls, spec, PROFS])).rows[0].id as string;
    await db.query("INSERT INTO group_characters (group_id, character_id, user_id, is_main) VALUES ($1, $2, $3, true)", [group, id, user]);
  };
  await addMain(me, "Brindille", "Druid", "Feral Bear");
  const others: [string, string, "Tank" | "Heal" | "DPS"][] = [];
  for (const [name, cls, spec, role] of [["Bramm", "Warrior", "Protection", "Tank"], ["Kaelys", "Priest", "Holy", "Heal"], ["Tiblou", "Mage", "Frost", "DPS"]] as const) {
    const u = (await db.query("INSERT INTO users (email, display_name, email_verified_at, password_hash) VALUES ($1, $2, now(), 'x') RETURNING id", [`${name.toLowerCase()}-${Date.now()}@example.test`, name])).rows[0].id as string;
    await db.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')", [group, u]);
    await addMain(u, name, cls, spec);
    others.push([u, name, role]);
  }

  await test.step("onglet Sondages vide, puis un sondage à choix depuis « + Sondage »", async () => {
    await page.goto(`/groups/${group}/membres/sondages`);
    await expect(page.getByRole("tab", { name: "Sondages" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(/Aucun sondage pour l'instant/)).toBeVisible();
    await page.getByRole("button", { name: "+ Sondage" }).click();
    const dlg = page.getByRole("dialog", { name: "Nouveau sondage" });
    await dlg.getByLabel("Question").fill("Quel donjon jeudi soir ?");
    await dlg.getByLabel("Choix 1", { exact: true }).fill("Scholomance");
    await dlg.getByLabel("Choix 2", { exact: true }).fill("Stratholme");
    // Une case vide apparaît sous la dernière remplie
    await dlg.getByLabel("Choix 3", { exact: true }).fill("Pic Rochenoire");
    await expect(dlg.getByLabel("Choix 4", { exact: true })).toHaveValue("");
    await dlg.getByLabel("Vote anonyme").uncheck();
    await expect(dlg.getByLabel(/Le poser aussi sur Discord, dans/)).toBeChecked();
    await dlg.getByRole("button", { name: "Poser le sondage" }).click();
    await expect(dlg).toBeHidden();
    const card = page.locator(".pl-card");
    await expect(card.getByRole("heading", { name: "Quel donjon jeudi soir ?" })).toBeVisible();
    await expect(card.getByText(/vote public · un seul choix · jusqu'à ce qu'il soit clos · aussi sur Discord/)).toBeVisible();
    await expect(page.getByRole("tab", { name: /Sondages/ }).locator(".av-badge")).toHaveText("1");
    await card.getByRole("button", { name: /Stratholme/ }).click();
    await expect(card.getByRole("button", { name: /Stratholme/ })).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByText("Tu as voté")).toBeVisible();
    await expect(page.getByRole("tab", { name: /Sondages/ }).locator(".av-badge")).toHaveCount(0);
    // Changer d'avis, puis voir qui a voté
    await card.getByRole("button", { name: /Scholomance/ }).click();
    await expect(card.getByRole("button", { name: /Scholomance/ })).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByRole("button", { name: /Stratholme/ })).toHaveAttribute("aria-pressed", "false");
    await card.getByRole("button", { name: "Qui a voté ?" }).click();
    await expect(card.locator(".pl-who")).toContainText("Scholomance (1) · Brindille");
  });

  await test.step("disponibilités : créneaux, Oui / Si besoin / Non, meilleur créneau, raid", async () => {
    await page.getByRole("button", { name: "+ Sondage" }).click();
    const dlg = page.getByRole("dialog", { name: "Nouveau sondage" });
    await dlg.getByRole("button", { name: /Disponibilités/ }).click();
    await dlg.getByLabel("Question").fill("Quel soir pour Onyxia ?");
    await dlg.getByLabel(/Nom du raid/).fill("Onyxia");
    await dlg.getByRole("button", { name: "Poser le sondage" }).click();
    await expect(dlg).toBeHidden();
    const card = page.locator(".pl-card");
    await expect(card.getByRole("heading", { name: "Quel soir pour Onyxia ?" })).toBeVisible();
    await expect(card.locator(".pl-gr:not(.pl-gh)")).toHaveCount(3);
    // Les autres répondent (base), Thalion répond sur la page
    const poll = (await db.query("SELECT id FROM polls WHERE group_id = $1 AND kind = 'dates'", [group])).rows[0].id as string;
    for (const [i, [u, name, role]] of others.entries()) {
      await db.query("INSERT INTO poll_votes (poll_id, voter_key, user_id, name, role, yes, maybe) VALUES ($1, $2, $3, $4, $5, $6, '[]')", [poll, `u:${u}`, u, name, role, JSON.stringify(i ? [2, 3] : [2])]);
    }
    await page.reload();
    const answer = (n: number) => card.getByRole("group", { name: /^Ta réponse pour/ }).nth(n);
    await answer(0).getByRole("button", { name: "Si besoin" }).click();
    await expect(answer(0).getByRole("button", { name: "Si besoin" })).toHaveAttribute("aria-pressed", "true");
    await answer(1).getByRole("button", { name: "Oui" }).click();
    await expect(answer(1).getByRole("button", { name: "Oui" })).toHaveAttribute("aria-pressed", "true");
    await expect(card.locator(".pl-gr.best .pl-slot")).toContainText("★");
    await expect(card.locator(".pl-gr.best .pl-roles")).toHaveText("TANK 2 · HEAL 1 · 1 DPS");
    await expect(card.getByText(/tu réponds avec Brindille \(tank\)/)).toBeVisible();
    await card.getByRole("button", { name: "Qui a répondu ?" }).click();
    await expect(card.locator(".pl-who")).toContainText("Bramm, Kaelys, Tiblou, Brindille");
    // Créer le raid sur ★ : nom repris, meilleur créneau proposé
    await card.getByRole("button", { name: "Créer le raid sur ★" }).click();
    const rd = page.getByRole("dialog", { name: "Créer le raid" });
    await expect(rd.getByLabel("Nom du raid")).toHaveValue("Onyxia");
    await expect(rd.getByLabel("Créneau").locator("option:checked")).toContainText("★");
    await rd.getByRole("button", { name: "Créer le raid" }).click();
    await expect(page.getByText(/Raid « Onyxia » créé ; son annonce part dans le salon des raids/)).toBeVisible();
    await expect(card.getByRole("link", { name: "Voir le raid" })).toBeVisible();
    await expect(card.getByText("Clos", { exact: true })).toBeVisible();
    await expect(page.locator(".pl-li").filter({ hasText: "Quel soir pour Onyxia ?" })).toContainText("Raid créé : Onyxia");
    const raids = (await db.query("SELECT name FROM raids WHERE group_id = $1", [group])).rows.map(r => r.name);
    expect(raids).toEqual(["Onyxia"]);
  });

  await test.step("clore le sondage à choix ; rien ne déborde à 360 et 390 px", async () => {
    await page.locator(".pl-li").filter({ hasText: "Quel donjon jeudi soir ?" }).click();
    const card = page.locator(".pl-card");
    await card.getByRole("button", { name: /Clore le sondage/ }).click();
    await card.getByRole("button", { name: "Clore", exact: true }).click();
    await expect(card.getByText("Clos", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: /Scholomance/ })).toBeDisabled();
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.reload();
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `sondages à ${width} px`).toBeLessThanOrEqual(width);
      expect(await page.locator(".panel > .tabs").evaluate(t => t.scrollWidth <= t.clientWidth), `onglets à ${width} px`).toBe(true);
    }
  });
  await db.end();
});
