import { zonedParts } from "@forever/game-data";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { characterRecipes, gameItems, gameRecipes, raids, users } from "../src/db/schema";
import { buildInternalApp } from "../src/internal";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
let internal: FastifyInstance;
const SECRET = "secret-interne-de-test-assez-long-0123456789";
beforeAll(async () => {
  env = await setup();
  internal = await buildInternalApp(env.app.ctx); await internal.ready();
  const db = env.app.ctx.db;
  await db.insert(gameItems).values([
    { id: 990001, name: "Flarecore Test", quality: 4, itemLevel: 66, reqLevel: 60, classId: 4, subclassId: 1, inventoryType: 7 },
    { id: 990002, name: "Mooncloth Test", quality: 2, itemLevel: 50, reqLevel: 0, classId: 7, subclassId: 0, inventoryType: 0 },
    { id: 990003, name: "Core Leather Test", quality: 3, itemLevel: 60, reqLevel: 0, classId: 7, subclassId: 0, inventoryType: 0 },
  ]).onConflictDoNothing();
  await db.insert(gameRecipes).values([
    { spellId: 990101, skillLine: 197, name: "Flarecore Test", reqSkill: 300, trivialLow: 300, trivialHigh: 320, createdItemId: 990001, reagents: [{ id: 990002, n: 4 }, { id: 990003, n: 2 }] },
    { spellId: 990102, skillLine: 197, name: "Robe introuvable", reqSkill: 250, trivialLow: 250, trivialHigh: 270 },
  ]).onConflictDoNothing();
});
afterAll(async () => { await internal.close(); await env.close(); });

const bot = (method: string, url: string, payload?: object) =>
  internal.inject({ method: method as "GET", url, headers: { authorization: `Bearer ${SECRET}` }, ...(payload ? { payload } : {}) });
const inDays = (d: number) => new Date(Date.now() + d * 86400e3).toISOString();
const day = (d: number) => { const z = zonedParts(new Date(Date.now() + d * 86400e3)); return `${z.year}-${String(z.month).padStart(2, "0")}-${String(z.day).padStart(2, "0")}`; };
let snow = 910000000000000000n;
const linkDiscord = async (userId: string) => { const id = String(++snow); await env.app.ctx.db.update(users).set({ discordId: id }).where(eq(users.id, userId)); return id; };

async function group(name: string) {
  const gm = await signedIn(env, `${name}Chef`), p = await signedIn(env, `${name}Joueur`);
  const g = (await gm.c.post("/api/groups", { name })).json().group;
  const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 3, expiresInHours: 24 })).json().invite;
  await p.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
  return { gm, p, g, inv };
}

describe("commandes d'artisanat (lot F)", () => {
  it("demander avec composants, prendre, faire ; artisans connus ; droits", async () => {
    const { gm, p, g } = await group("Couture");
    const tailor = (await gm.c.post("/api/characters", { name: "Aiguille", race: "Undead", cls: "Mage", spec1: "Frost",
      professions: { prof1: { name: "Tailoring", skill: 300 }, prof2: { name: "", skill: 0 }, cooking: 0, fishing: 0, firstAid: 0 } })).json().character;
    await env.app.ctx.db.insert(characterRecipes).values({ characterId: tailor.id, spellId: 990101, status: "known" });

    const hits = (await p.c.get(`/api/groups/${g.id}/orders/recipes?q=flarecore`)).json().recipes;
    expect(hits[0]).toMatchObject({ spellId: 990101, itemName: "Flarecore Test", reagents: [{ itemId: 990002, n: 4, name: "Mooncloth Test" }, { itemId: 990003, n: 2 }],
      crafters: [expect.objectContaining({ name: "Aiguille" })] });

    const mine = (await p.c.post("/api/characters", { name: "Porteur", race: "Orc", cls: "Warrior", spec1: "Protection" })).json().character;
    const o = (await p.c.post(`/api/groups/${g.id}/orders`, { spellId: 990101, quantity: 2, characterId: mine.id, note: "Pas pressé", provided: [990003] })).json().order;
    await p.c.post(`/api/groups/${g.id}/orders`, { spellId: 990102 });
    let list = (await gm.c.get(`/api/groups/${g.id}/orders`)).json().orders;
    const mineOrder = list.find((x: { id: string }) => x.id === o.id);
    expect(mineOrder).toMatchObject({ status: "open", quantity: 2, character: "Porteur", canCraft: true, item: { name: "Flarecore Test", quality: 4 }, note: "Pas pressé",
      reagents: [{ itemId: 990002, n: 8, provided: false }, { itemId: 990003, n: 4, provided: true }] });
    expect(list.find((x: { recipeName: string }) => x.recipeName === "Robe introuvable").crafters).toEqual([]);

    // Composants cochés par le demandeur ; un autre membre ne peut pas
    expect((await p.c.patch(`/api/groups/${g.id}/orders/${o.id}`, { action: "reagents", provided: [990002, 990003] })).statusCode).toBe(200);
    const other = await signedIn(env, "Curieux");
    expect((await other.c.patch(`/api/groups/${g.id}/orders/${o.id}`, { action: "take" })).statusCode).toBe(404);
    expect((await gm.c.patch(`/api/groups/${g.id}/orders/${o.id}`, { action: "take" })).statusCode).toBe(200);
    expect((await p.c.patch(`/api/groups/${g.id}/orders/${o.id}`, { action: "take" })).json().error).toMatch(/déjà/);
    expect((await gm.c.patch(`/api/groups/${g.id}/orders/${o.id}`, { action: "done" })).statusCode).toBe(200);
    list = (await p.c.get(`/api/groups/${g.id}/orders`)).json().orders;
    expect(list.find((x: { id: string }) => x.id === o.id)).toMatchObject({ status: "done", taker: { name: "CoutureChef" }, reagents: [{ provided: true }, { provided: true }] });
    expect((await p.c.del(`/api/groups/${g.id}/orders/${o.id}`)).statusCode).toBe(200);
    expect((await p.c.post(`/api/groups/${g.id}/orders`, { spellId: 123 })).json().error).toMatch(/inconnue/);
  });

  it("salon Discord des commandes : liaison par code, publication, « Je m'en charge »", async () => {
    const { gm, p, g } = await group("Forge");
    const gmDiscord = await linkDiscord(gm.user.id), pDiscord = await linkDiscord(p.user.id);
    const { code } = (await gm.c.post(`/api/groups/${g.id}/discord/orders-code`)).json();
    expect((await p.c.post(`/api/groups/${g.id}/discord/orders-code`)).statusCode).toBe(403);
    const bind = (await bot("POST", "/internal/discord/bind", { code, guildId: "300000000000000001", channelId: "300000000000000002", discordUserId: gmDiscord })).json();
    expect(bind).toMatchObject({ kind: "orders", group: { name: "Forge" } });
    expect((await gm.c.get(`/api/groups/${g.id}`)).json().group).toMatchObject({ ordersLinked: true, discordLinked: false });

    const o = (await p.c.post(`/api/groups/${g.id}/orders`, { spellId: 990101 })).json().order;
    const outbox = (await bot("GET", "/internal/discord/orders/outbox")).json().orders.filter((x: { id: string }) => x.id === o.id);
    expect(outbox[0]).toMatchObject({ channelId: "300000000000000002", messageId: null, status: "open", requester: "ForgeJoueur", item: { name: "Flarecore Test" },
      reagents: [{ name: "Mooncloth Test", n: 4, provided: false }, { name: "Core Leather Test", n: 2, provided: false }] });
    await bot("POST", `/internal/discord/orders/${o.id}/published`, { channelId: "300000000000000002", messageId: "300000000000000003", changedAt: outbox[0].changedAt });
    expect((await bot("GET", "/internal/discord/orders/outbox")).json().orders.filter((x: { id: string }) => x.id === o.id)).toEqual([]);

    // Le demandeur ne prend pas sa propre commande ; l'officier oui, et le message est à republier
    expect((await bot("POST", `/internal/discord/orders/${o.id}/take`, { discordUserId: pDiscord })).json().error).toMatch(/propre commande/);
    const taken = (await bot("POST", `/internal/discord/orders/${o.id}/take`, { discordUserId: gmDiscord })).json();
    expect(taken.view).toMatchObject({ status: "taken", taker: "ForgeChef", messageId: "300000000000000003" });
    expect((await bot("GET", "/internal/discord/orders/outbox")).json().orders.filter((x: { id: string }) => x.id === o.id)).toHaveLength(1);
    // Délier : le message sera supprimé par le bot
    await gm.c.del(`/api/groups/${g.id}/discord/orders`);
    const del = (await bot("GET", "/internal/discord/outbox")).json().deletions;
    expect(del).toEqual(expect.arrayContaining([expect.objectContaining({ messageId: "300000000000000003" })]));
  });
});

describe("absences déclarées (lot F)", () => {
  it("période : raids sans réponse en Absent, réponse donnée gardée, nouveaux raids, retrait propre", async () => {
    const { gm, p, g } = await group("Vacances");
    const war = (await p.c.post("/api/characters", { name: "Bouclier", race: "Orc", cls: "Warrior", spec1: "Protection" })).json().character;
    const mk = async (name: string, d: number) => (await gm.c.post(`/api/groups/${g.id}/raids`, { name, scheduledAt: inDays(d) })).json().raid;
    const r1 = await mk("Déjà répondu", 3), r0 = await mk("Sans réponse", 2), r2 = await mk("Après", 12);
    await p.c.put(`/api/groups/${g.id}/raids/${r1.id}/signup`, { status: "present", characterId: war.id });

    expect((await p.c.post("/api/absences", { startDate: day(2), endDate: day(1) })).json().error).toMatch(/avant son début/);
    expect((await p.c.post("/api/absences", { reason: "rien" })).json().error).toMatch(/période|jours/);
    const a = (await p.c.post("/api/absences", { startDate: day(1), endDate: day(6), reason: "Vacances", reasonVisibility: "officers" })).json();
    expect(a.raids).toBe(1);
    const status = async (raidId: string) => (await gm.c.get(`/api/groups/${g.id}/raids/${raidId}`)).json().signups.find((s: { userId: string }) => s.userId === p.user.id);
    expect(await status(r0.id)).toMatchObject({ status: "absent", note: "Absence déclarée" });
    expect(await status(r1.id)).toMatchObject({ status: "present" }); // une réponse donnée n'est pas remplacée
    expect(await status(r2.id)).toBeUndefined();

    const r3 = await mk("Ajouté", 4);
    expect(await status(r3.id)).toMatchObject({ status: "absent" });
    await gm.c.put(`/api/groups/${g.id}/raids/${r2.id}`, { name: "Après", scheduledAt: inDays(5), slots: [] });
    expect(await status(r2.id)).toMatchObject({ status: "absent" });

    // Motif : visible des officiers seulement (choix du joueur)
    const sheet = (who: typeof gm) => who.c.get(`/api/groups/${g.id}/members/${p.user.id}/sheet`).then(r => r.json().absences);
    expect(await sheet(gm)).toEqual([{ startDate: day(1), endDate: day(6), weekdays: [], reason: "Vacances" }]);
    const third = await signedIn(env, "Voisin");
    const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 1, expiresInHours: 24 })).json().invite;
    await third.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    expect((await sheet(third))[0].reason).toBe("");

    expect((await p.c.del(`/api/absences/${a.absence.id}`)).json().raids).toBe(3);
    expect(await status(r3.id)).toBeUndefined();
    expect(await status(r1.id)).toMatchObject({ status: "present" });
    expect((await p.c.get("/api/absences")).json().absences).toEqual([]);
    // Un raid passé n'est jamais touché
    await env.app.ctx.db.update(raids).set({ scheduledAt: new Date(Date.now() - 86400e3) }).where(eq(raids.id, r0.id));
    await p.c.post("/api/absences", { startDate: day(0), endDate: day(2) });
    expect(await status(r0.id)).toBeUndefined();
  });

  it("chaque semaine : jours de la semaine, motif visible de tout le groupe, groupe rejoint ensuite", async () => {
    const { gm, g, inv } = await group("Hebdo");
    const at = new Date(Date.now() + 3 * 86400e3);
    const wd = zonedParts(at).weekday;
    const raid = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "MC", scheduledAt: at.toISOString() })).json().raid;
    const other = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "BWL", scheduledAt: new Date(at.getTime() + 86400e3).toISOString() })).json().raid;
    const late = await signedIn(env, "Retardataire");
    const a = (await late.c.post("/api/absences", { weekdays: [wd], reason: "Travail le soir", reasonVisibility: "group" })).json();
    expect(a.absence).toMatchObject({ weekdays: [wd], startDate: null });
    await late.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    const su = async (raidId: string) => (await gm.c.get(`/api/groups/${g.id}/raids/${raidId}`)).json().signups.find((s: { userId: string }) => s.userId === late.user.id);
    expect(await su(raid.id)).toMatchObject({ status: "absent" });
    expect(await su(other.id)).toBeUndefined();
    // Raid récurrent généré ce jour-là : Absent d'office
    const next = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "MC 2", scheduledAt: new Date(at.getTime() + 7 * 86400e3).toISOString() })).json().raid;
    expect(await su(next.id)).toMatchObject({ status: "absent" });
    const member = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 1, expiresInHours: 24 })).json().invite;
    const third = await signedIn(env, "Collegue");
    await third.c.post("/api/groups/invites/accept", { token: tokenFrom(member.url) });
    expect((await third.c.get(`/api/groups/${g.id}/members/${late.user.id}/sheet`)).json().absences[0]).toMatchObject({ weekdays: [wd], reason: "Travail le soir" });
  });
});
