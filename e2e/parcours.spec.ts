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
    await page.getByRole("button", { name: "+ Ajouter un perso" }).first().click();
    await page.fill("#f-name", "Tournicoti");
    await page.selectOption("#f-race", "Tauren");
    await page.selectOption("#f-cls", "Druid");
    await page.selectOption("#f-spec-main", "Feral Cat");
    await expect(page.getByText("Enregistré.")).toBeVisible();
    await page.reload();
    await expect(page.locator(".dhead h2")).toContainText("Tournicoti");
    await expect(page.locator("#f-spec-main")).toHaveValue("Feral Cat");
  });

  await test.step("portrait : recadrage puis envoi (sous la CSP de production)", async () => {
    await page.locator(".upl input[type=file]").setInputFiles(path.resolve("e2e/fixtures/portrait.png"));
    const save = page.locator(".upl .btn.primary");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.locator(".dhead .portrait-img")).toBeVisible();
    await expect(page.locator(".dhead .portrait-img")).toHaveJSProperty("naturalWidth", 200);
  });

  await test.step("métiers : cocher un patron", async () => {
    await page.getByRole("tab", { name: "Métiers" }).click();
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

  await test.step("groupe : l'onglet Artisans montre le patron coché", async () => {
    await page.getByRole("link", { name: "Groupes" }).first().click();
    await page.fill("#g-name", "Les Testeurs");
    await page.getByRole("button", { name: "Créer" }).click();
    await page.getByRole("tab", { name: "Artisans" }).click();
    await expect(page.getByRole("row", { name: /Warbear Woolies.*Tournicoti/ })).toBeVisible();
    // Infobulle de l'objet fabriqué : « Où l'obtenir » avec le patron et qui le connaît
    await page.getByRole("row", { name: /Warbear Woolies.*Tournicoti/ }).locator(".ihover").first().hover();
    await expect(page.locator(".itip")).toContainText("Où l'obtenir");
    await expect(page.locator(".itip")).toContainText("Pattern: Warbear Woolies");
    await expect(page.locator(".itip")).toContainText("Connu par : Tournicoti (toi)");
    await page.mouse.move(0, 0);
  });

  await test.step("raid : création, inscription et composition", async () => {
    await page.getByRole("tab", { name: "Raids" }).click();
    await page.fill("#r-name", "Molten Core");
    await page.locator("form").filter({ has: page.locator("#r-name") }).getByRole("button", { name: "Créer" }).click();
    await expect(page.getByRole("heading", { name: "Molten Core" })).toBeVisible();
    await page.selectOption("#su-spec", "Feral Bear");
    await page.getByRole("group", { name: "Mon statut" }).getByRole("button", { name: "Présent" }).click();
    await expect(page.getByText("Tu es inscrit : Présent avec Tournicoti (Feral Bear)")).toBeVisible();
    await expect(page.locator(".su-col").filter({ hasText: "Tank" })).toContainText("Tournicoti");
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
    const raidId = page.url().split("/raids/")[1]!;
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL_E2E ?? "postgres://forever:forever@localhost:5432/forever_e2e" });
    await db.connect();
    await db.query(`INSERT INTO raid_signups (raid_id, discord_user_id, display_name, cls, spec, status) VALUES ($1, '720000000000000001', 'Chamy', 'Shaman', 'Enhancement DPS', 'present')`, [raidId]);
    await db.end();
    await page.reload();
    await page.getByRole("button", { name: "Ajouter Chamy au raid" }).click();
    await expect(page.getByRole("button", { name: /Groupe 1, place 2 : Chamy/ })).toContainText("Discord");
    await expect(page.locator(".cov .it.on").filter({ hasText: "Windfury Totem" })).toBeVisible();

    // Compo publiée sur Discord, puis export pour le jeu
    await page.getByRole("button", { name: "Publier la compo" }).click();
    await expect(page.locator(".roster-pub .tag")).toHaveText("Publiée");
    await page.getByText("Export pour le jeu").click();
    await expect(page.locator("#ex-addon")).toHaveValue(/^FRR;1;[0-9a-f-]{36};0;Molten Core\nM;Tournicoti;DRUID;Tank;Feral Bear;1;1;present;site\nM;Chamy;SHAMAN;DPS;Enhancement DPS;1;2;present;discord\nEND;2$/);
    await expect(page.getByRole("textbox", { name: "Macro d'invitation 1" })).toHaveValue("/inv Tournicoti");
    await expect(page.getByText("À inviter à la main (inscrits sans compte, pseudo Discord) : Chamy.")).toBeVisible();
    // Temps réel : un second onglet ouvert sur le raid se met à jour sans recharger
    const other = await page.context().newPage();
    await other.goto(page.url());
    await expect(other.getByText(/Tu es inscrit : Présent/)).toBeVisible();
    await page.waitForTimeout(500); // connexion en direct du second onglet établie
    await page.getByRole("group", { name: "Mon statut" }).getByRole("button", { name: "En retard" }).click();
    await expect(page.getByText("Tu es inscrit : En retard")).toBeVisible();
    await expect(other.getByText("Tu es inscrit : En retard")).toBeVisible({ timeout: 5000 });
    await other.close();
    await page.getByRole("link", { name: "Retour au groupe" }).click();
    await expect(page.getByRole("row", { name: /Molten Core/ })).toContainText("En retard");
  });

  await test.step("groupe : raid récurrent", async () => {
    await page.fill("#t-name", "Zul'Gurub");
    await page.selectOption("#t-day", "5");
    await page.fill("#t-time", "20:30");
    await page.fill("#t-lead", "14");
    await page.locator("form").filter({ has: page.locator("#t-name") }).getByRole("button", { name: "Ajouter" }).click();
    await expect(page.getByRole("status").filter({ hasText: /raids? créés?\./ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Zul'Gurub.*Vendredi à 20 h 30/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Zul'Gurub" }).first()).toBeVisible();
  });

  await test.step("groupe : code de liaison d'un salon Discord", async () => {
    await page.getByRole("tab", { name: "Administration" }).click();
    await expect(page.getByRole("heading", { name: "Invitations" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Supprimer le groupe" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Salon Discord" })).toBeVisible();
    await page.getByRole("button", { name: "Générer un code de liaison" }).click();
    await expect(page.getByRole("textbox", { name: "Commande de liaison" })).toHaveValue(/^\/forever-lier code:[A-Z2-9]{8}$/);
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
