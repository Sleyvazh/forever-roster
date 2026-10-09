import { expect, test as base, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Un site, deux adresses : Forever Roster (localhost) et Roster, pour WoW Retail (127.0.0.1 en test).
 * Accueil public propre à chaque adresse, même compte sur les deux, Roster limité au compte avant son ouverture.
 * Chaque test échoue s'il y a une erreur JavaScript ou une violation de la CSP.
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

const FOREVER = "http://localhost:4173";
const RETAIL = "http://127.0.0.1:4173";
const LOG = path.resolve("test-results/api.log");

/** Dernier e-mail de confirmation journalisé pour cette adresse : lien et texte. */
function lastVerifyMail(email: string) {
  const line = readFileSync(LOG, "utf8").split("\n").filter(l => l.includes(email) && l.includes("verify-email")).at(-1);
  const m = line?.match(/(https?:\/\/[^\s"\\]+)\/verify-email#([A-Za-z0-9_-]{20,})/);
  if (!line || !m) throw new Error(`Aucun lien verify-email pour ${email}`);
  return { origin: m[1]!, token: m[2]!, line };
}

test("accueil public propre à chaque adresse", async ({ page }) => {
  await test.step("Forever Roster", async () => {
    await page.goto(`${FOREVER}/`);
    await expect(page).toHaveTitle(/^Forever Roster/);
    await expect(page.locator("html")).not.toHaveClass(/retail/);
    await expect(page.locator("meta[name=description]")).toHaveAttribute("content", /WoW Forever/);
    await expect(page.locator(".cta a.primary")).toHaveAttribute("href", "/register");
    await expect(page.locator("figure.shot img")).toHaveJSProperty("complete", true);
    expect(await page.locator("figure.shot img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  });
  await test.step("Roster", async () => {
    await page.goto(`${RETAIL}/`);
    await expect(page).toHaveTitle(/^Roster/);
    await expect(page.locator("html")).toHaveClass(/retail/);
    await expect(page.getByText("Déjà un compte sur Forever Roster ?")).toBeVisible();
    expect(await page.locator("figure.shot img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await page.locator("header .btn", { hasText: "Se connecter" }).click();
    await expect(page).toHaveURL(`${RETAIL}/login`);
    await expect(page).toHaveTitle(/Roster/);
  });
  await test.step("robots.txt", async () => {
    const r = await page.request.get(`${RETAIL}/robots.txt`);
    expect(await r.text()).toContain("Disallow: /api/");
  });
});

test("même compte sur les deux adresses", async ({ page }) => {
  const email = `e2e-sites-${Date.now()}@example.test`;
  const password = "une phrase de passe pour les deux sites";

  await test.step("inscription sur Roster : l'e-mail renvoie vers Roster", async () => {
    await page.goto(`${RETAIL}/register`);
    await page.fill("#dn", "Voyageuse");
    await page.fill("#em", email);
    await page.fill("#pw", password);
    await page.fill("#pw2", password);
    await page.getByRole("button", { name: /créer/i }).click();
    await expect(page.getByText("Vérifie tes e-mails")).toBeVisible();
    await expect.poll(() => { try { return lastVerifyMail(email).token; } catch { return ""; } }).not.toBe("");
    const mail = lastVerifyMail(email);
    expect(mail.origin).toBe(RETAIL);
    expect(mail.line).toContain("Roster");
    expect(mail.line).not.toContain("Forever Roster");
    await page.goto(`${RETAIL}/verify-email#${mail.token}`);
    await expect(page.getByText("Adresse confirmée")).toBeVisible();
  });

  await test.step("connexion sur Roster : ouvert à tous depuis le 08/10", async () => {
    await page.goto(`${RETAIL}/login`);
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await expect(page.getByRole("heading", { name: "Mes personnages" })).toBeVisible();
    await expect(page.locator(".brand")).toHaveAccessibleName(/^Roster/);
    await expect(page.getByRole("heading", { name: "Roster arrive bientôt" })).toHaveCount(0);
    await expect(page.getByText("Accès anticipé")).toHaveCount(0);
    await page.goto(`${RETAIL}/groups`);
    await expect(page.getByRole("heading", { name: "Roster arrive bientôt" })).toHaveCount(0);
    // Accueil public : un visiteur connecté file vers le site
    await page.goto(`${RETAIL}/`);
    await expect(page).toHaveURL(`${RETAIL}/persos`);
  });

  await test.step("même compte sur Forever Roster (connexion à refaire sur cette adresse)", async () => {
    await page.goto(`${FOREVER}/persos`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await expect(page.getByRole("heading", { name: "Mes personnages" })).toBeVisible();
    await expect(page.locator(".brand")).toHaveAccessibleName(/^Forever Roster/);
  });
});

test.describe("Roster (WoW Retail)", () => {
  test.use({ locale: "fr-FR" });

  test("persos et raid de WoW Retail, noms en français ou en anglais", async ({ page }) => {
    const email = `e2e-retail-${Date.now()}@example.test`;
    const password = "une phrase de passe pour Roster";

    await test.step("compte créé sur Roster, tout de suite utilisable", async () => {
      await page.goto(`${RETAIL}/register`);
      await page.fill("#dn", "Officière");
      await page.fill("#em", email);
      await page.fill("#pw", password);
      await page.fill("#pw2", password);
      await page.getByRole("button", { name: /créer/i }).click();
      await expect.poll(() => { try { return lastVerifyMail(email).token; } catch { return ""; } }).not.toBe("");
      await page.goto(`${RETAIL}/verify-email#${lastVerifyMail(email).token}`);
      await expect(page.getByText("Adresse confirmée")).toBeVisible();
      await page.goto(`${RETAIL}/login`);
      await page.fill("#email", email);
      await page.fill("#password", password);
      await page.getByRole("button", { name: /se connecter/i }).click();
      await expect(page.getByRole("heading", { name: "Mes personnages" })).toBeVisible();
      await expect(page.getByText("Accès anticipé")).toHaveCount(0);
      // R3a : l'addon Roster (page Addon, « Copier pour le jeu ») ; pas encore de nouveautés ni de compte à rebours
      await expect(page.getByRole("link", { name: "Addon" }).first()).toBeVisible();
      await expect(page.locator(".topnav").getByRole("button", { name: /Copier pour le jeu/ })).toBeVisible();
      await expect(page.locator(".topnav").getByRole("button", { name: /Nouveautés/ })).toHaveCount(0);
    });

    await test.step("perso créé à la main : classe et spé en français (navigateur en français)", async () => {
      await page.goto(`${RETAIL}/persos`);
      await page.fill("#rcn-name", "Brumelune");
      await page.fill("#rcn-realm", "Hyjal");
      await page.selectOption("#rcn-cls", "Monk");
      await expect(page.locator("#rcn-cls option:checked")).toHaveText("Moine");
      await page.selectOption("#rcn-spec", "Mistweaver");
      await expect(page.locator("#rcn-spec option:checked")).toHaveText("Tisse-brume");
      await page.getByRole("button", { name: "Créer le perso" }).click();
      const sheet = page.getByRole("region", { name: "Fiche de Brumelune" });
      await expect(sheet).toContainText("Moine");
      await expect(sheet.getByRole("link", { name: "Raider.IO" })).toHaveAttribute("href", "https://raider.io/characters/eu/hyjal/brumelune");
      if (process.env.SHOTS) await page.screenshot({ path: "test-results/shots/roster-perso.png", fullPage: true });
    });

    await test.step("import Battle.net (simulé) : persos niveau 90 cochés, fiche déjà là reconnue, mise à jour", async () => {
      await page.getByRole("button", { name: "Importer depuis Battle.net" }).first().click();
      const panel = page.getByRole("region", { name: "Persos de ton compte Battle.net" });
      await expect(panel).toBeVisible();
      await expect(panel.locator(".bi-row", { hasText: "Brumelune" })).toContainText("déjà sur Roster");
      await expect(panel.locator(".bi-row", { hasText: "Brumelune" }).getByRole("checkbox")).not.toBeChecked();
      await expect(panel.locator(".bi-row", { hasText: "Vaelis" }).getByRole("checkbox")).toBeChecked();
      await expect(panel.locator(".bi-row", { hasText: "Petit" }).getByRole("checkbox")).not.toBeChecked();
      if (process.env.SHOTS) await page.screenshot({ path: "test-results/shots/roster-import.png", fullPage: true });
      await panel.getByRole("button", { name: "Importer 1 perso" }).click();
      await expect(panel.getByRole("status")).toContainText("1 perso importé");
      const sheet = page.getByRole("region", { name: "Fiche de Vaelis" });
      await expect(sheet).toContainText("Paladin");
      await expect(sheet).toContainText("ilvl 708");
      await expect(sheet.locator("#rc-s1")).toHaveValue("Protection");
      await page.locator(".card", { hasText: "Brumelune" }).click();
      const brume = page.getByRole("region", { name: "Fiche de Brumelune" });
      await brume.getByRole("button", { name: "Mettre à jour" }).click();
      await expect(brume.locator(".rc-bnet")).toContainText("Niveau d'objet 712");
      await expect(brume.locator(".rc-bnet")).toContainText("Tisse-brume");
      if (process.env.SHOTS) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: "test-results/shots/roster-fiche-bnet.png", fullPage: true }); }
    });

    await test.step("groupe et raid Héroïque : effectif, inscription, buffs de Midnight", async () => {
      await page.getByRole("link", { name: "Groupes" }).first().click();
      await page.fill("#g-name", "Pasta e Basta");
      await page.getByRole("button", { name: "Créer" }).click();
      await expect(page.getByRole("tab", { name: "Personnages" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Artisans" })).toHaveCount(0);
      await page.getByRole("button", { name: "+ Nouveau raid" }).click();
      await page.getByRole("button", { name: "Flèche du Vide" }).click();
      await page.getByRole("group", { name: "Difficulté" }).getByRole("button", { name: "Héroïque" }).click();
      await expect(page.locator("#gr-size")).toHaveValue("20");
      await page.fill("#gr-size", "25");
      // Butin (R3b) : journal ou conseil (distribution par l'addon Roster), pas de soft reserve
      const loot = page.getByRole("radiogroup", { name: "Butin" });
      await expect(loot.getByRole("radio")).toHaveText(["Journal", "Conseil (distribution par Roster)"]);
      await loot.getByRole("radio", { name: "Conseil (distribution par Roster)" }).click();
      await expect(page.locator(".gr-sum")).toContainText("Héroïque · 25 joueurs · Conseil (distribution par Roster)");
      await page.getByRole("button", { name: "Créer le raid" }).click();
      await expect(page.getByRole("heading", { name: "Flèche du Vide" })).toBeVisible();
      await expect(page.locator(".rp-meta")).toContainText("Héroïque · 25 joueurs");
      await expect(page.locator(".rp-meta .tag.gold")).toHaveText("Conseil");
      await expect(page.getByRole("tab", { name: "Butin" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Préparation" })).toHaveCount(0);
      await page.getByRole("tab", { name: /Inscriptions/ }).click();
      await page.selectOption("#su-spec", "Mistweaver");
      await page.getByRole("group", { name: "Mon statut" }).getByRole("button", { name: "Présent" }).click();
      await expect(page.getByText("Tu es inscrit : Présent avec Brumelune (Tisse-brume)")).toBeVisible();
      await page.getByRole("tab", { name: "Compo" }).click();
      await page.getByRole("button", { name: "Ajouter Brumelune au raid" }).click();
      await expect(page.getByText("1 effet couvert sur 14")).toBeVisible();
      await page.getByText("Détail des 14 effets").click();
      await expect(page.getByText("Toucher mystique")).toBeVisible();
      await expect(page.locator(".rgroup")).toHaveCount(5);
      if (process.env.SHOTS) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: "test-results/shots/roster-raid.png", fullPage: true }); }
    });

    await test.step("addon Roster : export de la compo (RRR) et macros /inv Prénom-Royaume", async () => {
      await expect(page.getByText("Enregistré.", { exact: true })).toBeVisible();
      await page.getByText("Export pour le jeu").click();
      const text = await page.locator("#ex-addon").inputValue();
      expect(text).toMatch(/^RRR;1;[0-9a-f-]{36};0;Flèche du Vide;heroic;25\nM;Brumelune-Hyjal;MONK;Heal;Mistweaver;1;1;present;site\nEND;1$/);
      await expect(page.getByText("Texte pour l'addon Roster (format RRR v1)")).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Macro d'invitation 1" })).toHaveValue("/inv Brumelune-Hyjal");
    });

    await test.step("onglet Butin : mode et conseil choisi pour le raid, sans soft reserve", async () => {
      await page.getByRole("tab", { name: "Butin" }).click();
      const mode = page.getByRole("radiogroup", { name: "Butin" });
      await expect(mode.getByRole("radio", { name: "Conseil (distribution par Roster)" })).toHaveAttribute("aria-checked", "true");
      await expect(mode.getByRole("radio", { name: "Soft reserve" })).toHaveCount(0);
      const council = page.getByRole("region", { name: "Conseil du butin" });
      await expect(council).toContainText("Par défaut : les officiers du groupe.");
      const me = council.getByRole("checkbox", { name: /Officière/ });
      await expect(me).toBeChecked();
      // Choisi pour ce raid : la ligne L du texte pour l'addon
      // Case enregistrée tout de suite, cochée d'après la réponse du serveur
      await me.click();
      await expect(me).not.toBeChecked();
      await expect(council.getByRole("button", { name: "Revenir aux officiers" })).toBeVisible();
      await me.click();
      await expect(me).toBeChecked();
      await expect(council).toContainText("Choisi pour ce raid");
      await expect(page.getByText("Le chef de butin reçoit les objets grâce à l'addon Roster")).toBeVisible();
      if (process.env.SHOTS) await page.screenshot({ path: "test-results/shots/roster-butin.png", fullPage: true });
      await page.getByRole("tab", { name: "Compo" }).click();
    });

    await test.step("page Addon de Roster : zip de l'addon Roster, « Copier pour le jeu » en RRG", async () => {
      const raidUrl = page.url();
      const [, groupId, raidId] = raidUrl.match(/\/groups\/([0-9a-f-]{36})\/raids\/([0-9a-f-]{36})/) ?? [];
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.getByRole("link", { name: "Addon" }).first().click();
      await expect(page.getByRole("heading", { name: "Le jeu et le site" })).toBeVisible();
      await expect(page.getByText("Addon Roster", { exact: true })).toBeVisible();
      await expect(page.locator(".addon-steps")).toContainText("World of Warcraft\\_retail_\\Interface\\AddOns\\");
      await expect(page.getByText(/Roster Companion, l'appli qui fait la synchro toute seule, n'est pas encore disponible pour Roster/)).toBeVisible();
      await expect(page.getByRole("link", { name: /Télécharger l'addon Roster/ })).toHaveAttribute("href", "/downloads/Roster.zip");
      const zip = await page.request.get(`${RETAIL}/downloads/Roster.zip`);
      expect(zip.status()).toBe(200);
      expect((await zip.body()).subarray(0, 4).toString("latin1")).toBe("PK\u0003\u0004");
      await page.locator(".topnav").getByRole("button", { name: /Copier pour le jeu/ }).click();
      await expect(page.locator(".topnav").getByRole("button", { name: /Copié/ })).toBeVisible();
      // R3b : conseil par défaut (O), conseil choisi pour ce raid (L), objets reçus (N), hors du compte de END
      expect(await page.evaluate(() => navigator.clipboard.readText()))
        .toMatch(new RegExp(`^RRG;1;${groupId};\\d+;Pasta e Basta\nR;${raidId};0;Flèche du Vide;heroic;25;present;Brumelune-Hyjal;council\nO;Brumelune-Hyjal\nL;${raidId};Brumelune-Hyjal\nN;saison;depuis le début;Brumelune-Hyjal:0\nEND;1$`));
      // Téléphone : onglet Addon en bas, pas de défilement horizontal
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator(".tabbar").getByRole("link", { name: "Addon" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.setViewportSize({ width: 1280, height: 720 });
      if (process.env.SHOTS) await page.screenshot({ path: "test-results/shots/roster-addon.png", fullPage: true });
      await page.goto(raidUrl);
    });

    await test.step("bilan RRB collé (Ctrl+V) par l'officière : onglets Bilan et Présence & butin", async () => {
      const raidUrl = page.url();
      const raidId = raidUrl.match(/\/raids\/([0-9a-f-]{36})/)![1]!;
      const start = Math.floor(Date.now() / 1000) - 3 * 3600, end = start + 3 * 3600;
      const lines = [
        `A;Brumelune-Hyjal;${start};${end};180`,
        `A;Inconnue-Ysondre;${start + 600};${start + 1200};10`,
        `L;249321;Brumelune-Hyjal;${start + 1800};Imperator Averzian;;;;Lame du Vide hurlant`,
        // R3b : objets distribués par Roster (conseil BiS : compte ; jet OS : ne compte pas)
        `L;249400;Brumelune-Hyjal;${start + 1900};Imperator Averzian;council;bis;3 votes;Heaume du Vide`,
        `L;249401;Brumelune-Hyjal;${start + 2000};Imperator Averzian;roll;;OS 54;Bottes du Vide`,
        `E;3176;Imperator Averzian;${start + 1500};0`,
        `E;3176;Imperator Averzian;${start + 1750};1`,
      ];
      const rrb = [`RRB;1;${raidId};${start};${end};Brumelune-Hyjal;Flèche du Vide;The Voidspire;1;heroic`, ...lines, `END;${lines.length}`].join("\n");
      const paste = (text: string) => page.evaluate(t => {
        const dt = new DataTransfer();
        dt.setData("text/plain", t);
        (document.activeElement as HTMLElement | null)?.blur();
        document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
      }, text);
      await page.getByRole("link", { name: "Mes persos" }).first().click();
      // Un texte de l'addon Forever Roster est refusé sur Roster
      await paste("FRC;2;Tournicoti;Forever EU;DRUID;Tauren;60;Horde;1790000000;1.5.4\nEND;0");
      const dialog = page.getByRole("dialog", { name: "Export de l'addon" });
      await expect(dialog).toContainText("Texte de l'autre addon");
      await expect(dialog).toContainText("Ce texte vient de l'addon Forever Roster : colle-le sur localhost:4173.");
      await dialog.getByRole("button", { name: "Fermer" }).click();
      await paste(rrb);
      await expect(dialog).toContainText("Bilan de Flèche du Vide");
      await expect(dialog).toContainText("2 présents · 3 objets · 1 boss vaincu · relevé par Brumelune-Hyjal");
      await dialog.getByRole("button", { name: "Enregistrer le bilan" }).click();
      await expect(dialog).toContainText("Bilan de Flèche du Vide : enregistré · 2 présents, 3 objets, 1 boss vaincu · sans fiche : Inconnue-Ysondre");
      await dialog.getByRole("button", { name: "Fermer" }).click();
      await page.goto(raidUrl);
      await page.getByRole("tab", { name: "Bilan" }).click();
      const bilan = page.getByRole("region", { name: "Bilan du raid" });
      await expect(bilan).toContainText("Héroïque");
      await expect(bilan).toContainText("1 vaincu sur 1 tenté");
      await expect(bilan.getByRole("row", { name: /Imperator Averzian.*2.*Vaincu à/ })).toBeVisible();
      await expect(bilan.getByRole("row", { name: /Brumelune.*Présent/ })).toBeVisible();
      await expect(bilan.getByRole("row", { name: /Inconnue-Ysondre.*sans fiche/ })).toBeVisible();
      // Nom de l'objet donné par l'addon (le site n'a pas la base des objets de Retail)
      await expect(bilan.getByRole("link", { name: "Lame du Vide hurlant" })).toHaveAttribute("href", "https://www.wowhead.com/fr/item=249321");
      // R3b : méthode de chaque objet distribué, ce qui compte dans « Reçus », exclusion par l'officière
      await expect(bilan.getByRole("row", { name: /Heaume du Vide.*Conseil : BiS · 3 votes/ })).toBeVisible();
      await expect(bilan.getByRole("row", { name: /Bottes du Vide.*Jet OS 54.*ne compte pas · jet OS/ })).toBeVisible();
      await expect(bilan.getByRole("button", { name: "Ne pas compter" })).toHaveCount(2);
      const lame = bilan.getByRole("row", { name: /Lame du Vide hurlant/ });
      await lame.getByRole("button", { name: "Ne pas compter" }).click();
      await expect(lame.getByRole("button", { name: "Compter" })).toBeVisible();
      await expect(lame).toContainText("ne compte pas");
      if (process.env.SHOTS) await bilan.screenshot({ path: "test-results/shots/roster-bilan.png" });
      await page.getByRole("link", { name: "Retour au groupe" }).click();
      await expect(page.getByRole("tab", { name: "Artisans" })).toHaveCount(0);
      await page.getByRole("tab", { name: "Présence & butin" }).click();
      await expect(page).toHaveURL(/\/presence$/);
      // Reçus : le Heaume (conseil BiS) ; pas les Bottes (jet OS) ni la Lame (sortie du compte)
      const table = page.locator("table.rl-att");
      await expect(table.getByRole("columnheader", { name: "Reçus · saison" })).toBeVisible();
      await expect(table.getByRole("row", { name: /Brumelune.*1\/1.*Bottes du Vide/ })).toBeVisible();
      await expect(table.getByRole("row", { name: /Brumelune/ }).locator("td.r .num")).toHaveText("1");
      // Détail sous le total (retours du raid de test) : BiS, Upgrade, jets MS
      await expect(table.getByRole("row", { name: /Brumelune/ }).locator("td.r .lc-det")).toHaveText("1 BiS");
      // Administration → Butin : période du compte (pas de réglages de soft reserve sur Roster)
      await page.getByRole("tab", { name: "Administration" }).click();
      await page.locator(".adm-nav").getByRole("button", { name: "Butin" }).click();
      await expect(page.getByRole("heading", { name: "Objets reçus" })).toBeVisible();
      await expect(page.locator("#lt-count")).toHaveCount(0);
      // Historique d'avant le site, collé tel quel : une correction BiS et une correction Upgrade (« Spé 1 ») par joueur reconnu
      await page.getByRole("button", { name: "Importer un historique" }).click();
      await page.getByRole("textbox", { name: "Liste des objets reçus" }).fill([
        "Season loot count - 9 items (Season 2)", "", "Brumelune - BiS 1, Spé 1 1 (total 2)", "  - Crochet de malveillance ombreuse", "  - Idole tissée de venin",
        "Quinlan - BiS 3, Spé 1 4 (total 7)", "  - Chaîne vitriolique de sentinelle",
      ].join("\n"));
      await page.getByRole("button", { name: "Vérifier" }).click();
      const hist = page.locator("table.data").filter({ hasText: "Dans la liste" });
      await expect(hist.getByRole("row", { name: /Brumelune.*2.*Brumelune-Hyjal.*à ajouter/ })).toBeVisible();
      await expect(hist.getByRole("row", { name: /Quinlan.*7.*pas dans le groupe/ })).toBeVisible();
      if (process.env.SHOTS) await page.locator(".lt-add").screenshot({ path: "test-results/shots/roster-historique.png" });
      await page.getByRole("button", { name: "Ajouter 1 joueur" }).click();
      await expect(page.getByRole("status").filter({ hasText: "1 joueur ajouté au compte (Historique Season 2)." })).toBeVisible();
      await expect(hist.getByRole("row", { name: /Brumelune.*déjà importé/ })).toBeVisible();
      await page.getByRole("tab", { name: "Présence & butin" }).click();
      await expect(table.getByRole("row", { name: /Brumelune/ }).locator("td.r .num")).toHaveText("3");
      await expect(table.getByRole("row", { name: /Brumelune/ }).locator("td.r .lc-det")).toHaveText("2 BiS · 1 Up");
      if (process.env.SHOTS) await table.screenshot({ path: "test-results/shots/roster-recus-detail.png" });
      // Fiche du joueur (onglet Membres) : total, détail, et les deux corrections de l'historique avec leur catégorie
      await page.getByRole("tab", { name: "Membres" }).click();
      await page.locator("table.mb-table").getByRole("button", { name: "Officière", exact: true }).click();
      const fiche = page.locator(".ps");
      await expect(fiche.locator(".lc-sum")).toContainText("3 objets depuis le début");
      await expect(fiche.locator(".lc-sum .lc-det")).toHaveText("2 BiS · 1 Up");
      const corr = fiche.getByRole("list", { name: "Corrections des officiers" });
      await expect(corr.getByRole("listitem").filter({ hasText: "Historique Season 2 : 1 BiS" }).locator(".lc-kind")).toHaveText("BiS");
      await expect(corr.getByRole("listitem").filter({ hasText: "Historique Season 2 : 1 Spé 1" }).locator(".lc-kind")).toHaveText("Upgrade");
      // Correction manuelle avec une catégorie (Jet MS)
      await page.selectOption("#lc-kind", "ms");
      await page.fill("#lc-note", "Jet MS hors addon");
      await page.getByRole("button", { name: "Corriger le compte" }).click();
      await expect(corr.getByRole("listitem").filter({ hasText: "Jet MS hors addon" }).locator(".lc-kind")).toHaveText("Jet MS");
      await expect(fiche.locator(".lc-sum .lc-det")).toHaveText("2 BiS · 1 Up · 1 MS");
      // Téléphone : la fiche ne déborde pas
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      if (process.env.SHOTS) await fiche.screenshot({ path: "test-results/shots/roster-fiche-detail-mobile.png" });
      await page.setViewportSize({ width: 1280, height: 720 });
      // « Copier pour le jeu » : ligne D juste après N (BiS:Upgrade:MS), mêmes entrées
      await page.locator(".topnav").getByRole("button", { name: /Copier pour le jeu/ }).click();
      await expect(page.locator(".topnav").getByRole("button", { name: /Copié/ })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText()))
        .toMatch(new RegExp(`^RRG;1;[0-9a-f-]{36};\\d+;Pasta e Basta\nR;${raidId};0;Flèche du Vide;heroic;25;present;Brumelune-Hyjal;council\nO;Brumelune-Hyjal\nL;${raidId};Brumelune-Hyjal\nN;saison;depuis le début;Brumelune-Hyjal:4\nD;Brumelune-Hyjal:2:1:1\nEND;1$`));
      await page.getByRole("tab", { name: "Administration" }).click();
      await page.locator(".adm-nav").getByRole("button", { name: "Butin" }).click();
      await page.selectOption("#lt-cm", "raids");
      await expect(page.getByRole("status").filter({ hasText: "Enregistré." })).toBeVisible();
      await page.getByRole("tab", { name: "Présence & butin" }).click();
      await expect(table.getByRole("columnheader", { name: "Reçus · 5 raids" })).toBeVisible();
      await page.goto(raidUrl);
    });

    await test.step("noms en anglais au choix du compte", async () => {
      const raid = page.url();
      await page.goto(`${RETAIL}/account`);
      await page.selectOption("#gl", "en");
      await expect(page.getByText("Enregistré.")).toBeVisible();
      await page.goto(raid);
      await page.getByText("Détail des 14 effets").click();
      await expect(page.getByText("Mystic Touch")).toBeVisible();
      await expect(page.locator(".rp-meta")).toContainText("Heroic · 25 joueurs");
    });
  });
});
