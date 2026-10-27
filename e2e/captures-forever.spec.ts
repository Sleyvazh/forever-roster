import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Captures de Forever Roster « guilde en marche » : l'image héros de l'accueil public (apps/web/public/landing/img/forever.webp)
 * et des aperçus dans test-results/shots/forever/ : Accueil (sombre, clair, téléphone), Sorties, Course au 60, Guilde.
 * Guilde fictive de 24 membres (aucun vrai pseudo ni adresse) un jeudi soir en pleine course : jeudi 19 novembre 2026, 19:40.
 *
 * La course ne part qu'à la sortie du jeu : le serveur et sa base doivent tourner à cette date, avec libfaketime
 * (sudo apt install faketime). Le navigateur prend l'heure du serveur (en-tête Date de l'API). Avec les icônes de Pahpool
 * (dossier icons/ copié dans apps/web/public/icons/ avant npm run build) l'image est plus parlante ; sans, initiales.
 *
 *   OFF=$(( $(date -d 2026-11-19T18:40:00Z +%s) - $(date +%s) ))   # même décalage pour la base et l'API
 *   LIB=/usr/lib/x86_64-linux-gnu/faketime/libfaketimeMT.so.1
 *   # Base de test à part (port 5433, rôle forever, base forever_e2e vide), démarrée avec l'horloge décalée :
 *   sudo -u postgres env LD_PRELOAD=$LIB FAKETIME=+$OFF pg_ctl -D <dossier du cluster> -o "-p 5433 -k /tmp" start
 *   LD_PRELOAD=$LIB FAKETIME=+$OFF DATABASE_URL_E2E=postgres://forever:forever@127.0.0.1:5433/forever_e2e node e2e/start.mjs &
 *   CAPTURES=1 DATABASE_URL_E2E=postgres://forever:forever@127.0.0.1:5433/forever_e2e npx playwright test e2e/captures-forever.spec.ts
 */
test.skip(!process.env.CAPTURES, "captures seulement sur demande (CAPTURES=1)");

const OUT = path.resolve("test-results/shots/forever");
const HERO = path.resolve("apps/web/public/landing/img/forever.webp");
const DB = process.env.DATABASE_URL_E2E ?? "postgres://forever:forever@localhost:5432/forever_e2e";
const PASSWORD = "une phrase de passe pour la démo";
const DAY = 86400e3;
const RACE = Date.UTC(2026, 10, 4, 23, 0, 0);
const guid = (n: number) => `Player-4620-${(0xB000 + n).toString(16).toUpperCase().padStart(8, "0")}`;

// nom complet, CLASSE, niveau, rang, n° du rang, note, 60 atteint le jour (null : pas encore)
const MEMBERS: [string, string, number, string, number, string, number | null][] = [
  ["Kaeldra Brisevent", "WARRIOR", 60, "Maître de guilde", 0, "", 9.9],
  ["Brindille Feuillevive", "DRUID", 57, "Officier", 1, "", null],
  ["Vex Ombrelame", "ROGUE", 60, "Officier", 1, "", 11.8],
  ["Ysalis Cendrevent", "PRIEST", 60, "Membre", 3, "", 13.4],
  ["Gorrak Fendroc", "WARRIOR", 58, "Vétéran", 2, "", null],
  ["Nessa Flotsombre", "SHAMAN", 55, "Officier", 1, "", null],
  ["Pikou Patacuivre", "MAGE", 52, "Membre", 3, "", null],
  ["Morvh Sombreval", "MAGE", 51, "Membre", 3, "", null],
  ["Tavish Noircoeur", "WARLOCK", 49, "Membre", 3, "", null],
  ["Elwin Hautepine", "DRUID", 47, "Membre", 3, "", null],
  ["Sorcha Ventebrume", "SHAMAN", 46, "Membre", 3, "", null],
  ["Nyssaël Tirelune", "HUNTER", 45, "Membre", 3, "", null],
  ["Hadrien Marbregris", "PRIEST", 44, "Membre", 3, "", null],
  ["Lysandre Feuardent", "MAGE", 42, "Membre", 3, "", null],
  ["Brakka Crocsang", "ROGUE", 39, "Membre", 3, "", null],
  ["Grumdal Pierrefer", "WARRIOR", 40, "Membre", 3, "", null],
  ["Isendra Vagueclaire", "SHAMAN", 38, "Membre", 3, "", null],
  ["Sylvaë Pluiedor", "PRIEST", 36, "Membre", 3, "", null],
  ["Thalion Cendrebois", "MAGE", 34, "Officier", 1, "", null],
  ["Mirelle Lunargent", "HUNTER", 33, "Membre", 3, "", null],
  ["Thorn Ecorcefer", "WARLOCK", 31, "Membre", 3, "", null],
  ["Vexelle Ombrelame", "SHAMAN", 29, "Membre", 3, "Alt de Vex", null],
  ["Zirta Pellerouge", "PRIEST", 21, "Recrue", 4, "", null],
  ["Orgen Brasdefer", "WARRIOR", 17, "Recrue", 4, "", null],
];
const G = Object.fromEntries(MEMBERS.map(([n], i) => [n, guid(i + 1)]));

function frl(now: number) {
  const lines = [
    ...MEMBERS.map(([name, cls, lv, rank, ri, note], i) => ["M", name, cls, lv, rank, ri, i % 5 === 0 ? 1 : 0, i % 5 === 0 ? 0 : (i % 7) * 3 + 1, note, "", guid(i + 1)].join(";")),
    `J;${now};Brindille Feuillevive`,
    "E;join;Orgen Brasdefer;;;20",
    "E;invite;Kaeldra Brisevent;Orgen Brasdefer;;20",
    "E;quit;Grokk Malmain;;;47",
    "E;promote;Kaeldra Brisevent;Nessa Flotsombre;1;70",
    "E;join;Zirta Pellerouge;;;74",
    "E;invite;Vex Ombrelame;Zirta Pellerouge;;74",
    `P;Brindille;57;61200;115200;${now};${G["Brindille Feuillevive"]}`,
  ];
  return [`FRL;1;Les Lanternes;Horde;${now};Brindille Feuillevive;1;Officier;${MEMBERS.length + 0};Forever EU;1.6.2`, ...lines, `END;${lines.length}`].join("\n");
}

const paste = (page: Page, text: string) => page.evaluate(t => {
  const dt = new DataTransfer();
  dt.setData("text/plain", t);
  (document.activeElement as HTMLElement | null)?.blur();
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
}, text);

test("guilde en marche : image de l'accueil public, Accueil, Sorties, Course", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  // Heure du serveur (décalée par libfaketime) : le navigateur s'y met aussi
  const date = (await page.request.get("/api/health")).headers()["date"];
  const now = Date.parse(date ?? "") || Date.now();
  test.skip(now < RACE + DAY, "le serveur n'est pas après la sortie : voir l'en-tête du fichier (libfaketime)");
  await page.clock.install({ time: now });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1360, height: 1000 });

  const email = `thalion-${Date.now()}@example.test`;
  await page.goto("/register");
  await page.fill("#dn", "Thalion"); await page.fill("#em", email); await page.fill("#pw", PASSWORD); await page.fill("#pw2", PASSWORD);
  await page.getByRole("button", { name: /créer/i }).click();
  await page.waitForLoadState("networkidle");
  const v = new pg.Client({ connectionString: DB }); await v.connect();
  await expect.poll(async () => (await v.query("update users set email_verified_at = now() where email = $1", [email])).rowCount).toBe(1);
  await v.end();
  await page.goto("/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForLoadState("networkidle");

  const ids = await page.evaluate(async () => {
    const { csrfToken } = await (await fetch("/api/auth/me")).json();
    const h = { "content-type": "application/json", "x-csrf-token": csrfToken };
    const j = async (url: string, method: string, body: unknown) => {
      const r = await fetch(url, { method, headers: h, body: JSON.stringify(body) });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(`${url} ${r.status} ${JSON.stringify(d)}`);
      return d;
    };
    const g = (await j("/api/groups", "POST", { name: "Les Lanternes" })).group.id as string;
    const bri = (await j("/api/characters", "POST", { name: "Brindille", cls: "Druid", race: "Tauren", spec1: "Restoration", spec2: "Feral Bear", level: 57 })).character.id as string;
    const tha = (await j("/api/characters", "POST", { name: "Thalion", cls: "Mage", race: "Undead", spec1: "Frost", level: 34 })).character.id as string;
    await j(`/api/groups/${g}/characters/${bri}`, "PUT", { assigned: true, main: true });
    await j(`/api/groups/${g}/characters/${tha}`, "PUT", { assigned: true });
    return { g, bri, tha };
  });

  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  try {
    const at = (d: number) => new Date(RACE + d * DAY);
    // Fiches de Thalion : GUID et nom complet (comme après une synchro de l'addon 1.6.2), synchronisées récemment
    await db.query("update characters set guid = $1, addon_synced_at = $2 where id = $3", [G["Brindille Feuillevive"], new Date(now - 2.2 * 3600e3), ids.bri]);
    await db.query("update characters set guid = $1, addon_synced_at = $2 where id = $3", [G["Thalion Cendrebois"], new Date(now - 26 * 3600e3), ids.tha]);
  } finally { await db.end(); }

  // Relevé de la guilde collé par Thalion (officier) : la guilde du jeu se lie toute seule
  await page.goto(`/groups/${ids.g}`);
  await page.waitForLoadState("networkidle");
  await paste(page, frl(Math.floor(now / 1000)));
  await page.waitForTimeout(2500);

  const db2 = new pg.Client({ connectionString: DB });
  await db2.connect();
  try {
    const q = (s: string, p: unknown[] = []) => db2.query(s, p);
    const at = (d: number) => new Date(RACE + d * DAY);
    await q("update game_guilds set first_roster_at = $1, linked_at = $1 where group_id = $2", [at(0.4), ids.g]);
    await q("update guild_members set first_seen_at = $1 where group_id = $2 and joined_at is null", [at(0.4), ids.g]);
    // Niveaux de la course : une montée régulière, plus rapide au début ; les 60 aux jours donnés
    await q("delete from guild_levels where group_id = $1", [ids.g]);
    for (const [name, , lv, , , , sixty] of MEMBERS) {
      const g = G[name]!;
      const late = name === "Zirta Pellerouge" ? 12.2 : name === "Orgen Brasdefer" ? 13.8 : 0.1;
      const endDay = sixty ?? 14.6 - (MEMBERS.findIndex(m => m[0] === name) % 4) * 0.3;
      const start = name === "Zirta Pellerouge" || name === "Orgen Brasdefer" ? 8 : 2;
      for (let l = start + 1; l <= lv; l++) {
        const f = (l - start) / (lv - start);
        const d = late + (endDay - late) * Math.pow(f, 1.6);
        await q("insert into guild_levels (group_id, guid, level, reached_at, source) values ($1, $2, $3, $4, $5) on conflict do nothing",
          [ids.g, g, l, at(d), name === "Brindille Feuillevive" ? "exact" : "roster"]);
      }
    }
    // Podium recalculé d'après cet historique (le relevé l'avait figé sur « vus au premier relevé »)
    await q("update game_guilds set podium = null where group_id = $1", [ids.g]);
    // Autres joueurs du site, avec leur main dans la guilde
    const users: Record<string, string> = {};
    for (const [disp, char, cls, spec, lv, role] of [
      ["Kael", "Kaeldra", "Warrior", "Protection", 60, "member"], ["Vexou", "Vex", "Rogue", "Combat", 60, "officer"],
      ["Ysa", "Ysalis", "Priest", "Holy", 60, "member"], ["Gorrak", "Gorrak", "Warrior", "Fury", 58, "member"],
      ["Nessa", "Nessa", "Shaman", "Restoration", 55, "officer"], ["Pikou", "Pikou", "Mage", "Fire", 52, "member"],
      ["Hadrien", "Hadrien", "Priest", "Holy", 44, "member"], ["Lysandre", "Lysandre", "Mage", "Frost", 42, "member"],
      ["Grumdal", "Grumdal", "Warrior", "Protection", 40, "member"],
    ] as const) {
      const full = MEMBERS.find(m => m[0].startsWith(`${char} `))![0];
      const u = (await q("insert into users (display_name, email, email_verified_at, password_hash) values ($1, $2, now(), '$argon2id$v=19$m=19456,t=2,p=1$ZGVtbw$ZGVtbw') returning id", [disp, `${disp.toLowerCase()}-${Date.now()}@example.test`])).rows[0].id as string;
      users[char] = u;
      await q("insert into group_members (group_id, user_id, role) values ($1, $2, $3)", [ids.g, u, role]);
      const c = (await q("insert into characters (user_id, name, cls, spec1, level, game, guid) values ($1, $2, $3, $4, $5, 'forever', $6) returning id", [u, char, cls, spec, lv, G[full]])).rows[0].id as string;
      await q("insert into group_characters (group_id, character_id, user_id, is_main) values ($1, $2, $3, true)", [ids.g, c, u]);
      users[`${char}:c`] = c;
    }
    // Raid de ce soir (21:00) et de dimanche : créés par Thalion
    const mk = async (name: string, iso: string) => (await q("insert into raids (group_id, name, scheduled_at, size, loot_mode, created_by) values ($1, $2, $3, 10, 'council', (select user_id from group_members where group_id = $1 and role = 'owner')) returning id", [ids.g, name, iso])).rows[0].id as string;
    const r1 = await mk("Upper Blackrock Spire", "2026-11-19T20:00:00Z");
    const r2 = await mk("Upper Blackrock Spire", "2026-11-22T19:45:00Z");
    const signup = (raid: string, who: string, cls: string, spec: string, status: string) =>
      users[who] ? q("insert into raid_signups (raid_id, user_id, display_name, character_id, cls, spec, status) values ($1, $2, $3, $4, $5, $6, $7)", [raid, users[who], who, users[`${who}:c`], cls, spec, status])
        : q("insert into raid_signups (raid_id, discord_user_id, display_name, cls, spec, status) values ($1, $2, $3, $4, $5, $6)", [raid, String(930000000000000000n + BigInt(Math.floor(Math.random() * 1e9))), who, cls, spec, status]);
    for (const [w, c, s, st] of [["Kaeldra", "Warrior", "Protection", "present"], ["Vex", "Rogue", "Combat", "present"], ["Ysalis", "Priest", "Holy", "present"], ["Gorrak", "Warrior", "Fury", "present"],
      ["Morvh", "Mage", "Frost", "present"], ["Tavish", "Warlock", "Affliction", "present"], ["Elwin", "Druid", "Restoration", "tentative"], ["Nyssaël", "Hunter", "Marksmanship", "present"]] as const) await signup(r1, w, c, s, st);
    for (const [w, c, s, st] of [["Kaeldra", "Warrior", "Protection", "present"], ["Vex", "Rogue", "Combat", "present"], ["Gorrak", "Warrior", "Fury", "present"], ["Pikou", "Mage", "Fire", "present"]] as const) await signup(r2, w, c, s, st);
    // Sorties d'aujourd'hui et de demain
    const outing = async (dungeon: string, title: string, min: number, max: number, dayIso: string, iso: string | null, creator: string, note = "") => {
      const exp = iso ? new Date(Date.parse(iso) + 2 * 3600e3) : new Date(`${dayIso}T22:59:00Z`);
      return (await q("insert into outings (group_id, dungeon, title, min_level, max_level, day, scheduled_at, expires_at, creator_name, created_by, note) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id",
        [ids.g, dungeon, title, min, max, dayIso, iso, exp, creator, users[creator.split(" ")[0]!] ?? null, note])).rows[0].id as string;
    };
    const os = (o: string, who: string, cls: string, spec: string, role: string, waiting = false) =>
      users[who] ? q("insert into outing_signups (outing_id, user_id, display_name, character_id, character_name, cls, spec, role, waiting_since) values ($1, $2, $3, $4, $3, $5, $6, $7, $8)", [o, users[who], who, users[`${who}:c`], cls, spec, role, waiting ? new Date(now - 3600e3) : null])
        : q("insert into outing_signups (outing_id, discord_user_id, display_name, character_name, cls, spec, role, waiting_since) values ($1, $2, $3, $3, $4, $5, $6, $7)", [o, String(940000000000000000n + BigInt(Math.floor(Math.random() * 1e9))), who, cls, spec, role, waiting ? new Date(now - 3600e3) : null]);
    const o1 = await outing("blackrock-depths", "Blackrock Depths", 52, 60, "2026-11-19", "2026-11-19T19:30:00Z", "Gorrak Fendroc", "Clé de l'ombreforge");
    await os(o1, "Kaeldra", "Warrior", "Protection", "Tank"); await os(o1, "Gorrak", "Warrior", "Fury", "DPS"); await os(o1, "Pikou", "Mage", "Fire", "DPS");
    const o2 = await outing("scarlet-monastery", "Scarlet Monastery", 34, 45, "2026-11-19", null, "Hadrien Marbregris", "Cathédrale");
    await os(o2, "Grumdal", "Warrior", "Protection", "Tank"); await os(o2, "Hadrien", "Priest", "Holy", "Heal"); await os(o2, "Lysandre", "Mage", "Frost", "DPS"); await os(o2, "Brakka", "Rogue", "Combat", "DPS");
    const o3 = await outing("stratholme", "Stratholme", 58, 60, "2026-11-20", "2026-11-20T20:00:00Z", "Vex Ombrelame", "Côté mort-vivant");
    await os(o3, "Kaeldra", "Warrior", "Protection", "Tank"); await os(o3, "Ysalis", "Priest", "Holy", "Heal"); await os(o3, "Vex", "Rogue", "Combat", "DPS");
    await os(o3, "Gorrak", "Warrior", "Fury", "DPS"); await os(o3, "Morvh", "Mage", "Frost", "DPS"); await os(o3, "Tavish", "Warlock", "Affliction", "DPS", true);
    const o4 = await outing("zulfarrak", "Zul'Farrak", 44, 54, "2026-11-20", "2026-11-20T18:00:00Z", "Nessa Flotsombre");
    await os(o4, "Nessa", "Shaman", "Restoration", "Heal"); await os(o4, "Elwin", "Druid", "Feral Bear", "Tank");
  } finally { await db2.end(); }

  const shots = async (p: Page, name: string) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
  await page.goto(`/groups/${ids.g}`);
  await expect(page.locator(".hm")).toBeVisible();
  await expect(page.getByText("jour 15 de la course")).toBeVisible();
  await shots(page, "accueil-sombre");

  // Image héros de l'accueil public, 1200 × 800 : l'Accueil en 1100 × 733, agrandi d'un dixième (lisible en petit), thème sombre
  const hero = await page.context().browser()!.newContext({
    baseURL: new URL(page.url()).origin, storageState: await page.context().storageState(), viewport: { width: 1100, height: 733 }, deviceScaleFactor: 1200 / 1100, colorScheme: "dark", locale: "fr-FR",
  });
  const hp = await hero.newPage();
  await hp.clock.install({ time: now });
  await hp.goto(`/groups/${ids.g}`);
  await expect(hp.getByText("jour 15 de la course")).toBeVisible();
  await hp.waitForLoadState("networkidle"); await hp.waitForTimeout(400);
  const { default: sharp } = await import("sharp");
  await sharp(await hp.screenshot()).resize(1200, 800).webp({ quality: 82 }).toFile(HERO);
  await hero.close();
  const meta = await sharp(HERO).metadata();
  expect([meta.width, meta.height]).toEqual([1200, 800]);
  expect(statSync(HERO).size).toBeLessThan(160_000);

  await page.setViewportSize({ width: 1360, height: 1000 });
  await page.goto(`/groups/${ids.g}/sorties`); await shots(page, "sorties-sombre");
  await page.goto(`/groups/${ids.g}/membres/course`); await shots(page, "course-sombre");
  await page.goto(`/groups/${ids.g}/membres`); await shots(page, "guilde-sombre");
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`/groups/${ids.g}`); await shots(page, "accueil-clair");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/groups/${ids.g}`); await shots(page, "accueil-telephone");
});
