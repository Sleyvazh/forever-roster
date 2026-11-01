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
 * Demandes de retrait (patch du 5/11) : un membre demande un objet depuis la grille, l'officier prépare puis remet, le
 * demandeur suit l'étape, l'officier nomme un banquier qui traite à son tour ; rien ne déborde à 360 et 390 px.
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

/** Compte vérifié et connecté : inscription, lien reçu par e-mail (journal de l'API), connexion. */
async function signUp(page: Page, name: string) {
  const email = `${name.toLowerCase()}-${Date.now()}@example.test`;
  await page.goto("/register");
  await page.fill("#dn", name);
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
  return email;
}

/** Relevé d'une autre guilde (Les Veilleurs) : deux membres, la banque du test ci-dessus (3 cases, 2 onglets). */
function frlVeilleurs(now: number) {
  const lines = [
    ["M", "Sorelle Hautvent", "PRIEST", 30, "Officier", 1, 1, 0, "", "", guid(11)].join(";"),
    ["M", "Torvald Brumegris", "WARRIOR", 24, "Membre", 3, 0, 3, "", "", guid(12)].join(";"),
    `J;${now};Sorelle Hautvent`,
    `B;${now};Sorelle Hautvent;1234567;2`,
    "T;1;Consommables;1;1",
    "T;2;Officiers;0;0",
    "I;1;1;8170;20",
    "I;1;8;10940;5",
    "I;1;2;999999;1",
    "X;1;deposit;Torvald Brumegris;8170;20;;;3",
  ];
  return [`FRL;1;Les Veilleurs;Horde;${now};Sorelle Hautvent;1;Officier;2;Forever EU;1.6.2`, ...lines, `END;${lines.length}`].join("\n");
}

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
    // Trouver quoi faire : pour Brindille (niveau 28), les donjons de Forever d'abord, les joueurs à 3 niveaux près (liste du jeu)
    const find = page.getByRole("region", { name: "Trouver quoi faire" });
    await expect(find).toContainText("Brindille, niveau 28");
    await expect(find.locator(".tf-d").first()).toContainText("City of Dalaran");
    await expect(find.locator(".tf-d").first().locator(".tag")).toHaveText("Forever");
    await expect(find.locator(".tf-d").filter({ hasText: "Excavation Site: Wetlands" })).toContainText("1 perso de la guilde a le niveau");
    // Même dernière connexion : le plus proche de son niveau d'abord
    await expect(find.locator(".tf-who li")).toHaveText([/Vex Ombrelame\s*27/, /Kaeldra Brisevent\s*30/]);
    // « Proposer » ouvre « + Sortie » avec le donjon et le perso déjà choisis
    await find.getByRole("link", { name: "Proposer une sortie à Excavation Site: Wetlands" }).click();
    await expect(page).toHaveURL(new RegExp(`/groups/${group}/sorties/nouvelle\\?donjon=excavation-site&perso=`));
    await expect(page.locator(".dg-chosen")).toContainText("Excavation Site: Wetlands");
    await expect(page.getByRole("button", { name: /Brindille Feuillevive/ })).toHaveAttribute("aria-pressed", "true");
    await page.goBack();
    await expect(find).toBeVisible();
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

test("guilde : demandes de retrait à la banque, Préparer, Remise, banquier", async ({ page, browser }) => {
  test.setTimeout(150_000);
  // Captures pour la documentation et la relecture : SHOTS_DIR=/chemin npx playwright test guilde
  const shot = async (p: Page, name: string) => {
    if (!process.env.SHOTS_DIR) return;
    // Barre du bas du téléphone : fixe, elle recouvrirait le bas de la page entière
    await p.evaluate(() => document.querySelectorAll<HTMLElement>("body *").forEach(e => { if (getComputedStyle(e).position === "fixed" && e.getBoundingClientRect().top > 300) e.style.display = "none"; }));
    await p.screenshot({ path: path.join(process.env.SHOTS_DIR, name), fullPage: true });
  };

  // Deux navigateurs : l'officière (page) et le membre (autre contexte)
  const ctx = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 1280, height: 900 } });
  await ctx.route("**/icons/**", r => r.fulfill({ status: 404, body: "" }));
  const member = await ctx.newPage();
  const problems: string[] = [];
  member.on("pageerror", e => problems.push(`Erreur JS : ${e.message}`));
  member.on("console", m => { if (m.type() === "error" && !(m.location().url ?? "").includes("/icons/")) problems.push(`Console : ${m.text().slice(0, 200)}`); });

  const officerEmail = await signUp(page, "Sorelle");
  const memberEmail = await signUp(member, "Torvald");

  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const idOf = async (email: string) => (await db.query("SELECT id FROM users WHERE email = $1", [email])).rows[0].id as string;
  const [officer, torvald] = [await idOf(officerEmail), await idOf(memberEmail)];
  const group = (await db.query("INSERT INTO groups (name) VALUES ('Les Veilleurs') RETURNING id")).rows[0].id as string;
  const owner = (await db.query("INSERT INTO users (email, email_verified_at, password_hash, display_name) VALUES ($1, now(), 'demo', 'Maelys') RETURNING id",
    [`maelys-${Date.now()}@example.test`])).rows[0].id as string;
  for (const [user, role] of [[owner, "owner"], [officer, "officer"], [torvald, "member"]]) {
    await db.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)", [group, user, role]);
  }
  for (const [user, name, cls, race, spec, level, g] of [[officer, "Sorelle Hautvent", "Priest", "Troll", "Holy", 30, 11], [torvald, "Torvald Brumegris", "Warrior", "Orc", "Arms", 24, 12]] as const) {
    const id = (await db.query("INSERT INTO characters (user_id, name, race, cls, spec1, level, professions, guid) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
      [user, name, race, cls, spec, level, PROFS, guid(g)])).rows[0].id as string;
    await db.query("INSERT INTO group_characters (group_id, character_id, user_id, is_main) VALUES ($1, $2, $3, true)", [group, id, user]);
  }
  await db.end();

  await test.step("le relevé de l'officière lie la guilde du jeu et sa banque", async () => {
    await paste(page, frlVeilleurs(Math.floor(Date.now() / 1000) - 60));
    await expect(page.getByRole("status", { name: "Export de l'addon" })).toContainText("Les Veilleurs (liée) : liste de 2 membres (complète)");
  });

  const bank = `/groups/${group}/membres/banque`;
  const boxOf = (p: Page) => p.getByRole("region", { name: /^Demandes en cours/ });
  // Une demande en cours (les terminées, dépliées, sont une autre liste)
  const rowOf = (p: Page, text: string) => boxOf(p).getByRole("list", { name: "Demandes en cours" }).getByRole("listitem").filter({ hasText: text });
  await page.goto(bank);
  await member.goto(bank);

  await test.step("sans demande : l'encadré le dit, personne ne traite sauf l'officière", async () => {
    for (const p of [page, member]) {
      await expect(boxOf(p)).toContainText("Demandes en cours (0)");
      await expect(boxOf(p)).toContainText("visibles par toute la guilde");
      await expect(boxOf(p)).toContainText("Aucune demande en cours. Pour en faire une, choisis un objet de la banque.");
      await expect(p.getByRole("button", { name: /^Terminées/ })).toHaveCount(0);
    }
  });

  await test.step("le membre clique une case : petit menu, puis la fenêtre « Demander à la banque »", async () => {
    await member.getByLabel("Rugged Leather × 20").click();
    const pop = member.getByRole("dialog", { name: "Rugged Leather" });
    await expect(pop).toContainText("20 dans la banque");
    await expect(member.locator(".bk-slot.sel")).toHaveCount(1);
    await shot(member, "demander-menu-pc.png");
    // Échap referme le menu et rend le focus à la case
    await member.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
    await expect(member.getByLabel("Rugged Leather × 20")).toBeFocused();
    await member.getByLabel("Rugged Leather × 20").click();
    await pop.getByRole("button", { name: "Demander" }).click();
    const dlg = member.getByRole("dialog", { name: "Demander à la banque" });
    await expect(dlg).toContainText("Rugged Leather · 20 dans la banque");
    await expect(dlg).toContainText("de 1 à 20 (tous les onglets)");
    await dlg.getByRole("spinbutton", { name: "Quantité" }).fill("10");
    await dlg.getByRole("textbox", { name: "Un mot (facultatif)" }).fill("pour monter Travail du cuir");
    await shot(member, "demander-fenetre-pc.png");
    await dlg.getByRole("button", { name: "Envoyer la demande" }).click();
    await expect(dlg).toHaveCount(0);
  });

  await test.step("la demande est en attente chez le membre, et chez l'officière sans recharger", async () => {
    const mine = rowOf(member, "Rugged Leather");
    await expect(boxOf(member)).toContainText("Demandes en cours (1)");
    await expect(mine).toContainText("Torvald Brumegris");
    await expect(mine).toContainText("Toi");
    await expect(mine).toContainText("10 × Rugged Leather");
    await expect(mine).toContainText("« pour monter Travail du cuir »");
    await expect(mine).toContainText("En attente");
    await expect(mine.getByRole("button")).toHaveText(["Annuler"]);
    // Une seule demande ouverte par objet : la case propose « Demande en cours »
    await member.getByLabel("Rugged Leather × 20").click();
    await expect(member.getByRole("dialog", { name: "Rugged Leather" }).getByRole("button", { name: "Demande en cours" })).toBeDisabled();
    await member.keyboard.press("Escape");
    const theirs = rowOf(page, "Rugged Leather");
    await expect(boxOf(page)).toContainText("Demandes en cours (1)");
    await expect(theirs).toContainText("Torvald Brumegris");
    await expect(theirs).not.toContainText("Toi");
    await expect(theirs.getByRole("button")).toHaveText(["Préparer", "Remise", "Refuser"]);
  });

  await test.step("l'officière prépare : le membre voit « Préparée par … » tout de suite", async () => {
    await rowOf(page, "Rugged Leather").getByRole("button", { name: "Préparer Rugged Leather pour Torvald Brumegris" }).click();
    const theirs = rowOf(page, "Rugged Leather");
    await expect(theirs).toContainText("Préparée");
    await expect(theirs).toContainText("par Sorelle");
    await expect(theirs.getByRole("button")).toHaveText(["Remise", "Refuser"]);
    const mine = rowOf(member, "Rugged Leather");
    await expect(mine).toContainText("Préparée");
    await expect(mine).toContainText("par Sorelle");
    await expect(mine).toContainText("à récupérer en jeu");
    await expect(mine.getByRole("button")).toHaveCount(0);
  });

  await test.step("l'officière remet : la demande passe dans « Terminées »", async () => {
    await rowOf(page, "Rugged Leather").getByRole("button", { name: "Marquer Rugged Leather remis à Torvald Brumegris" }).click();
    for (const p of [page, member]) {
      await expect(boxOf(p)).toContainText("Demandes en cours (0)");
      const fold = p.getByRole("button", { name: /^Terminées \(1\)/ });
      await expect(fold).toHaveAttribute("aria-expanded", "false");
      await fold.click();
      const done = boxOf(p).getByRole("list", { name: "Demandes terminées" });
      await expect(done).toContainText("10 × Rugged Leather");
      await expect(done).toContainText("Remise");
      await expect(done.getByRole("button")).toHaveCount(0);
    }
  });

  await test.step("refuser demande un motif facultatif ; annuler est le geste du demandeur", async () => {
    await member.getByLabel("Strange Dust × 5").click();
    await member.getByRole("dialog", { name: "Strange Dust" }).getByRole("button", { name: "Demander" }).click();
    const dlg = member.getByRole("dialog", { name: "Demander à la banque" });
    await dlg.getByRole("button", { name: "Envoyer la demande" }).click();
    await expect(dlg).toHaveCount(0);
    const theirs = rowOf(page, "Strange Dust");
    await theirs.getByRole("button", { name: "Refuser Strange Dust à Torvald Brumegris" }).click();
    await theirs.getByRole("textbox", { name: /Motif du refus/ }).fill("réservé pour le raid");
    await theirs.getByRole("button", { name: "Refuser la demande" }).click();
    await expect(boxOf(page)).toContainText("Demandes en cours (0)");
    await expect(boxOf(member)).toContainText("Demandes en cours (0)");
    await expect(member.getByRole("button", { name: /^Terminées \(2\)/ })).toHaveAttribute("aria-expanded", "true");
    await expect(boxOf(member).getByRole("list", { name: "Demandes terminées" })).toContainText("réservé pour le raid");
    // Une demande en attente s'annule
    await member.getByLabel("Strange Dust × 5").click();
    await member.getByRole("dialog", { name: "Strange Dust" }).getByRole("button", { name: "Demander" }).click();
    await member.getByRole("dialog", { name: "Demander à la banque" }).getByRole("button", { name: "Envoyer la demande" }).click();
    await rowOf(member, "Strange Dust").getByRole("button", { name: "Annuler ma demande de Strange Dust" }).click();
    await expect(boxOf(member)).toContainText("Demandes en cours (0)");
    await expect(boxOf(page)).toContainText("Demandes en cours (0)");
  });

  await test.step("Membres › Par joueur : l'officière nomme Torvald banquier (tag), puis le retire et le renomme", async () => {
    await page.goto(`/groups/${group}/membres/joueurs`);
    const players = page.getByRole("table", { name: "Joueurs de la guilde" });
    const row = players.getByRole("row").filter({ hasText: "Torvald Brumegris" });
    await expect(row).not.toContainText("Banquier");
    await players.getByRole("button", { name: "Actions pour Torvald Brumegris" }).click();
    await page.getByRole("menuitem", { name: "Nommer banquier" }).click();
    await expect(row.locator(".tag", { hasText: "Banquier" })).toBeVisible();
    await players.getByRole("button", { name: "Actions pour Torvald Brumegris" }).click();
    await page.getByRole("menuitem", { name: "Retirer banquier" }).click();
    await expect(row).not.toContainText("Banquier");
    await players.getByRole("button", { name: "Actions pour Torvald Brumegris" }).click();
    await page.getByRole("menuitem", { name: "Nommer banquier" }).click();
    await expect(row.locator(".tag", { hasText: "Banquier" })).toBeVisible();
    await shot(page, "membres-banquier-pc.png");
  });

  await test.step("le banquier voit « À traiter » sur l'accueil et traite la demande de l'officière", async () => {
    // L'officière demande à son tour (Annuler seulement sur sa propre demande en attente)
    await page.goto(bank);
    await page.getByLabel("Strange Dust × 5").click();
    await page.getByRole("dialog", { name: "Strange Dust" }).getByRole("button", { name: "Demander" }).click();
    await page.getByRole("dialog", { name: "Demander à la banque" }).getByRole("button", { name: "Envoyer la demande" }).click();
    await expect(rowOf(page, "Strange Dust").getByRole("button")).toHaveText(["Annuler"]);
    // Torvald est banquier : un membre simple n'avait pas « À traiter », lui l'a, avec les demandes en attente
    await member.goto(`/groups/${group}`);
    const todo = member.getByRole("region", { name: /À traiter/ });
    await expect(todo).toContainText("banquiers");
    await expect(todo.getByRole("listitem")).toHaveCount(1);
    await expect(todo.locator(".tt-n")).toHaveText("1");
    await expect(todo.getByRole("listitem")).toContainText("demande de retrait");
    await expect(todo.getByRole("listitem")).toContainText("Guilde › Banque");
    await todo.getByRole("link", { name: "Voir" }).click();
    await expect(member).toHaveURL(new RegExp(`/groups/${group}/membres/banque$`));
    const theirs = rowOf(member, "Strange Dust");
    await expect(theirs).toContainText("Sorelle Hautvent");
    await expect(theirs.getByRole("button")).toHaveText(["Préparer", "Remise", "Refuser"]);
    // Sa propre demande à lui : « Annuler » seulement ; l'officière voit la sienne avec ses trois gestes
    await member.getByLabel("Rugged Leather × 20").click();
    await member.getByRole("dialog", { name: "Rugged Leather" }).getByRole("button", { name: "Demander" }).click();
    const own = member.getByRole("dialog", { name: "Demander à la banque" });
    await own.getByRole("spinbutton", { name: "Quantité" }).fill("5");
    await own.getByRole("textbox", { name: "Un mot (facultatif)" }).fill("pour Nessa, à son retour");
    await own.getByRole("button", { name: "Envoyer la demande" }).click();
    await expect(rowOf(member, "Rugged Leather").getByRole("button")).toHaveText(["Annuler"]);
    await expect(rowOf(page, "Rugged Leather").getByRole("button")).toHaveText(["Préparer", "Remise", "Refuser"]);
    await shot(member, "banque-demandes-banquier-pc.png");
    await shot(page, "banque-demandes-officiere-pc.png");
    await theirs.getByRole("button", { name: "Préparer Strange Dust pour Sorelle Hautvent" }).click();
    await expect(theirs).toContainText("par Torvald");
    await expect(rowOf(page, "Strange Dust")).toContainText("à récupérer en jeu");
    // Le retrait du rôle ferme l'accès tout de suite : les gestes disparaissent
    await page.goto(`/groups/${group}/membres/joueurs`);
    await page.getByRole("button", { name: "Actions pour Torvald Brumegris" }).click();
    await page.getByRole("menuitem", { name: "Retirer banquier" }).click();
    await expect(member.getByRole("region", { name: /^Demandes en cours/ }).getByRole("button", { name: /Remise/ })).toHaveCount(0);
  });

  await test.step("grand écran : encadré et journal côte à côte ; téléphone : liste « Demander », rien ne déborde", async () => {
    await member.setViewportSize({ width: 1360, height: 900 });
    await member.goto(bank);
    await expect(rowOf(member, "Strange Dust")).toBeVisible();
    for (const width of [390, 360]) {
      await member.setViewportSize({ width, height: 844 });
      await member.goto(bank);
      await expect(member.locator(".bk-list > li").first()).toBeVisible();
      await expect(rowOf(member, "Strange Dust")).toBeVisible();
      await expect(rowOf(member, "Rugged Leather")).toContainText("Toi");
      await expect(member.getByRole("button", { name: "Demander Strange Dust" })).toBeEnabled();
      await expect(member.getByRole("button", { name: "Demande en cours pour Rugged Leather" })).toBeDisabled();
      expect(await member.evaluate(() => document.documentElement.scrollWidth), `banque à ${width} px`).toBeLessThanOrEqual(width);
      if (width === 390) await shot(member, "banque-demandes-390.png");
    }
  });

  expect(problems, "erreurs ou violations CSP chez le membre").toEqual([]);
  await ctx.close();
});
