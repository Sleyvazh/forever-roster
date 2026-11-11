import { expect, test as base, type Page } from "@playwright/test";
import pg from "pg";
import { hash } from "@node-rs/argon2";
import { sealText } from "../packages/game-data/src/seal";

/**
 * Version anglaise (10/11/2026), lot E1 : accueil public en anglais (/?lang=en, puis le cookie fr-lang), connexion,
 * inscription, mot de passe oublié et pages légales en anglais ; FR | EN en bas de page ; langue gardée dans le compte
 * (retrouvée sans le cookie). Lot E2 : Accueil d'une guilde et Raids. Lot E3 : Sorties et Guilde (Membres, Course au 60,
 * Artisans, Banque, Historique). Sur chaque page visitée en anglais : aucun texte français. Noms inventés.
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
const PASSWORD = "a passphrase for the english guild";

// Mots qui trahissent du français (les noms propres et « Français », libellé du choix de langue, sont permis)
const FRENCH = /\b(le|la|les|des|du|une|pour|avec|dans|sur|est|sont|tes|ton|ta|vos|votre|pas|aucun|aucune|déjà|être|et|au|aux|ou|ici|tu|mon|mes|ce|cette|connexion|compte|mot de passe)\b|[éèêàùç]/i;
const ALLOWED = [/^Français$/, /Métropole/];
/** EN_SHOTS=<dossier> : une capture de chaque page vérifiée (relecture de la traduction). */
let shot = 0;
async function expectEnglish(page: Page, where: string) {
  if (process.env.EN_SHOTS) await page.screenshot({ path: `${process.env.EN_SHOTS}/${String(++shot).padStart(2, "0")}-${where.replace(/[^\p{L}\d]+/gu, "-")}.png`, fullPage: true });
  const text = await page.locator("body").innerText();
  // « Mon », « MON » (lundi) ne sont pas « mon »
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean)
    .filter(l => !ALLOWED.some(a => a.test(l)) && FRENCH.test(l.replace(/\b(Mon|MON)\b/g, "")));
  expect(lines, `texte français sur ${where}`).toEqual([]);
}

test("accueil, connexion, inscription et pages légales en anglais ; langue gardée dans le compte", async ({ page, context }) => {
  // Accueil public : /?lang=en, puis le cookie garde le choix (même adresse sans ?lang)
  await page.goto("/?lang=en");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("organized without the headache");
  await expectEnglish(page, "l'accueil public");
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("banner").getByRole("link", { name: "Log in" }).click();

  // Connexion : le site suit le cookie
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expectEnglish(page, "la connexion");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page.getByRole("heading", { name: "Forgotten password" })).toBeVisible();
  await expectEnglish(page, "mot de passe oublié");
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
  await page.fill("#pw", "short");
  await expect(page.getByText("At least 12 characters")).toBeVisible();
  await expectEnglish(page, "l'inscription");

  // Pages légales
  await page.goto("/mentions-legales");
  await expect(page.getByRole("heading", { name: "Legal notice" })).toBeVisible();
  await expectEnglish(page, "les mentions légales");
  await page.goto("/confidentialite");
  await expect(page.getByRole("heading", { name: "Privacy policy" })).toBeVisible();
  await expect(page.getByText("fr-lang", { exact: true })).toBeVisible();

  // FR | EN en bas de page : retour au français, puis l'anglais de nouveau
  await page.goto("/login");
  await page.getByRole("contentinfo").getByRole("button", { name: "Français" }).click();
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page.getByRole("contentinfo").getByRole("button", { name: /English/ }).click();
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();

  // Compte créé et confirmé, connexion en anglais : page Bienvenue en anglais, et la langue part dans le compte
  const email = `english-${Date.now()}@example.test`;
  await page.goto("/register");
  await page.fill("#dn", "Aldric"); await page.fill("#em", email); await page.fill("#pw", PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page.getByRole("heading", { name: "Check your e-mails" })).toBeVisible();
  const db = new pg.Client({ connectionString: DB }); await db.connect();
  try {
    await expect.poll(async () => (await db.query("update users set email_verified_at = now() where email = $1", [email])).rowCount).toBe(1);
    await page.goto("/login");
    await page.fill("#email", email); await page.fill("#password", PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your guild" })).toBeVisible();
    await expectEnglish(page, "la page Bienvenue");
    // Menu du compte : Langue → EN (déjà choisi : le choix passe dans le compte)
    await page.locator(".acct-btn").click();
    await expect(page.getByRole("link", { name: "Account & security" })).toBeVisible();
    await page.locator(".acct-menu").getByRole("button", { name: "Français" }).click();
    await expect(page.getByRole("heading", { name: "Ta guilde" })).toBeVisible();
    await page.locator(".acct-btn").click();
    await page.locator(".acct-menu").getByRole("button", { name: /English/ }).click();
    await expect(page.getByRole("heading", { name: "Your guild" })).toBeVisible();
    await expect.poll(async () => (await db.query("select lang from users where email = $1", [email])).rows[0]?.lang).toBe("en");
  } finally { await db.end(); }

  // Sans le cookie (autre appareil) : le compte redonne l'anglais
  await context.clearCookies({ name: "fr-lang" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your guild" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

/** Relevé d'une guilde (FRL v1, comme l'addon 1.6.2) : quatre membres, la banque (un onglet, deux cases), le journal. */
const guid = (n: number) => `Player-4620-${(0xB000 + n).toString(16).toUpperCase().padStart(8, "0")}`;
function frl(now: number) {
  const members: [string, string, number, string, number, string, number][] = [
    ["Aldwin Stormhold", "WARRIOR", 30, "Guild Master", 0, "", 1],
    ["Brena Ashfield", "PRIEST", 28, "Officer", 1, "", 2],
    ["Corvin Gale", "MAGE", 22, "Member", 3, "", 3],
    ["Dara Gale", "ROGUE", 14, "Member", 3, "Alt of Corvin", 4],
  ];
  const lines = [
    ...members.map(([name, cls, lv, rank, ri, note, g]) => ["M", name, cls, lv, rank, ri, g === 1 ? 1 : 0, g === 1 ? 0 : 3, note, "", guid(g)].join(";")),
    `J;${now};Aldwin Stormhold`,
    "E;join;Corvin Gale;;;5",
    "E;promote;Aldwin Stormhold;Brena Ashfield;1;30",
    `B;${now};Aldwin Stormhold;1234567;1`,
    "T;1;Supplies;1;1",
    "I;1;1;8170;20",
    "I;1;2;999999;1",
    "X;1;deposit;Corvin Gale;8170;20;;;3",
    "O;repair;Brena Ashfield;123030;5",
  ];
  return sealText([`FRL;1;Silver Lanterns;Horde;${now};Aldwin Stormhold;0;Guild Master;${members.length};Forever EU;1.6.2`, ...lines, `END;${lines.length}`].join("\n"));
}

/**
 * Lots E2 et E3 : Accueil de la guilde, Raids (liste, création, présence, page d'un raid et ses onglets), Sorties (liste,
 * nouvelle sortie, gestion) et Guilde (Membres, Course au 60, Artisans, Banque, Historique). Lot E4 : Mes persos (liste,
 * fiche et ses onglets, profil), Compte (chaque section), Addon, panneau Synchro (erreur de lecture, aperçu d'un export
 * collé), Signalements (les miens, la fenêtre d'envoi, la page des admins) et Administration de la guilde. Un seul compte,
 * créé en base, une seule connexion (inscriptions et connexions par formulaire : 20 par quart d'heure pour toute la suite).
 */
test("accueil, raids, sorties, guilde, persos, compte, addon, synchro, signalements et administration en anglais", async ({ page }) => {
  test.setTimeout(240_000);
  const email = `guild-en-${Date.now()}@example.test`;
  const db = new pg.Client({ connectionString: DB }); await db.connect();
  let group = "", raid = "", char = "";
  try {
    const me = (await db.query("insert into users (email, email_verified_at, password_hash, display_name, lang, site_admin) values ($1, now(), $2, 'Aldwin', 'en', true) returning id",
      [email, await hash(PASSWORD, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 })])).rows[0].id as string;
    group = (await db.query("insert into groups (name) values ('Silver Lanterns') returning id")).rows[0].id as string;
    await db.query("insert into group_members (group_id, user_id, role) values ($1, $2, 'owner')", [group, me]);
    const profs = JSON.stringify({ prof1: { name: "Tailoring", skill: 150 }, prof2: { name: "", skill: 0 }, cooking: 0, fishing: 0, firstAid: 0 });
    const chars: { id: string; user: string; name: string; cls: string; spec: string }[] = [];
    for (const [i, [name, cls, spec, race, level]] of ([["Aldwin Stormhold", "Warrior", "Protection", "Orc", 30], ["Brena Ashfield", "Priest", "Holy", "Undead", 28], ["Corvin Gale", "Mage", "Frost", "Troll", 22]] as const).entries()) {
      const user = i === 0 ? me : (await db.query("insert into users (email, email_verified_at, password_hash, display_name) values ($1, now(), 'demo', $2) returning id",
        [`${name.split(" ")[0]!.toLowerCase()}-${Date.now()}@example.test`, name.split(" ")[0]])).rows[0].id as string;
      if (i > 0) await db.query("insert into group_members (group_id, user_id, role) values ($1, $2, 'member')", [group, user]);
      const id = (await db.query("insert into characters (user_id, name, race, cls, spec1, level, professions, guid) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
        [user, name, race, cls, spec, level, profs, i === 0 ? guid(1) : null])).rows[0].id as string;
      await db.query("insert into group_characters (group_id, character_id, user_id, is_main) values ($1, $2, $3, true)", [group, id, user]);
      chars.push({ id, user, name, cls, spec });
      if (i === 0) char = id;
    }
    raid = (await db.query("insert into raids (group_id, name, scheduled_at, size, created_by) values ($1, 'Molten Core', $2, 40, $3) returning id",
      [group, new Date(Date.now() + 2 * 86400e3), me])).rows[0].id as string;
    for (const [c, st] of [[chars[0]!, "present"], [chars[1]!, "late"], [chars[2]!, "tentative"]] as const) {
      await db.query("insert into raid_signups (raid_id, user_id, display_name, character_id, cls, spec, status) values ($1, $2, $3, $4, $5, $6, $7)", [raid, c.user, c.name, c.id, c.cls, c.spec, st]);
    }
  } finally { await db.end(); }

  // Le compte est en anglais : la connexion y passe aussi (sans cookie, le compte donne la langue)
  await page.goto("/?lang=en");
  await page.goto("/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.locator(".acct-btn")).toBeVisible();

  await test.step("Accueil", async () => {
    await page.goto(`/groups/${group}`);
    await expect(page.getByRole("heading", { name: /^(Hello|Good evening), Aldwin$/ })).toBeVisible();
    await expect(page.getByText("Molten Core").first()).toBeVisible();
    await expectEnglish(page, "l'accueil de la guilde");
  });

  await test.step("Raids : à venir, nouveau raid, présence", async () => {
    await page.goto(`/groups/${group}/raids`);
    await expect(page.getByRole("tab", { name: "Upcoming (1)" })).toBeVisible();
    await expectEnglish(page, "la liste des raids");
    await page.getByRole("button", { name: "+ Raid" }).click();
    await expect(page.getByRole("heading", { name: "New raid" })).toBeVisible();
    await expectEnglish(page, "la création d'un raid");
    await page.getByRole("button", { name: "Close" }).first().click();
    await page.getByRole("tab", { name: "Attendance" }).click();
    await expect(page.getByText("No raid recorded yet.")).toBeVisible();
    await expectEnglish(page, "la présence");
  });

  await test.step("Page du raid : inscriptions, compo, préparation, réglages", async () => {
    await page.goto(`/groups/${group}/raids/${raid}`);
    await expect(page.getByRole("heading", { name: "Molten Core", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Sign-ups coming").getByText("2 coming")).toBeVisible();
    await expectEnglish(page, "les inscriptions du raid");
    for (const [tab, check] of [["Comp", "Needs"], ["Prep", "Consumables"], ["Settings", "Loot mode"]] as const) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await expect(page.getByRole("heading", { name: new RegExp(`^${check}`) }).first()).toBeVisible();
      await expectEnglish(page, `l'onglet ${tab} du raid`);
    }
  });

  await test.step("Sorties : liste vide, nouvelle sortie, gestion", async () => {
    await page.goto(`/groups/${group}/sorties`);
    await expect(page.getByRole("heading", { name: "Runs", level: 1 })).toBeVisible();
    await expectEnglish(page, "les sorties");
    await page.goto(`/groups/${group}/sorties/nouvelle`);
    await expect(page.getByRole("heading", { name: "New run" })).toBeVisible();
    await expectEnglish(page, "la nouvelle sortie");
    await page.getByRole("button", { name: "Publish the run" }).click();
    await expect(page.getByRole("heading", { name: "Runs", level: 1 })).toBeVisible();
    await expect(page.locator(".so-card").first()).toBeVisible();
    await expectEnglish(page, "une sortie publiée");
    await page.getByRole("button", { name: "Manage my run" }).click();
    await expect(page.getByRole("button", { name: "Change the time" })).toBeVisible();
    await expectEnglish(page, "la gestion d'une sortie");
  });

  await test.step("Guilde : relevé collé, puis chaque onglet", async () => {
    await page.goto(`/groups/${group}/membres`);
    await expect(page.getByRole("heading", { name: "Guild", level: 1 })).toBeVisible();
    await expectEnglish(page, "la guilde sans liste du jeu");
    await page.evaluate(t => {
      const dt = new DataTransfer();
      dt.setData("text/plain", t);
      (document.activeElement as HTMLElement | null)?.blur();
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    }, frl(Math.floor(Date.now() / 1000) - 60));
    const panel = page.getByRole("dialog");
    await panel.locator(".sy-go").click();
    await expect(panel.getByRole("status")).toBeVisible();
    // Résultat du relevé, écrit par l'API dans la langue de la page (lot E5)
    await expect(panel.getByText(/roster of 4 members \(complete\)/)).toBeVisible();
    await expectEnglish(page, "le résultat d'un relevé de guilde");
    await page.keyboard.press("Escape");
    await page.goto(`/groups/${group}/membres/persos`);
    await expect(page.locator(".gx-table")).toContainText("Brena Ashfield");
    await expectEnglish(page, "Membres › Par perso");
    await page.goto(`/groups/${group}/membres/joueurs`);
    await expect(page.getByRole("table", { name: "Guild players" })).toBeVisible();
    await expectEnglish(page, "Membres › Par joueur");
    for (const [path, check] of [["course", "First to 60"], ["artisans", "Who crafts what?"], ["banque", "Supplies"], ["historique", "joins the guild"]] as const) {
      await page.goto(`/groups/${group}/membres/${path}`);
      await expect(page.getByText(check).first()).toBeVisible();
      await expectEnglish(page, `Guilde › ${path}`);
    }
  });

  await test.step("Mes persos : la liste, puis la fiche et ses onglets", async () => {
    await page.goto("/persos");
    await expect(page.getByRole("heading", { name: "My characters" })).toBeVisible();
    await expectEnglish(page, "Mes persos");
    await page.goto(`/persos/${char}`);
    await expect(page.getByRole("heading", { name: "Aldwin Stormhold" }).first()).toBeVisible();
    await expectEnglish(page, "la fiche d'un perso");
    for (const [tab, check] of [["Professions", "No known pattern yet"], ["Notes", "Preview section"], ["Gear", "Edit by hand"]] as const) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await expect(page.getByText(check).first()).toBeVisible();
      await expectEnglish(page, `l'onglet ${tab} de la fiche`);
    }
    // Profil : l'éditeur (identité, spés, talents)
    await page.getByRole("button", { name: "✎ Edit the profile" }).click();
    await expect(page.getByRole("button", { name: "Confirm the profile" })).toBeVisible();
    await expectEnglish(page, "le profil d'un perso");
    await page.getByRole("button", { name: "Confirm the profile" }).click();
  });

  await test.step("Compte : chaque section", async () => {
    for (const [section, check] of [["profil", "Account image"], ["securite", "Change the password"], ["discord", "Discord account"], ["appareils", "Active sessions"],
      ["journal", "Logged in"], ["supprimer", "Delete my account…"]] as const) {
      await page.goto(`/account?section=${section}`);
      await expect(page.getByText(check, { exact: true }).first()).toBeVisible();
      await expectEnglish(page, `Compte › ${section}`);
    }
  });

  await test.step("Addon et panneau Synchro (aperçu d'un export collé)", async () => {
    await page.goto("/addon");
    await expect(page.getByRole("heading", { name: "Install the addon" })).toBeVisible();
    await page.getByText("In-game commands · 6").click();
    await page.getByText("Security: what the addon does (and doesn't do)").click();
    await expect(page.getByText("/fr search + Shift+click an item")).toBeVisible();
    await expectEnglish(page, "la page Addon");
    await page.goto("/persos");
    await expect(page.getByRole("heading", { name: "My characters" })).toBeVisible();
    const paste = (text: string) => page.evaluate(t => {
      const dt = new DataTransfer();
      dt.setData("text/plain", t);
      (document.activeElement as HTMLElement | null)?.blur();
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    }, text);
    const at = Math.floor(Date.now() / 1000) - 60;
    // Erreur de lecture (game-data, en français) : traduite par motif
    await paste(`FRC;9;Aldwin Stormhold;Forever EU;WARRIOR;Orc;31;Horde;${at};1.6.4\nEND;0`);
    const panel = page.getByRole("dialog");
    await expect(panel.getByText("Aldwin Stormhold: Unsupported export version (9): update the website or the addon.")).toBeVisible();
    await expectEnglish(page, "une erreur de lecture dans la synchro");
    await page.keyboard.press("Escape");
    await paste(sealText(`FRC;2;Aldwin;Forever EU;WARRIOR;Orc;31;Horde;${at};1.6.4;${guid(1)};Aldwin Stormhold\nG;1:16866\nW;15090;1\nEND;2`));
    await expect(panel.getByText("1 character recognized")).toBeVisible();
    await expect(panel.locator(".sy-go")).toHaveText("Update 1 character");
    await expectEnglish(page, "l'aperçu de la synchro");
    await page.keyboard.press("Escape");
    await expect(page.getByText("Close without updating your characters?")).toBeVisible();
    await expectEnglish(page, "la confirmation de fermeture de la synchro");
    await page.getByRole("button", { name: "Close without updating" }).click();
    // Puis la mise à jour : le résultat vient de l'API, en anglais (lot E5)
    await paste(sealText(`FRC;2;Aldwin;Forever EU;WARRIOR;Orc;31;Horde;${at};1.6.4;${guid(1)};Aldwin Stormhold\nG;1:16866\nW;15090;1\nEND;2`));
    await panel.locator(".sy-go").click();
    await expect(panel.getByText("1 character up to date")).toBeVisible();
    await expect(panel.getByText(/sheet updated/)).toBeVisible();
    await expectEnglish(page, "le résultat de la synchro");
    await page.keyboard.press("Escape");
    // Infobulle d'un objet : les mots du jeu anglais (lot E4)
    await page.getByText("Helm of Might").first().hover();
    await expect(page.getByRole("tooltip")).toContainText("Item Level");
    await expectEnglish(page, "l'infobulle d'un objet");
  });

  await test.step("Signalements : les miens, la fenêtre d'envoi, la page des admins", async () => {
    await page.goto("/signalements");
    await expect(page.getByText("No reports yet.", { exact: false })).toBeVisible();
    await expectEnglish(page, "Mes signalements");
    await page.getByRole("button", { name: "New report" }).first().click();
    await expect(page.getByRole("dialog").getByText("It's about")).toBeVisible();
    await expectEnglish(page, "la fenêtre d'un signalement");
    await page.keyboard.press("Escape");
    await page.goto("/admin/signalements");
    await expect(page.getByRole("heading", { name: "Website administration" })).toBeVisible();
    await expectEnglish(page, "l'administration du site");
  });

  await test.step("Administration de la guilde : chaque section", async () => {
    await page.goto(`/groups/${group}/admin`);
    for (const [section, check] of [["Invitations", "Link settings"], ["Guild", "Danger zone"], ["Discord", "Race to 60 announcements"], ["Loot", "Loot"],
      ["Feedback", "No Discord server linked."], ["Log", "Who"]] as const) {
      await page.locator(".adm-nav").getByRole("button", { name: section }).click();
      await expect(page.locator(".adm-body").getByText(check).first()).toBeVisible();
      await expectEnglish(page, `Administration › ${section}`);
    }
  });

  await test.step("Langue du bot (lot E6) : réglage de la guilde, noté au journal", async () => {
    await page.locator(".adm-nav").getByRole("button", { name: "Discord" }).click();
    const seg = page.getByRole("group", { name: "Bot language" });
    await expect(seg.getByRole("button", { name: "Français" })).toHaveAttribute("aria-pressed", "true");
    await seg.getByRole("button", { name: "English" }).click();
    await expect(seg.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    await expectEnglish(page, "Administration › Discord, langue du bot");
    await page.locator(".adm-nav").getByRole("button", { name: "Log" }).click();
    await expect(page.locator(".adm-body").getByText("changed the bot's language · English")).toBeVisible();
  });
});
