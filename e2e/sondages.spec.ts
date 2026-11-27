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
const NAMES = ["Zèle", "Écho", "Aube", "Milk me John", "Bastion", "Les Sans-Nom", "Cendre", "Dague", "Forge", "Givre", "Hydre", "Iris", "Jade"];
// 58 choix comme le vrai vote du nom de guilde : la liste défile, chaque ligne garde sa hauteur (bug vu par Flo le 27/11)
const MORE = Array.from({ length: 45 }, (_, i) => `Nom ${String(i + 1).padStart(2, "0")}`);
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

test("grand sondage (liste collée, au plus N, recherche, classement, 2e tour) et salon des sondages", async ({ page, context }) => {
  test.setTimeout(90_000);
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const stamp = Date.now();
  // Officier avec son Discord lié (pour générer un code de liaison)
  const me = (await db.query("INSERT INTO users (email, email_verified_at, password_hash, display_name, discord_id, discord_username) VALUES ($1, now(), 'x', 'Ombrelune', $2, 'ombrelune') RETURNING id",
    [`ombrelune-${stamp}@example.test`, String(700000000000000000n + BigInt(stamp % 1e9))])).rows[0].id as string;
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')",
    [me, createHash("sha256").update(token).digest("hex"), randomBytes(32).toString("base64url")]);
  await context.addCookies([{ name: "fr_sid", value: token, url: "http://localhost:4173" }]);
  const group = (await db.query("INSERT INTO groups (name, discord_guild_id, discord_channel_id, discord_channel_name) VALUES ('Les Veilleurs', '111111111111111112', '222222222222222223', 'raids') RETURNING id")).rows[0].id as string;
  await db.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'officer')", [group, me]);
  const id = (await db.query("INSERT INTO characters (user_id, name, race, cls, spec1, spec2, level, professions) VALUES ($1, 'Ombrelune', 'Troll', 'Mage', 'Frost', '', 60, $2) RETURNING id", [me, PROFS])).rows[0].id as string;
  await db.query("INSERT INTO group_characters (group_id, character_id, user_id, is_main) VALUES ($1, $2, $3, true)", [group, id, me]);

  await test.step("Administration › Discord : salon des sondages, code de liaison", async () => {
    await page.goto(`/groups/${group}/admin`);
    await page.locator(".adm-nav").getByRole("button", { name: "Discord" }).click();
    const sec = page.locator("section.admin-sec").filter({ has: page.getByRole("heading", { name: "Salon des sondages", exact: true }) });
    await expect(sec.getByText("Non lié")).toBeVisible();
    await expect(sec.getByText(/Sans lui, \/sondage et \/dispos posent le sondage dans le salon où la commande est tapée/)).toBeVisible();
    await sec.getByRole("button", { name: "Générer un code de liaison" }).click();
    await expect(sec.getByLabel("Commande de liaison du salon des sondages")).toHaveValue(/^\/forever-lier code:[A-Z0-9]+$/);
    await expect(sec.getByText(/Les sondages en cours y sont déplacés dès que le salon est lié/)).toBeVisible();
    // Le bot lie le salon (simulé en base)
    await db.query("UPDATE groups SET polls_guild_id = '111111111111111112', polls_channel_id = '333333333333333334', polls_channel_name = 'sondages', polls_link_code_hash = null WHERE id = $1", [group]);
    await page.reload();
    await page.locator(".adm-nav").getByRole("button", { name: "Discord" }).click();
    await expect(sec.locator(".tag.chan")).toHaveText("#sondages");
    await expect(sec.getByText(/Tous les sondages de la guilde y sont posés/)).toBeVisible();
    await expect(sec.getByRole("button", { name: "Délier le salon" })).toBeVisible();
  });

  await test.step("liste collée de 13 noms, au plus 3, posée dans le salon des sondages", async () => {
    await page.goto(`/groups/${group}/membres/sondages`);
    await page.getByRole("button", { name: "+ Sondage" }).click();
    const dlg = page.getByRole("dialog", { name: "Nouveau sondage" });
    await dlg.getByLabel("Question").fill("Nom de guilde · 1er tour");
    await dlg.getByRole("button", { name: "Coller une liste (un choix par ligne)" }).click();
    await dlg.getByLabel("Liste des choix, un par ligne").fill([...NAMES, ...MORE, "Aube", ""].join("\n"));
    await dlg.getByRole("button", { name: "Utiliser cette liste" }).click();
    await expect(dlg.getByLabel("Choix 13", { exact: true })).toHaveValue("Jade");
    await expect(dlg.getByText("58 choix : ils seront rangés par ordre alphabétique, et sur Discord « Voter » ouvre la liste.")).toBeVisible();
    await dlg.getByLabel("Plusieurs choix par personne").check();
    await dlg.getByRole("checkbox", { name: /^Au plus/ }).check();
    await dlg.getByRole("button", { name: "À la fin" }).click();
    await expect(dlg.getByLabel(/Le poser aussi sur Discord, dans/)).toBeChecked();
    await expect(dlg.getByText("#sondages")).toBeVisible();
    await dlg.getByRole("button", { name: "Poser le sondage" }).click();
    await expect(dlg).toBeHidden();
    const poll = (await db.query("SELECT channel_id, max_choices FROM polls WHERE group_id = $1", [group])).rows[0];
    expect(poll).toEqual({ channel_id: "333333333333333334", max_choices: 3 });
  });

  const card = page.locator(".pl-card");
  await test.step("recherche, Mes choix, au plus 3", async () => {
    await expect(card.getByText(/vote anonyme · jusqu'à 3 choix · résultats à la fin/)).toBeVisible();
    const opts = card.locator(".pl-big .pl-opt");
    await expect(opts).toHaveCount(58);
    await expect(opts.first()).toContainText("Aube");
    // Pas de lignes écrasées : chacune garde sa hauteur, la liste défile
    expect(await opts.evaluateAll(els => Math.min(...els.map(e => e.getBoundingClientRect().height))), "hauteur d'une ligne").toBeGreaterThanOrEqual(30);
    expect(await card.locator(".pl-big").evaluate(el => el.scrollHeight > el.clientHeight), "la liste défile").toBe(true);
    await expect(opts.nth(4)).toContainText("Écho");
    await card.getByRole("searchbox", { name: "Chercher un choix" }).fill("echo");
    await expect(opts).toHaveCount(1);
    await opts.first().click();
    await expect(opts.first()).toHaveAttribute("aria-pressed", "true");
    await card.getByRole("searchbox", { name: "Chercher un choix" }).fill("");
    for (const name of ["Aube", "Milk me John"]) {
      await card.getByRole("button", { name }).click();
      await expect(card.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
    }
    await expect(card.locator(".pl-count")).toHaveText("3 sur 3 choisis");
    await card.getByRole("button", { name: "Zèle" }).click();
    await expect(page.getByText("3 choix au plus : retires-en un.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Zèle" })).toHaveAttribute("aria-pressed", "false");
    await card.getByRole("button", { name: /^Mes choix/ }).click();
    await expect(opts).toHaveCount(3);
    await card.getByRole("button", { name: /^Tous/ }).click();
  });

  await test.step("clos : classement, ✅ qualifiés ; 2e tour avec les 5 premiers", async () => {
    const pollId = (await db.query("SELECT id FROM polls WHERE group_id = $1", [group])).rows[0].id as string;
    // D'autres votes (joueurs Discord sans compte) : Écho 3, Aube 2, Milk me John 2, Bastion 1, Cendre 1, Dague 1
    for (const [i, yes] of [[5, 1, 12], [5, 2, 3], [4]].entries()) {
      await db.query("INSERT INTO poll_votes (poll_id, voter_key, discord_user_id, name, yes, maybe) VALUES ($1, $2, $3, $4, $5, '[]')",
        [pollId, `d:90000000000000000${i}`, `90000000000000000${i}`, `Invité${i}`, JSON.stringify(yes)]);
    }
    await page.reload();
    await card.getByRole("button", { name: /Clore le sondage/ }).click();
    await card.getByRole("button", { name: "Clore", exact: true }).click();
    await expect(card.getByText("Clos", { exact: true })).toBeVisible();
    const opts = card.locator(".pl-big .pl-opt");
    await expect(opts.nth(0)).toContainText("1.Écho ✅3");
    await expect(opts.nth(1)).toContainText("2.Aube ✅2");
    await expect(opts.nth(2)).toContainText("3.Milk me John ✅2");
    await expect(opts.nth(5)).toContainText("6.Dague ✅1");
    await expect(opts.nth(6)).toContainText("7.Forge0");
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `grand sondage à ${width} px`).toBeLessThanOrEqual(width);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await card.getByRole("button", { name: "2e tour avec les 5 premiers" }).click();
    const r2 = page.getByRole("dialog", { name: "2e tour" });
    await expect(r2.getByText("6 qualifiés : Écho, Aube, Milk me John, Bastion, Cendre, Dague")).toBeVisible();
    await expect(r2.getByLabel("Question")).toHaveValue("Nom de guilde · 2e tour");
    await r2.getByRole("button", { name: "Poser le 2e tour" }).click();
    await expect(r2).toBeHidden();
    await expect(card.getByRole("heading", { name: "Nom de guilde · 2e tour" })).toBeVisible();
    await expect(card.getByText(/vote anonyme · un seul choix · résultats à la fin/)).toBeVisible();
    await expect(card.locator(".pl-opts .pl-opt")).toHaveCount(6);
    const runoff = (await db.query("SELECT channel_id, multi FROM polls WHERE group_id = $1 AND question = 'Nom de guilde · 2e tour'", [group])).rows[0];
    expect(runoff).toEqual({ channel_id: "333333333333333334", multi: false });
  });
  await db.end();
});
