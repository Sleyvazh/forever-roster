import { addDays, atTime, dayKeyOf, outingDays } from "@forever/game-data";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discordDeletions, groups, outings, users } from "../src/db/schema";
import { buildInternalApp } from "../src/internal";
import { ORIGIN, setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

/** Sorties donjon (Forever) : création, droits, limites, liste d'attente, heure, annulation, bot, ligne X du FRG. */

let env: TestEnv;
let internal: FastifyInstance;
const SECRET = "secret-interne-de-test-assez-long-0123456789";
beforeAll(async () => { env = await setup(); internal = await buildInternalApp(env.app.ctx); await internal.ready(); });
afterAll(async () => { await internal.close(); await env.close(); });

const bot = (method: string, url: string, payload?: object) =>
  internal.inject({ method: method as "GET", url, headers: { authorization: `Bearer ${SECRET}` }, ...(payload ? { payload } : {}) });
let snow = 730000000000000000n;
const nextId = () => String(++snow);
const db = () => env.app.ctx.db;
/** Demain 21:00 (heure de Paris) : toujours dans la fenêtre « aujourd'hui ou demain ». */
const tomorrow = () => outingDays().tomorrow;
const tomorrowAt = (time = "21:00") => atTime(tomorrow(), time)!.toISOString();

type Signed = Awaited<ReturnType<typeof signedIn>>;
type Outing = {
  id: string; title: string; day: string; at: string | null; places: { tank: number; heal: number; dps: number }; canManage: boolean;
  signups: { id: string; role: string; name: string; guest: boolean; mine: boolean; dm?: string; player?: string | null }[];
  waiting: { id: string; role: string; name: string }[];
};

/** Groupe de Forever : un chef et des membres (Discord liés), chacun avec un perso du niveau voulu. */
async function scene(name: string, players: [string, string, string, number][]) {
  const slug = name.replace(/[^A-Za-z]/g, "");
  const gm = await signedIn(env, `${slug}Chef`);
  const g = (await gm.c.post("/api/groups", { name })).json().group as { id: string };
  const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 20, expiresInHours: 24 })).json().invite;
  const people: Record<string, { s: Signed; char: string; discordId: string }> = {};
  const add = async (s: Signed, char: string, cls: string, spec: string, level: number) => {
    const discordId = nextId();
    await db().update(users).set({ discordId }).where(eq(users.id, s.user.id));
    const c = (await s.c.post("/api/characters", { name: char, race: cls === "Druid" ? "Tauren" : "Troll", cls, spec1: spec, level })).json().character;
    await s.c.put(`/api/groups/${g.id}/characters/${c.id}`, { assigned: true });
    people[char] = { s, char: c.id, discordId };
  };
  await add(gm, `${slug}Lead`, "Mage", "Frost", 33);
  for (const [player, char, cls, level] of players) {
    const s = await signedIn(env, `${slug}${player}`);
    await s.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    await add(s, char, cls, cls === "Warrior" ? "Protection" : cls === "Priest" ? "Holy" : cls === "Druid" ? "Feral Bear" : "Frost", level);
  }
  const list = async (s: Signed = gm) => (await s.c.get(`/api/groups/${g.id}/outings`)).json() as { outings: Outing[]; canCreate: boolean; me: { characters: { id: string }[] }; levels: number[] };
  const create = (s: Signed, body: object) => s.c.post(`/api/groups/${g.id}/outings`, body);
  const join = (who: string, outingId: string, role: string, wait = false) =>
    people[who]!.s.c.put(`/api/groups/${g.id}/outings/${outingId}/signup`, { role, characterId: people[who]!.char, wait });
  return { gm, g, people, list, create, join, lead: people[`${slug}Lead`]! };
}

const gnomeregan = (characterId: string, extra: object = {}) => ({ dungeon: "gnomeregan", day: tomorrow(), at: tomorrowAt(), characterId, role: "DPS", note: "Toutes les quêtes", ...extra });
const claim = async () => (await bot("POST", "/internal/discord/outings/notices/claim")).json().notices as { discordUserId: string; kind: string; payload: Record<string, unknown> }[];

describe("création d'une sortie", () => {
  it("tout membre par défaut, perso au niveau, créateur inscrit, donjon connu ou « Autre »", async () => {
    const s = await scene("Lanternes", [["Ana", "Kaelys", "Priest", 31], ["Bob", "Bramm", "Warrior", 30], ["Low", "Nyx", "Mage", 20]]);
    const ana = s.people.Kaelys!;
    // Un membre crée (réglage par défaut : tous les membres)
    const r = await s.create(ana.s, gnomeregan(ana.char, { role: "Heal" }));
    expect(r.statusCode).toBe(201);
    const { outings: list, canCreate } = await s.list(ana.s);
    expect(canCreate).toBe(true);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: "Gnomeregan", day: tomorrow(), places: { tank: 1, heal: 1, dps: 3 }, canManage: true, note: "Toutes les quêtes", zone: "Dun Morogh" });
    expect(list[0]!.signups).toEqual([expect.objectContaining({ role: "Heal", name: "Kaelys", mine: true })]);
    // Perso sans le niveau, donjon inconnu, places invalides, rôle impossible, jour hors fenêtre, heure passée
    const low = s.people.Nyx!;
    expect((await s.create(low.s, gnomeregan(low.char))).json().error).toBe("Nyx (niveau 20) n'a pas le niveau de Gnomeregan (29-38).");
    expect((await s.create(ana.s, gnomeregan(ana.char, { dungeon: "naxxramas" }))).json().error).toBe("Donjon inconnu.");
    expect((await s.create(ana.s, gnomeregan(ana.char, { role: "Heal", places: { tank: 2, heal: 1, dps: 3 } }))).json().error).toBe("Places invalides : 5 en tout.");
    expect((await s.create(s.lead.s, gnomeregan(s.lead.char, { role: "Tank" }))).json().error).toBe(`${"LanternesLead"} ne peut pas jouer tank.`);
    expect((await s.create(ana.s, gnomeregan(ana.char, { role: "Heal", day: addDays(tomorrow(), 1), at: null }))).json().error).toBe("Une sortie, c'est pour aujourd'hui ou demain.");
    const past = new Date(Date.now() - 3600e3);
    expect((await s.create(ana.s, gnomeregan(ana.char, { role: "Heal", day: dayKeyOf(past), at: past.toISOString() }))).statusCode).toBe(400);
    // « Autre » : titre libre, sans fourchette (tout perso convient) ; « dès que complet » : sans heure
    const other = await s.create(low.s, { dungeon: "other", title: "Élite de la Vallée", day: tomorrow(), at: null, characterId: low.char, role: "DPS" });
    expect(other.statusCode).toBe(201);
    const all = (await s.list()).outings;
    // Par jour : « dès que complet » d'abord, puis à l'heure
    expect(all.map(o => o.title)).toEqual(["Élite de la Vallée", "Gnomeregan"]);
    expect(all[0]).toMatchObject({ at: null, minLevel: null, zone: "" });
    // Un groupe de Roster n'a pas de sorties
    const rg = await signedIn(env, "LanternesRetail");
    const retail = (await rg.c.post("/api/groups", { name: "Pasta" })).json().group;
    await db().update(groups).set({ game: "retail" }).where(eq(groups.id, retail.id));
    expect((await rg.c.get(`/api/groups/${retail.id}/outings`)).json().error).toBe("Les sorties donjon sont pour WoW Forever.");
  });

  it("limites : 3 sorties ouvertes par joueur", async () => {
    const s = await scene("Limites", [["Ana", "Kaelys", "Priest", 60]]);
    const ana = s.people.Kaelys!;
    for (const d of ["blackrock-depths", "dire-maul", "stratholme"]) expect((await s.create(ana.s, { ...gnomeregan(ana.char, { role: "Heal" }), dungeon: d })).statusCode).toBe(201);
    const fourth = await s.create(ana.s, { ...gnomeregan(ana.char, { role: "Heal" }), dungeon: "scholomance" });
    expect(fourth.statusCode).toBe(400);
    expect(fourth.json().error).toMatch(/^Tu as déjà 3 sorties ouvertes/);
    // Une sortie passée ne compte plus
    const [first] = (await s.list()).outings;
    await db().update(outings).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(outings.id, first!.id));
    expect((await s.create(ana.s, { ...gnomeregan(ana.char, { role: "Heal" }), dungeon: "scholomance" })).statusCode).toBe(201);
  });
});

describe("qui crée : réglage des officiers, pour les raids et pour les sorties", () => {
  it("sorties réservées aux officiers, raids ouverts à tous les membres ; /raid suit le réglage", async () => {
    const s = await scene("Reglages", [["Ana", "Kaelys", "Priest", 31]]);
    const ana = s.people.Kaelys!;
    // Défauts : raids → officiers, sorties → tous
    const d0 = (await ana.s.c.get(`/api/groups/${s.g.id}`)).json().group.creators;
    expect(d0).toEqual({ raids: "officers", outings: "members", canCreateRaid: false, canCreateOuting: true });
    expect((await ana.s.c.post(`/api/groups/${s.g.id}/raids`, { name: "Onyxia", size: 40 })).statusCode).toBe(403);
    // Un membre ne change pas le réglage
    expect((await ana.s.c.put(`/api/groups/${s.g.id}/creators`, { raids: "members" })).statusCode).toBe(403);
    expect((await s.gm.c.put(`/api/groups/${s.g.id}/creators`, { raids: "members", outings: "officers" })).json().creators).toEqual({ raids: "members", outings: "officers" });
    expect((await ana.s.c.post(`/api/groups/${s.g.id}/raids`, { name: "Onyxia", size: 40 })).statusCode).toBe(201);
    // Le raid récurrent reste aux officiers
    expect((await ana.s.c.post(`/api/groups/${s.g.id}/raids`, { name: "Onyxia", size: 40, scheduledAt: tomorrowAt(), weekly: { leadDays: 7 } })).statusCode).toBe(403);
    const refused = await s.create(ana.s, gnomeregan(ana.char, { role: "Heal" }));
    expect(refused.statusCode).toBe(403);
    expect((await s.list(ana.s)).canCreate).toBe(false);
    expect((await s.create(s.gm, gnomeregan(s.lead.char))).statusCode).toBe(201);

    // /raid : membre lié, salon du groupe ; suit le réglage des raids
    const guild = nextId(), channel = nextId();
    const { code } = (await s.gm.c.post(`/api/groups/${s.g.id}/discord/code`)).json();
    await bot("POST", "/internal/discord/bind", { code, guildId: guild, channelId: channel, discordUserId: s.lead.discordId });
    const raid = (who: string) => bot("POST", "/internal/discord/raids", { guildId: guild, channelId: channel, discordUserId: who, name: "Molten Core", scheduledAt: tomorrowAt() });
    expect((await raid(ana.discordId)).statusCode).toBe(200);
    await s.gm.c.put(`/api/groups/${s.g.id}/creators`, { raids: "officers" });
    expect((await raid(ana.discordId)).json().error).toBe("Seuls les officiers du groupe peuvent créer un raid.");
    // /sortie : réservé aux officiers ici
    const sortie = await bot("POST", "/internal/discord/outings", { guildId: guild, channelId: channel, discordUserId: ana.discordId, dungeon: "gnomeregan", day: tomorrow(), at: tomorrowAt("20:00") });
    expect(sortie.json().error).toBe("Seuls les officiers du groupe peuvent créer une sortie.");
  });
});

describe("inscriptions, liste d'attente et promotion", () => {
  it("premier arrivé premier servi ; complet → attente ; la place libérée va au premier en attente (MP)", async () => {
    const s = await scene("Attente", [
      ["A", "Bramm", "Warrior", 30], ["B", "Kaelys", "Priest", 31], ["C", "Tiblou", "Mage", 31], ["D", "Mirka", "Mage", 34],
      ["E", "Quillon", "Mage", 36], ["F", "Brindille", "Priest", 35], ["G", "Grimbald", "Warrior", 38],
    ]);
    await s.create(s.gm, gnomeregan(s.lead.char));
    const o = (await s.list()).outings[0]!;
    await claim(); // file vide pour la suite
    expect((await s.join("Bramm", o.id, "Tank")).json().result).toEqual({ state: "in", role: "Tank", name: "Bramm", position: null });
    expect((await s.join("Kaelys", o.id, "Heal")).statusCode).toBe(200);
    expect((await s.join("Tiblou", o.id, "DPS")).statusCode).toBe(200);
    // Rôle plein : 409 sans « en attente »
    const full = await s.join("Grimbald", o.id, "Tank");
    expect(full.statusCode).toBe(409);
    expect(full.json().error).toBe("Plus de place en tank : mets-toi en attente.");
    // La dernière place : sortie complète → MP au créateur, une seule fois
    expect((await s.join("Mirka", o.id, "DPS")).json().result.state).toBe("in");
    let notices = await claim();
    expect(notices).toEqual([expect.objectContaining({ discordUserId: s.lead.discordId, kind: "full", payload: expect.objectContaining({ title: "Gnomeregan", count: 5, isCreator: true }) })]);
    // Attente : dans l'ordre
    expect((await s.join("Quillon", o.id, "DPS", true)).json().result).toEqual({ state: "waiting", role: "DPS", name: "Quillon", position: 1 });
    expect((await s.join("Brindille", o.id, "Heal", true)).json().result).toMatchObject({ state: "waiting", position: 2 });
    let cur = (await s.list()).outings[0]!;
    expect(cur.signups.map(x => `${x.role}:${x.name}`)).toEqual(["DPS:AttenteLead", "Tank:Bramm", "Heal:Kaelys", "DPS:Tiblou", "DPS:Mirka"]);
    expect(cur.waiting.map(x => `${x.role}:${x.name}`)).toEqual(["DPS:Quillon", "Heal:Brindille"]);
    // Le créateur ne se retire pas ; un DPS se retire → Quillon (premier en attente pour DPS) prend sa place
    expect((await s.lead.s.c.del(`/api/groups/${s.g.id}/outings/${o.id}/signup`)).json().error).toBe("Tu as créé cette sortie : annule-la plutôt (sur le site).");
    expect((await s.people.Tiblou!.s.c.del(`/api/groups/${s.g.id}/outings/${o.id}/signup`)).json()).toEqual({ ok: true });
    cur = (await s.list()).outings[0]!;
    expect(cur.signups.map(x => x.name)).toContain("Quillon");
    expect(cur.waiting.map(x => x.name)).toEqual(["Brindille"]);
    notices = await claim();
    expect(notices).toEqual([expect.objectContaining({ discordUserId: s.people.Quillon!.discordId, kind: "promoted", payload: expect.objectContaining({ role: "DPS", character: "Quillon" }) })]);
    // Le créateur retire Kaelys (heal) : Brindille passe ; « Places et note » : un rôle ne descend pas sous ses inscrits
    const kaelys = cur.signups.find(x => x.name === "Kaelys")!;
    expect(cur.signups.find(x => x.name === "Kaelys")).toMatchObject({ dm: "yes", player: "AttenteB" });
    expect((await s.people.Bramm!.s.c.del(`/api/groups/${s.g.id}/outings/${o.id}/signups/${kaelys.id}`)).statusCode).toBe(403);
    expect((await s.lead.s.c.del(`/api/groups/${s.g.id}/outings/${o.id}/signups/${kaelys.id}`)).statusCode).toBe(200);
    expect((await s.list()).outings[0]!.signups.map(x => x.name)).toContain("Brindille");
    const tooFew = await s.lead.s.c.patch(`/api/groups/${s.g.id}/outings/${o.id}`, { places: { tank: 1, heal: 2, dps: 2 } });
    expect(tooFew.json().error).toBe("Il y a 3 inscrits en DPS : retire-en avant de passer à 2 places.");
    expect((await s.lead.s.c.patch(`/api/groups/${s.g.id}/outings/${o.id}`, { note: "Quête de VanCleef" })).statusCode).toBe(200);
  });
});

describe("changer l'heure, annuler", () => {
  it("les inscrits restent et sont prévenus ; l'annulation prévient tout le monde et efface le message", async () => {
    const s = await scene("Heure", [["A", "Bramm", "Warrior", 30], ["B", "Kaelys", "Priest", 31]]);
    await s.create(s.gm, gnomeregan(s.lead.char));
    const o = (await s.list()).outings[0]!;
    await s.join("Bramm", o.id, "Tank");
    await s.join("Kaelys", o.id, "Heal");
    // Kaelys a coupé les MP du bot : pas de MP pour elle
    await db().update(users).set({ discordReminders: false }).where(eq(users.id, s.people.Kaelys!.s.user.id));
    await claim();
    // Un simple inscrit ne change pas l'heure
    expect((await s.people.Bramm!.s.c.put(`/api/groups/${s.g.id}/outings/${o.id}/time`, { day: tomorrow(), at: tomorrowAt("21:30") })).statusCode).toBe(403);
    expect((await s.lead.s.c.put(`/api/groups/${s.g.id}/outings/${o.id}/time`, { day: tomorrow(), at: tomorrowAt("21:30") })).statusCode).toBe(200);
    const moved = (await s.list()).outings[0]!;
    expect(moved.at).toBe(tomorrowAt("21:30"));
    expect(moved.signups).toHaveLength(3);
    const notices = await claim();
    expect(notices).toEqual([expect.objectContaining({ discordUserId: s.people.Bramm!.discordId, kind: "moved",
      payload: expect.objectContaining({ at: tomorrowAt("21:30"), oldAt: tomorrowAt("21:00"), role: "Tank" }) })]);
    // « Dès que complet »
    expect((await s.lead.s.c.put(`/api/groups/${s.g.id}/outings/${o.id}/time`, { day: tomorrow(), at: null })).statusCode).toBe(200);
    expect((await s.list()).outings[0]!.at).toBeNull();
    await claim();

    // Annuler : un officier le peut aussi ; message publié effacé
    await db().update(outings).set({ discordChannelId: "999000111222333444", discordMessageId: "999000111222333555" }).where(eq(outings.id, o.id));
    expect((await s.people.Bramm!.s.c.del(`/api/groups/${s.g.id}/outings/${o.id}`)).statusCode).toBe(403);
    expect((await s.gm.c.del(`/api/groups/${s.g.id}/outings/${o.id}`)).statusCode).toBe(200);
    expect((await s.list()).outings).toEqual([]);
    expect((await claim()).map(n => `${n.kind}:${n.discordUserId}`)).toEqual([`cancelled:${s.people.Bramm!.discordId}`]);
    const del = await db().select().from(discordDeletions).where(eq(discordDeletions.messageId, "999000111222333555"));
    expect(del).toHaveLength(1);
  });
});

describe("bot Discord (API interne)", () => {
  it("salon des sorties lié par code, nom rapporté, annonces à publier puis effacées 2 h après", async () => {
    const s = await scene("Salons", [["A", "Bramm", "Warrior", 30]]);
    const guild = nextId(), raidsCh = nextId(), outCh = nextId();
    // Sans salon : rien à publier ; avec le salon du groupe : les sorties y vont
    await s.create(s.gm, gnomeregan(s.lead.char));
    const o = (await s.list()).outings[0]!;
    const outbox = async () => (await bot("GET", "/internal/discord/outings/outbox")).json().outings as { id: string; channelId: string; messageId: string | null; changedAt: string; today: string; title: string; signups: unknown[] }[];
    expect((await outbox()).find(x => x.id === o.id)).toBeUndefined();
    const raidsCode = (await s.gm.c.post(`/api/groups/${s.g.id}/discord/code`)).json().code;
    await bot("POST", "/internal/discord/bind", { code: raidsCode, guildId: guild, channelId: raidsCh, discordUserId: s.lead.discordId, channelName: "raids" });
    expect((await outbox()).find(x => x.id === o.id)?.channelId).toBe(raidsCh);

    // Salon à part : code (officiers), liaison, salon des raids refusé
    expect((await s.people.Bramm!.s.c.post(`/api/groups/${s.g.id}/discord/outings-code`)).statusCode).toBe(403);
    let { code } = (await s.gm.c.post(`/api/groups/${s.g.id}/discord/outings-code`)).json();
    expect((await bot("POST", "/internal/discord/bind", { code, guildId: guild, channelId: raidsCh, discordUserId: s.lead.discordId })).json().error)
      .toMatch(/^Ce salon est déjà celui des raids du groupe/);
    ({ code } = (await s.gm.c.post(`/api/groups/${s.g.id}/discord/outings-code`)).json());
    expect((await bot("POST", "/internal/discord/bind", { code, guildId: guild, channelId: outCh, discordUserId: s.lead.discordId, channelName: "sorties" })).json())
      .toEqual({ group: { id: s.g.id, name: "Salons" }, kind: "outings" });
    expect((await s.gm.c.get(`/api/groups/${s.g.id}`)).json().group).toMatchObject({ outingsLinked: true, outingsChannelName: "sorties" });
    // Nom des salons liés : le bot relève et rapporte
    const linked = (await bot("GET", "/internal/discord/linked-channels")).json() as { kind: string; id: string; channelId: string; name: string }[];
    expect(linked).toContainEqual({ kind: "outings", id: s.g.id, guildId: guild, channelId: outCh, name: "sorties" });
    expect((await bot("POST", "/internal/discord/channel-name", { kind: "outings", id: s.g.id, channelId: outCh, name: "sorties-donjons" })).json()).toEqual({ ok: true, changed: true });
    expect((await s.gm.c.get(`/api/groups/${s.g.id}`)).json().group.outingsChannelName).toBe("sorties-donjons");

    // À publier dans le salon des sorties ; publiée, elle ne revient que si elle change (ou le lendemain)
    const item = (await outbox()).find(x => x.id === o.id)!;
    expect(item).toMatchObject({ channelId: outCh, messageId: null, title: "Gnomeregan", today: outingDays().today });
    await bot("POST", `/internal/discord/outings/${o.id}/published`, { channelId: outCh, messageId: "777000111222333444", changedAt: item.changedAt, renderedOn: item.today });
    expect((await outbox()).find(x => x.id === o.id)).toBeUndefined();
    await db().update(outings).set({ discordRenderedOn: addDays(outingDays().today, -1) }).where(eq(outings.id, o.id));
    expect((await outbox()).find(x => x.id === o.id)?.messageId).toBe("777000111222333444");
    await bot("POST", `/internal/discord/outings/${o.id}/published`, { channelId: outCh, messageId: "777000111222333444", changedAt: item.changedAt, renderedOn: item.today });

    // Délier le salon des sorties : le message part, la sortie repart dans le salon du groupe
    await s.gm.c.del(`/api/groups/${s.g.id}/discord/outings`);
    const deletions = (await bot("GET", "/internal/discord/outbox")).json().deletions as { messageId: string }[];
    expect(deletions.map(d => d.messageId)).toContain("777000111222333444");
    expect((await outbox()).find(x => x.id === o.id)?.channelId).toBe(raidsCh);

    // 2 h après l'heure : la sortie disparaît, son message est effacé
    await bot("POST", `/internal/discord/outings/${o.id}/published`, { channelId: raidsCh, messageId: "777000111222333999", changedAt: item.changedAt, renderedOn: item.today });
    await db().update(outings).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(outings.id, o.id));
    await outbox();
    expect((await db().select().from(outings).where(eq(outings.id, o.id)))).toEqual([]);
    expect((await db().select().from(discordDeletions).where(eq(discordDeletions.messageId, "777000111222333999")))).toHaveLength(1);
    expect((await s.list()).outings).toEqual([]);
  });

  it("boutons : membre lié (son perso au niveau), inscrit sans compte, me retirer ; /sortie ; MP 15 min avant", async () => {
    const s = await scene("Boutons", [["A", "Bramm", "Warrior", 30], ["Low", "Nyx", "Warrior", 12]]);
    const guild = nextId(), ch = nextId();
    const { code } = (await s.gm.c.post(`/api/groups/${s.g.id}/discord/outings-code`)).json();
    await bot("POST", "/internal/discord/bind", { code, guildId: guild, channelId: ch, discordUserId: s.lead.discordId });

    // /sortie : complétion (triée pour son perso, « N persos au niveau »), puis création avec le perso qui a le niveau
    const ac = (await bot("GET", `/internal/discord/outings/dungeons?guildId=${guild}&channelId=${ch}&discordUserId=${s.lead.discordId}&q=gno`)).json().choices;
    expect(ac[0]).toEqual({ key: "gnomeregan", name: "Gnomeregan", levels: "29-38", count: 2, fits: true });
    const at = new Date(Date.now() + 10 * 60e3); // dans 10 min : le rappel de 15 min est dû
    const created = await bot("POST", "/internal/discord/outings", { guildId: guild, channelId: ch, discordUserId: s.lead.discordId, dungeon: "gnomeregan", day: dayKeyOf(at), at: at.toISOString(), note: "Toutes les quêtes" });
    expect(created.statusCode).toBe(200);
    const c = created.json();
    expect(c).toMatchObject({ character: "BoutonsLead", role: "DPS", open: { mine: 1, max: 3 } });
    const id = c.view.id as string;
    // Nom approché (« Uldaman ») et texte libre (« Autre »)
    const libre = await bot("POST", "/internal/discord/outings", { guildId: guild, channelId: ch, discordUserId: s.people.Nyx!.discordId, dungeon: "Élite de la Vallée", day: tomorrow(), at: null });
    expect(libre.json().view).toMatchObject({ dungeon: "other", title: "Élite de la Vallée", levels: "" });
    expect((await bot("POST", "/internal/discord/outings", { guildId: guild, channelId: ch, discordUserId: s.people.Nyx!.discordId, dungeon: "uldaman", day: tomorrow(), at: null })).json().error)
      .toBe("Aucun de tes persos n'a le niveau de Uldaman (41-51).");

    // Membre lié : ses persos au niveau qui tiennent le rôle
    const choices = (await bot("GET", `/internal/discord/outings/${id}/choices?discordUserId=${s.people.Bramm!.discordId}&role=Tank`)).json();
    expect(choices).toMatchObject({ mode: "member", levels: "29-38", characters: [{ name: "Bramm", spec: "Protection", level: 30 }] });
    const lowChoices = (await bot("GET", `/internal/discord/outings/${id}/choices?discordUserId=${s.people.Nyx!.discordId}&role=Tank`)).json();
    expect(lowChoices).toMatchObject({ mode: "member", anyAtLevel: false, characters: [] });
    const joined = await bot("POST", `/internal/discord/outings/${id}/signup`, { discordUserId: s.people.Bramm!.discordId, discordName: "bramm", role: "Tank", characterId: choices.characters[0].id });
    expect(joined.json().result).toEqual({ state: "in", role: "Tank", name: "Bramm", position: null });
    expect(joined.json().view.signups).toContainEqual({ role: "Tank", name: "Bramm", cls: "Warrior", spec: "Protection", guest: false });

    // Sans compte : classe et spé du rôle
    const guest = nextId();
    expect((await bot("GET", `/internal/discord/outings/${id}/choices?discordUserId=${guest}&role=Heal`)).json()).toMatchObject({ mode: "guest", linked: false });
    expect((await bot("POST", `/internal/discord/outings/${id}/signup`, { discordUserId: guest, discordName: "mirka", role: "Heal", cls: "Priest", spec: "Shadow" })).json().error)
      .toBe("Cette spé ne joue pas heal.");
    const g1 = await bot("POST", `/internal/discord/outings/${id}/signup`, { discordUserId: guest, discordName: "mirka", role: "Heal", cls: "Priest", spec: "Holy" });
    expect(g1.json().view.signups).toContainEqual({ role: "Heal", name: "mirka", cls: "Priest", spec: "Holy", guest: true });

    // Ligne X du FRG : inscrit sans compte en « @pseudo »
    const frg = (await s.gm.c.get(`/api/groups/${s.g.id}/addon-export`)).json().text as string;
    const x = frg.split("\n").filter(l => l.startsWith("X;"));
    expect(x).toContain(`X;${id};${Math.floor(at.getTime() / 1000)};gnomeregan;Gnomeregan;29;38;BoutonsLead;1/1/3;Bramm;@mirka;BoutonsLead;;Toutes les quêtes`);
    expect(x.some(l => l.endsWith(";other;Élite de la Vallée;;;Nyx;1/1/3;Nyx;;;;"))).toBe(true);
    const lines = frg.split("\n");
    expect(lines.findIndex(l => l.startsWith("X;"))).toBeLessThan(lines.findIndex(l => l.startsWith("M;")));

    // Me retirer (sans compte)
    expect((await bot("DELETE", `/internal/discord/outings/${id}/signup/${guest}`)).json().removed).toBe(true);
    expect((await bot("DELETE", `/internal/discord/outings/${id}/signup/${guest}`)).json().removed).toBe(false);

    // 15 min avant : un MP à chaque inscrit qui a une place (le créateur a son propre texte), une seule fois
    const notices = (await claim()).filter(n => n.kind === "soon");
    expect(notices.map(n => n.discordUserId).sort()).toEqual([s.lead.discordId, s.people.Bramm!.discordId].sort());
    expect(notices.find(n => n.discordUserId === s.lead.discordId)!.payload).toMatchObject({ isCreator: true, title: "Gnomeregan", url: `${ORIGIN}/groups/${s.g.id}/sorties` });
    expect((await claim()).filter(n => n.kind === "soon")).toEqual([]);
  });
});
