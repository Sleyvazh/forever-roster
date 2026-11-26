import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvents, polls, pollVotes, users } from "../src/db/schema";
import { buildInternalApp } from "../src/internal";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

/** Sondages (26/11/2026) : droits (officiers par défaut, réglable), sondage à choix, disponibilités, raid sur ★, relève. */

let env: TestEnv;
let internal: FastifyInstance;
const SECRET = "secret-interne-de-test-assez-long-0123456789";
beforeAll(async () => { env = await setup(); internal = await buildInternalApp(env.app.ctx); await internal.ready(); });
afterAll(async () => { await internal.close(); await env.close(); });

const bot = (method: string, url: string, payload?: object) =>
  internal.inject({ method: method as "GET", url, headers: { authorization: `Bearer ${SECRET}` }, ...(payload ? { payload } : {}) });
let snow = 840000000000000000n;
const nextId = () => String(++snow);
const db = () => env.app.ctx.db;
const inDays = (d: number, h = 21) => { const t = new Date(Date.now() + d * 86400e3); t.setUTCHours(h, 0, 0, 0); return t.toISOString(); };

type Signed = Awaited<ReturnType<typeof signedIn>>;
type View = {
  id: string; kind: string; hidden: boolean; voters: number; best: number | null; leaders: number[]; closedAt: string | null; closesAt: string | null;
  creator: string; channelId: string | null; messageId: string | null; changedAt: string; url: string; raid: { id: string; name: string } | null;
  options: { id: number; label: string; at: string | null; yes: number | null; maybe: number | null; no: number | null; roles: Record<string, number> | null }[];
};

/** Guilde liée à un salon Discord : un chef (officier) et des membres liés, chacun avec un main. */
async function scene(name: string, players: [string, string, string, string][]) {
  const slug = name.replace(/[^A-Za-z]/g, "");
  const gm = await signedIn(env, `${slug}Chef`);
  const g = (await gm.c.post("/api/groups", { name })).json().group as { id: string };
  const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 20, expiresInHours: 24 })).json().invite;
  const people: Record<string, { s: Signed; discordId: string }> = {};
  const add = async (s: Signed, char: string, cls: string, spec: string) => {
    const discordId = nextId();
    await db().update(users).set({ discordId }).where(eq(users.id, s.user.id));
    const c = (await s.c.post("/api/characters", { name: char, race: cls === "Druid" ? "Tauren" : "Troll", cls, spec1: spec, level: 60 })).json().character;
    await s.c.put(`/api/groups/${g.id}/characters/${c.id}`, { assigned: true });
    people[char] = { s, discordId };
  };
  await add(gm, `${slug}Lead`, "Mage", "Frost");
  for (const [player, char, cls, spec] of players) {
    const s = await signedIn(env, `${slug}${player}`);
    await s.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    await add(s, char, cls, spec);
  }
  const guildId = nextId(), channelId = nextId();
  const { code } = (await gm.c.post(`/api/groups/${g.id}/discord/code`)).json();
  await bot("POST", "/internal/discord/bind", { code, guildId, channelId, discordUserId: people[`${slug}Lead`]!.discordId });
  const create = (who: string, body: object) => bot("POST", "/internal/discord/polls", { guildId, channelId, discordUserId: who, ...body });
  return { gm, g, people, guildId, channelId, create, lead: people[`${slug}Lead`]! };
}

const vote = (id: string, who: string, optionId: number, name = "Pseudo") => bot("POST", `/internal/discord/polls/${id}/vote`, { discordUserId: who, discordName: name, optionId });
const dates = (id: string, who: string, body: { yes?: number[]; maybe?: number[] }, name = "Pseudo") => bot("PUT", `/internal/discord/polls/${id}/dates`, { discordUserId: who, discordName: name, ...body });
const view = async (id: string) => (await bot("GET", `/internal/discord/polls/${id}/view`)).json() as View;
const outbox = async () => (await bot("GET", "/internal/discord/polls/outbox")).json().polls as View[];

describe("droits", () => {
  it("officiers par défaut ; réglable pour tous les membres ; compte lié et membre", async () => {
    const s = await scene("Sondeurs", [["Ana", "Kaelys", "Priest", "Holy"]]);
    const ana = s.people.Kaelys!;
    const can = (who: string) => bot("GET", `/internal/discord/polls/can-create?guildId=${s.guildId}&channelId=${s.channelId}&discordUserId=${who}`);
    expect((await can(ana.discordId)).json().error).toBe("Seuls les officiers de la guilde peuvent créer un sondage.");
    expect((await can(s.lead.discordId)).json()).toMatchObject({ ok: true, group: { id: s.g.id, name: "Sondeurs" } });
    expect((await can(nextId())).json().error).toBe("Lie d'abord ton compte Discord au site (Compte & sécurité).");
    const body = { kind: "choice", question: "Quel donjon ?", options: [{ label: "Scholomance" }, { label: "Stratholme" }] };
    expect((await s.create(ana.discordId, body)).statusCode).toBe(403);
    // Site : réglage et ce que voit un membre
    const group = async (x: Signed) => (await x.c.get(`/api/groups/${s.g.id}`)).json().group.creators;
    expect(await group(ana.s)).toMatchObject({ polls: "officers", canCreatePoll: false });
    expect((await ana.s.c.put(`/api/groups/${s.g.id}/creators`, { polls: "members" })).statusCode).toBe(403);
    expect((await s.gm.c.put(`/api/groups/${s.g.id}/creators`, { polls: "members" })).json().creators).toMatchObject({ polls: "members" });
    expect(await group(ana.s)).toMatchObject({ polls: "members", canCreatePoll: true });
    expect((await s.create(ana.discordId, body)).statusCode).toBe(200);
    // Salon non lié
    expect((await bot("POST", "/internal/discord/polls", { ...body, guildId: s.guildId, channelId: nextId(), discordUserId: ana.discordId })).statusCode).toBe(404);
  });
});

describe("sondage à choix", () => {
  it("vérifie la saisie ; un seul choix (le même clic le retire) ; joueur sans compte ; anonyme ; clôture", async () => {
    const s = await scene("Choix", [["Ana", "Kaelys", "Priest", "Holy"], ["Bob", "Bramm", "Warrior", "Protection"]]);
    const lead = s.lead.discordId, ana = s.people.Kaelys!.discordId, bob = s.people.Bramm!.discordId;
    const q = (options: string[], extra: object = {}) => s.create(lead, { kind: "choice", question: "  Quel   donjon jeudi soir ? ", options: options.map(label => ({ label })), anonymous: true, ...extra });
    expect((await q(["Scholomance"])).json().error).toBe("Propose au moins 2 choix.");
    expect((await q(["Scholomance", "scholomance"])).json().error).toBe("Deux choix sont identiques.");
    expect((await q(Array.from({ length: 11 }, (_, i) => `Choix ${i}`))).json().error).toBe("10 choix au plus.");
    expect((await q(["A", "B"], { closesAt: inDays(-1) })).json().error).toBe("La fin du sondage est déjà passée.");
    expect((await q(["A", "B"], { closesAt: inDays(40) })).json().error).toBe("Un sondage dure 30 jours au plus.");
    const r = await q(["Scholomance", "Stratholme", "Pic Rochenoire"]);
    expect(r.statusCode).toBe(200);
    const v0 = r.json().view as View;
    expect(v0).toMatchObject({ kind: "choice", question: "Quel donjon jeudi soir ?", anonymous: true, multi: false, voters: 0, creator: "ChoixLead", channelId: s.channelId, messageId: null, closedAt: null });
    expect(v0.url).toBe(`http://app.test/groups/${s.g.id}/membres/sondages?sondage=${v0.id}`);
    // Relève : à poser, puis plus rien tant que rien ne change
    expect((await outbox()).map(p => p.id)).toContain(v0.id);
    await bot("POST", `/internal/discord/polls/${v0.id}/published`, { channelId: s.channelId, messageId: "900000000000000001", changedAt: v0.changedAt });
    expect((await outbox()).map(p => p.id)).not.toContain(v0.id);

    // Votes : membres liés (sous leur compte), joueur Discord sans compte
    expect((await vote(v0.id, ana, 1)).json().vote).toEqual({ yes: [1] });
    expect((await vote(v0.id, ana, 2)).json().vote).toEqual({ yes: [2] });
    expect((await vote(v0.id, bob, 2)).json()).toMatchObject({ vote: { yes: [2] }, name: "Bramm", guest: false });
    const guest = nextId();
    expect((await vote(v0.id, guest, 1, "Passant")).json()).toMatchObject({ vote: { yes: [1] }, name: "Passant", guest: true });
    expect((await vote(v0.id, ana, 9)).json().error).toBe("Ce choix n'existe pas.");
    let v = await view(v0.id);
    expect(v.options.map(o => o.yes)).toEqual([1, 2, 0]);
    expect(v).toMatchObject({ voters: 3, leaders: [2] });
    // Le même clic retire le vote
    expect((await vote(v0.id, guest, 1)).json().vote).toEqual({ yes: [] });
    expect((await view(v0.id)).voters).toBe(2);
    expect((await outbox()).map(p => p.id)).toContain(v0.id);
    // Mon vote ; anonyme : pas de « Qui a voté ? »
    expect((await bot("GET", `/internal/discord/polls/${v0.id}/mine?discordUserId=${ana}&discordName=x`)).json()).toMatchObject({ vote: { yes: [2] }, name: "Kaelys" });
    expect((await bot("GET", `/internal/discord/polls/${v0.id}/voters`)).json().error).toBe("Ce sondage est anonyme : personne ne voit qui a voté quoi.");
    // Clore : son créateur ou un officier
    expect((await bot("POST", `/internal/discord/polls/${v0.id}/close`, { discordUserId: ana })).json().error).toBe("Seuls son créateur et les officiers peuvent clore ce sondage.");
    expect((await bot("POST", `/internal/discord/polls/${v0.id}/close`, { discordUserId: lead })).json()).toMatchObject({ already: false });
    v = await view(v0.id);
    expect(v.closedAt).not.toBeNull();
    expect((await vote(v0.id, ana, 1)).json().error).toBe("Ce sondage est clos.");
    const types = (await db().select({ type: auditEvents.type }).from(auditEvents).where(eq(auditEvents.groupId, s.g.id))).map(e => e.type);
    expect(types).toEqual(expect.arrayContaining(["poll_created", "poll_closed"]));
  });

  it("plusieurs choix, public, résultats cachés jusqu'à la fin", async () => {
    const s = await scene("Plusieurs", [["Ana", "Kaelys", "Priest", "Holy"]]);
    const ana = s.people.Kaelys!.discordId;
    const v0 = (await s.create(s.lead.discordId, { kind: "choice", question: "Quels soirs ?", options: [{ label: "Mardi" }, { label: "Jeudi" }, { label: "Dimanche" }], multi: true, anonymous: false, results: "end" })).json().view as View;
    expect((await vote(v0.id, ana, 3)).json().vote).toEqual({ yes: [3] });
    expect((await vote(v0.id, ana, 1)).json().vote).toEqual({ yes: [1, 3] });
    expect((await vote(v0.id, ana, 3)).json().vote).toEqual({ yes: [1] });
    await vote(v0.id, s.lead.discordId, 1);
    // Caché : ni compte ni « qui a voté » avant la fin
    let v = await view(v0.id);
    expect(v).toMatchObject({ hidden: true, voters: 2, leaders: [] });
    expect(v.options.every(o => o.yes === null)).toBe(true);
    expect((await bot("GET", `/internal/discord/polls/${v0.id}/voters`)).json().error).toBe("Les résultats seront visibles à la fin du sondage.");
    // Fin passée : la relève le clôt, les résultats apparaissent
    await db().update(polls).set({ closesAt: new Date(Date.now() - 60e3) }).where(eq(polls.id, v0.id));
    const out = await outbox();
    v = out.find(p => p.id === v0.id)!;
    expect(v).toMatchObject({ hidden: false, leaders: [1] });
    expect(v.closedAt).not.toBeNull();
    expect(v.options.map(o => o.yes)).toEqual([2, 0, 0]);
    const voters = (await bot("GET", `/internal/discord/polls/${v0.id}/voters`)).json();
    expect(voters.options[0].yes.map((p: { name: string }) => p.name).sort()).toEqual(["Kaelys", "PlusieursLead"]);
  });

  it("un vote donné sans compte passe sous le compte une fois le Discord lié", async () => {
    const s = await scene("Liaison", [["Ana", "Kaelys", "Priest", "Holy"]]);
    const v0 = (await s.create(s.lead.discordId, { kind: "choice", question: "Oui ou non ?", options: [{ label: "Oui" }, { label: "Non" }] })).json().view as View;
    const later = nextId();
    await vote(v0.id, later, 1, "Futur");
    // Ana lie ce Discord à son compte (à la place du sien)
    await db().update(users).set({ discordId: later }).where(eq(users.id, s.people.Kaelys!.s.user.id));
    expect((await bot("GET", `/internal/discord/polls/${v0.id}/mine?discordUserId=${later}&discordName=x`)).json()).toMatchObject({ vote: { yes: [1] }, name: "Kaelys", guest: false });
    expect((await vote(v0.id, later, 2)).json().vote).toEqual({ yes: [2] });
    const rows = await db().select({ key: pollVotes.voterKey }).from(pollVotes).where(eq(pollVotes.pollId, v0.id));
    expect(rows.map(r => r.key)).toEqual([`u:${s.people.Kaelys!.s.user.id}`]);
  });
});

describe("disponibilités", () => {
  it("créneaux datés, Oui / Si besoin, meilleur créneau et rôles, puis « Créer le raid sur ★ »", async () => {
    const s = await scene("Dispos", [["Ana", "Kaelys", "Priest", "Holy"], ["Bob", "Bramm", "Warrior", "Protection"], ["Cid", "Tiblou", "Mage", "Frost"]]);
    const lead = s.lead.discordId, ana = s.people.Kaelys!.discordId, bob = s.people.Bramm!.discordId, cid = s.people.Tiblou!.discordId;
    const slots = [inDays(6), inDays(4), inDays(5)];
    expect((await s.create(lead, { kind: "dates", question: "Quel soir ?", options: [{ label: "x", at: slots[0] }, { label: "y" }] })).json().error).toBe("Chaque créneau doit avoir une date et une heure.");
    expect((await s.create(lead, { kind: "dates", question: "Quel soir ?", options: [{ label: "x", at: slots[0] }, { label: "y", at: slots[0] }] })).json().error).toBe("Deux créneaux sont identiques.");
    expect((await s.create(lead, { kind: "dates", question: "Quel soir ?", options: [{ label: "x", at: slots[0] }, { label: "y", at: inDays(-2) }] })).json().error).toBe("Un créneau est déjà passé.");
    const v0 = (await s.create(lead, { kind: "dates", question: "Quel soir pour Onyxia ?", options: slots.map((at, i) => ({ label: `c${i}`, at })), raidName: "Onyxia", anonymous: true })).json().view as View;
    // Rangés du plus tôt au plus tard ; jamais anonyme ; fin au premier créneau
    expect(v0.options.map(o => o.at)).toEqual([slots[1], slots[2], slots[0]]);
    expect(v0).toMatchObject({ kind: "dates", anonymous: false, multi: true, closesAt: slots[1], raidName: "Onyxia" });
    expect((await vote(v0.id, ana, 1)).json().error).toBe("C'est un sondage de disponibilités : réponds créneau par créneau.");

    expect((await dates(v0.id, ana, { yes: [1, 2] })).json()).toMatchObject({ vote: { yes: [1, 2], maybe: [] }, name: "Kaelys", role: "Heal" });
    // « Je viens » l'emporte sur « Si besoin »
    expect((await dates(v0.id, ana, { maybe: [2, 3] })).json().vote).toEqual({ yes: [1, 2], maybe: [3] });
    expect((await dates(v0.id, bob, { yes: [2] })).json()).toMatchObject({ role: "Tank" });
    await dates(v0.id, cid, { maybe: [1] });
    // « Non » partout reste une réponse
    const guest = nextId();
    await dates(v0.id, guest, { yes: [] }, "Passant");
    const v = await view(v0.id);
    expect(v.voters).toBe(4);
    expect(v.options.map(o => [o.yes, o.maybe, o.no])).toEqual([[1, 1, 2], [2, 0, 2], [0, 1, 3]]);
    expect(v.best).toBe(2);
    expect(v.options[1]!.roles).toEqual({ Tank: 1, Heal: 1, DPS: 0 });
    const who = (await bot("GET", `/internal/discord/polls/${v0.id}/voters`)).json();
    expect(who.none).toEqual([{ name: "Passant", role: null, guest: true }]);

    // Raid : droits des raids (officiers par défaut)
    const raid = (by: string) => bot("POST", `/internal/discord/polls/${v0.id}/raid`, { discordUserId: by, name: "Onyxia", scheduledAt: slots[2] });
    expect((await raid(ana)).json().error).toBe("Seuls les officiers de la guilde peuvent créer un raid.");
    const r = (await raid(lead)).json();
    expect(r).toMatchObject({ raid: { name: "Onyxia", scheduledAt: slots[2] }, hasChannel: true, view: { raid: { name: "Onyxia" } } });
    expect(r.view.closedAt).not.toBeNull();
    expect(r.announcement).toMatchObject({ raid: { name: "Onyxia" }, channelId: s.channelId });
    expect((await raid(lead)).json().error).toBe("Le raid de ce sondage est déjà créé.");
    const list = (await s.gm.c.get(`/api/groups/${s.g.id}/raids`)).json().raids as { name: string; scheduledAt: string }[];
    expect(list).toEqual([expect.objectContaining({ name: "Onyxia", scheduledAt: slots[2] })]);
  });
});

describe("ménage", () => {
  it("sans fin : clos au bout de 30 jours ; clos depuis 90 jours : effacé", async () => {
    const s = await scene("Menage", []);
    const v0 = (await s.create(s.lead.discordId, { kind: "choice", question: "Vieux ?", options: [{ label: "A" }, { label: "B" }] })).json().view as View;
    expect(v0.closesAt).toBeNull();
    await db().update(polls).set({ createdAt: new Date(Date.now() - 31 * 86400e3) }).where(eq(polls.id, v0.id));
    expect((await outbox()).find(p => p.id === v0.id)?.closedAt).not.toBeNull();
    await bot("POST", `/internal/discord/polls/${v0.id}/published`, { channelId: s.channelId, messageId: "900000000000000555", changedAt: new Date().toISOString() });
    await db().update(polls).set({ closedAt: new Date(Date.now() - 91 * 86400e3) }).where(eq(polls.id, v0.id));
    await outbox();
    expect((await bot("GET", `/internal/discord/polls/${v0.id}/view`)).statusCode).toBe(404);
    // Son message Discord part avec lui
    const deletions = (await bot("GET", "/internal/discord/outbox")).json().deletions as { messageId: string }[];
    expect(deletions.map(x => x.messageId)).toContain("900000000000000555");
  });
});

describe("sur le site", () => {
  it("liste, création (aussi sur Discord ou non), vote, disponibilités, qui a répondu, clore, effacer, raid ; pastille", async () => {
    const s = await scene("Site", [["Ana", "Kaelys", "Priest", "Holy"]]);
    const ana = s.people.Kaelys!;
    const api = (x: Signed) => ({
      list: async () => (await x.c.get(`/api/groups/${s.g.id}/polls`)).json() as { polls: (View & { mine: { yes: number[]; maybe: number[] } | null; canClose: boolean; canDelete: boolean; canRaid: boolean })[]; canCreate: boolean; discord: { channel: string | null } | null; me: { name: string; role: string | null } },
      badge: async () => (await x.c.get(`/api/groups/${s.g.id}`)).json().group.polls as { open: number; toAnswer: number },
    });
    const empty = await api(ana.s).list();
    expect(empty).toMatchObject({ polls: [], canCreate: false, discord: { channel: null }, me: { name: "Kaelys", role: "Heal" } });
    // Un membre ne pose pas de sondage (officiers par défaut)
    expect((await ana.s.c.post(`/api/groups/${s.g.id}/polls`, { kind: "choice", question: "Q ?", options: [{ label: "A" }, { label: "B" }] })).statusCode).toBe(403);
    const c = await s.gm.c.post(`/api/groups/${s.g.id}/polls`, { kind: "choice", question: "Quel donjon ?", options: [{ label: "Scholomance" }, { label: "Stratholme" }], anonymous: false });
    expect(c.statusCode).toBe(201);
    const choice = c.json().poll as View & { canClose: boolean };
    expect(choice).toMatchObject({ channelId: s.channelId, canClose: true });
    // Site seulement : pas dans la relève du bot
    const d = await s.gm.c.post(`/api/groups/${s.g.id}/polls`, { kind: "dates", question: "Quel soir ?", options: [{ label: "", at: inDays(3) }, { label: "", at: inDays(4) }], discord: false, raidName: "Onyxia" });
    const dates = d.json().poll as View;
    expect(dates.channelId).toBeNull();
    expect((await outbox()).map(p => p.id)).not.toContain(dates.id);
    expect(await api(ana.s).badge()).toEqual({ open: 2, toAnswer: 2 });

    // Vote du site = vote de Discord (même compte)
    expect((await ana.s.c.put(`/api/groups/${s.g.id}/polls/${choice.id}/vote`, { yes: [1, 2] })).json().error).toBe("Un seul choix pour ce sondage.");
    expect((await ana.s.c.put(`/api/groups/${s.g.id}/polls/${choice.id}/vote`, { yes: [2] })).json()).toEqual({ mine: { yes: [2], maybe: [] } });
    expect((await bot("GET", `/internal/discord/polls/${choice.id}/mine?discordUserId=${ana.discordId}&discordName=x`)).json().vote).toEqual({ yes: [2], maybe: [] });
    expect((await ana.s.c.put(`/api/groups/${s.g.id}/polls/${dates.id}/dates`, { yes: [2], maybe: [1, 2] })).json()).toEqual({ mine: { yes: [2], maybe: [1] } });
    expect(await api(ana.s).badge()).toEqual({ open: 2, toAnswer: 0 });
    const mine = (await api(ana.s).list()).polls;
    expect(mine.find(p => p.id === choice.id)).toMatchObject({ mine: { yes: [2], maybe: [] }, canClose: false, canDelete: false, canRaid: false });
    expect(mine.find(p => p.id === dates.id)).toMatchObject({ mine: { yes: [2], maybe: [1] }, best: 2 });
    expect((await ana.s.c.get(`/api/groups/${s.g.id}/polls/${choice.id}/voters`)).json().options[1].yes).toEqual([{ name: "Kaelys", role: "Heal", guest: false }]);

    // Clore et effacer : créateur ou officier
    expect((await ana.s.c.post(`/api/groups/${s.g.id}/polls/${choice.id}/close`, {})).statusCode).toBe(403);
    expect((await s.gm.c.post(`/api/groups/${s.g.id}/polls/${choice.id}/close`, {})).json()).toEqual({ already: false });
    expect((await ana.s.c.del(`/api/groups/${s.g.id}/polls/${choice.id}`)).statusCode).toBe(403);
    // Effacé : son message Discord part dans les messages à retirer
    await bot("POST", `/internal/discord/polls/${choice.id}/published`, { channelId: s.channelId, messageId: "900000000000000777", changedAt: new Date().toISOString() });
    expect((await s.gm.c.del(`/api/groups/${s.g.id}/polls/${choice.id}`)).json()).toEqual({ ok: true });
    const deletions = (await bot("GET", "/internal/discord/outbox")).json().deletions as { messageId: string }[];
    expect(deletions.map(x => x.messageId)).toContain("900000000000000777");

    // Raid depuis le site, sur le créneau choisi ; un autre groupe ne voit rien
    const r = await s.gm.c.post(`/api/groups/${s.g.id}/polls/${dates.id}/raid`, { name: "Onyxia", scheduledAt: dates.options[1]!.at });
    expect(r.json()).toMatchObject({ raid: { name: "Onyxia", scheduledAt: dates.options[1]!.at }, hasChannel: true });
    expect((await api(s.gm).list()).polls).toEqual([expect.objectContaining({ id: dates.id, raid: expect.objectContaining({ name: "Onyxia" }), canRaid: false })]);
    const other = await signedIn(env, "SiteAutre");
    expect((await other.c.get(`/api/groups/${s.g.id}/polls`)).statusCode).toBe(404);
  });
});
