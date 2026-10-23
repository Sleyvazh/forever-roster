import { atTime, LAUNCH_AT, outingDays, type GuildHistoryResponse, type GuildHomeResponse, type GuildLinkResponse, type GuildMembersResponse, type GuildRaceResponse } from "@forever/game-data";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { characters, groups, guildEvents, guildLevels, guildLinkProposals, guildLinks, guildMembers, guildPlayers } from "../src/db/schema";
import { purgeOldData } from "../src/lib/purges";
import { DAY, frc, frl, guid, HOUR, m, NOW, paste as pasteAs, scene as sceneOf, type Signed } from "./guild-helpers";
import { setup, signedIn, type TestEnv } from "./helpers";

/**
 * Lot « Guilde » (Forever) : relevé de la guilde du jeu (FRL), en-tête FRC (GUID, nom complet), lien de la guilde,
 * mains et alts, historique, Course au 60, accueil, purges. Noms inventés (annonces du bot : guilde-annonces.test.ts).
 */

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });
afterEach(() => { env.app.ctx.now = undefined; });

const db = () => env.app.ctx.db;
const setNow = (unix: number) => { env.app.ctx.now = () => new Date(unix * 1000); };
const L = LAUNCH_AT / 1000;

const scene = (name: string, others: string[] = []) => sceneOf(env, name, others);
const paste = pasteAs;
const charOf = (v: GuildMembersResponse, name: string) => v.chars.find(c => c.name === name)!;
const playerOf = (v: GuildMembersResponse, name: string) => v.players.find(p => p.key === charOf(v, name).player)!;

describe("en-tête FRC de l'addon 1.6.2 : GUID et nom complet", () => {
  it("GUID gardé, nom complet sur une fiche qui n'a que le prénom, nom saisi à la main gardé et signalé, ancien en-tête accepté", async () => {
    const s = await signedIn(env, "Mousseclaire");
    const gb = guid(), gp = guid(), gn = guid();
    const fiche = (await s.c.post("/api/characters", { name: "Brindille", cls: "Druid", race: "Tauren", level: 50 })).json().character;
    const custom = (await s.c.post("/api/characters", { name: "Pikou (alt)", cls: "Mage", race: "Troll", level: 30 })).json().character;
    const r = await paste(s, [frc("Brindille", "DRUID", "Tauren", 55, gb, "Brindille Mousseclaire"), frc("Pikou", "MAGE", "Troll", 33, gp, "Pikou Mousseclaire"), frc("Nyx", "MAGE", "Undead", 22, gn, "Nyx Sombrevent")].join("\n"),
      { targets: { "Brindille-Forever EU": fiche.id, "Pikou-Forever EU": custom.id, "Nyx-Forever EU": "new" } });
    expect(r.errors).toEqual([]);
    expect(r.results[0]).toMatchObject({ status: "updated", message: expect.stringContaining("nom complet : Brindille Mousseclaire") });
    expect(r.results[0]!.nameConflict).toBeUndefined();
    expect(r.results[1]).toMatchObject({ status: "updated", nameConflict: { fiche: "Pikou (alt)", game: "Pikou Mousseclaire" } });
    expect(r.results[1]!.message).toContain("nom en jeu « Pikou Mousseclaire » différent de la fiche (« Pikou (alt) », gardé)");
    expect(r.results[2]).toMatchObject({ status: "created" });
    const rows = await db().select({ name: characters.name, guid: characters.guid, level: characters.level }).from(characters).where(eq(characters.userId, s.user.id));
    expect(rows.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "Brindille Mousseclaire", guid: gb, level: 55 }, { name: "Nyx Sombrevent", guid: gn, level: 22 }, { name: "Pikou (alt)", guid: gp, level: 33 },
    ]);
    // Le GUID retrouve la fiche, même sans choix ; l'ancien en-tête (sans GUID) reste lu
    const again = await paste(s, frc("Brindille", "DRUID", "Tauren", 56, gb, "Brindille Mousseclaire"));
    expect(again.results[0]).toMatchObject({ status: "updated", characterId: fiche.id });
    const old = await paste(s, frc("Brindille", "DRUID", "Tauren", 57));
    expect(old.results[0]).toMatchObject({ status: "updated", characterId: fiche.id });
    expect((await db().select({ guid: characters.guid }).from(characters).where(eq(characters.id, fiche.id)))[0]!.guid).toBe(gb);
  });
});

describe("relevé de la guilde (FRL) : lien et règles d'envoi", () => {
  it("lien au premier relevé d'un officier ; tout membre envoie ensuite ; le plus récent l'emporte ; notes d'officier d'un officier seulement ; autre guilde ignorée", async () => {
    const s = await scene("Les Lanternes", ["Vexou", "Ysa"]);
    const K = m("Kaeldra Brisevent", 60, { rank: "Maître de guilde", ri: 0, online: true, note: "GM", onote: "Officier loot" });
    const V = m("Vex Ombrelame", 58, { cls: "ROGUE", rank: "Officier", ri: 1 });
    const Y = m("Ysalis Clairsang", 59, { cls: "PRIEST", rank: "Officier", ri: 1, hours: 5 });
    const T = NOW() - 2 * HOUR;
    // Un membre sans guilde liée : ignoré
    let r = await paste(s.p.Vexou!, frl({ at: T, members: [K, V, Y] }));
    expect(r.results).toEqual([expect.objectContaining({ kind: "guild", status: "ignored", message: expect.stringContaining("le premier relevé d'un officier fait le lien") })]);
    // Le propriétaire (officier) : lien automatique
    r = await paste(s.owner, frl({ at: T, members: [K, V, Y] }));
    expect(r.results[0]).toMatchObject({ kind: "guild", name: "Guilde Les Lanternes", status: "updated", groups: [{ id: s.g.id, name: "Les Lanternes" }] });
    expect(r.results[0]!.message).toBe("Les Lanternes (liée) : liste de 3 membres (complète)");
    const link = await s.get<GuildLinkResponse>(s.owner, "/guild/link");
    expect(link).toMatchObject({ link: { name: "Les Lanternes", realm: "Forever EU", faction: "Horde", auto: true, linkedBy: "LesLanternesChef", roster: { by: "Morwen Cendrevoile", complete: true, total: 3 } }, announce: "sixty", canManage: true, proposals: [] });
    let v = await s.guild();
    expect(charOf(v, "Kaeldra Brisevent")).toMatchObject({ firstName: "Kaeldra", cls: "Warrior", level: 60, rank: "Maître de guilde", rankIndex: 0, online: true, note: "GM", officerNote: "Officier loot" });
    expect(charOf(v, "Ysalis Clairsang").lastOnlineAt).toBe(new Date((T - 5 * HOUR) * 1000).toISOString());
    // Un membre ne voit pas les notes d'officier
    expect(charOf(await s.guild(s.p.Vexou!), "Kaeldra Brisevent")).not.toHaveProperty("officerNote");
    // Un membre envoie un relevé plus récent : appliqué, mais les notes d'officier restent celles de l'officier
    r = await paste(s.p.Vexou!, frl({ at: T + 600, members: [{ ...K, onote: "écrasée ?", rank: "Chef" }, V, Y] }));
    expect(r.results[0]).toMatchObject({ status: "updated", message: "liste de 3 membres (complète)" });
    v = await s.guild();
    expect(charOf(v, "Kaeldra Brisevent")).toMatchObject({ rank: "Chef", officerNote: "Officier loot" });
    // Relevé plus ancien : gardé tel quel
    r = await paste(s.p.Ysa!, frl({ at: T + 300, members: [{ ...K, rank: "Ancien" }, V, Y] }));
    expect(r.results[0]!.message).toBe("liste plus ancienne que celle du site (gardée)");
    expect(charOf(await s.guild(), "Kaeldra Brisevent").rank).toBe("Chef");
    // Un officier : ses notes d'officier sont reprises (en-tête 1), pas si son en-tête dit 0
    await s.promote("Ysa");
    await paste(s.p.Ysa!, frl({ at: T + 900, members: [{ ...K, onote: "Raid lead" }, V, Y] }));
    expect(charOf(await s.guild(), "Kaeldra Brisevent").officerNote).toBe("Raid lead");
    await paste(s.p.Ysa!, frl({ at: T + 1200, officer: false, members: [K, V, Y] }));
    expect(charOf(await s.guild(), "Kaeldra Brisevent").officerNote).toBe("Raid lead");
    // Heure dans le futur (horloge du PC) : ramenée à maintenant, le relevé suivant passe quand même
    await paste(s.owner, frl({ at: NOW() + 10 * DAY, members: [{ ...K, rank: "Futur" }, V, Y] }));
    await new Promise(res => setTimeout(res, 1100));
    await paste(s.p.Vexou!, frl({ at: NOW(), members: [{ ...K, rank: "Présent" }, V, Y] }));
    expect(charOf(await s.guild(), "Kaeldra Brisevent").rank).toBe("Présent");
    // Un relevé d'une autre guilde du jeu est ignoré
    r = await paste(s.owner, frl({ guild: "Autre Guilde", at: NOW(), members: [m("Personne Ailleurs", 10)] }));
    expect(r.results[0]).toMatchObject({ status: "ignored", message: "ignoré : « Les Lanternes » est liée à la guilde du jeu Les Lanternes, pas à Autre Guilde" });
    // Le Ctrl+V peut laisser le relevé de côté
    expect((await paste(s.owner, frl({ at: NOW(), members: [K, V, Y] }), { skipGuild: true })).results).toEqual([]);
    // Délier : liste effacée ; le relevé suivant d'un officier refait le lien
    expect((await s.p.Vexou!.c.del(`/api/groups/${s.g.id}/guild/link`)).statusCode).toBe(403);
    expect((await s.owner.c.del(`/api/groups/${s.g.id}/guild/link`)).statusCode).toBe(200);
    expect(await db().select().from(guildMembers).where(eq(guildMembers.groupId, s.g.id))).toEqual([]);
    expect((await s.get<GuildLinkResponse>(s.owner, "/guild/link")).link).toBeNull();
    expect((await paste(s.owner, frl({ at: NOW(), members: [K] }))).results[0]!.status).toBe("updated");
  });

  it("officier de deux guildes sans lien : guilde du jeu proposée dans chacune, liée à la main avec le relevé gardé", async () => {
    const s = await scene("Garde Noire", ["Recrue"]);
    const other = (await s.owner.c.post("/api/groups", { name: "Garde Grise" })).json().group as { id: string };
    const members = [m("Torvin Rochefer", 51), m("Torva Rochefer", 24)];
    const r = await paste(s.owner, frl({ guild: "Garde du Nord", at: NOW() - HOUR, members, total: 2 }));
    expect(r.results[0]).toMatchObject({ status: "ignored", message: "à lier : la guilde du jeu est proposée dans l'Administration de « Garde Grise », « Garde Noire »" });
    const link = await s.get<GuildLinkResponse>(s.owner, "/guild/link");
    expect(link.link).toBeNull();
    expect(link.proposals).toEqual([expect.objectContaining({ key: "Garde du Nord-Forever EU-Horde", name: "Garde du Nord", by: "GardeNoireChef", members: 2 })]);
    // Un membre ne voit pas les propositions et ne peut pas lier
    expect((await s.get<GuildLinkResponse>(s.p.Recrue!, "/guild/link")).proposals).toEqual([]);
    expect((await s.p.Recrue!.c.post(`/api/groups/${s.g.id}/guild/link`, { key: link.proposals[0]!.key })).statusCode).toBe(403);
    const done = await s.owner.c.post(`/api/groups/${s.g.id}/guild/link`, { key: link.proposals[0]!.key });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().link).toMatchObject({ name: "Garde du Nord", auto: false, linkedBy: "GardeNoireChef" });
    expect((await s.guild()).chars.map(c => c.name).sort()).toEqual(["Torva Rochefer", "Torvin Rochefer"]);
    // Déjà liée : il faut délier d'abord ; l'autre guilde garde sa proposition
    expect((await s.owner.c.post(`/api/groups/${s.g.id}/guild/link`, { key: link.proposals[0]!.key })).json().error).toMatch(/délie-la d'abord/);
    expect((await s.owner.c.get(`/api/groups/${other.id}/guild/link`)).json().proposals).toHaveLength(1);
    // Le relevé suivant va à la guilde liée
    expect((await paste(s.owner, frl({ guild: "Garde du Nord", at: NOW(), members }))).results[0]).toMatchObject({ status: "updated", groups: [{ id: s.g.id, name: "Garde Noire" }] });
  });

  it("grande guilde (1 000 membres, 256 Kio) : Ctrl+V du site avec les persos, puis Roster Companion (/api/sync/upload)", async () => {
    const s = await scene("La Multitude");
    const members = Array.from({ length: 1000 }, (_, i) => m(`Membre${i} Nomdefamille`, 1 + (i % 60), { note: "Note publique assez longue pour peser".padEnd(120, "."), onote: "Note d'officier".padEnd(60, ".") }));
    const text = `${frc("Kaeldra", "WARRIOR", "Orc", 60, members[0]!.guid, "Membre0 Nomdefamille")}\n${frl({ at: NOW() - HOUR, members })}`;
    expect(text.length).toBeGreaterThan(200 * 1024);
    expect(text.length).toBeLessThan(256 * 1024);
    const r = await paste(s.owner, text);
    expect(r.errors).toEqual([]);
    expect(r.results.map(x => [x.kind, x.status])).toEqual([["character", "created"], ["guild", "updated"]]);
    expect(r.results[1]!.message).toBe("La Multitude (liée) : liste de 1000 membres (complète)");
    const v = await s.guild();
    expect(v.chars).toHaveLength(1000);
    expect(playerOf(v, "Membre0 Nomdefamille").me).toBe(true);
    // Roster Companion : même texte, jeton de l'appareil
    const anon = (h: Record<string, string> = {}) => (method: string, url: string, body?: object) => env.app.inject({ method: method as "POST", url, headers: h, ...(body && { payload: body }) });
    const start = (await anon()("POST", "/api/devices/pair", { name: "PC-TEST", platform: "Windows 11", appVersion: "0.3.1" })).json();
    expect((await s.owner.c.post("/api/devices/pair/approve", { code: start.userCode })).statusCode).toBe(200);
    const token = (await anon()("POST", "/api/devices/pair/poll", { pairId: start.pairId })).json().token as string;
    const up = await anon({ authorization: `Bearer ${token}` })("POST", "/api/sync/upload", { text: frl({ at: NOW(), members }) });
    expect(up.statusCode, up.body).toBe(200);
    expect(up.json().results).toEqual([expect.objectContaining({ kind: "guild", status: "updated", message: "liste de 1000 membres (complète)" })]);
  });

  it("Roster (Retail) : routes de la guilde refusées", async () => {
    const s = await scene("Les Sentinelles");
    await db().update(groups).set({ game: "retail" }).where(eq(groups.id, s.g.id));
    const r = await s.owner.c.get(`/api/groups/${s.g.id}/guild`);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("La guilde du jeu, la Course au 60 et l'accueil sont pour WoW Forever.");
  });
});

describe("liste complète ou partielle, journal de guilde", () => {
  it("départs (liste complète seulement, date du journal), arrivées, journal dédoublonné à l'heure près, historique", async () => {
    const s = await scene("Les Veilleurs");
    const K = m("Kaeldra Brisevent", 60, { rank: "Maître de guilde", ri: 0 });
    const A = m("Ashka Ventsauvage", 56, { cls: "HUNTER" });
    const G = m("Gorvash Tannecuir", 40);
    const T = NOW() - 10 * HOUR;
    await paste(s.owner, frl({ at: T, members: [K, A, G] }));
    // Liste partielle (2 lignes sur 3) : personne ne part
    await paste(s.owner, frl({ at: T + HOUR, total: 3, members: [K, A] }));
    expect((await s.guild()).chars.map(c => c.name)).toContain("Gorvash Tannecuir");
    // Arrivée de Zirta (invitée par Torvin), promotion d'Ashka, puis liste complète sans Gorvash, parti d'après le journal
    const Z = m("Zirta Brumefeu", 12, { cls: "PRIEST", rank: "Recrue", ri: 4 });
    const J = T + 3 * HOUR;
    let r = await paste(s.owner, frl({
      at: J, members: [K, { ...A, rank: "Officier", ri: 1 }, Z],
      journal: { at: J, events: [["quit", G.name, "", "", 1], ["promote", K.name, A.name, 1, 2], ["join", Z.name, "", "", 2], ["invite", "Torvin Rochefer", Z.name, "", 2], ["invite", "Torvin Rochefer", "Oddo Noirval", "", 2], ["invite", "Torvin Rochefer", "Oddo Noirval", "", 2]] },
    }));
    expect(r.results[0]!.message).toBe("liste de 3 membres (complète), 1 arrivée, 1 départ, journal : 6 nouveaux événements");
    const [gone] = await db().select().from(guildMembers).where(and(eq(guildMembers.groupId, s.g.id), eq(guildMembers.guid, G.guid)));
    expect(gone!.leftAt!.toISOString()).toBe(new Date((J - HOUR) * 1000).toISOString());
    const v = await s.guild();
    expect(v.chars.map(c => c.name)).not.toContain("Gorvash Tannecuir");
    expect(charOf(v, "Zirta Brumefeu")).toMatchObject({ joinedAt: new Date((J - 2 * HOUR) * 1000).toISOString(), joinedApprox: false });
    expect(charOf(v, "Kaeldra Brisevent")).toMatchObject({ joinedAt: null });
    // Même journal relu 1 h 30 plus tard (« il y a » + 1 ou 2 h) : aucun doublon ; un nouvel événement seulement
    const J2 = J + 5400;
    r = await paste(s.owner, frl({ at: J, members: [], journal: { at: J2, events: [["quit", G.name, "", "", 2], ["promote", K.name, A.name, 1, 3], ["join", Z.name, "", "", 3], ["invite", "Torvin Rochefer", Z.name, "", 3], ["invite", "Torvin Rochefer", "Oddo Noirval", "", 3], ["invite", "Torvin Rochefer", "Oddo Noirval", "", 3], ["demote", K.name, "Quillon Vifargent", 4, 0]] } }));
    expect(r.results[0]!.message).toBe("liste plus ancienne que celle du site (gardée), journal : 1 nouvel événement");
    expect(await db().$count(guildEvents, eq(guildEvents.groupId, s.g.id))).toBe(7);
    // Historique : arrivées (invitée par), départs, rangs (nom du rang de la liste)
    const h = await s.get<GuildHistoryResponse>(s.owner, "/guild/history");
    expect(h.moves.map(x => [x.kind, x.who.name, x.by, x.rank])).toEqual([
      ["demote", "Quillon Vifargent", "Kaeldra Brisevent", "Recrue"],
      ["leave", "Gorvash Tannecuir", null, null],
      ["join", "Zirta Brumefeu", "Torvin Rochefer", null],
      ["promote", "Ashka Ventsauvage", "Kaeldra Brisevent", "Officier"],
    ]);
    expect(h.moves[1]!.who).toMatchObject({ guid: G.guid, level: 40, cls: "Warrior" });
    expect(h.journal).toEqual({ at: new Date(J2 * 1000).toISOString(), by: "Morwen Cendrevoile" });
    expect((await s.get<GuildHistoryResponse>(s.owner, "/guild/history?kind=leaves")).moves.map(x => x.kind)).toEqual(["leave"]);
    expect((await s.get<GuildHistoryResponse>(s.owner, "/guild/history?kind=ranks&limit=1")).more).toBe(true);
    // Retour de Gorvash : il n'est plus parti, nouvelle arrivée
    await paste(s.owner, frl({ at: J2, members: [K, A, Z, G] }));
    expect(charOf(await s.guild(), "Gorvash Tannecuir")).toMatchObject({ level: 40, joinedApprox: true, joinedAt: new Date(J2 * 1000).toISOString() });
  });
});

describe("mains et alts", () => {
  it("compte du site (GUID), suggestions des notes, « Rattacher à… », « Est-ce ton perso ? », perso déclaré, nouveau joueur, main", async () => {
    const s = await scene("Les Braises", ["Vexou", "Ysa", "Nessa"]);
    const K = m("Kaeldra Brisevent", 60, { rank: "Maître de guilde", ri: 0 }), KA = m("Kaelys Brisevent", 31, { cls: "PRIEST" });
    const V = m("Vex Ombrelame", 60, { cls: "ROGUE", ri: 1 }), VE = m("Vexelle Ombrelame", 24, { cls: "ROGUE", note: "Alt de Vex" });
    const Y = m("Ysalis Clairsang", 59, { cls: "PRIEST" }), N = m("Nessa Flotsombre", 49, { cls: "SHAMAN" }), O = m("Oddo Noirval", 47, { cls: "WARLOCK", onote: "reroll Morwen" });
    const Z = m("Zirta Brumefeu", 12, { cls: "PRIEST", ri: 4 });
    await paste(s.owner, [frc("Kaeldra", "WARRIOR", "Orc", 60, K.guid, K.name), frc("Kaelys", "PRIEST", "Troll", 31, KA.guid, KA.name)].join("\n"));
    await paste(s.p.Vexou!, frc("Vex", "ROGUE", "Undead", 60, V.guid, V.name));
    const T = NOW() - 3 * HOUR;
    await paste(s.owner, frl({ at: T, members: [K, KA, V, VE, Y, N, O] }));
    await paste(s.owner, frl({ at: T + HOUR, members: [K, KA, V, VE, Y, N, O, Z] }));
    let v = await s.guild();
    const owner = `u:${s.owner.user.id}`, vexou = `u:${s.p.Vexou!.user.id}`;
    expect(playerOf(v, K.name)).toMatchObject({ key: owner, account: { displayName: "LesBraisesChef" }, main: K.guid, alts: [KA.guid], me: true });
    expect(charOf(v, KA.name)).toMatchObject({ player: owner, link: { source: "account", confirmed: null, by: null }, mine: true, race: "Troll" });
    expect(charOf(v, K.name).isMain).toBe(true);
    expect(playerOf(v, V.name)).toMatchObject({ key: vexou, alts: [] });
    expect(playerOf(v, Y.name)).toMatchObject({ key: `m:${Y.guid}`, account: null });
    // Bande « À rattacher » (officiers) : Vexelle (note « Alt de Vex »), Zirta (arrivée) ; Oddo : note d'officier sans membre « Morwen »
    expect(v.unattached).toEqual([
      { guid: VE.guid, reason: "note", suggestion: { from: "note", note: "Alt de Vex", target: { guid: V.guid, name: V.name, player: vexou }, candidates: [] } },
      { guid: Z.guid, reason: "new", suggestion: null },
    ]);
    expect(v.chars.find(c => c.guid === Z.guid)!.player).toBeNull();
    // Un membre ne voit pas la bande : ces persos sont des joueurs seuls
    const asVex = await s.guild(s.p.Vexou!);
    expect(asVex.unattached).toEqual([]);
    expect(playerOf(asVex, Z.name).key).toBe(`m:${Z.guid}`);
    expect((await s.p.Vexou!.c.put(`/api/groups/${s.g.id}/guild/members/${Z.guid}/link`, { to: vexou })).statusCode).toBe(403);

    // Suggestion acceptée : Vexelle rejoint Vex ; Vexou voit « Est-ce ton perso ? » et répond oui
    expect((await s.owner.c.post(`/api/groups/${s.g.id}/guild/members/${VE.guid}/accept`, {})).json()).toEqual({ player: vexou });
    v = await s.guild(s.p.Vexou!);
    expect(v.questions).toEqual([{ guid: VE.guid, name: VE.name, cls: "Rogue", level: 24, by: "LesBraisesChef", at: expect.any(String) }]);
    expect(playerOf(v, V.name).alts).toEqual([VE.guid]);
    expect(charOf(v, VE.name).link).toEqual({ source: "note", confirmed: null, by: "LesBraisesChef" });
    expect((await s.get<GuildHomeResponse>(s.p.Vexou!, "/home")).questions).toHaveLength(1);
    expect((await s.p.Vexou!.c.post(`/api/groups/${s.g.id}/guild/members/${VE.guid}/answer`, { yes: true })).statusCode).toBe(200);
    v = await s.guild(s.p.Vexou!);
    expect(v.questions).toEqual([]);
    expect(charOf(v, VE.name).link).toMatchObject({ source: "note", confirmed: true });
    // « Rattacher à… » : Zirta à Vexou, qui répond non : elle revient dans la bande
    await s.owner.c.put(`/api/groups/${s.g.id}/guild/members/${Z.guid}/link`, { to: vexou });
    expect((await s.guild()).unattached.map(u => u.guid)).toEqual([]);
    expect((await s.p.Ysa!.c.post(`/api/groups/${s.g.id}/guild/members/${Z.guid}/answer`, { yes: false })).statusCode).toBe(404);
    await s.p.Vexou!.c.post(`/api/groups/${s.g.id}/guild/members/${Z.guid}/answer`, { yes: false });
    expect((await s.guild()).unattached.map(u => u.guid)).toEqual([Z.guid]);
    // Rattacher à un perso seul : un joueur sans compte se forme (Ysalis main, Zirta alt), sans question
    expect((await s.owner.c.put(`/api/groups/${s.g.id}/guild/members/${Z.guid}/link`, { to: `m:${Y.guid}` })).statusCode).toBe(200);
    v = await s.guild();
    const ysalis = playerOf(v, Y.name);
    expect(ysalis).toMatchObject({ account: null, main: Y.guid, alts: [Z.guid] });
    expect(ysalis.key).toMatch(/^p:/);
    // « C'est mon perso » : Nessa déclare son perso ; un perso déjà à quelqu'un ne se déclare pas
    expect((await s.p.Nessa!.c.post(`/api/groups/${s.g.id}/guild/members/${N.guid}/claim`, {})).statusCode).toBe(200);
    expect((await s.p.Nessa!.c.post(`/api/groups/${s.g.id}/guild/members/${V.guid}/claim`, {})).statusCode).toBe(409);
    v = await s.guild(s.p.Nessa!);
    expect(charOf(v, N.name)).toMatchObject({ player: `u:${s.p.Nessa!.user.id}`, mine: true, link: { source: "declared", confirmed: true } });
    // Le main d'un joueur sans compte qui crée son compte : il le déclare, ses alts le suivent
    await s.p.Ysa!.c.post(`/api/groups/${s.g.id}/guild/members/${Y.guid}/claim`, {});
    v = await s.guild(s.p.Ysa!);
    expect(playerOf(v, Y.name)).toMatchObject({ key: `u:${s.p.Ysa!.user.id}`, main: Y.guid, alts: [Z.guid], me: true });
    // Le lien d'un officier prime sur la déclaration
    await s.owner.c.put(`/api/groups/${s.g.id}/guild/members/${N.guid}/link`, { to: vexou });
    expect(charOf(await s.guild(), N.name).player).toBe(vexou);
    // Un perso du compte d'un joueur : « Détacher » refusé, « Nouveau joueur » le sépare (sans retour au compte)
    const det = await s.owner.c.del(`/api/groups/${s.g.id}/guild/members/${KA.guid}/link`);
    expect(det.statusCode).toBe(400);
    expect(det.json().error).toBe("Kaelys Brisevent est sur le compte de LesBraisesChef (fiche synchronisée par l'addon) : choisis « Nouveau joueur » pour l'en séparer.");
    await s.owner.c.put(`/api/groups/${s.g.id}/guild/members/${KA.guid}/link`, { to: "new" });
    v = await s.guild();
    expect(playerOf(v, KA.name)).toMatchObject({ account: null, main: KA.guid, alts: [] });
    expect(playerOf(v, K.name).alts).toEqual([]);
    // Détacher un lien d'officier : Nessa redevient seule
    await s.owner.c.del(`/api/groups/${s.g.id}/guild/members/${N.guid}/link`);
    expect(charOf(await s.guild(), N.name).player).toBe(`m:${N.guid}`);
    // Main : le joueur lui-même ou un officier
    expect((await s.p.Ysa!.c.put(`/api/groups/${s.g.id}/guild/players/${vexou}/main`, { guid: VE.guid })).statusCode).toBe(403);
    expect((await s.p.Vexou!.c.put(`/api/groups/${s.g.id}/guild/players/${vexou}/main`, { guid: VE.guid })).statusCode).toBe(200);
    expect(playerOf(await s.guild(), V.name)).toMatchObject({ main: VE.guid, alts: [V.guid] });
    expect((await s.p.Vexou!.c.put(`/api/groups/${s.g.id}/guild/players/${vexou}/main`, { guid: K.guid })).json().error).toBe("Ce perso n'est pas à ce joueur.");
    // Persos : filtres simples
    const chars = await s.get<{ chars: { name: string }[]; total: number }>(s.owner, "/guild/chars?cls=Priest&min=20");
    expect(chars.chars.map(c => c.name)).toEqual([Y.name, KA.name]);
    expect(chars.total).toBe(8);
  });
});

describe("Course au 60", () => {
  it("avant le départ, podium (exact, approximatif, ex æquo, figé dès 3), % d'XP, semaine, jalons, premiers par classe, ma place", async () => {
    const s = await scene("La Course", ["Vexou"]);
    const K = m("Kaeldra Brisevent", 25, { ri: 0 }), V = m("Vex Ombrelame", 22, { cls: "ROGUE" }), Y = m("Ysalis Clairsang", 20, { cls: "PRIEST" });
    const N = m("Nessa Flotsombre", 18, { cls: "SHAMAN" }), O = m("Oddo Noirval", 21, { cls: "WARLOCK" });
    await paste(s.owner, frc("Kaeldra", "WARRIOR", "Orc", 25, K.guid, K.name));
    await paste(s.p.Vexou!, frc("Vex", "ROGUE", "Undead", 22, V.guid, V.name));
    const at = (d: number) => Math.round(L + d * DAY);
    // Avant le départ : rien à classer
    setNow(L - DAY);
    await paste(s.owner, frl({ at: L - 2 * DAY, members: [{ ...K, level: 20 }] }));
    let race = await s.race();
    expect(race).toMatchObject({ started: false, day: null, linked: true, rows: [], chars: [], startsAt: new Date(LAUNCH_AT).toISOString() });
    // Les relevés de la course (horloge du site après la sortie)
    setNow(at(10));
    await paste(s.owner, frl({ at: at(2), members: [K, V, Y, N, O] }));
    await paste(s.owner, frl({ at: at(5), members: [{ ...K, level: 45 }, { ...V, level: 44 }, { ...Y, level: 40 }, { ...N, level: 30 }, { ...O, level: 41 }] }));
    // Kaeldra a l'addon : heures exactes de ses niveaux ; Vex : son XP
    await paste(s.owner, frl({ at: at(9.8), members: [{ ...K, level: 60 }, { ...V, level: 59 }, { ...Y, level: 60 }, { ...N, level: 49 }, { ...O, level: 58 }],
      levels: [["Kaeldra", 59, at(8.5), K.guid], ["Kaeldra", 60, at(9.7), K.guid]], xp: [["Vex", 59, 8200, 10000, at(9.8), V.guid]] }));
    race = await s.race();
    expect(race).toMatchObject({ started: true, day: 11, linked: true, announce: "sixty", me: { rank: 1, tie: false, player: `u:${s.owner.user.id}` } });
    expect(race.podium.frozen).toBe(false);
    expect(race.podium.places.map(p => [p.place, p.char.name, p.racing, p.reached?.exact ?? null, p.days])).toEqual([
      [1, K.name, false, true, 9], [2, Y.name, false, false, 9], [3, V.name, true, null, null],
    ]);
    expect(race.rows.map(r => [r.rank, r.best.name, r.best.level, r.best.xpPct])).toEqual([
      [1, K.name, 60, null], [2, Y.name, 60, null], [3, V.name, 59, 82], [4, O.name, 58, null], [5, N.name, 49, null],
    ]);
    const kae = race.rows[0]!.best;
    expect(kae).toMatchObject({ addon: true, weekGain: 35, last: { at: new Date(at(9.7) * 1000).toISOString(), exact: true } });
    // Jalons : 20 « vers le » (premier relevé, au niveau 25), 40 approximatif (relevé du 5e jour), 60 exact
    expect(kae.milestones).toEqual({
      20: { at: new Date(at(2) * 1000).toISOString(), exact: false }, 40: { at: new Date(at(5) * 1000).toISOString(), exact: false }, 60: { at: new Date(at(9.7) * 1000).toISOString(), exact: true },
    });
    expect(race.rows.find(r => r.best.name === N.name)!.best).toMatchObject({ addon: false, weekGain: 31, xpPct: null });
    expect(race.rows.find(r => r.best.name === V.name)!.best).toMatchObject({ addon: true, xpPct: 82 });
    expect(race.firstByClass.map(f => [f.cls, f.char.name])).toEqual([["Warrior", K.name], ["Priest", Y.name], ["Rogue", V.name], ["Warlock", O.name], ["Shaman", N.name]]);
    expect(race.chars).toHaveLength(5);
    // Oddo prend le 60 dans le même relevé que Vex : ex æquo, et le podium se fige au troisième
    setNow(at(10.5));
    await paste(s.owner, frl({ at: at(10.2), members: [{ ...K, level: 60 }, { ...V, level: 60 }, { ...Y, level: 60 }, { ...N, level: 49 }, { ...O, level: 60 }] }));
    race = await s.race();
    expect(race.podium.frozen).toBe(true);
    expect(race.podium.places.map(p => [p.place, p.tie, p.char.name])).toEqual([[1, false, K.name], [2, false, Y.name], [3, true, O.name], [3, true, V.name]]);
    expect(race.rows.map(r => [r.rank, r.tie, r.best.name])).toEqual([[1, false, K.name], [2, false, Y.name], [3, true, O.name], [3, true, V.name], [5, false, N.name]]);
    // Ysalis part : le podium figé ne bouge pas
    await paste(s.owner, frl({ at: at(10.4), members: [{ ...K, level: 60 }, { ...V, level: 60 }, { ...N, level: 49 }, { ...O, level: 60 }] }));
    race = await s.race();
    expect(race.podium.places.map(p => [p.char.name, p.char.left ?? false])).toEqual([[K.name, false], [Y.name, true], [O.name, false], [V.name, false]]);
    expect(race.rows.map(r => r.best.name)).not.toContain(Y.name);
    // Accueil : mini-course et ma place
    const home = await s.get<GuildHomeResponse>(s.p.Vexou!, "/home");
    expect(home.race).toMatchObject({ started: true, linked: true, me: { rank: 2, tie: true, name: V.name, cls: "Rogue", level: 60 } });
    expect(home.race.podium).toHaveLength(4);
  });
});

describe("accueil de la guilde", () => {
  it("raids et sorties d'aujourd'hui et demain (mon inscription, mon perso pour une place libre), mouvements de la semaine", async () => {
    const s = await scene("Les Lucioles", ["Vexou"]);
    const mk = (who: Signed, name: string, cls: string, spec: string, level: number) => who.c.post("/api/characters", { name, race: "Troll", cls, spec1: spec, level }).then(r => r.json().character as { id: string });
    const lead = await mk(s.owner, "Torvin", "Warrior", "Protection", 33);
    const vex = await mk(s.p.Vexou!, "Vexou", "Priest", "Holy", 31);
    await mk(s.p.Vexou!, "Bas Niveau", "Mage", "Frost", 10);
    await s.owner.c.put(`/api/groups/${s.g.id}/characters/${lead.id}`, { assigned: true });
    const { tomorrow } = outingDays();
    const outing = await s.owner.c.post(`/api/groups/${s.g.id}/outings`, { dungeon: "gnomeregan", day: tomorrow, at: atTime(tomorrow, "21:00")!.toISOString(), characterId: lead.id, role: "Tank" });
    expect(outing.statusCode, outing.body).toBe(201);
    await s.owner.c.post(`/api/groups/${s.g.id}/outings`, { dungeon: "maraudon", day: tomorrow, at: atTime(tomorrow, "20:00")!.toISOString(), characterId: (await mk(s.owner, "Haut Niveau", "Warrior", "Arms", 50)).id, role: "DPS" });
    const raid = (await s.owner.c.post(`/api/groups/${s.g.id}/raids`, { name: "Upper Blackrock Spire", scheduledAt: atTime(tomorrow, "20:30")!.toISOString() })).json().raid;
    await s.p.Vexou!.c.put(`/api/groups/${s.g.id}/raids/${raid.id}/signup`, { status: "present", characterId: vex.id, spec: "Holy" });
    const T = NOW() - 2 * HOUR;
    await paste(s.owner, frl({ at: T, members: [m("Torvin Rochefer", 33)], journal: { at: T, events: [["join", "Torvin Rochefer", "", "", 30]] } }));
    const home = await s.get<GuildHomeResponse>(s.p.Vexou!, "/home");
    expect(home.today).toBe(outingDays().today);
    expect(home.agenda.map(a => (a.kind === "raid" ? `raid ${a.name}` : `sortie ${a.title}`))).toEqual(["raid Upper Blackrock Spire", "sortie Gnomeregan"]);
    const [r, o] = home.agenda as [Extract<GuildHomeResponse["agenda"][number], { kind: "raid" }>, Extract<GuildHomeResponse["agenda"][number], { kind: "outing" }>];
    expect(r).toMatchObject({ counts: { coming: 1, heal: 1, tank: 0 }, mine: { status: "present", characterName: "Vexou", characterId: vex.id, spec: "Holy" } });
    expect(o).toMatchObject({ levels: "29-38", creator: "Torvin", missing: { tank: 0, heal: 1, dps: 3 }, mine: null, full: false });
    expect(o.suggest).toEqual([{ role: "Heal", characterId: vex.id, characterName: "Vexou" }, { role: "DPS", characterId: vex.id, characterName: "Vexou" }]);
    // Maraudon n'est pour aucun perso de Vexou : comptée, pas listée
    expect(home.outings).toEqual({ total: 2, hidden: 1 });
    expect(home.moves.map(x => [x.kind, x.who.name])).toEqual([["join", "Torvin Rochefer"]]);
    expect(home.guild).toMatchObject({ linked: true, name: "Les Lanternes" });
    expect(home.race).toMatchObject({ startsAt: new Date(LAUNCH_AT).toISOString(), linked: true });
    // Le créateur voit sa sortie
    const mine = (await s.get<GuildHomeResponse>(s.owner, "/home")).agenda.find(a => a.kind === "outing" && a.title === "Gnomeregan");
    expect(mine).toMatchObject({ mine: { role: "Tank", creator: true, characterName: "Torvin" }, suggest: [] });
  });
});

describe("purges de la guilde du jeu", () => {
  it("membres partis depuis 90 jours (niveaux et rattachements compris), journal au bout de 12 mois, guildes proposées au bout de 30 jours", async () => {
    const s = await scene("Les Oubliés");
    const A = m("Ancien Parti", 30), B = m("Parti Recent", 30), C = m("Toujours La", 30);
    const T = NOW() - HOUR;
    await paste(s.owner, frl({ at: T, members: [A, B, C], journal: { at: T, events: [["join", C.name, "", "", 1]] } }));
    await s.owner.c.put(`/api/groups/${s.g.id}/guild/members/${A.guid}/link`, { to: `m:${C.guid}` });
    const ago = (days: number) => new Date(Date.now() - days * DAY * 1000);
    await db().update(guildMembers).set({ leftAt: ago(91) }).where(eq(guildMembers.guid, A.guid));
    await db().update(guildMembers).set({ leftAt: ago(89) }).where(eq(guildMembers.guid, B.guid));
    await db().insert(guildLevels).values([{ groupId: s.g.id, guid: A.guid, level: 31, reachedAt: ago(100), source: "roster" }, { groupId: s.g.id, guid: B.guid, level: 31, reachedAt: ago(100), source: "roster" }]);
    await db().insert(guildEvents).values([{ groupId: s.g.id, type: "quit", player1: "Vieux Souvenir", at: ago(366) }, { groupId: s.g.id, type: "quit", player1: "Souvenir Recent", at: ago(300) }]);
    await db().insert(guildLinkProposals).values([
      { groupId: s.g.id, key: "Vieille-Forever EU-Horde", name: "Vieille", proposedBy: s.owner.user.id, proposedByName: "x", text: "FRL", createdAt: ago(31) },
      { groupId: s.g.id, key: "Neuve-Forever EU-Horde", name: "Neuve", proposedBy: s.owner.user.id, proposedByName: "x", text: "FRL", createdAt: ago(29) },
    ]);
    const done = await purgeOldData(db());
    expect(done).toMatchObject({ guildMembers: 1, guildEvents: 1, guildProposals: 1 });
    const left = (await db().select({ guid: guildMembers.guid }).from(guildMembers).where(eq(guildMembers.groupId, s.g.id))).map(x => x.guid);
    expect(left.sort()).toEqual([B.guid, C.guid].sort());
    expect((await db().select().from(guildLevels).where(eq(guildLevels.groupId, s.g.id))).map(x => x.guid).filter(g => g !== C.guid && g !== B.guid)).toEqual([]);
    expect(await db().select().from(guildLinks).where(eq(guildLinks.guid, A.guid))).toEqual([]);
    // Le joueur sans compte formé autour de Toujours La garde son main
    expect(await db().$count(guildPlayers, eq(guildPlayers.groupId, s.g.id))).toBe(1);
    expect((await db().select({ p: guildEvents.player1 }).from(guildEvents).where(eq(guildEvents.groupId, s.g.id))).map(x => x.p).sort()).toEqual([C.name, "Souvenir Recent"].sort());
    expect((await db().select({ key: guildLinkProposals.key }).from(guildLinkProposals).where(eq(guildLinkProposals.groupId, s.g.id))).map(x => x.key)).toEqual(["Neuve-Forever EU-Horde"]);
    expect(await purgeOldData(db())).toMatchObject({ guildMembers: 0, guildEvents: 0, guildProposals: 0 });
  });
});
