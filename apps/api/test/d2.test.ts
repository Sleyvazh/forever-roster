import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { groups, raids, users } from "../src/db/schema";
import { buildInternalApp } from "../src/internal";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
let internal: FastifyInstance;
const SECRET = "secret-interne-de-test-assez-long-0123456789";
beforeAll(async () => { env = await setup(); internal = await buildInternalApp(env.app.ctx); await internal.ready(); });
afterAll(async () => { await internal.close(); await env.close(); });

const bot = (method: string, url: string, payload?: object) =>
  internal.inject({ method: method as "GET", url, headers: { authorization: `Bearer ${SECRET}` }, ...(payload ? { payload } : {}) });
const inHours = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
let snow = 700000000000000000n;
const discordOf = async (userId: string, reminders = true) => {
  const id = String(++snow);
  await env.app.ctx.db.update(users).set({ discordId: id, discordReminders: reminders }).where(eq(users.id, userId));
  return id;
};

/** Groupe lié à Discord : un officier, trois membres (Discord lié, MP coupés, sans Discord). */
async function scene(name: string) {
  const gm = { ...(await signedIn(env, `${name}Chef`)), name: `${name}Chef` };
  const g = (await gm.c.post("/api/groups", { name })).json().group;
  const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 5, expiresInHours: 24 })).json().invite;
  const join = async (n: string) => { const p = await signedIn(env, n); await p.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) }); return { ...p, name: n }; };
  const a = await join(`${name}Ana`), b = await join(`${name}Bob`), c = await join(`${name}Cid`);
  await env.app.ctx.db.update(groups).set({ discordGuildId: "100000000000000001", discordChannelId: "100000000000000002" }).where(eq(groups.id, g.id));
  const ids = { gm: await discordOf(gm.user.id), a: await discordOf(a.user.id), b: await discordOf(b.user.id, false) };
  return { gm, g, a, b, c, ids };
}

describe("relance des sans-réponse (lot D2)", () => {
  it("réglage du groupe, relance automatique une fois, liste aux officiers", async () => {
    const { gm, g, a, b, c, ids } = await scene("Lanternes");
    expect((await gm.c.get(`/api/groups/${g.id}/nudge-settings`)).json().settings).toEqual({ hours: 48, officers: true });
    expect((await a.c.put(`/api/groups/${g.id}/nudge-settings`, { hours: 24 })).statusCode).toBe(403);
    expect((await gm.c.put(`/api/groups/${g.id}/nudge-settings`, { hours: 12 })).statusCode).toBe(400);

    const raid = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "Molten Core", scheduledAt: inHours(30) })).json().raid;
    await a.c.put(`/api/groups/${g.id}/raids/${raid.id}/signup`, { status: "absent" });
    const mine = async () => (await bot("POST", "/internal/discord/nudges/claim")).json().nudges.filter((n: { view: { raid: { id: string } } }) => n.view.raid.id === raid.id);

    // Raid créé à l'instant : pas de relance (délai de grâce)
    expect(await mine()).toEqual([]);
    await env.app.ctx.db.update(raids).set({ createdAt: new Date(Date.now() - 3 * 3600e3) }).where(eq(raids.id, raid.id));
    const [n] = await mine();
    // Ana a répondu (absente) ; le chef et Bob/Cid non. Bob a coupé les MP du bot, Cid n'a pas Discord.
    expect(n.auto).toBe(true);
    expect(n.recipients.map((r: { discordUserId: string }) => r.discordUserId)).toEqual([ids.gm]);
    expect(n.unreachable).toEqual(expect.arrayContaining([{ name: b.name, why: "dm-off" }, { name: c.name, why: "no-discord" }]));
    expect(n.officers).toEqual([ids.gm]);
    expect(n.view.raid.size).toBe(40);
    // Une seule relance automatique
    expect(await mine()).toEqual([]);

    // Vue officiers : la liste et l'état
    const reach = (await gm.c.get(`/api/groups/${g.id}/raids/${raid.id}/reach`)).json();
    expect(reach.pending.map((p: { displayName: string; dm: boolean }) => `${p.displayName}:${p.dm}`).sort())
      .toEqual([`${b.name}:false`, `${c.name}:false`, `${gm.name}:true`].sort());
    expect(reach.auto.sentAt).toBeTruthy();
    expect((await a.c.get(`/api/groups/${g.id}/raids/${raid.id}/reach`)).statusCode).toBe(403);
  });

  it("relance à la main : une par heure, sans prévenir les officiers ; désactivée = pas d'automatique", async () => {
    const { gm, g } = await scene("Braises");
    await gm.c.put(`/api/groups/${g.id}/nudge-settings`, { hours: null });
    const raid = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "Onyxia", scheduledAt: inHours(20) })).json().raid;
    await env.app.ctx.db.update(raids).set({ createdAt: new Date(Date.now() - 3 * 3600e3) }).where(eq(raids.id, raid.id));
    const mine = async () => (await bot("POST", "/internal/discord/nudges/claim")).json().nudges.filter((n: { view: { raid: { id: string } } }) => n.view.raid.id === raid.id);
    expect(await mine()).toEqual([]);

    const r1 = await gm.c.post(`/api/groups/${g.id}/raids/${raid.id}/nudge`);
    expect(r1.json().count).toBe(2);
    expect((await gm.c.post(`/api/groups/${g.id}/raids/${raid.id}/nudge`)).statusCode).toBe(429);
    const [n] = await mine();
    expect(n).toMatchObject({ auto: false, officers: [] });
    expect(await mine()).toEqual([]);
  });
});

describe("« Demander à X » (lot D2)", () => {
  it("l'officier demande, le bot envoie, le joueur répond Oui : inscrit avec ce perso", async () => {
    const { gm, g, a, b, ids } = await scene("Cendres");
    const main = (await a.c.post("/api/characters", { name: "Givra", race: "Undead", cls: "Mage", spec1: "Frost" })).json().character;
    const alt = (await a.c.post("/api/characters", { name: "Pansou", race: "Tauren", cls: "Druid", spec1: "Restoration", spec2: "Feral Bear" })).json().character;
    const bchar = (await b.c.post("/api/characters", { name: "Rempart", race: "Orc", cls: "Warrior", spec1: "Protection" })).json().character;
    for (const [p, ch] of [[a, main], [a, alt], [b, bchar]] as const) await p.c.put(`/api/groups/${g.id}/characters/${ch.id}`, { assigned: true });
    const raid = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "BWL", scheduledAt: inHours(50), size: 20 })).json().raid;
    await a.c.put(`/api/groups/${g.id}/raids/${raid.id}/signup`, { status: "present", characterId: main.id });

    const ask = (body: object) => gm.c.post(`/api/groups/${g.id}/raids/${raid.id}/asks`, body);
    expect((await ask({ characterId: alt.id, spec: "Fury" })).json().error).toMatch(/n'existe pas/);
    expect((await ask({ characterId: bchar.id, spec: "Protection" })).json().error).toMatch(/désactivé/);
    expect((await ask({ characterId: main.id, spec: "Frost" })).json().error).toMatch(/déjà inscrit/);
    expect((await a.c.post(`/api/groups/${g.id}/raids/${raid.id}/asks`, { characterId: alt.id, spec: "Restoration" })).statusCode).toBe(403);
    expect((await ask({ characterId: alt.id, spec: "Restoration" })).statusCode).toBe(201);
    expect((await ask({ characterId: alt.id, spec: "Restoration" })).statusCode).toBe(409);

    const claimed = (await bot("POST", "/internal/discord/asks/claim")).json().asks.filter((x: { raid: { id: string } }) => x.raid.id === raid.id);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ discordUserId: ids.a, character: { name: "Pansou", cls: "Druid" }, spec: "Restoration", role: "Heal",
      askedBy: gm.name, current: { status: "present", characterName: "Givra" } });
    // Déjà réservée : pas renvoyée
    expect((await bot("POST", "/internal/discord/asks/claim")).json().asks.filter((x: { raid: { id: string } }) => x.raid.id === raid.id)).toEqual([]);
    let reach = (await gm.c.get(`/api/groups/${g.id}/raids/${raid.id}/reach`)).json();
    expect(reach.asks).toEqual([expect.objectContaining({ name: "Pansou", state: "sent", role: "Heal" })]);

    // Un autre Discord ne peut pas répondre à sa place
    expect((await bot("POST", `/internal/discord/asks/${claimed[0].id}/answer`, { discordUserId: ids.gm, yes: true })).statusCode).toBe(404);
    const ans = (await bot("POST", `/internal/discord/asks/${claimed[0].id}/answer`, { discordUserId: ids.a, yes: true })).json();
    expect(ans).toMatchObject({ answer: "yes", character: "Pansou", already: false });
    expect(ans.view.raid.id).toBe(raid.id);
    const su = (await gm.c.get(`/api/groups/${g.id}/raids/${raid.id}`)).json().signups.find((s: { userId: string }) => s.userId === a.user.id);
    expect(su).toMatchObject({ characterId: alt.id, spec: "Restoration", status: "present" });
    // Deuxième clic : la réponse ne change pas
    expect((await bot("POST", `/internal/discord/asks/${claimed[0].id}/answer`, { discordUserId: ids.a, yes: false })).json()).toMatchObject({ answer: "yes", already: true });
    reach = (await gm.c.get(`/api/groups/${g.id}/raids/${raid.id}/reach`)).json();
    expect(reach.asks[0].state).toBe("yes");
  });

  it("MP impossible, refus, annulation", async () => {
    const { gm, g, a } = await scene("Givre");
    const ch = (await a.c.post("/api/characters", { name: "Fennec", race: "Orc", cls: "Hunter", spec1: "Marksmanship" })).json().character;
    await a.c.put(`/api/groups/${g.id}/characters/${ch.id}`, { assigned: true });
    const raid = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "ZG", scheduledAt: inHours(10), size: 20 })).json().raid;
    const id = (await gm.c.post(`/api/groups/${g.id}/raids/${raid.id}/asks`, { characterId: ch.id, spec: "Marksmanship" })).json().ask.id;
    await bot("POST", "/internal/discord/asks/claim");
    await bot("POST", `/internal/discord/asks/${id}/failed`);
    expect((await gm.c.get(`/api/groups/${g.id}/raids/${raid.id}/reach`)).json().asks[0].state).toBe("failed");
    // Annulée : le joueur ne peut plus répondre, on peut redemander
    expect((await gm.c.del(`/api/groups/${g.id}/raids/${raid.id}/asks/${id}`)).statusCode).toBe(200);
    const [u] = await env.app.ctx.db.select({ d: users.discordId }).from(users).where(eq(users.id, a.user.id));
    expect((await bot("POST", `/internal/discord/asks/${id}/answer`, { discordUserId: u!.d!, yes: true })).statusCode).toBe(404);
    const id2 = (await gm.c.post(`/api/groups/${g.id}/raids/${raid.id}/asks`, { characterId: ch.id, spec: "Marksmanship" })).json().ask.id;
    await bot("POST", "/internal/discord/asks/claim");
    expect((await bot("POST", `/internal/discord/asks/${id2}/answer`, { discordUserId: u!.d!, yes: false })).json().answer).toBe("no");
    const su = (await gm.c.get(`/api/groups/${g.id}/raids/${raid.id}`)).json().signups;
    expect(su).toEqual([]);
  });
});
