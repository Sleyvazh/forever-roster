import { expect, test as base, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Guilde du jeu (Forever, lot « Guilde ») : le relevé FRL collé sur le site (Ctrl+V) lie la guilde, Membres s'ouvre sur
 * « Par perso » (liste du jeu) et retient le choix « Par joueur » / « Par perso » et « Liste du jeu » / « Fiches du site »,
 * Par joueur montre les joueurs (main et alts, compte du site), la bande « À rattacher » accepte une suggestion de note,
 * « Rattacher à… » range un perso sous un joueur ; Course au 60, Historique, Banque (onglets, grille, recherche, or, journal),
 * Accueil et Administration s'affichent. Noms inventés.
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
    // Banque : or, deux onglets (le 2e que le releveur ne voit pas), trois cases (dont un objet inconnu du catalogue), un dépôt d'objets, une réparation et un dépôt d'or
    `B;${now};Brindille Feuillevive;1234567;2`,
    "T;1;Consommables;1;1",
    "T;2;Officiers;0;0",
    "I;1;1;8170;20",
    "I;1;8;10940;5",
    "I;1;2;999999;1",
    "X;1;deposit;Pikou Patacuivre;8170;20;;;3",
    "X;1;withdraw;Nessa Flotsombre;;5;;;8", // objet que le jeu n'a pas dit
    "O;repair;Vex Ombrelame;123030;5",
    "O;deposit;Kaeldra Brisevent;500000;30",
    "O;withdraw;Vex Ombrelame;;40", // montant que le jeu n'a pas dit
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
    return id;
  };
  await fiche(me, "Brindille Feuillevive", "Druid", "Tauren", "Restoration", 28, 2);
  const kaeldraId = await fiche(kael, "Kaeldra Brisevent", "Warrior", "Orc", "Protection", 30, 1);
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
    await dialog.getByRole("link", { name: "Les Lanternes › Membres" }).click();
    await expect(page).toHaveURL(new RegExp(`/groups/${group}/membres$`));
  });

  const players = page.getByRole("table", { name: "Joueurs de la guilde" });
  const by = page.getByRole("group", { name: "Par perso ou par joueur" });
  const mode = page.getByRole("group", { name: "Persos : liste du jeu ou fiches du site" });
  await test.step("Guilde › Membres : Par perso d'abord, liste du jeu, barre fixe", async () => {
    await expect(page.locator(".topnav").getByRole("link", { name: "Guilde" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("tab", { name: "Membres" })).toHaveAttribute("aria-selected", "true");
    // Barre en haut du volet : Par perso | Par joueur à gauche, Liste du jeu | Fiches du site à droite
    await expect(page.locator(".gm-bar")).toHaveCount(1);
    await expect(by.getByRole("button")).toHaveText(["Par perso", "Par joueur"]);
    await expect(by.getByRole("button", { name: "Par perso" })).toHaveAttribute("aria-pressed", "true");
    await expect(mode.getByRole("button", { name: "Liste du jeu" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".gx-table")).toContainText("Kaeldra Brisevent");
    await expect(players).toHaveCount(0);
    const bar = (await page.locator(".gm-bar").boundingBox())!;
    // Un clic sur « Par joueur » mène à l'adresse explicite ; la barre ne bouge pas
    await by.getByRole("button", { name: "Par joueur" }).click();
    await expect(page).toHaveURL(new RegExp(`/groups/${group}/membres/joueurs$`));
    await expect(by.getByRole("button", { name: "Par joueur" })).toHaveAttribute("aria-pressed", "true");
    await expect(mode).toHaveCount(0); // Liste du jeu / Fiches du site n'existe qu'en Par perso
    const barJ = (await page.locator(".gm-bar").boundingBox())!;
    expect([barJ.x, barJ.y]).toEqual([bar.x, bar.y]);
    // Le choix est retenu : /membres rouvre Par joueur
    await page.goto(`/groups/${group}/membres`);
    await expect(players).toBeVisible();
    await expect(page.locator(".gx-table")).toHaveCount(0);
  });

  await test.step("Guilde › Membres › Par joueur : mains, comptes du site, bande « À rattacher »", async () => {
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
    await by.getByRole("button", { name: "Par perso" }).click();
    await expect(page).toHaveURL(new RegExp(`/groups/${group}/membres/persos$`));
    await expect(page.getByRole("row").filter({ hasText: "Pikou Patacuivre" })).toContainText("Thalion");
  });

  await test.step("choix retenus : Par perso / Par joueur et Liste du jeu / Fiches du site", async () => {
    // Une adresse explicite force la vue sans changer le choix retenu (Par perso)
    await page.goto(`/groups/${group}/membres/joueurs`);
    await expect(players).toBeVisible();
    await page.goto(`/groups/${group}/membres`);
    await expect(page.locator(".gx-table")).toBeVisible();
    // « Fiches du site » : ?vue=fiches dans l'adresse, retenu pour la prochaine fois
    await mode.getByRole("button", { name: "Fiches du site" }).click();
    await expect(page).toHaveURL(/\/membres\?vue=fiches$/);
    await expect(page.getByRole("group", { name: "Affichage" })).toBeVisible();
    await expect(page.locator(".gx-table")).toHaveCount(0);
    await page.goto(`/groups/${group}/membres`);
    await expect(page.getByRole("group", { name: "Affichage" })).toBeVisible();
    // ?vue=jeu force la liste du jeu sans changer le choix retenu ; « Liste du jeu » le rétablit
    await page.goto(`/groups/${group}/membres?vue=jeu`);
    await expect(page.locator(".gx-table")).toBeVisible();
    await page.goto(`/groups/${group}/membres`);
    await expect(page.getByRole("group", { name: "Affichage" })).toBeVisible();
    await mode.getByRole("button", { name: "Liste du jeu" }).click();
    await expect(page).toHaveURL(/\/membres\?vue=jeu$/);
    await expect(page.locator(".gx-table")).toBeVisible();
    await page.goto(`/groups/${group}/membres`);
    await expect(page.locator(".gx-table")).toBeVisible();
  });

  await test.step("ancienne adresse /persos?perso= : la fiche reste ouverte malgré le choix retenu « Liste du jeu »", async () => {
    await page.goto(`/groups/${group}/persos?perso=${kaeldraId}`);
    await expect(page).toHaveURL(/\/membres\/persos\?(?=.*vue=fiches)/);
    await expect(page.getByRole("group", { name: "Affichage" })).toBeVisible();
    await expect(page.locator(".grow[aria-expanded=true]")).toContainText("Kaeldra Brisevent");
    await expect(page.locator(".gx-table")).toHaveCount(0);
    // Elle y est encore une fois ?perso= retiré de l'adresse
    await expect(page).not.toHaveURL(/perso=/);
    await expect(page.locator(".grow[aria-expanded=true]")).toContainText("Kaeldra Brisevent");
    // « Liste du jeu » rétablit la liste
    await mode.getByRole("button", { name: "Liste du jeu" }).click();
    await expect(page.locator(".gx-table")).toBeVisible();
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

  await test.step("Guilde › Banque : onglets, grille, recherche, or et journal", async () => {
    await page.getByRole("tab", { name: "Banque" }).click();
    await expect(page).toHaveURL(new RegExp(`/groups/${group}/membres/banque$`));
    await expect(page.getByRole("tab", { name: "Banque" })).toHaveAttribute("aria-selected", "true");
    // En-tête : qui a relevé, onglet jamais relevé, nombre d'onglets, or en po / pa / pc
    const head = page.locator(".bk-head");
    await expect(head).toContainText("Relevée par Brindille Feuillevive");
    await expect(head).toContainText("onglet Officiers jamais relevé");
    await expect(head).toContainText("2 onglets");
    await expect(page.getByRole("group", { name: "Or de la banque" })).toContainText("123 po 45 pa 67 pc");
    // Le premier onglet est choisi : grille 14 × 7, les cases rangées colonne par colonne (case 1, puis 2 dessous, la 8 à côté)
    const chips = page.getByRole("group", { name: "Onglets de la banque" });
    await expect(chips.getByRole("button")).toHaveText(["Tout 3", "Consommables 3", "Officiers 0"]);
    await expect(chips.getByRole("button", { name: /^Consommables/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".bk-slot")).toHaveCount(98);
    const leather = page.getByLabel("Rugged Leather × 20"), unknown = page.getByLabel("Objet n° 999999 × 1"), dust = page.getByLabel("Strange Dust × 5");
    await expect(leather).toBeVisible();
    await expect(unknown).toBeVisible();
    await expect(unknown, "survol à la souris : l'objet inconnu se nomme").toHaveAttribute("title", "Objet n° 999999 × 1");
    const [a, b, c] = [(await leather.boundingBox())!, (await unknown.boundingBox())!, (await dust.boundingBox())!];
    expect(b.x, "case 2 sous la case 1").toBeCloseTo(a.x, 0);
    expect(b.y).toBeGreaterThan(a.y + 20);
    expect(c.y, "case 8 en haut, une colonne plus loin").toBeCloseTo(a.y, 0);
    expect(c.x).toBeGreaterThan(a.x + 20);
    // Onglet jamais relevé
    await chips.getByRole("button", { name: /^Officiers/ }).click();
    await expect(page.getByText("Personne n'a encore relevé cet onglet : il faut qu'un membre dont le rang le voit ouvre la banque avec l'addon.")).toBeVisible();
    await expect(page.locator(".bk-grid")).toHaveCount(0);
    // « Tout » : la liste, une ligne par objet et par onglet, triée par nom
    await chips.getByRole("button", { name: /^Tout/ }).click();
    await expect(page.locator(".bk-list > li")).toHaveText([/Objet n° 999999.*× 1/, /Rugged Leather.*Consommables.*× 20/, /Strange Dust.*Consommables.*× 5/]);
    // Recherche dans tous les onglets, sans tenir compte de la casse
    const search = page.getByRole("searchbox", { name: "Chercher un objet dans la banque" });
    await expect(search).toHaveAttribute("placeholder", "Chercher un objet dans tous les onglets…");
    await search.fill("DUST");
    await expect(page.locator(".bk-list > li")).toHaveCount(1);
    await expect(page.locator(".bk-list > li")).toContainText("Strange Dust");
    await expect(page.locator(".bk-list > li")).toContainText("× 5");
    await expect(page.getByText("1 objet trouvé · 5 au total")).toBeVisible();
    await search.fill("zzz");
    await expect(page.getByText("Aucun objet ne correspond.")).toBeVisible();
    await search.fill("");
    // Journal : objets (dépôt), or en dessous, puis le journal de l'or
    const journal = page.locator(".bk-journal");
    await expect(journal.getByRole("heading", { name: "Journal" })).toBeVisible();
    await expect(journal).toContainText("le jeu en montre 50 par onglet");
    await expect(journal).toContainText("Pikou Patacuivre a déposé 20 × Rugged Leather");
    await expect(journal).toContainText("Nessa Flotsombre a retiré 5 × objet inconnu");
    await expect(journal).toContainText("Consommables");
    // « Or : » les deux derniers mouvements, du plus récent au plus ancien : qui, ce qu'il a fait, montant signé, quand
    await expect(page.locator(".bk-last")).toContainText(/^Or : Vex Ombrelame a payé des réparations −12 po 30 pa 30 pc \(.+\) · Kaeldra Brisevent a déposé \+50 po \(.+\)$/);
    await journal.getByRole("group", { name: "Journal de la banque" }).getByRole("button", { name: "Or" }).click();
    await expect(journal).toContainText("Vex Ombrelame a payé des réparations −12 po 30 pa 30 pc");
    await expect(journal).toContainText("Kaeldra Brisevent a déposé +50 po");
    await expect(journal).toContainText("le jeu en montre 50");
    await expect(journal).toContainText("Vex Ombrelame a retiré un montant inconnu");
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
    for (const url of [`/groups/${group}`, `/groups/${group}/membres`, `/groups/${group}/membres/joueurs`, `/groups/${group}/membres/course`]) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.scrollWidth), url).toBeLessThanOrEqual(390);
    }
    // Banque : la liste de l'onglet (pas la grille), rien ne déborde
    await page.goto(`/groups/${group}/membres/banque`);
    await expect(page.locator(".bk-list > li").first()).toBeVisible();
    await expect(page.locator(".bk-grid")).toHaveCount(0);
    await expect(page.locator(".bk-journal")).toContainText("Pikou Patacuivre a déposé 20 × Rugged Leather");
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "banque").toBeLessThanOrEqual(390);
    // Par perso (par défaut) : deux lignes par perso, sans les notes ni l'en-tête, rien ne déborde du cadre
    await page.goto(`/groups/${group}/membres`);
    const row = page.locator(".gx-table tbody tr").filter({ hasText: "Pikou Patacuivre" });
    await expect(row).toBeVisible();
    await expect(page.locator(".gx-table thead")).toBeHidden();
    await expect(row.locator(".gx-note").first()).toBeHidden();
    for (const c of ["gx-lv", "gx-rank", "gx-pl", "gx-seen"]) await expect(row.locator(`.${c}`)).toBeVisible();
    const name = (await row.locator(".gx-name").boundingBox())!, rank = (await row.locator(".gx-rank").boundingBox())!;
    expect(rank.y, "rang, joueur et connexion sous le nom").toBeGreaterThan(name.y + name.height - 2);
    expect((await row.locator(".gx-lv").boundingBox())!.y, "niveau sur la ligne du nom").toBeLessThan(name.y + name.height);
    expect(await page.locator(".gx-table").evaluate(t => t.parentElement!.scrollWidth <= t.parentElement!.clientWidth)).toBe(true);
    // 360, 375 et 390 px : les cinq onglets de Guilde tiennent sans défiler, rien ne déborde (Membres, Banque)
    for (const width of [360, 375, 390]) {
      await page.setViewportSize({ width, height: 800 });
      for (const url of [`/groups/${group}/membres`, `/groups/${group}/membres/banque`]) {
        await page.goto(url);
        await page.waitForLoadState("networkidle");
        expect(await page.evaluate(() => document.documentElement.scrollWidth), `${url} à ${width} px`).toBeLessThanOrEqual(width);
        expect(await page.locator(".panel > .tabs").evaluate(t => t.scrollWidth <= t.clientWidth), `onglets de Guilde sans défilement à ${width} px`).toBe(true);
      }
    }
  });
});
