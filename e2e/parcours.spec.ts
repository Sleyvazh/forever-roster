import { expect, test as base, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Parcours complet d'un joueur, sur le site construit comme en production.
 * Chaque test échoue s'il y a une erreur JavaScript ou une violation de la CSP :
 * c'est ce qui avait bloqué l'envoi d'image en production sans qu'aucun test ne le voie.
 */
const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const problems: string[] = [];
    page.on("pageerror", e => problems.push(`Erreur JS : ${e.message}`));
    page.on("console", m => {
      if (m.type() !== "error") return;
      const url = m.location().url ?? "";
      if (url.includes("/icons/")) return; // icônes du jeu absentes en test : repli prévu par le site
      problems.push(`Console : ${m.text().slice(0, 200)}`);
    });
    await use(page);
    expect(problems, "erreurs ou violations CSP pendant le test").toEqual([]);
  },
});

const LOG = path.resolve("test-results/api.log");
/** Dernier lien de confirmation envoyé à cette adresse (e-mails journalisés par l'API en mode test). */
function lastToken(email: string, kind: "verify-email" | "reset-password") {
  const lines = readFileSync(LOG, "utf8").split("\n").filter(l => l.includes(email) && l.includes(kind));
  const m = lines.at(-1)?.match(new RegExp(`${kind}#([A-Za-z0-9_-]{20,})`));
  if (!m) throw new Error(`Aucun lien ${kind} pour ${email}`);
  return m[1]!;
}

test("inscription, fiche, portrait, patrons, équipement, groupe", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`;
  const password = "une phrase de passe pour les tests";

  await test.step("inscription et confirmation de l'adresse", async () => {
    await page.goto("/register");
    await page.fill("#dn", "Testeur");
    await page.fill("#em", email);
    await page.fill("#pw", password);
    await page.fill("#pw2", password);
    await page.getByRole("button", { name: /créer/i }).click();
    await expect(page.getByText("Vérifie tes e-mails")).toBeVisible();
    await expect.poll(() => { try { return lastToken(email, "verify-email"); } catch { return ""; } }).not.toBe("");
    await page.goto(`/verify-email#${lastToken(email, "verify-email")}`);
    await expect(page.getByText("Adresse confirmée")).toBeVisible();
  });

  await test.step("connexion", async () => {
    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await expect(page.getByRole("heading", { name: "Mes personnages" })).toBeVisible();
  });

  await test.step("création d'un perso et sauvegarde automatique", async () => {
    // Compte sans perso : les trois étapes de démarrage à la place de la liste
    await expect(page.getByRole("heading", { name: "Trois étapes pour commencer" })).toBeVisible();
    if (process.env.SHOTS) await page.screenshot({ path: "test-results/shots/start.png", fullPage: true });
    await page.getByRole("button", { name: "+ Créer mon perso" }).click();
    await page.fill("#f-name", "Tournicoti");
    await page.selectOption("#f-race", "Tauren");
    await page.selectOption("#f-cls", "Druid");
    await page.selectOption("#f-spec-main", "Feral Cat");
    await expect(page.getByText("Enregistré.")).toBeVisible();
    await page.reload();
    await expect(page.locator(".dhead h2")).toContainText("Tournicoti");
    await expect(page.locator("#f-spec-main")).toHaveValue("Feral Cat");
    // Import d'un build ForeverChanges : répartition calculée, puis appliquée à la spé principale
    await page.fill("#f-import", "https://foreverchanges.pro/talents/priest?b=5");
    await expect(page.locator(".bi-result")).toContainText("Ce build est pour la classe Priest");
    await page.fill("#f-import", "https://foreverchanges.pro/talents/druid?b=050022-5520002123032213051-05");
    await expect(page.locator(".bi-result")).toContainText("plus que les 0 disponibles");
    await page.fill("#f-level", "60");
    await page.locator("#f-level").blur();
    await expect(page.locator(".bi-result")).toContainText("Build complet : 51/51 points.");
    await page.getByRole("button", { name: "Appliquer à la spé principale" }).click();
    await expect(page.locator("#f-tal-main")).toHaveValue("9/37/5");
    await expect(page.locator(".tt.main .tt-pts").first()).toHaveText("37");
    // Vue « Arbres » : les vrais arbres de Forever, rangs lus depuis le lien
    await page.getByRole("group", { name: "Affichage des arbres" }).getByRole("button", { name: "Arbres" }).click();
    await expect(page.locator(".tt-col.main .tg-slot.on").first()).toBeVisible();
    await expect(page.locator(".build").first().locator(".tt-col.main .tg-slot.on")).toHaveCount(14);
    await page.locator(".build").first().getByLabel("Ferocity : 5/5").hover();
    await expect(page.locator(".itip")).toContainText("Rang 5/5");
    await page.mouse.move(0, 0);
  });

  await test.step("portrait : recadrage puis envoi (sous la CSP de production)", async () => {
    await page.getByRole("button", { name: "Changer le portrait de Tournicoti" }).click();
    await page.locator(".upl input[type=file]").setInputFiles(path.resolve("e2e/fixtures/portrait.png"));
    const save = page.locator(".upl .btn.primary");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.locator(".dhead .portrait-img")).toBeVisible();
    await expect(page.locator(".dhead .portrait-img")).toHaveJSProperty("naturalWidth", 200);
  });

  await test.step("métiers : cocher un patron", async () => {
    await page.getByRole("tab", { name: "Métiers" }).click();
    // Perso et onglet dans l'adresse : rechargement et retour arrière
    await expect(page).toHaveURL(/\/persos\/[0-9a-f-]{36}\/metiers$/);
    await page.reload();
    await expect(page.getByRole("tab", { name: "Métiers" })).toHaveAttribute("aria-selected", "true");
    await page.goBack();
    await expect(page.getByRole("tab", { name: "Profil & talents" })).toHaveAttribute("aria-selected", "true");
    await page.goForward();
    await page.selectOption("#p1-n", "Leatherworking");
    await page.fill("#p1-s", "300");
    await page.locator("#p1-s").press("ArrowDown");
    await expect(page.locator("#p1-s")).toHaveValue("295");
    await page.locator("#p1-s").fill("0450");
    await expect(page.locator("#p1-s")).toHaveValue("300");
    const card = page.locator("details.recipes").first();
    await card.locator("summary").click();
    await card.getByRole("button", { name: "Je connais Warbear Woolies" }).click();
    await expect(card.getByRole("button", { name: "Je connais Warbear Woolies" })).toHaveAttribute("aria-pressed", "true");
    await expect(card.locator("summary")).toContainText("1 connu");
  });

  await test.step("équipement : choisir un objet dans la base", async () => {
    await page.getByRole("tab", { name: "Équipement" }).click();
    await page.getByRole("button", { name: /^Tête : vide/ }).click();
    await page.getByRole("combobox", { name: "Équipé : Tête" }).fill("helm");
    await page.getByRole("option", { name: /Helm of Might/ }).click();
    await page.getByRole("button", { name: "Fermer" }).click();
    await page.getByRole("button", { name: /^Tête : Helm of Might/ }).hover();
    await expect(page.locator(".itip")).toContainText("Niveau d'objet 66");
    await expect(page.locator(".itip")).toContainText("608 Armure");
    await expect(page.locator(".itip")).toContainText("+19 Force");
    await expect(page.locator(".itip")).toContainText("Battlegear of Might");
  });

  await test.step("addon : mise à jour de la fiche depuis l'export du jeu", async () => {
    await page.getByRole("tab", { name: "Profil & talents" }).click();
    // La fiche n'a plus de zone d'import : Ctrl+V n'importe où (lot F), avec le choix des parties
    await expect(page.locator(".ce-sync")).toContainText("jamais synchronisé");
    await page.evaluate(text => {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      (document.activeElement as HTMLElement | null)?.blur();
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    }, readFileSync(path.resolve("addon/tests/sample.frc"), "utf8"));
    const pasted = page.getByRole("dialog", { name: "Export de l'addon" });
    await expect(pasted).toContainText("Tournicoti");
    await expect(pasted).toContainText("2 patrons");
    await pasted.getByText("Choisir quoi importer").click();
    await expect(pasted.getByRole("checkbox", { name: "Équipement porté" })).toBeChecked();
    await pasted.getByRole("button", { name: "Mettre à jour 1 perso" }).click();
    await expect(pasted).toContainText("Tournicoti : fiche mise à jour · 2 patrons cochés");
    await pasted.getByRole("button", { name: "Fermer" }).click();
    await expect(page.locator(".ce-sync")).toContainText("synchro il y a moins d'une heure");
    await expect(page.locator("#f-tal-main")).toHaveValue("0/8/0");
    await expect(page.locator("#f-link-main")).toHaveValue("https://foreverchanges.pro/talents/druid?b=-53");
    await expect(page.locator(".build").first().locator(".tt-col.main .tg-slot.on")).toHaveCount(2);
    await page.getByRole("tab", { name: "Équipement" }).click();
    await expect(page.getByRole("button", { name: /^Jambes : Warbear Woolies/ })).toBeVisible();
  });

  await test.step("groupe : l'onglet Artisans montre le patron coché", async () => {
    await page.getByRole("link", { name: "Groupes" }).first().click();
    await page.fill("#g-name", "Les Testeurs");
    await page.getByRole("button", { name: "Créer" }).click();
    await page.getByRole("tab", { name: "Artisans" }).click();
    await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}\/artisans$/);
    await page.reload();
    await expect(page.getByRole("row", { name: /Warbear Woolies.*Tournicoti/ })).toBeVisible();
    // Infobulle de l'objet fabriqué : « Où l'obtenir » avec le patron et qui le connaît
    await page.getByRole("row", { name: /Warbear Woolies.*Tournicoti/ }).locator(".ihover").first().hover();
    await expect(page.locator(".itip")).toContainText("Où l'obtenir");
    await expect(page.locator(".itip")).toContainText("Pattern: Warbear Woolies");
    await expect(page.locator(".itip")).toContainText("Connu par : Tournicoti (toi)");
    await page.mouse.move(0, 0);
    // Commandes d'artisanat (lot F) : « Commander » depuis la liste, composants de la recette, puis annulation
    await page.getByRole("row", { name: /Warbear Woolies.*Tournicoti/ }).getByRole("button", { name: "Commander" }).click();
    await expect(page.locator(".co-pick")).toContainText("Peuvent le faire : Tournicoti");
    await page.fill("#co-note", "Pas pressé");
    await page.getByRole("button", { name: "Envoyer la commande" }).click();
    const order = page.locator(".co-table tr").filter({ hasText: "Warbear Woolies" });
    await expect(order).toContainText("Ouverte");
    await expect(order).toContainText("Pas pressé");
    await expect(page.locator(".co-head")).toContainText("1 en cours");
    if (process.env.SHOTS) await page.screenshot({ path: "test-results/shots/commandes.png", fullPage: true });
    await order.getByRole("button", { name: "Annuler" }).click();
    await expect(page.locator(".co-head")).toContainText("0 en cours");
    // Données pour l'addon : le patron Warbear Woolies (objet 15090) et qui le connaît
    await page.getByRole("tab", { name: "Administration" }).click();
    await page.locator(".adm-nav").getByRole("button", { name: "Données pour l'addon" }).click();
    await page.locator(".export summary").click();
    await expect(page.locator("#ga-text")).toHaveValue(/^FRG;1;[0-9a-f-]{36};\d+;Les Testeurs\nP;15090;Warbear Woolies;;Tournicoti\nEND;1$/);
  });

  await test.step("page Addon : téléchargement, copier pour le jeu, collage n'importe où de plusieurs persos", async () => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("link", { name: "Addon" }).first().click();
    await expect(page.getByRole("heading", { name: "Le jeu et le site" })).toBeVisible();
    const zip = await page.request.get("/downloads/ForeverRoster.zip");
    expect(zip.status()).toBe(200);
    expect((await zip.body()).subarray(0, 4).toString("latin1")).toBe("PK\u0003\u0004");
    // « Copier pour le jeu » : barre du haut (toutes les pages) et étape 2
    await page.locator(".topnav").getByRole("button", { name: /Copier pour le jeu/ }).click();
    await expect(page.locator(".topnav").getByRole("button", { name: /Copié/ })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^FRG;1;[0-9a-f-]{36};\d+;Les Testeurs\nP;15090;Warbear Woolies;;Tournicoti\nEND;1$/);
    // La page explique la synchro sans la refaire : copier et coller se font depuis n'importe quelle page
    await expect(page.getByRole("heading", { name: "Synchroniser" })).toBeVisible();
    await expect(page.locator(".addon-step").getByRole("button", { name: "Copier pour le jeu" })).toHaveCount(0);
    // Téléphone : pas de défilement horizontal
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.setViewportSize({ width: 1360, height: 900 });
    // Export de deux persos collé n'importe où (Ctrl+V hors d'un champ) : Tournicoti (fiche existante), Greta (nouvelle fiche)
    const sample = readFileSync(path.resolve("addon/tests/sample.frc"), "utf8").trim();
    const both = `${sample}\nFRC;2;Greta;Forever EU;DRUID;Tauren;20;Horde;1790000500;0.5.0\nG;1:16866\nW;15090;1\nEND;2`;
    await page.getByRole("link", { name: "Mes persos" }).first().click();
    await page.evaluate(text => {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      (document.activeElement as HTMLElement | null)?.blur();
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    }, both);
    const dialog = page.getByRole("dialog", { name: "Export de l'addon" });
    await expect(dialog).toContainText("Export de l'addon reconnu");
    await expect(dialog.getByRole("combobox", { name: "Fiche pour Tournicoti" })).toHaveValue(/[0-9a-f-]{36}/);
    await expect(dialog.getByRole("combobox", { name: "Fiche pour Greta" })).toHaveValue("new");
    await dialog.getByRole("button", { name: "Mettre à jour 1 perso et créer 1 fiche" }).click();
    await expect(dialog).toContainText("Greta : fiche créée · 1 recherché ajouté");
    await expect(dialog).toContainText("Tournicoti : fiche mise à jour");
    await expect(page.getByRole("button", { name: /Greta/ }).first()).toBeVisible();
    await dialog.getByRole("button", { name: "Fermer" }).click();
    // Dernière synchro, page Addon
    await page.getByRole("link", { name: "Addon" }).first().click();
    await expect(page.locator(".addon-sync")).toContainText("synchro il y a moins d'une heure");
    await page.getByRole("link", { name: "Groupes" }).first().click();
    await page.getByRole("link", { name: /Les Testeurs/ }).click();
  });

  await test.step("Roster Companion : appairage d'un appareil", async () => {
    // L'appli demande un code (sans compte), le joueur le valide sur le site, l'appli reçoit son jeton
    const start = await (await page.request.post("/api/devices/pair", { data: { name: "PC-E2E", platform: "Windows 11", appVersion: "0.1.0" } })).json();
    await page.goto(`/appairer?code=${start.userCode}`);
    await expect(page.getByRole("heading", { name: "Relier un appareil" })).toBeVisible();
    await expect(page.locator(".cp-code")).toHaveText(start.userCode);
    await expect(page.locator(".cp-dev")).toContainText("Roster Companion sur PC-E2E");
    await page.getByRole("button", { name: "Autoriser cet appareil" }).click();
    await expect(page.getByRole("status")).toContainText("PC-E2E est relié à ton compte");
    await new Promise(r => setTimeout(r, 4200)); // intervalle d'attente de l'appli
    const done = await (await page.request.post("/api/devices/pair/poll", { data: { pairId: start.pairId } })).json();
    expect(done.status).toBe("approved");
    const frg = await page.request.get("/api/sync/frg", { headers: { authorization: `Bearer ${done.token}` } });
    expect(frg.status()).toBe(200);
    expect((await frg.json()).text).toContain("Les Testeurs");
    // Compte & sécurité : l'appareil, le journal, et « Délier »
    await page.goto("/account");
    const section = page.locator("#appareils");
    await expect(section).toContainText("PC-E2E");
    await expect(page.getByText("Appareil relié : PC-E2E")).toBeVisible();
    await section.getByRole("button", { name: "Délier" }).click();
    await expect(page.getByText("PC-E2E délié.")).toBeVisible();
    expect((await page.request.get("/api/sync/frg", { headers: { authorization: `Bearer ${done.token}` } })).status()).toBe(401);
    await page.getByRole("link", { name: "Groupes" }).first().click();
    await page.getByRole("link", { name: /Les Testeurs/ }).click();
  });

  await test.step("fiche joueur", async () => {
    await page.getByRole("tab", { name: /Membres/ }).click();
    await page.locator(".ps-link").first().click();
    await expect(page.locator(".ps")).toContainText("raids venus");
    await page.locator(".ps").getByRole("button", { name: "Fermer" }).click();
  });

  await test.step("persos du groupe : main et alts", async () => {
    await page.getByRole("tab", { name: "Personnages" }).click();
    // Rien par défaut : on choisit ses persos, le premier devient main
    const mine = page.getByRole("region", { name: "Mes persos dans ce groupe" });
    await expect(mine).toContainText("Tu ne joues encore aucun perso dans Les Testeurs");
    await mine.getByRole("button", { name: /Tournicoti/ }).click();
    await expect(page.locator(".gm-fold")).toContainText("★ Tournicoti");
    // Greta : rangée dans le groupe depuis Mes persos (un perso = un groupe), en alt
    await page.locator(".gm-fold").getByRole("link", { name: "Gérer dans Mes persos" }).click();
    await expect(page.locator(".ch-sec").filter({ hasText: "Les Testeurs" })).toContainText("Tournicoti");
    await page.locator(".card").filter({ hasText: "Greta" }).click();
    await expect(page.locator("#ch-group")).toHaveValue("");
    await page.selectOption("#ch-group", { label: "Les Testeurs" });
    await expect(page.locator(".ch-sec").filter({ hasText: "Les Testeurs" })).toContainText("Greta");
    await expect(page.locator(".ch-gbar").getByRole("button", { name: "Alt" })).toHaveAttribute("aria-pressed", "true");
    if (process.env.SHOTS) await page.screenshot({ path: "test-results/shots/persos-par-groupe.png", fullPage: true });
    await page.getByRole("link", { name: "Groupes" }).first().click();
    await page.getByRole("link", { name: /Les Testeurs/ }).click();
    await page.getByRole("tab", { name: "Personnages" }).click();
    await expect(page.locator(".grow").filter({ hasText: "Greta" })).toContainText("alt");
    if (process.env.SHOTS) await page.screenshot({ path: "test-results/shots/mains-alts.png", fullPage: true });
    // Mains seulement : l'alt disparaît ; vue par joueur
    await page.getByRole("group", { name: "Persos" }).getByRole("button", { name: "Mains", exact: true }).click();
    await expect(page.locator(".grow").filter({ hasText: "Greta" })).toHaveCount(0);
    await page.getByRole("group", { name: "Persos" }).getByRole("button", { name: "Mains + alts" }).click();
    await page.getByRole("group", { name: "Affichage" }).getByRole("button", { name: "Par joueur" }).click();
    await expect(page.locator(".gm-player")).toHaveCount(1);
    if (process.env.SHOTS) await page.screenshot({ path: "test-results/shots/par-joueur.png", fullPage: true });
    await page.getByRole("group", { name: "Affichage" }).getByRole("button", { name: "Liste" }).click();
  });

  await test.step("raid : création, inscription et composition", async () => {
    await page.getByRole("tab", { name: "Raids" }).click();
    await page.getByRole("button", { name: "+ Nouveau raid" }).click();
    await page.fill("#gr-name", "Molten Core");
    await page.getByRole("button", { name: "Créer le raid" }).click();
    await expect(page.getByRole("heading", { name: "Molten Core" })).toBeVisible();
    // Butin : passage en soft reserve depuis la page du raid (officier)
    await page.getByRole("tab", { name: "Butin" }).click();
    await page.getByRole("radio", { name: "Soft reserve" }).click();
    await expect(page.getByRole("heading", { name: "Soft reserve" })).toBeVisible();
    await expect(page.getByText("Aucune réservation pour l'instant.")).toBeVisible();
    if (process.env.SHOTS) await page.screenshot({ path: "test-results/shots/softres.png", fullPage: true });
    // Format du raid : 10 joueurs, 2 groupes ; besoins de la compo
    await page.getByRole("tab", { name: "Réglages" }).click();
    await page.getByRole("group", { name: "Format du raid" }).getByRole("button", { name: "10" }).click();
    await page.getByRole("tab", { name: "Compo" }).click();
    await expect(page.locator(".rgroup")).toHaveCount(2);
    await expect(page.locator(".ra")).toContainText("raid à 10");
    await page.getByRole("tab", { name: /Inscriptions/ }).click();
    await page.selectOption("#su-spec", "Feral Bear");
    await page.getByRole("group", { name: "Mon statut" }).getByRole("button", { name: "Présent" }).click();
    await expect(page.getByText("Tu es inscrit : Présent avec Tournicoti (Feral Bear)")).toBeVisible();
    await expect(page.locator(".su-col").filter({ hasText: "Tank" })).toContainText("Tournicoti");
    await page.getByRole("tab", { name: "Compo" }).click();
    // L'officier place l'inscrit : le rôle affiché suit la spé choisie pour ce raid
    await page.getByRole("button", { name: "Ajouter Tournicoti au raid" }).click();
    await expect(page.getByRole("button", { name: /Groupe 1, place 1 : Tournicoti/ })).toContainText("Tank");
    // Survol : niveau d'objet moyen et BiS du joueur
    await page.getByRole("button", { name: /Groupe 1, place 1 : Tournicoti/ }).hover();
    await expect(page.locator(".itip")).toContainText("Niveau d'objet moyen66");
    await expect(page.locator(".itip")).toContainText("BiS obtenus0/17");
    await page.mouse.move(0, 0);
    // Inscrit sans compte (fait depuis le bot Discord) : placé comme un perso du site
    await expect(page.getByRole("status").filter({ hasText: "Enregistré." })).toBeVisible();
    const raidId = page.url().split("/raids/")[1]!.split("/")[0]!;
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL_E2E ?? "postgres://forever:forever@localhost:5432/forever_e2e" });
    await db.connect();
    await db.query(`INSERT INTO raid_signups (raid_id, discord_user_id, display_name, cls, spec, status) VALUES ($1, '720000000000000001', 'Chamy', 'Shaman', 'Enhancement DPS', 'present')`, [raidId]);
    // Consommable pour l'onglet Préparation (lot G)
    await db.query(`INSERT INTO game_items (id, name, quality, item_level, req_level, class_id, subclass_id, inventory_type) VALUES (13457, 'Greater Fire Protection Potion', 1, 48, 38, 0, 0, 0) ON CONFLICT DO NOTHING`);
    await db.end();
    await page.reload();
    await page.getByRole("button", { name: "Ajouter Chamy au raid" }).click();
    await expect(page.getByRole("button", { name: /Groupe 1, place 2 : Chamy/ })).toContainText("Discord");
    await page.locator(".rp-covd summary").click();
    await expect(page.locator(".cov .it.on").filter({ hasText: "Windfury Totem" })).toBeVisible();

    // Compo publiée sur Discord, puis export pour le jeu
    await page.getByRole("button", { name: "Publier la compo" }).click();
    await expect(page.locator(".rp-meta")).toContainText("Compo publiée");
    await page.getByText("Export pour le jeu").click();
    await expect(page.locator("#ex-addon")).toHaveValue(/^FRR;1;[0-9a-f-]{36};0;Molten Core\nM;Tournicoti;DRUID;Tank;Feral Bear;1;1;present;site\nM;Chamy;SHAMAN;DPS;Enhancement DPS;1;2;present;discord\nEND;2$/);
    await expect(page.getByRole("textbox", { name: "Macro d'invitation 1" })).toHaveValue("/inv Tournicoti");
    await expect(page.getByText("À inviter à la main (inscrits sans compte, pseudo Discord) : Chamy.")).toBeVisible();
    // Préparation (lot G) : consommable demandé, qui est prêt, fiche de Ragnaros (Molten Core reconnu d'après le nom)
    await page.getByRole("tab", { name: "Préparation" }).click();
    await page.getByRole("button", { name: "+ Consommable" }).click();
    await page.getByRole("searchbox", { name: "Chercher un consommable" }).fill("fire protection");
    await page.getByRole("button", { name: "[Greater Fire Protection Potion]" }).click();
    await expect(page.locator(".pr-ready")).toContainText("Tournicoti");
    await expect(page.locator(".pr-ready")).toContainText("Pas comptés 2");
    await page.getByRole("tab", { name: /^Ragnaros/ }).click();
    await page.getByRole("button", { name: "+ Ligne" }).click();
    await page.getByRole("textbox", { name: "Intitulé" }).fill("Tank principal");
    await page.getByRole("textbox", { name: "Intitulé" }).blur();
    await expect(page.getByRole("tab", { name: /^Ragnaros/ })).toContainText("1 ligne");
    await page.getByRole("combobox", { name: "Ajouter un perso : Tank principal" }).selectOption({ label: "Tournicoti" });
    await expect(page.locator(".pr-prev")).toContainText("Tournicoti verra en ciblant Ragnaros : « Tank principal »");
    // Temps réel : un second onglet ouvert sur le raid se met à jour sans recharger
    const other = await page.context().newPage();
    await other.goto(`/groups/${page.url().split("/groups/")[1]!.split("/")[0]}/raids/${raidId}/inscriptions`);
    await expect(other.getByText(/Tu es inscrit : Présent/)).toBeVisible();
    await page.waitForTimeout(500); // connexion en direct du second onglet établie
    await page.getByRole("tab", { name: /Inscriptions/ }).click();
    await page.getByRole("group", { name: "Mon statut" }).getByRole("button", { name: "En retard" }).click();
    await expect(page.getByText("Tu es inscrit : En retard")).toBeVisible();
    await expect(other.getByText("Tu es inscrit : En retard")).toBeVisible({ timeout: 5000 });
    await other.close();
    await page.getByRole("link", { name: "Retour au groupe" }).click();
    await expect(page.locator(".gr-raid").filter({ hasText: "Molten Core" })).toContainText("En retard");
  });

  await test.step("groupe : raid récurrent", async () => {
    // Un seul formulaire : la case « Chaque semaine » en fait un raid récurrent
    await page.getByRole("button", { name: "+ Nouveau raid" }).click();
    await page.fill("#gr-name", "Zul'Gurub");
    await page.locator(".dt-day").nth(3).click();
    await page.getByRole("group", { name: "Heure du raid" }).getByRole("button", { name: "20:30" }).click();
    await page.locator(".gr-tog").click();
    await page.fill("#gr-lead", "14");
    await expect(page.locator(".gr-sum")).toContainText("chaque semaine");
    if (process.env.SHOTS) await page.screenshot({ path: "test-results/shots/nouveau-raid.png", fullPage: true });
    await page.getByRole("button", { name: "Créer le raid" }).click();
    await expect(page.getByRole("heading", { name: "Zul'Gurub" })).toBeVisible();
    await expect(page.locator(".rp-meta")).toContainText("20:30");
    await page.getByRole("link", { name: "Retour au groupe" }).click();
    await page.getByRole("button", { name: /Récurrents \(1\)/ }).click();
    await expect(page.locator(".gr-recrow")).toContainText(/Zul'Gurub.*chaque .* 20:30/);
    await expect(page.locator(".gr-raid").filter({ hasText: "Zul'Gurub" }).first()).toBeVisible();
  });

  await test.step("cette semaine : bandeau en haut de Mes persos", async () => {
    // Molten Core ce soir : bandeau en haut de Mes persos, inscription en un clic
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL_E2E ?? "postgres://forever:forever@localhost:5432/forever_e2e" });
    await db.connect();
    await db.query(`UPDATE raids SET scheduled_at = now() + interval '3 hours' WHERE name = 'Molten Core'`);
    await db.end();
    await page.getByRole("link", { name: "Mes persos" }).first().click();
    const band = page.getByRole("region", { name: "Cette semaine" });
    await expect(band).toContainText("Molten Core");
    await expect(band).toContainText("2 viennent");
    await expect(band).toContainText("En retard"); // statut choisi sur la page du raid, hors des trois boutons rapides
    // Étapes restantes : groupe et addon faits plus haut, plus de ligne
    await expect(page.getByRole("note", { name: "Pour bien démarrer" })).toHaveCount(0);
    await band.getByRole("button", { name: "Peut-être" }).click();
    await expect(band.getByRole("button", { name: "Peut-être" })).toHaveAttribute("aria-pressed", "true");
    // « à faire » déplie les autres raids de la semaine et le reste
    await band.getByRole("button", { name: /à faire/ }).click();
    await expect(band.locator("#wk-details")).toContainText("Greta n'a pas de spé");
    if (process.env.SHOTS) await page.screenshot({ path: "test-results/shots/band.png" });
    // Réduit à une ligne, choix gardé au rechargement
    await band.getByRole("button", { name: "Réduire le bandeau" }).click();
    await page.reload();
    await expect(page.getByRole("region", { name: "Cette semaine" })).toContainText("Peut-être");
    await page.getByRole("button", { name: "Déplier le bandeau" }).click();
    await expect(page.locator(".topnav").getByRole("link", { name: /Cette semaine/ })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    if (process.env.SHOTS) await page.screenshot({ path: "test-results/shots/band-mobile.png" });
    await page.setViewportSize({ width: 1360, height: 900 });
    // Page Groupes : carte avec prochain raid, ma réponse, roster et raccourcis vers les onglets
    await page.getByRole("link", { name: "Groupes" }).first().click();
    const card = page.getByRole("article", { name: "Les Testeurs" });
    await expect(card).toContainText("Molten Core");
    await expect(card).toContainText("Peut-être");
    await expect(card.getByRole("link", { name: "Artisans" })).toHaveAttribute("href", /\/groups\/[0-9a-f-]{36}\/artisans$/);
    // Nouveautés : point doré tant que pas lues, panneau à l'ouverture
    const news = page.getByRole("button", { name: "Nouveautés (non lues)" });
    await news.click();
    await expect(page.getByRole("region", { name: "Nouveautés" })).toContainText("Un onglet Options en jeu");
    if (process.env.SHOTS) await page.screenshot({ path: "test-results/shots/groupes-news.png" });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Nouveautés", exact: true })).toBeVisible();
    if (process.env.SHOTS) await page.screenshot({ path: "test-results/shots/groupes.png" });
    await page.getByRole("link", { name: /Les Testeurs/ }).click();
    // Onglet Personnages sur téléphone : pas de défilement horizontal (les onglets défilent seuls)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("tab", { name: "Personnages" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Tournicoti" }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.getByRole("tab", { name: "Raids" }).click();
  });

  await test.step("bilan du raid relevé par l'addon : collé, puis page du raid et onglet Présence & butin", async () => {
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL_E2E ?? "postgres://forever:forever@localhost:5432/forever_e2e" });
    await db.connect();
    const { id: raidId, at } = (await db.query(`SELECT id, extract(epoch from scheduled_at)::int AS at FROM raids WHERE name = 'Molten Core'`)).rows[0];
    await db.end();
    const frb = `FRB;1;${raidId};${at - 600};${at + 3 * 3600};Tournicoti;Molten Core\nA;Tournicoti;${at - 600};${at + 3 * 3600};190\nA;Chamy;${at + 1800};${at + 3 * 3600};150\nL;16866;Tournicoti;${at + 1200};Lucifron\nEND;3`;
    await page.getByRole("link", { name: "Mes persos" }).first().click();
    await page.evaluate(text => {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      (document.activeElement as HTMLElement | null)?.blur();
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    }, frb);
    const dialog = page.getByRole("dialog", { name: "Export de l'addon" });
    await expect(dialog).toContainText("Bilan de Molten Core");
    await expect(dialog).toContainText("2 présents · 1 objet");
    await dialog.getByRole("button", { name: "Enregistrer le bilan" }).click();
    await expect(dialog).toContainText("Bilan de Molten Core : enregistré · 2 présents, 1 objet · sans fiche : Chamy");
    await dialog.getByRole("button", { name: "Fermer" }).click();
    await page.getByRole("link", { name: "Groupes" }).first().click();
    await page.getByRole("article", { name: "Les Testeurs" }).getByRole("link", { name: /Molten Core/ }).click();
    await page.getByRole("tab", { name: "Bilan" }).click();
    const bilan = page.getByRole("region", { name: "Bilan du raid" });
    await expect(bilan).toContainText("Helm of Might");
    await expect(bilan).toContainText("Lucifron");
    await expect(bilan.getByRole("row", { name: /Tournicoti.*Présent/ })).toBeVisible();
    if (process.env.SHOTS) await bilan.screenshot({ path: "test-results/shots/bilan.png" });
    await page.getByRole("link", { name: "Retour au groupe" }).click();
    await page.getByRole("tab", { name: "Présence & butin" }).click();
    await expect(page).toHaveURL(/\/presence$/);
    await expect(page.getByRole("row", { name: /Tournicoti.*1\/1.*Helm of Might/ })).toBeVisible();
    if (process.env.SHOTS) await page.screenshot({ path: "test-results/shots/presence.png" });
    await page.getByRole("tab", { name: "Raids" }).click();
  });

  await test.step("absences déclarées : chaque semaine, puis retirée", async () => {
    await page.getByRole("link", { name: "Mes persos" }).first().click();
    const ab = page.getByRole("region", { name: "Mes absences" });
    await expect(ab).toContainText("aucune de prévue");
    await ab.getByRole("button", { name: "+ Déclarer une absence" }).click();
    await ab.getByRole("button", { name: "Chaque semaine" }).click();
    await ab.getByRole("group", { name: "Jours d'absence" }).getByRole("button", { name: "ven." }).click();
    await page.fill("#ab-why", "Travail");
    await ab.getByRole("button", { name: "Enregistrer" }).click();
    await expect(ab).toContainText("chaque vendredi");
    await expect(ab).toContainText("Travail");
    if (process.env.SHOTS) await page.screenshot({ path: "test-results/shots/absences.png" });
    await ab.getByRole("button", { name: /Retirer l'absence/ }).click();
    await expect(ab).toContainText("aucune de prévue");
    await page.getByRole("link", { name: "Groupes" }).first().click();
    await page.getByRole("link", { name: /Les Testeurs/ }).click();
  });

  await test.step("groupe : code de liaison d'un salon Discord", async () => {
    await page.getByRole("tab", { name: "Administration" }).click();
    await expect(page.getByRole("heading", { name: "Invitations" })).toBeVisible();
    await page.locator(".adm-nav").getByRole("button", { name: "Zone sensible" }).click();
    await expect(page.getByRole("button", { name: "Supprimer le groupe" })).toBeVisible();
    await page.locator(".adm-nav").getByRole("button", { name: "Discord et relances" }).click();
    await expect(page.getByRole("heading", { name: "Salon Discord" })).toBeVisible();
    // Sans Discord lié à son compte, l'officier est invité à le lier d'abord (le bot vérifie qui tape la commande)
    await page.locator("section[aria-labelledby=dc-title]").getByRole("button", { name: "Générer un code de liaison" }).click();
    await expect(page.locator("section[aria-labelledby=dc-title] .alert.info")).toContainText("lie d'abord ton propre Discord");
    // Salon des commandes d'artisanat (lot F) : même liaison, bloc à part
    await expect(page.getByRole("heading", { name: "Salon des commandes d'artisanat" })).toBeVisible();
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Discord" })).toBeVisible();
    await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: "Discord" }) })).toContainText("Non lié");
  });

  await test.step("menu du compte : thème et déconnexion", async () => {
    await page.locator(".acct-btn").click();
    await page.locator(".acct-menu").getByRole("button", { name: "Sombre" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.locator(".acct-menu").getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test("les en-têtes de sécurité de production sont bien appliqués", async ({ page }) => {
  const res = await page.goto("/login");
  const h = res!.headers();
  expect(h["content-security-policy"]).toContain("default-src 'self'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  await expect(page.getByRole("heading", { name: /connexion/i })).toBeVisible();
});
