import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvents, discordDeletions, polls, pollVotes, users } from "../src/db/schema";
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
    expect((await q(Array.from({ length: 101 }, (_, i) => `Choix ${i}`))).json().error).toBe("100 choix au plus.");
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

type BigView = View & { multi: boolean; maxChoices: number | null; qualifiers: number[]; runoffId: string | null; anonymous: boolean; results: string; question: string };
const deleted = async () => (await db().select({ messageId: discordDeletions.messageId }).from(discordDeletions)).map(d => d.messageId);

describe("grand sondage", () => {
  it("jusqu'à 100 choix par ordre alphabétique, au plus N par personne, menus de Discord, classement, 2e tour", async () => {
    const s = await scene("Grands", [["Ana", "Kaelys", "Priest", "Holy"], ["Bob", "Torvald", "Warrior", "Protection"]]);
    const ana = s.people.Kaelys!.discordId, bob = s.people.Torvald!.discordId, lead = s.lead.discordId;
    const names = ["Zèle", "Écho", "Aube", "Milk me John", "Bastion", "Les Sans-Nom", "Cendre", "Dague", "Forge", "Givre", "Hydre", "Iris", "Jade"];
    const big = (extra: object) => s.create(lead, { kind: "choice", question: "Nom de guilde · 1er tour", options: names.map(label => ({ label })), anonymous: true, results: "end", ...extra });
    expect((await big({ maxChoices: 13 })).json().error).toBe("Le nombre de choix par personne va de 2 à 12.");
    const v0 = (await big({ maxChoices: 3 })).json().view as BigView;
    // « Au plus 3 » vaut « plusieurs » ; plus de 10 choix : par ordre alphabétique (accents compris)
    expect(v0).toMatchObject({ multi: true, maxChoices: 3, hidden: true, qualifiers: [], runoffId: null });
    expect(v0.options.map(o => o.label)).toEqual(["Aube", "Bastion", "Cendre", "Dague", "Écho", "Forge", "Givre", "Hydre", "Iris", "Jade", "Les Sans-Nom", "Milk me John", "Zèle"]);

    // Menus de « Voter » : chacun remplace ses propres choix, les autres menus gardent les leurs
    const pick = (who: string, scope: number[], yes: number[], id = v0.id) =>
      bot("PUT", `/internal/discord/polls/${id}/choices`, { discordUserId: who, discordName: "Pseudo", scope, yes });
    const first = [1, 2, 3, 4, 5, 6, 7], second = [8, 9, 10, 11, 12, 13];
    expect((await pick(ana, first, [1, 5])).json().vote).toEqual({ yes: [1, 5] });
    expect((await pick(ana, second, [12])).json().vote).toEqual({ yes: [1, 5, 12] });
    expect((await pick(ana, second, [12, 13])).json().error).toBe("3 choix au plus : retires-en un.");
    expect((await pick(ana, first, [5])).json().vote).toEqual({ yes: [5, 12] });
    expect((await pick(ana, [99], [99])).json().error).toBe("Ce choix n'existe pas.");
    // Bouton (vote à un clic) : la même limite
    await pick(bob, first, [1, 2, 5]);
    expect((await vote(v0.id, bob, 9)).json().error).toBe("3 choix au plus : retires-en un.");
    await pick(lead, first, [1, 3, 5]);
    const guest1 = nextId(), guest2 = nextId();
    expect((await pick(guest1, second, [12], v0.id)).json()).toMatchObject({ vote: { yes: [12] }, guest: true });
    await pick(guest2, first, [4]);
    // Site : la même limite
    expect((await s.people.Kaelys!.s.c.put(`/api/groups/${s.g.id}/polls/${v0.id}/vote`, { yes: [1, 2, 3, 4] })).json().error).toBe("3 choix au plus : retires-en un.");

    // Pas de 2e tour avant la fin
    const r2 = (who: string, body: object = {}) => bot("POST", `/internal/discord/polls/${v0.id}/runoff`, { discordUserId: who, ...body });
    expect((await r2(lead)).json().error).toBe("Clos d'abord le 1er tour.");
    await bot("POST", `/internal/discord/polls/${v0.id}/close`, { discordUserId: lead });
    // Classement : Écho 3 ; Aube 2, Milk me John 2 ; Bastion, Cendre, Dague 1 (ex æquo du 5e : qualifié aussi)
    const closed = await view(v0.id) as BigView;
    expect(closed.hidden).toBe(false);
    expect(closed.qualifiers).toEqual([5, 1, 12, 2, 3, 4]);
    expect(closed.options.find(o => o.id === 5)?.yes).toBe(3);
    // Le 2e tour : créateur ou officier, une seule fois
    expect((await r2(ana)).json().error).toBe("Seuls son créateur et les officiers peuvent poser le 2e tour.");
    const r = (await r2(lead)).json() as { view: BigView; first: BigView };
    expect(r.view).toMatchObject({ question: "Nom de guilde · 2e tour", multi: false, maxChoices: null, anonymous: true, results: "end", channelId: s.channelId });
    expect(r.view.options.map(o => o.label)).toEqual(["Écho", "Aube", "Milk me John", "Bastion", "Cendre", "Dague"]);
    expect(r.first.runoffId).toBe(r.view.id);
    expect((await r2(lead)).json().error).toBe("Le 2e tour de ce sondage est déjà posé.");
    // Un seul choix : le dernier coché l'emporte, quel que soit le menu
    expect((await pick(ana, [1, 2, 3], [2], r.view.id)).json().vote).toEqual({ yes: [2] });
    expect((await pick(ana, [4, 5, 6], [5], r.view.id)).json().vote).toEqual({ yes: [5] });
    expect((await pick(ana, [4, 5, 6], [], r.view.id)).json().vote).toEqual({ yes: [] });
    // Petit sondage : pas de 2e tour
    const small = (await s.create(lead, { kind: "choice", question: "Petit ?", options: [{ label: "A" }, { label: "B" }] })).json().view as View;
    await bot("POST", `/internal/discord/polls/${small.id}/close`, { discordUserId: lead });
    expect((await bot("POST", `/internal/discord/polls/${small.id}/runoff`, { discordUserId: lead })).json().error).toBe("Le 2e tour est pour les sondages de plus de 10 choix.");
  });

  it("sur le site : liste collée, 2e tour (canRunoff)", async () => {
    const s = await scene("GrandSite", [["Ana", "Kaelys", "Priest", "Holy"]]);
    const ana = s.people.Kaelys!;
    const labels = Array.from({ length: 12 }, (_, i) => ({ label: `Nom ${String.fromCharCode(76 - i)}` }));
    const c = await s.gm.c.post(`/api/groups/${s.g.id}/polls`, { kind: "choice", question: "Nom ?", options: labels, multi: true, maxChoices: 2, results: "end" });
    expect(c.statusCode).toBe(201);
    const p = c.json().poll as BigView & { canRunoff: boolean };
    expect(p.options[0]!.label).toBe("Nom A");
    expect(p).toMatchObject({ maxChoices: 2, canRunoff: false });
    expect((await ana.s.c.put(`/api/groups/${s.g.id}/polls/${p.id}/vote`, { yes: [1, 2] })).json()).toEqual({ mine: { yes: [1, 2], maybe: [] } });
    await s.gm.c.put(`/api/groups/${s.g.id}/polls/${p.id}/vote`, { yes: [2, 3] });
    await s.gm.c.post(`/api/groups/${s.g.id}/polls/${p.id}/close`, {});
    const list = async (x: Signed) => (await x.c.get(`/api/groups/${s.g.id}/polls`)).json().polls as (BigView & { canRunoff: boolean })[];
    expect((await list(s.gm)).find(x => x.id === p.id)).toMatchObject({ canRunoff: true, qualifiers: [2, 1, 3] });
    expect((await list(ana.s)).find(x => x.id === p.id)?.canRunoff).toBe(false);
    expect((await ana.s.c.post(`/api/groups/${s.g.id}/polls/${p.id}/runoff`, {})).statusCode).toBe(403);
    const r = await s.gm.c.post(`/api/groups/${s.g.id}/polls/${p.id}/runoff`, { question: "Nom : la finale", closesAt: inDays(1) });
    expect(r.statusCode).toBe(201);
    expect(r.json().poll).toMatchObject({ question: "Nom : la finale", multi: false });
    expect((r.json().poll as View).options.map(o => o.label)).toEqual(["Nom B", "Nom A", "Nom C"]);
    expect((await list(s.gm)).find(x => x.id === p.id)).toMatchObject({ canRunoff: false, runoffId: r.json().poll.id });
  });
});

describe("salon des sondages", () => {
  it("lié par code : tous les sondages y vont, ceux en cours y sont déplacés ; refus ; délié : retour au salon des raids", async () => {
    const s = await scene("Salons", [["Ana", "Kaelys", "Priest", "Holy"]]);
    const lead = s.lead.discordId;
    const ask = (question: string, channelId = s.channelId) =>
      bot("POST", "/internal/discord/polls", { guildId: s.guildId, channelId, discordUserId: lead, kind: "choice", question, options: [{ label: "A" }, { label: "B" }] });
    const published = (v: View, channelId: string, messageId: string) =>
      bot("POST", `/internal/discord/polls/${v.id}/published`, { channelId, messageId, changedAt: v.changedAt });
    // Un sondage ouvert et un sondage clos, déjà posés dans le salon des raids
    const open = (await ask("Ouvert ?")).json().view as View;
    await published(open, s.channelId, "900000000000001001");
    const done = (await ask("Clos ?")).json().view as View;
    await published(done, s.channelId, "900000000000001002");
    await bot("POST", `/internal/discord/polls/${done.id}/close`, { discordUserId: lead });

    // Code : officiers seulement ; refusés : le salon des raids
    expect((await s.people.Kaelys!.s.c.post(`/api/groups/${s.g.id}/discord/polls-code`)).statusCode).toBe(403);
    const code = async () => (await s.gm.c.post(`/api/groups/${s.g.id}/discord/polls-code`)).json().code as string;
    const bind = async (channelId: string, by = lead) =>
      bot("POST", "/internal/discord/bind", { code: await code(), guildId: s.guildId, channelId, discordUserId: by, channelName: "sondages" });
    expect((await bind(s.channelId)).json().error).toContain("Ce salon est déjà celui des raids de la guilde");
    expect((await bind(nextId(), s.people.Kaelys!.discordId)).json().error).toBe("Réservé aux officiers de la guilde.");
    const pollsChannel = nextId();
    expect((await bind(pollsChannel)).json()).toMatchObject({ kind: "polls", group: { id: s.g.id } });
    expect((await s.gm.c.get(`/api/groups/${s.g.id}`)).json().group).toMatchObject({ pollsLinked: true, pollsChannelName: "sondages" });

    // Le sondage ouvert part dans le salon des sondages (ancien message effacé) ; le clos reste où il est
    expect(await view(open.id)).toMatchObject({ channelId: pollsChannel, messageId: null });
    expect((await outbox()).map(p => p.id)).toContain(open.id);
    expect(await view(done.id)).toMatchObject({ channelId: s.channelId, messageId: "900000000000001002" });
    expect(await deleted()).toContain("900000000000001001");
    expect(await deleted()).not.toContain("900000000000001002");

    // /sondage tapé ailleurs (salon des raids) ou dans le salon des sondages : posé dans le salon des sondages
    const next = (await ask("Ailleurs ?")).json().view as View;
    expect(next.channelId).toBe(pollsChannel);
    expect((await ask("Ici ?", pollsChannel)).json().view.channelId).toBe(pollsChannel);
    // Site : « aussi sur Discord » vise ce salon
    expect((await s.gm.c.get(`/api/groups/${s.g.id}/polls`)).json().discord).toEqual({ channel: "sondages", polls: true });
    const site = (await s.gm.c.post(`/api/groups/${s.g.id}/polls`, { kind: "choice", question: "Site ?", options: [{ label: "A" }, { label: "B" }] })).json().poll as View;
    expect(site.channelId).toBe(pollsChannel);

    // Nom du salon : rapporté par le bot
    const linked = (await bot("GET", "/internal/discord/linked-channels")).json() as object[];
    expect(linked).toContainEqual({ kind: "polls", id: s.g.id, guildId: s.guildId, channelId: pollsChannel, name: "sondages" });
    expect((await bot("POST", "/internal/discord/channel-name", { kind: "polls", id: s.g.id, channelId: pollsChannel, name: "votes" })).json()).toEqual({ ok: true, changed: true });
    expect((await s.gm.c.get(`/api/groups/${s.g.id}`)).json().group.pollsChannelName).toBe("votes");

    // Les autres liaisons refusent ce salon ; une autre guilde ne peut pas le prendre pour ses sondages
    const oc = (await s.gm.c.post(`/api/groups/${s.g.id}/discord/orders-code`)).json().code;
    expect((await bot("POST", "/internal/discord/bind", { code: oc, guildId: s.guildId, channelId: pollsChannel, discordUserId: lead })).json().error)
      .toBe("Ce salon est déjà celui des sondages : choisis un autre salon pour les commandes.");
    const other = await scene("Voisins", []);
    const c2 = (await other.gm.c.post(`/api/groups/${other.g.id}/discord/polls-code`)).json().code;
    expect((await bot("POST", "/internal/discord/bind", { code: c2, guildId: s.guildId, channelId: pollsChannel, discordUserId: other.lead.discordId })).json().error)
      .toBe("Ce salon sert déjà à une autre guilde : choisis un autre salon pour les sondages.");

    // Délié : les sondages ouverts reviennent dans le salon des raids
    await published(next, pollsChannel, "900000000000001003");
    expect((await s.people.Kaelys!.s.c.del(`/api/groups/${s.g.id}/discord/polls`)).statusCode).toBe(403);
    expect((await s.gm.c.del(`/api/groups/${s.g.id}/discord/polls`)).json()).toEqual({ ok: true });
    expect(await view(next.id)).toMatchObject({ channelId: s.channelId, messageId: null });
    expect(await deleted()).toContain("900000000000001003");
    expect((await s.gm.c.get(`/api/groups/${s.g.id}`)).json().group).toMatchObject({ pollsLinked: false, pollsChannelName: null });
    expect((await s.gm.c.get(`/api/groups/${s.g.id}/polls`)).json().discord).toEqual({ channel: null, polls: false });
    const types = (await db().select({ type: auditEvents.type }).from(auditEvents).where(eq(auditEvents.groupId, s.g.id))).map(e => e.type);
    expect(types).toEqual(expect.arrayContaining(["group_polls_linked", "group_polls_unlinked"]));
  });
});
