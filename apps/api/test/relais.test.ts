import { readFileSync } from "node:fs";
import { createVerify } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalGroupBlock, groupBlockSignature, type GroupBlockKind } from "@forever/game-data";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvents, characters, groupMembers, raids, raidSignups } from "../src/db/schema";
import { signUpDiscordGuest } from "../src/lib/signups";
import { syncSigner } from "../src/lib/sync-signing";
import { groupExport } from "../src/routes/addon";
import { setup, signedIn, tokenFrom, type Client, type TestEnv } from "./helpers";

/**
 * Copier-coller facultatif, côté API : heure du dernier changement de statut d'une inscription (`status_at`), liste des
 * inscrits servie dans le bloc FRG signé (ligne Y), réglage « mes inscriptions faites en jeu peuvent passer par un
 * officier » (`gameRelay`), inscriptions faites en jeu transmises par un officier (lignes V du FRC, Ctrl+V et appli). Clé de TEST du partage (addon/tests/fixtures, keyId a3de5db8). Noms fictifs.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixture = (name: string) => readFileSync(path.join(ROOT, "addon/tests/fixtures", name), "utf8");
const PRIVATE_PEM = fixture("site-test-key.pem"), PUBLIC_PEM = fixture("site-test-key.pub.pem");
const KEY = Buffer.from(PRIVATE_PEM).toString("base64");

let env: TestEnv;
beforeAll(async () => { env = await setup({ SYNC_SIGNING_KEY: KEY }); });
afterAll(async () => { await env.close(); });

/** Signature du bloc vérifiée par Node avec la clé publique de test, sur sa forme canonique. */
function verified(block: string, kind: GroupBlockKind) {
  const s = groupBlockSignature(block);
  if (!s || s.keyId !== "a3de5db8") return false;
  return createVerify("sha256").update(Buffer.from(canonicalGroupBlock(block, kind), "utf8")).verify(PUBLIC_PEM, s.signature, "base64");
}
/** Les horodatages de la base ont la précision de la milliseconde : un court temps d'arrêt rend les changements visibles. */
const tick = () => new Promise(r => setTimeout(r, 40));
const db = () => env.app.ctx.db;

/**
 * Groupe de Forever : officière Greta (perso Greta Coulé), membre Thalwen (persos Thalwen et Brindille), un raid demain.
 * Thalwen s'inscrit en retard avec Brindille AVANT Greta (présente) : l'ordre d'arrivée est Brindille, puis Greta.
 */
async function scene(tag: string) {
  const gm = await signedIn(env, `Greta${tag}`), mem = await signedIn(env, `Thalwen${tag}`);
  const g = (await gm.c.post("/api/groups", { name: `Les Veilleurs ${tag}` })).json().group;
  const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 9, expiresInHours: 24 })).json().invite;
  const join = async (p: { c: { post: (u: string, b?: unknown) => Promise<{ statusCode: number }> } }) =>
    expect((await p.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) })).statusCode).toBe(200);
  await join(mem);
  const char = async (p: typeof gm, name: string, cls: string, race: string) => {
    const ch = (await p.c.post("/api/characters", { name, race, cls })).json().character;
    expect((await p.c.put(`/api/groups/${g.id}/characters/${ch.id}`, { assigned: true })).statusCode).toBe(200);
    return ch as { id: string };
  };
  const greta = await char(gm, "Greta Coulé", "Druid", "Tauren");
  const thalwen = await char(mem, "Thalwen", "Warrior", "Orc");
  const brindille = await char(mem, "Brindille", "Mage", "Troll");
  const raid = async (name: string, days: number) =>
    (await gm.c.post(`/api/groups/${g.id}/raids`, { name, scheduledAt: new Date(Date.now() + days * 86400e3).toISOString() })).json().raid as { id: string };
  const r = await raid("Molten Core", 1);
  const signup = async (p: typeof gm, raidId: string, body: Record<string, unknown>) =>
    expect((await p.c.put(`/api/groups/${g.id}/raids/${raidId}/signup`, body)).statusCode).toBe(200);
  await signup(mem, r.id, { status: "late", characterId: brindille.id });
  await tick();
  await signup(gm, r.id, { status: "present", characterId: greta.id });
  return { gm, mem, g, greta, thalwen, brindille, raid: r, newRaid: raid, signup, join, char };
}

/** Ligne d'inscription en base (heure du dernier changement de statut comprise). */
const signupRow = async (raidId: string, by: { userId: string } | { discordUserId: string }) => {
  const [row] = await db().select({ id: raidSignups.id, status: raidSignups.status, spec: raidSignups.spec, statusAt: raidSignups.statusAt, updatedAt: raidSignups.updatedAt })
    .from(raidSignups).where(and(eq(raidSignups.raidId, raidId), "userId" in by ? eq(raidSignups.userId, by.userId) : eq(raidSignups.discordUserId, by.discordUserId)));
  return row!;
};

describe("status_at : heure du dernier changement de statut", () => {
  it("status_at bouge seulement quand le statut change", async () => {
    const s = await scene("A");
    const who = { userId: s.mem.user.id };
    const base = `/api/groups/${s.g.id}/raids/${s.raid.id}`;
    const first = await signupRow(s.raid.id, who);
    expect(first.status).toBe("late");
    expect(first.statusAt).toBeInstanceOf(Date);

    // L'officier change la spé seulement : le statut est le même, status_at ne bouge pas (la ligne, elle, a changé)
    await tick();
    expect((await s.gm.c.patch(`${base}/signups/${first.id}`, { spec: "Fire" })).statusCode).toBe(200);
    const afterSpec = await signupRow(s.raid.id, who);
    expect(afterSpec.spec).toBe("Fire");
    expect(afterSpec.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
    expect(afterSpec.statusAt.getTime()).toBe(first.statusAt.getTime());

    // Même statut redonné par l'officier avec une autre spé : inchangé
    await tick();
    expect((await s.gm.c.patch(`${base}/signups/${first.id}`, { status: "late", spec: "Frost" })).statusCode).toBe(200);
    expect((await signupRow(s.raid.id, who)).statusAt.getTime()).toBe(first.statusAt.getTime());

    // Le joueur se réinscrit (signUpSiteUser) avec le même statut, autre spé et autre note : inchangé
    await tick();
    await s.signup(s.mem, s.raid.id, { status: "late", characterId: s.brindille.id, spec: "Arcane", note: "Je serai là à 21 h" });
    const again = await signupRow(s.raid.id, who);
    expect(again.spec).toBe("Arcane");
    expect(again.updatedAt.getTime()).toBeGreaterThan(afterSpec.updatedAt.getTime());
    expect(again.statusAt.getTime()).toBe(first.statusAt.getTime());

    // L'officier passe l'inscrit sur le banc : plus récent
    await tick();
    expect((await s.gm.c.patch(`${base}/signups/${first.id}`, { status: "bench" })).statusCode).toBe(200);
    const benched = await signupRow(s.raid.id, who);
    expect(benched.status).toBe("bench");
    expect(benched.statusAt.getTime()).toBeGreaterThan(first.statusAt.getTime());

    // Le joueur change de statut en se réinscrivant : plus récent encore
    await tick();
    await s.signup(s.mem, s.raid.id, { status: "present", characterId: s.brindille.id });
    const back = await signupRow(s.raid.id, who);
    expect(back.status).toBe("present");
    expect(back.statusAt.getTime()).toBeGreaterThan(benched.statusAt.getTime());
  });

  it("invité Discord : même règle (signUpDiscordGuest)", async () => {
    const s = await scene("B");
    const guest = { discordUserId: "discord-invite-1" };
    const sign = (status: "present" | "tentative") => signUpDiscordGuest(db(), s.raid.id, { ...guest, displayName: "Fantôme" }, { status, cls: "Warrior", spec: "Fury" });
    await sign("present");
    const first = await signupRow(s.raid.id, guest);
    await tick();
    await sign("present");
    expect((await signupRow(s.raid.id, guest)).statusAt.getTime()).toBe(first.statusAt.getTime());
    await tick();
    await sign("tentative");
    expect((await signupRow(s.raid.id, guest)).statusAt.getTime()).toBeGreaterThan(first.statusAt.getTime());
  });
});

describe("FRG : ligne Y (liste des inscrits)", () => {
  it("une ligne Y par raid : ordre d'arrivée, main d'un absent sans perso, invité Discord omis, signée", async () => {
    const s = await scene("Y");
    // Ondine : main « Ondine Verte » et alt « Ondinette », absente sans perso → écrite au prénom de son main
    const ondine = await signedIn(env, "OndineY");
    await s.join(ondine);
    await s.char(ondine, "Ondine Verte", "Priest", "Human");
    await s.char(ondine, "Ondinette", "Rogue", "Human");
    await s.signup(ondine, s.raid.id, { status: "absent" });
    // Sansperso : aucun perso dans la guilde, absent → omis
    const vide = await signedIn(env, "VideY");
    await s.join(vide);
    await s.signup(vide, s.raid.id, { status: "absent" });
    // Un invité Discord (pas de compte) : jamais dans la ligne
    await signUpDiscordGuest(db(), s.raid.id, { discordUserId: "discord-invite-y", displayName: "Fantôme" }, { status: "present", cls: "Warrior", spec: "Fury" });
    // Thalwen a deux persos au même prénom : un seul joueur, pas un homonyme
    await s.char(s.mem, "Brindille Dos", "Mage", "Troll");
    // Raid sans aucun inscrit : ligne Y vide, quand même présente
    const videRaid = await s.newRaid("Onyxia", 2);

    const signer = syncSigner(env.cfg);
    const text = (await groupExport(db(), s.g.id, s.mem.user.id, signer)).text;
    const lines = text.split("\n");
    const yLines = lines.filter(l => l.startsWith("Y;"));
    expect(yLines).toHaveLength(2);
    const mc = yLines.find(l => l.startsWith(`Y;${s.raid.id};`))!;
    const entries = mc.split(";")[2]!.split(",");
    // Ordre d'arrivée : Brindille (Thalwen), Greta, puis Ondine (absente)
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatch(/^Brindille:late:\d{10}$/);
    expect(entries[1]).toMatch(/^Greta:present:\d{10}$/);
    expect(entries[2]).toMatch(/^Ondine:absent:\d{10}$/);
    expect(mc).not.toMatch(/Fant|Vide|Ondinette|\?/);
    expect(yLines.find(l => l.startsWith(`Y;${videRaid.id};`))).toBe(`Y;${videRaid.id};`);

    // Heure du changement de statut : celle de la base, en secondes
    const row = await signupRow(s.raid.id, { userId: s.mem.user.id });
    expect(mc).toContain(`Brindille:late:${Math.floor(row.statusAt.getTime() / 1000)}`);

    // Placement : après les R (et les X), avant M ; END ne compte pas les Y ; bloc signé et vérifié, identique pour tous
    const kinds = lines.map(l => l.split(";")[0]);
    expect(kinds.lastIndexOf("R")).toBeLessThan(kinds.indexOf("Y"));
    expect(kinds.lastIndexOf("Y")).toBeLessThan(kinds.indexOf("M"));
    expect(lines.at(-1)).toBe("END;2");
    expect(verified(text, "FRG")).toBe(true);
    const other = (await groupExport(db(), s.g.id, s.gm.user.id, signer)).text;
    expect(other.split("\n").filter(l => l.startsWith("Y;"))).toEqual(yLines);
    expect(verified(other, "FRG")).toBe(true);
    expect(await groupExport(db(), s.g.id, s.gm.user.id, null)).toMatchObject({ text: expect.stringContaining(`\nY;${s.raid.id};Brindille:late:`) });
  });

  it("un prénom porté par deux joueurs est écrit « Prénom? » ; un changement de statut se voit dans la ligne", async () => {
    const s = await scene("H");
    // Un autre joueur a un perso « Greta Dubois » dans la guilde : Greta (Coulé) et Greta (Dubois) sont homonymes
    const rival = await signedIn(env, "RivaleH");
    await s.join(rival);
    const dubois = await s.char(rival, "Greta Dubois", "Rogue", "Human");
    const signer = syncSigner(env.cfg);
    const entries = async () => ((await groupExport(db(), s.g.id, s.mem.user.id, signer)).text.split("\n").find(l => l.startsWith("Y;"))!).split(";")[2]!.split(",");
    let list = await entries();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatch(/^Brindille:late:/);
    expect(list[1]).toMatch(/^Greta\?:present:/);
    // Homonyme inscrit lui aussi : les deux sont marqués
    await s.signup(rival, s.raid.id, { status: "tentative", characterId: dubois.id });
    list = await entries();
    expect(list.map(e => e.split(":").slice(0, 2).join(":"))).toEqual(["Brindille:late", "Greta?:present", "Greta?:tentative"]);
    expect(verified((await groupExport(db(), s.g.id, s.mem.user.id, signer)).text, "FRG")).toBe(true);

    // Changement de statut de Brindille : nouvelle heure dans la ligne
    const before = Number(list[0]!.split(":")[2]);
    await new Promise(r => setTimeout(r, 1100));
    await s.signup(s.mem, s.raid.id, { status: "bench", characterId: s.brindille.id });
    list = await entries();
    expect(list[0]).toMatch(/^Brindille:bench:\d+$/);
    expect(Number(list[0]!.split(":")[2])).toBeGreaterThan(before);
  });

  it("homonymes : le perso de chaque inscription compte aussi, même retiré de la guilde", async () => {
    const s = await scene("D");
    // Rivale s'inscrit avec « Greta Dubois », puis retire ce perso de la guilde : l'inscription le garde
    const rival = await signedIn(env, "RivaleD");
    await s.join(rival);
    const dubois = await s.char(rival, "Greta Dubois", "Rogue", "Human");
    await s.signup(rival, s.raid.id, { status: "tentative", characterId: dubois.id });
    expect((await rival.c.put(`/api/groups/${s.g.id}/characters/${dubois.id}`, { assigned: false })).statusCode).toBe(200);
    const signer = syncSigner(env.cfg);
    const text = (await groupExport(db(), s.g.id, s.mem.user.id, signer)).text;
    const y = text.split("\n").find(l => l.startsWith(`Y;${s.raid.id};`))!;
    // Deux joueurs portent « Greta » dans la liste : les deux entrées sont marquées
    expect(y.split(";")[2]!.split(",").map(e => e.split(":").slice(0, 2).join(":"))).toEqual(["Brindille:late", "Greta?:present", "Greta?:tentative"]);
    expect(verified(text, "FRG")).toBe(true);
  });

  it("même created_at : départagé par l'id, même liste à chaque appel", async () => {
    const s = await scene("T");
    const signer = syncSigner(env.cfg);
    // Les deux inscriptions reçoivent la même heure d'arrivée. Ids choisis à l'inverse de l'ordre des joueurs et de l'ordre
    // dans la table (la ligne réécrite en dernier passe en fin de table) : seul le départage par id donne l'ordre attendu
    const rows = await db().select({ id: raidSignups.id, userId: raidSignups.userId }).from(raidSignups).where(eq(raidSignups.raidId, s.raid.id));
    expect(rows).toHaveLength(2);
    const [a, b] = [...rows].sort((x, y) => (x.userId! < y.userId! ? -1 : 1));
    const same = new Date(Date.now() - 60_000);
    await db().update(raidSignups).set({ id: "ffffffff-ffff-4fff-bfff-ffffffffffff", createdAt: same }).where(eq(raidSignups.id, a!.id));
    await db().update(raidSignups).set({ id: "00000000-0000-4000-8000-000000000000", createdAt: same }).where(eq(raidSignups.id, b!.id));
    const nameOf = (userId: string | null) => (userId === s.mem.user.id ? "Brindille" : "Greta");
    const yLine = async () => (await groupExport(db(), s.g.id, s.mem.user.id, signer)).text.split("\n").find(l => l.startsWith(`Y;${s.raid.id};`))!;
    const first = await yLine();
    expect(first.split(";")[2]!.split(",").map(e => e.split(":")[0])).toEqual([nameOf(b!.userId), nameOf(a!.userId)]);
    expect(await yLine()).toBe(first);
    expect(await yLine()).toBe(first);
  });
});

describe("réglage gameRelay", () => {
  it("vrai par défaut dans /auth/me ; PATCH /api/account/preferences { gameRelay: false } le passe à faux", async () => {
    const { c } = await signedIn(env, "RelaisR");
    expect((await c.get("/api/auth/me")).json().user.gameRelay).toBe(true);
    const off = await c.patch("/api/account/preferences", { gameRelay: false });
    expect(off.statusCode).toBe(200);
    expect(off.json().user.gameRelay).toBe(false);
    expect((await c.get("/api/auth/me")).json().user.gameRelay).toBe(false);
    // La langue seule ne touche pas au relais ; les deux ensemble sont acceptés
    const lang = await c.patch("/api/account/preferences", { gameLang: "en" });
    expect(lang.json().user).toMatchObject({ gameLang: "en", gameRelay: false });
    const both = await c.patch("/api/account/preferences", { gameLang: "fr", gameRelay: true });
    expect(both.json().user).toMatchObject({ gameLang: "fr", gameRelay: true });
    // Au moins un réglage, et du bon type
    const none = await c.patch("/api/account/preferences", {});
    expect(none.statusCode).toBe(400);
    expect(none.json().error).toMatch(/réglage/i);
    expect((await c.patch("/api/account/preferences", { gameRelay: "non" })).statusCode).toBe(400);
    expect((await c.get("/api/auth/me")).json().user.gameRelay).toBe(true);
  });
});

/**
 * Relais : une joueuse clique son inscription en jeu, un officier avec l'appli (ou qui colle son export) la transmet par
 * les lignes `V` de son bloc FRC. Chaque garde du serveur (spec B4) est testée, par Ctrl+V comme par l'appli.
 */
type Player = Awaited<ReturnType<typeof signedIn>>;
const DAY = 86400e3, nowS = () => Math.floor(Date.now() / 1000);
const GRETA_GUID = "Player-4440-0A1B2C3D", PIKOU_GUID = "Player-4440-0A1B2C3E", GRETA_AUTRE_GUID = "Player-4440-0A1B2C3F", OPALE_GUID = "Player-4440-0A1B2C40";

/** Bloc FRC d'un perso (celui de l'envoyeur) avec ses lignes V. */
const block = (name: string, cls: string, race: string, v: string[]) =>
  [`FRC;2;${name};Forever EU;${cls};${race};60;Horde;1790000000;1.6.3`, ...v, `END;${v.length}`].join("\n");
const asOwner = (v: string[]) => block("Brakka", "WARRIOR", "Orc", v);
const asOfficer = (v: string[]) => block("Dorgan", "ROGUE", "Orc", v);
const asMember = (v: string[]) => block("Pikou", "PRIEST", "Human", v);

/** Appareil : requêtes sans cookie ni origine, avec le jeton Bearer (comme Roster Companion). */
const device = (token: string) => ({
  req: (method: string, url: string, body?: unknown) => env.app.inject({
    method: method as "GET", url, headers: { authorization: `Bearer ${token}` }, ...(body !== undefined ? { payload: body as object } : {}),
  }),
});
async function pair(site: Client) {
  const anon = env.app;
  const start = (await anon.inject({ method: "POST", url: "/api/devices/pair", payload: { name: "PC-DORGAN", platform: "Windows 11", appVersion: "0.3.1" } })).json();
  expect((await site.post("/api/devices/pair/approve", { code: start.userCode })).statusCode).toBe(200);
  const r = (await anon.inject({ method: "POST", url: "/api/devices/pair/poll", payload: { pairId: start.pairId } })).json();
  expect(r.status).toBe("approved");
  return r.token as string;
}

/**
 * Guilde : Brakka (propriétaire), Dorgan (officier), Greta (« Greta Coulé »), Pikou et Opale (membres), Nomade (sans perso) ;
 * un étranger (Étienne) qui a sa propre guilde et son raid. Brakka et Dorgan ont leur perso rangé dans la guilde.
 */
async function relayScene() {
  const own = await signedIn(env, "BrakkaJ");
  const g = (await own.c.post("/api/groups", { name: "Les Relayeurs" })).json().group as { id: string };
  const inv = (await own.c.post(`/api/groups/${g.id}/invites`, { maxUses: 20, expiresInHours: 24 })).json().invite;
  const join = async (p: Player) => expect((await p.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) })).statusCode).toBe(200);
  const char = async (p: Player, name: string, cls: string, race: string, file = true) => {
    const ch = (await p.c.post("/api/characters", { name, ...(cls && { race, cls }) })).json().character as { id: string };
    if (file) expect((await p.c.put(`/api/groups/${g.id}/characters/${ch.id}`, { assigned: true })).statusCode).toBe(200);
    return ch;
  };
  const player = async (name: string, perso: [string, string, string] | null) => {
    const p = await signedIn(env, name);
    await join(p);
    return { ...p, char: perso ? await char(p, ...perso) : null };
  };
  const brakka = await char(own, "Brakka", "Warrior", "Orc");
  const off = await player("DorganJ", ["Dorgan", "Rogue", "Orc"]);
  expect((await own.c.patch(`/api/groups/${g.id}/members/${off.user.id}`, { role: "officer" })).statusCode).toBe(200);
  const greta = await player("GretaJ", ["Greta Coulé", "Druid", "Tauren"]);
  const pikou = await player("PikouJ", ["Pikou", "Priest", "Human"]);
  const opale = await player("OpaleJ", ["Opale", "Mage", "Troll"]);
  const nomade = await player("NomadeJ", null);
  // Guilde d'un étranger : son raid ne peut pas être relayé dans la guilde de Brakka
  const ext = await signedIn(env, "EtienneJ");
  const g2 = (await ext.c.post("/api/groups", { name: "Les Voisins" })).json().group as { id: string };
  /** Raid créé ; sa date (celle de la base, en ISO) est relue pour le journal. */
  const raidOf = async (p: Player, gid: string, name: string, offset: number | null) => {
    const { id } = (await p.c.post(`/api/groups/${gid}/raids`, { name, scheduledAt: offset === null ? null : new Date(Date.now() + offset).toISOString() })).json().raid as { id: string };
    const [row] = await db().select({ scheduledAt: raids.scheduledAt }).from(raids).where(eq(raids.id, id));
    return { id, scheduledAt: row!.scheduledAt?.toISOString() ?? null };
  };
  return {
    own, off, greta, pikou, opale, nomade, ext, g, g2, brakka, join, char, player,
    raid: (name: string, offset: number | null = DAY) => raidOf(own, g.id, name, offset),
    raid2: (name: string) => raidOf(ext, g2.id, name, DAY),
  };
}

/** Ligne V : groupe, raid, statut, prénom, GUID, clic. */
const vLine = (gid: string, raid: { id: string }, status: string, name: string, at: number, guid = "") => `V;${gid};${raid.id};${status};${name};${guid};${at}`;
/** Message du bloc de l'envoyeur après un Ctrl+V. */
async function paste(c: Client, text: string, extra: Record<string, unknown> = {}) {
  const r = (await c.post("/api/addon/import", { text, ...extra })).json();
  expect(r.errors).toEqual([]);
  expect(r.results).toHaveLength(1);
  return r.results[0] as { status: string; message: string };
}
const signupsOf = (raidId: string) => db().select().from(raidSignups).where(eq(raidSignups.raidId, raidId));
const relayedEvents = async (groupId: string, raidName?: string) =>
  (await db().select().from(auditEvents).where(and(eq(auditEvents.groupId, groupId), eq(auditEvents.type, "signup_relayed")))).filter(e => !raidName || e.meta.raid === raidName);
const setGuid = (characterId: string, guid: string | null) => db().update(characters).set({ guid }).where(eq(characters.id, characterId));

describe("relais : inscriptions faites en jeu (lignes V)", () => {
  let s: Awaited<ReturnType<typeof relayScene>>;
  beforeAll(async () => { s = await relayScene(); });
  const send = (raid: { id: string }, status: string, name: string, at: number, guid = "") => vLine(s.g.id, raid, status, name, at, guid);
  /** Refus attendu : message « 1 refusée (Prénom : raison) », rien d'écrit sur le raid. */
  async function refused(c: Client, text: string, raid: { id: string }, why: string, empty = true) {
    expect(await paste(c, text)).toMatchObject({ status: "updated", message: `fiche mise à jour · 1 refusée (${why})` });
    if (empty) expect(await signupsOf(raid.id)).toEqual([]);
  }

  it("Ctrl+V : le propriétaire transmet, le site inscrit avec le bon perso, le journal le dit", async () => {
    await setGuid(s.opale.char!.id, OPALE_GUID);
    const raid = await s.raid("Onyxia");
    const at = nowS() - 120;
    // Greta par son prénom (seule à le porter), Opale par son GUID
    const r = await paste(s.own.c, asOwner([send(raid, "tentative", "Greta", at), send(raid, "present", "Opale", at - 30, OPALE_GUID)]));
    expect(r).toMatchObject({ status: "updated", message: "fiche mise à jour · 2 inscriptions transmises (Greta, Opale)" });
    const rows = await signupsOf(raid.id);
    expect(rows).toHaveLength(2);
    const greta = rows.find(x => x.userId === s.greta.user.id)!, opale = rows.find(x => x.userId === s.opale.user.id)!;
    expect(greta).toMatchObject({ status: "tentative", characterId: s.greta.char!.id, cls: "Druid", displayName: "GretaJ" });
    expect(opale).toMatchObject({ status: "present", characterId: s.opale.char!.id, cls: "Mage" });
    expect(greta.statusAt.getTime()).toBeGreaterThanOrEqual(at * 1000);

    // Journal de la guilde : l'officier qui a transmis, le perso, le raid, sa date, le statut
    const events = await relayedEvents(s.g.id, "Onyxia");
    expect(events).toHaveLength(2);
    const ev = events.find(e => e.meta.character === "Greta Coulé")!;
    expect(ev).toMatchObject({ userId: s.own.user.id, groupId: s.g.id, meta: { character: "Greta Coulé", raid: "Onyxia", at: raid.scheduledAt, status: "tentative" } });
    const journal = (await s.own.c.get(`/api/groups/${s.g.id}/audit`)).json().events as { type: string; actor: string; meta: Record<string, unknown> }[];
    expect(journal.filter(e => e.type === "signup_relayed" && e.meta.raid === "Onyxia").map(e => e.actor)).toEqual(["BrakkaJ", "BrakkaJ"]);
  });

  it("appli (/api/sync/upload) : un officier promu transmet ; renvoyé, c'est gardé, sans nouveau journal", async () => {
    const app = device(await pair(s.off.c));
    const raid = await s.raid("Ragnaros");
    const text = asOfficer([send(raid, "tentative", "Greta", nowS() - 60)]);
    const first = (await app.req("POST", "/api/sync/upload", { text })).json();
    expect(first.results).toEqual([expect.objectContaining({ status: "updated", message: "fiche mise à jour · 1 inscription transmise (Greta)" })]);
    expect(await signupsOf(raid.id)).toEqual([expect.objectContaining({ userId: s.greta.user.id, status: "tentative", characterId: s.greta.char!.id })]);
    const again = (await app.req("POST", "/api/sync/upload", { text })).json();
    expect(again.results[0].message).toBe("fiche mise à jour · 1 gardée");
    const events = await relayedEvents(s.g.id, "Ragnaros");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: s.off.user.id, meta: { status: "tentative" } });
    // Un membre simple avec l'appli : refusé, par l'appli aussi
    const member = device(await pair(s.pikou.c));
    const raid2 = await s.raid("Hakkar");
    const r = (await member.req("POST", "/api/sync/upload", { text: asMember([send(raid2, "present", "Greta", nowS() - 60)]) })).json();
    expect(r.results[0].message).toBe("fiche mise à jour · 1 refusée (Greta : pas officier)");
    expect(await signupsOf(raid2.id)).toEqual([]);
  });

  it("le site a le dernier mot : status_at >= clic → gardée ; plus récent → transmise", async () => {
    const raid = await s.raid("Zul Gurub");
    await s.greta.c.put(`/api/groups/${s.g.id}/raids/${raid.id}/signup`, { status: "present", characterId: s.greta.char!.id, note: "Je serai là à 21 h" });
    const get = async () => (await signupsOf(raid.id)).find(x => x.userId === s.greta.user.id)!;
    // Clic plus ancien que le changement fait sur le site : gardée, la ligne ne bouge pas
    const before = await get();
    expect(await paste(s.own.c, asOwner([send(raid, "absent", "Greta", nowS() - 3600)]))).toMatchObject({ message: "fiche mise à jour · 1 gardée" });
    expect(await get()).toMatchObject({ status: "present", note: "Je serai là à 21 h" });
    expect((await get()).updatedAt.getTime()).toBe(before.updatedAt.getTime());
    // Clic exactement à l'heure du changement (>=) : gardée
    const at = nowS() - 600;
    await db().update(raidSignups).set({ statusAt: new Date(at * 1000) }).where(eq(raidSignups.id, before.id));
    expect(await paste(s.own.c, asOwner([send(raid, "absent", "Greta", at)]))).toMatchObject({ message: "fiche mise à jour · 1 gardée" });
    expect((await get()).status).toBe("present");
    // Clic d'une seconde plus récent : transmise
    expect(await paste(s.own.c, asOwner([send(raid, "absent", "Greta", at + 1)]))).toMatchObject({ message: "fiche mise à jour · 1 inscription transmise (Greta)" });
    expect(await get()).toMatchObject({ status: "absent", characterId: s.greta.char!.id });
    expect((await get()).statusAt.getTime()).toBeGreaterThan(at * 1000);
    // Même statut, même perso, clic plus récent que status_at : rien à transmettre, la note est gardée
    await db().update(raidSignups).set({ statusAt: new Date((at - 100) * 1000), note: "Peut-être en retard" }).where(eq(raidSignups.id, before.id));
    expect(await paste(s.own.c, asOwner([send(raid, "absent", "Greta", at)]))).toMatchObject({ message: "fiche mise à jour · 1 gardée" });
    expect(await get()).toMatchObject({ status: "absent", note: "Peut-être en retard" });
    expect(await relayedEvents(s.g.id, "Zul Gurub")).toHaveLength(1);
  });

  it("refus : envoyeur simple membre, étranger à la guilde, perso de l'envoyeur", async () => {
    const raid = await s.raid("Naxxramas");
    const at = nowS() - 60;
    // Pikou est membre simple : son export ne transmet rien
    await refused(s.pikou.c, asMember([send(raid, "present", "Greta", at)]), raid, "Greta : pas officier");
    // Un étranger (officier de SA guilde seulement) ne transmet pas dans celle de Brakka
    const ext = await s.ext.c.post("/api/characters", { name: "Etienne", race: "Troll", cls: "Mage" });
    expect(ext.statusCode).toBe(201);
    await refused(s.ext.c, block("Etienne", "MAGE", "Troll", [send(raid, "present", "Greta", at)]), raid, "Greta : pas officier");
    // Le perso est celui de l'envoyeur : Brakka (propriétaire) et Dorgan (officier) ne s'inscrivent pas eux-mêmes par ce chemin
    await refused(s.own.c, asOwner([send(raid, "present", "Brakka", at)]), raid, "Brakka : ton perso");
    await refused(s.off.c, asOfficer([send(raid, "present", "Dorgan", at)]), raid, "Dorgan : ton perso");
    expect(await relayedEvents(s.g.id, "Naxxramas")).toEqual([]);
  });

  it("refus : le joueur a coupé le relais (réglage gameRelay) ; il le rallume, ça passe", async () => {
    const raid = await s.raid("Karazhan");
    const at = nowS() - 60;
    expect((await s.opale.c.patch("/api/account/preferences", { gameRelay: false })).statusCode).toBe(200);
    await refused(s.own.c, asOwner([send(raid, "present", "Opale", at)]), raid, "Opale : relais coupé par le joueur");
    expect((await s.opale.c.patch("/api/account/preferences", { gameRelay: true })).statusCode).toBe(200);
    expect(await paste(s.own.c, asOwner([send(raid, "present", "Opale", at)]))).toMatchObject({ message: "fiche mise à jour · 1 inscription transmise (Opale)" });
    expect(await signupsOf(raid.id)).toEqual([expect.objectContaining({ userId: s.opale.user.id, status: "present" })]);
  });

  it("refus : raid d'une autre guilde, groupe étranger, raid passé depuis plus de 24 h ; raid récent ou sans date accepté", async () => {
    const at = nowS() - 60;
    // Raid de la guilde voisine donné avec le groupe de Brakka, ou avec le groupe voisin (Brakka n'y est pas officier)
    const foreign = await s.raid2("Raid voisin");
    await refused(s.own.c, asOwner([send(foreign, "present", "Greta", at)]), foreign, "Greta : raid introuvable");
    await refused(s.own.c, asOwner([vLine(s.g2.id, foreign, "present", "Greta", at)]), foreign, "Greta : pas officier");
    // Passé depuis 25 h : refusé ; depuis 2 h : accepté ; sans date : accepté (la date du journal est alors vide)
    const old = await s.raid("Raid de la veille", -25 * 3600e3);
    await refused(s.own.c, asOwner([send(old, "present", "Greta", at)]), old, "Greta : raid passé");
    const recent = await s.raid("Raid de ce soir", -2 * 3600e3);
    expect(await paste(s.own.c, asOwner([send(recent, "present", "Greta", at)]))).toMatchObject({ message: "fiche mise à jour · 1 inscription transmise (Greta)" });
    const open = await s.raid("Raid sans date", null);
    expect(await paste(s.own.c, asOwner([send(open, "late", "Greta", at)]))).toMatchObject({ message: "fiche mise à jour · 1 inscription transmise (Greta)" });
    expect((await relayedEvents(s.g.id, "Raid sans date"))[0]!.meta).toMatchObject({ at: null, status: "late" });
    expect((await relayedEvents(s.g.id, "Raid de ce soir"))[0]!.meta.at).toBe(recent.scheduledAt);
    expect(await relayedEvents(s.g.id, "Raid de la veille")).toEqual([]);
  });

  it("refus : clic dans le futur (+ 10 min) ou trop ancien (- 8 jours) ; - 6 jours accepté", async () => {
    const raid = await s.raid("Gnomeregan");
    await refused(s.own.c, asOwner([send(raid, "present", "Greta", nowS() + 600)]), raid, "Greta : heure du clic");
    await refused(s.own.c, asOwner([send(raid, "present", "Greta", nowS() - 8 * 86400)]), raid, "Greta : heure du clic");
    expect(await paste(s.own.c, asOwner([send(raid, "present", "Greta", nowS() - 6 * 86400)]))).toMatchObject({ message: "fiche mise à jour · 1 inscription transmise (Greta)" });
    // Quatre minutes d'avance sur l'horloge du serveur : toléré (+ 5 min)
    const raid2 = await s.raid("Gnomeregan bis");
    expect(await paste(s.own.c, asOwner([send(raid2, "present", "Greta", nowS() + 240)]))).toMatchObject({ message: "fiche mise à jour · 1 inscription transmise (Greta)" });
  });

  it("homonymes : deux persos « Greta » sans GUID → refusé ; avec le GUID de l'un, c'est le bon qui s'inscrit", async () => {
    // Rivale a « Greta Dubois » dans la même guilde : Greta est ambiguë, tant qu'elle y reste
    const rival = await s.player("RivaleJ", ["Greta Dubois", "Rogue", "Human"]);
    const raid = await s.raid("Mur-de-Glace");
    const at = nowS() - 60;
    await refused(s.own.c, asOwner([send(raid, "present", "Greta", at)]), raid, "Greta : prénom en double");
    // GUID inconnu du site et prénom porté par deux persos : refusé aussi
    await refused(s.own.c, asOwner([send(raid, "present", "Greta", at, GRETA_AUTRE_GUID)]), raid, "Greta : prénom en double");
    // GUID connu : trouvée par GUID malgré l'homonyme
    await setGuid(s.greta.char!.id, GRETA_GUID);
    expect(await paste(s.own.c, asOwner([send(raid, "present", "Greta", at, GRETA_GUID)]))).toMatchObject({ message: "fiche mise à jour · 1 inscription transmise (Greta)" });
    expect(await signupsOf(raid.id)).toEqual([expect.objectContaining({ userId: s.greta.user.id, characterId: s.greta.char!.id })]);
    // Et celui de Greta Dubois renvoie à Greta Dubois
    await setGuid(rival.char!.id, GRETA_AUTRE_GUID);
    const raid2 = await s.raid("Mur-de-Glace bis");
    expect(await paste(s.own.c, asOwner([send(raid2, "tentative", "Greta", at, GRETA_AUTRE_GUID)]))).toMatchObject({ message: "fiche mise à jour · 1 inscription transmise (Greta)" });
    expect(await signupsOf(raid2.id)).toEqual([expect.objectContaining({ userId: rival.user.id, characterId: rival.char!.id, status: "tentative" })]);
    // Rivale retire son perso de la guilde : Greta redevient seule à porter ce prénom
    await setGuid(s.greta.char!.id, null);
    expect((await rival.c.put(`/api/groups/${s.g.id}/characters/${rival.char!.id}`, { assigned: false })).statusCode).toBe(200);
    const raid3 = await s.raid("Mur-de-Glace ter");
    expect(await paste(s.own.c, asOwner([send(raid3, "present", "Greta", at)]))).toMatchObject({ message: "fiche mise à jour · 1 inscription transmise (Greta)" });
    expect(await signupsOf(raid3.id)).toEqual([expect.objectContaining({ userId: s.greta.user.id })]);
  });

  it("GUID falsifié : un GUID connu envoyé avec un autre prénom est refusé, l'inscription visée ne bouge pas", async () => {
    // Le prénom de la ligne est celui de l'expéditeur (authentifié par le jeu) ; le GUID, déclaré dans son message, se falsifie
    await setGuid(s.greta.char!.id, GRETA_GUID);
    const raid = await s.raid("Orgrimmar");
    expect((await s.greta.c.put(`/api/groups/${s.g.id}/raids/${raid.id}/signup`, { status: "tentative", characterId: s.greta.char!.id })).statusCode).toBe(200);
    // Greta a répondu sur le site il y a une heure : un clic de maintenant l'emporterait, sans la garde du prénom
    const mine = (await signupsOf(raid.id))[0]!;
    await db().update(raidSignups).set({ statusAt: new Date((nowS() - 3600) * 1000) }).where(eq(raidSignups.id, mine.id));
    const before = (await signupsOf(raid.id))[0]!;
    // Pikou envoie le GUID de Greta : refusé, rien ne change pour Greta, rien n'est créé pour Pikou
    await refused(s.own.c, asOwner([send(raid, "absent", "Pikou", nowS() - 60, GRETA_GUID)]), raid, "Pikou : GUID d'un autre perso", false);
    expect(await signupsOf(raid.id)).toEqual([before]);
    expect(await relayedEvents(s.g.id, "Orgrimmar")).toEqual([]);
    // Avec son propre prénom (casse sans importance), le même GUID passe
    expect(await paste(s.own.c, asOwner([send(raid, "absent", "greta", nowS() - 60, GRETA_GUID)]))).toMatchObject({ message: "fiche mise à jour · 1 inscription transmise (Greta)" });
    expect((await signupsOf(raid.id))[0]).toMatchObject({ userId: s.greta.user.id, status: "absent" });
    await setGuid(s.greta.char!.id, null);
  });

  it("GUID : à défaut, le prénom seul suffit s'il est unique ; un GUID différent sur la fiche → refusé", async () => {
    const raid = await s.raid("Stratholme");
    const at = nowS() - 60;
    // Pikou n'a pas encore de GUID sur le site : le prénom unique suffit
    expect(await paste(s.own.c, asOwner([send(raid, "present", "pikou", at, PIKOU_GUID)]))).toMatchObject({ message: "fiche mise à jour · 1 inscription transmise (Pikou)" });
    // La fiche porte un autre GUID : ce n'est pas le même perso
    await setGuid(s.pikou.char!.id, GRETA_AUTRE_GUID);
    const raid2 = await s.raid("Stratholme bis");
    await refused(s.own.c, asOwner([send(raid2, "present", "Pikou", at, PIKOU_GUID)]), raid2, "Pikou : GUID différent sur la fiche");
    // Deux fiches au même GUID : on ne sait pas laquelle
    await setGuid(s.pikou.char!.id, GRETA_AUTRE_GUID);
    await setGuid(s.opale.char!.id, GRETA_AUTRE_GUID);
    await refused(s.own.c, asOwner([send(raid2, "present", "Pikou", at, GRETA_AUTRE_GUID)]), raid2, "Pikou : GUID en double");
    await setGuid(s.opale.char!.id, OPALE_GUID);
    await setGuid(s.pikou.char!.id, null);
  });

  it("perso inconnu, rangé ailleurs, joueur parti ou perso sans classe : refusé, rien n'est créé", async () => {
    const raid = await s.raid("Scholomance");
    const at = nowS() - 60;
    const total = async () => (await db().select({ id: characters.id }).from(characters)).length;
    const n = await total();
    await refused(s.own.c, asOwner([send(raid, "present", "Inconnu", at)]), raid, "Inconnu : perso introuvable");
    // Perso du site rangé dans aucune guilde
    await s.char(s.greta, "Solitaire", "Hunter", "Orc", false);
    await refused(s.own.c, asOwner([send(raid, "present", "Solitaire", at)]), raid, "Solitaire : perso introuvable");
    // Perso sans classe (rangé dans la guilde) : l'inscription du site le refuse
    await s.char(s.nomade, "Sansclasse", "", "");
    await refused(s.own.c, asOwner([send(raid, "present", "Sansclasse", at)]), raid, "Sansclasse : perso sans classe");
    // Joueur qui n'est plus membre (sa ligne de membre a disparu, son perso reste rangé) : refusé alors que le perso a une classe
    await s.char(s.nomade, "Partie", "Hunter", "Orc");
    expect(await paste(s.own.c, asOwner([send(raid, "present", "Partie", at)]))).toMatchObject({ message: "fiche mise à jour · 1 inscription transmise (Partie)" });
    await db().delete(raidSignups).where(eq(raidSignups.raidId, raid.id));
    await db().delete(groupMembers).where(and(eq(groupMembers.groupId, s.g.id), eq(groupMembers.userId, s.nomade.user.id)));
    await refused(s.own.c, asOwner([send(raid, "present", "Partie", at)]), raid, "Partie : pas membre");
    expect(await total()).toBe(n + 3); // Solitaire, Sansclasse et Partie, créés ici par le test lui-même
    expect(await relayedEvents(s.g.id, "Scholomance")).toHaveLength(1); // celle de Partie, avant son départ
  });

  it("message du bloc : transmises, gardées et refusées ensemble, accords au pluriel, parties à zéro omises", async () => {
    const raid = await s.raid("Tempete");
    const at = nowS() - 60;
    // Pikou et Opale ont déjà répondu sur le site après leur clic : gardées
    for (const p of [s.pikou, s.opale]) await p.c.put(`/api/groups/${s.g.id}/raids/${raid.id}/signup`, { status: "bench", characterId: p.char!.id });
    const r = await paste(s.own.c, asOwner([
      send(raid, "present", "Pikou", at), send(raid, "late", "Opale", at), send(raid, "present", "Inconnu", at), send(raid, "present", "Fantome", at),
    ]));
    expect(r.message).toBe("fiche mise à jour · 2 gardées · 2 refusées (Inconnu : perso introuvable, Fantome : perso introuvable)");
    expect(await paste(s.own.c, asOwner([send(raid, "present", "Pikou", at)]))).toMatchObject({ message: "fiche mise à jour · 1 gardée" });
    const mixed = await paste(s.own.c, asOwner([send(raid, "present", "Greta", at), send(raid, "present", "Pikou", at), send(raid, "present", "Inconnu", at)]));
    expect(mixed.message).toBe("fiche mise à jour · 1 inscription transmise (Greta) · 1 gardée · 1 refusée (Inconnu : perso introuvable)");
    // Raisons différentes, chacune dite ; le même prénom refusé deux fois pour la même raison n'est écrit qu'une fois
    const two = await paste(s.own.c, asOwner([send(raid, "present", "Greta", nowS() + 600), send(raid, "present", "Inconnu", at), vLine(s.g.id, { id: (await s.raid("Tempete bis")).id }, "present", "Inconnu", at)]));
    expect(two.message).toBe("fiche mise à jour · 3 refusées (Greta : heure du clic, Inconnu : perso introuvable)");
  });

  it("porteur du bloc inconnu du site (appli, sans création) : les lignes V sont transmises quand même, et renvoyées elles sont gardées", async () => {
    const app = device(await pair(s.off.c));
    const raid = await s.raid("Silithus");
    const at = nowS() - 60;
    const total = async () => (await db().select({ id: characters.id }).from(characters)).length;
    const n = await total();
    const text = block("Dorganalt", "ROGUE", "Orc", [send(raid, "present", "Greta", at), send(raid, "late", "Pikou", at)]);
    const first = (await app.req("POST", "/api/sync/upload", { text })).json();
    expect(first.results).toEqual([expect.objectContaining({
      key: "Dorganalt-Forever EU", status: "unknown", message: "perso inconnu du site : à créer ou à ignorer · 2 inscriptions transmises (Greta, Pikou)",
    })]);
    expect((await signupsOf(raid.id)).map(x => `${x.userId === s.greta.user.id ? "Greta" : "Pikou"}:${x.status}`).sort()).toEqual(["Greta:present", "Pikou:late"]);
    expect(await total()).toBe(n); // rien n'est créé pour le porteur
    expect((await relayedEvents(s.g.id, "Silithus")).map(e => e.userId)).toEqual([s.off.user.id, s.off.user.id]);
    // L'appli renvoie le même bloc (la question « créer ou ignorer ? » est toujours posée) : gardées, sans nouveau journal
    const again = (await app.req("POST", "/api/sync/upload", { text })).json();
    expect(again.results[0]).toMatchObject({ status: "unknown", message: "perso inconnu du site : à créer ou à ignorer · 2 gardées" });
    expect(await relayedEvents(s.g.id, "Silithus")).toHaveLength(2);
  });

  it("porteur ignoré dans l'appli : les lignes V partent aussi, sur l'envoi qui l'ignore comme sur les suivants", async () => {
    const app = device(await pair(s.off.c));
    const raid = await s.raid("Tanaris");
    const at = nowS() - 60;
    const text = block("Dorganbis", "ROGUE", "Orc", [send(raid, "tentative", "Opale", at)]);
    const first = (await app.req("POST", "/api/sync/upload", { text, ignore: ["Dorganbis-Forever EU"] })).json();
    expect(first.results[0]).toMatchObject({ status: "ignored", message: "perso ignoré (à remettre dans les options de l'appli) · 1 inscription transmise (Opale)" });
    expect(await signupsOf(raid.id)).toEqual([expect.objectContaining({ userId: s.opale.user.id, status: "tentative" })]);
    // Une autre inscription sur un nouvel envoi : porteur toujours ignoré, ligne transmise
    const raid2 = await s.raid("Tanaris bis");
    const next = (await app.req("POST", "/api/sync/upload", { text: block("Dorganbis", "ROGUE", "Orc", [send(raid2, "present", "Opale", at), send(raid, "tentative", "Opale", at)]) })).json();
    expect(next.results[0]).toMatchObject({ status: "ignored", message: "perso ignoré (à remettre dans les options de l'appli) · 1 inscription transmise (Opale) · 1 gardée" });
    expect(await signupsOf(raid2.id)).toEqual([expect.objectContaining({ userId: s.opale.user.id, status: "present" })]);
  });

  it("porteur laissé de côté au Ctrl+V, de classe différente ou hors de la partie « inscriptions » : message ajouté, ou lignes ignorées", async () => {
    const at = nowS() - 60;
    const raid = await s.raid("Ironforge");
    // « Ignorer » ce perso au Ctrl+V ne retient pas les inscriptions des autres joueurs
    const skipped = await paste(s.own.c, asOwner([send(raid, "present", "Greta", at)]), { targets: { "Brakka-Forever EU": "skip" } });
    expect(skipped).toMatchObject({ status: "skipped", message: "ignoré · 1 inscription transmise (Greta)" });
    expect(await signupsOf(raid.id)).toEqual([expect.objectContaining({ userId: s.greta.user.id, status: "present" })]);
    // Classe différente sur la fiche du porteur : résultat en erreur, lignes V transmises
    const raid2 = await s.raid("Ironforge bis");
    const mismatch = await paste(s.own.c, block("Brakka", "MAGE", "Troll", [send(raid2, "late", "Pikou", at), send(raid2, "present", "Inconnu", at)]));
    expect(mismatch).toMatchObject({ status: "error", message: "classe différente sur la fiche (Warrior) · 1 inscription transmise (Pikou) · 1 refusée (Inconnu : perso introuvable)" });
    expect(await signupsOf(raid2.id)).toEqual([expect.objectContaining({ userId: s.pikou.user.id, status: "late" })]);
    // Sans la partie « inscriptions » : porteur laissé de côté et lignes V ignorées
    const raid3 = await s.raid("Ironforge ter");
    expect(await paste(s.own.c, asOwner([send(raid3, "present", "Greta", at)]), { targets: { "Brakka-Forever EU": "skip" }, parts: ["gear"] })).toMatchObject({ status: "skipped", message: "ignoré" });
    expect(await signupsOf(raid3.id)).toEqual([]);
  });

  it("sans ligne V ou sans la partie « inscriptions » : rien ne change", async () => {
    const raid = await s.raid("Ahn Qiraj");
    const at = nowS() - 60;
    expect(await paste(s.own.c, asOwner([]))).toMatchObject({ status: "updated", message: "fiche mise à jour" });
    // Ctrl+V : « Choisir quoi importer » sans les inscriptions
    expect(await paste(s.own.c, asOwner([send(raid, "present", "Pikou", at)]), { parts: ["gear"] })).toMatchObject({ message: "fiche mise à jour" });
    expect(await signupsOf(raid.id)).toEqual([]);
    // Les lignes S gardent leur message d'avant
    expect(await paste(s.own.c, asOwner([`S;${s.g.id};${raid.id};present`]))).toMatchObject({ message: "fiche mise à jour · 1 inscription aux raids" });
    expect(await signupsOf(raid.id)).toEqual([expect.objectContaining({ userId: s.own.user.id, status: "present" })]);
  });
});
