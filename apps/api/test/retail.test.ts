import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { users } from "../src/db/schema";
import { buildInternalApp } from "../src/internal";
import { Client, setup, signedIn, type TestEnv } from "./helpers";

/** Roster (R2a) : persos et raids de WoW Retail, langue des noms, accès anticipé. */
const RETAIL = "http://roster.test";
class RetailClient extends Client {
  override req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    return super.req(method, url, body, { host: "roster.test", origin: RETAIL, ...headers });
  }
}

let env: TestEnv;
let internal: FastifyInstance;
const SECRET = "secret-interne-de-test-assez-long-0123456789";
beforeAll(async () => { env = await setup({ RETAIL_ORIGIN: RETAIL }); internal = await buildInternalApp(env.app.ctx); await internal.ready(); });
afterAll(async () => { await internal.close(); await env.close(); });
const bot = (method: string, url: string, payload?: object) =>
  internal.inject({ method: method as "GET", url, headers: { authorization: `Bearer ${SECRET}` }, ...(payload ? { payload } : {}) });

/** Lie le compte Discord d'un joueur (flux OAuth, Discord simulé). */
async function linkDiscord(c: Client, id: string, name: string) {
  env.fetchMock.impl = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith("/api/oauth2/token")) return Response.json({ access_token: "at", token_type: "Bearer" });
    if (u.endsWith("/api/users/@me")) return Response.json({ id, username: name, global_name: name });
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const state = new URL((await c.post("/api/auth/discord/link")).json().url).searchParams.get("state")!;
  await c.get(`/api/auth/discord/callback?code=abc&state=${state}`);
}

async function retailUser(name: string) {
  const { email, password, c: forever, user } = await signedIn(env, name);
  const r = new RetailClient(env);
  expect((await r.post("/api/auth/login", { email, password })).statusCode).toBe(200);
  return { r, forever, user };
}

describe("Roster : WoW Retail", () => {
  it("persos : classes et spés de Retail, royaume obligatoire, niveau 90", async () => {
    const { r, forever } = await retailUser("Vaelis");
    expect((await r.post("/api/characters", { name: "Vaëlis", cls: "Paladin", spec1: "Protection" })).json().error).toContain("royaume");
    expect((await r.post("/api/characters", { name: "Vaëlis", realm: "Hyjal", cls: "Paladin", spec1: "Holy Heal" })).statusCode).toBe(400);
    expect((await r.post("/api/characters", { name: "Vaëlis", realm: "Hyjal", cls: "Paladin", race: "Human" })).statusCode).toBe(400);
    const made = await r.post("/api/characters", { name: "Vaëlis", realm: "Hyjal", cls: "Paladin", spec1: "Protection", spec2: "Holy", level: 90 });
    expect(made.statusCode).toBe(201);
    expect(made.json().character).toMatchObject({ name: "Vaëlis", realm: "Hyjal", cls: "Paladin", spec1: "Protection", spec2: "Holy", level: 90 });
    const id = made.json().character.id as string;
    expect((await r.patch(`/api/characters/${id}`, { realm: "" })).statusCode).toBe(400);
    expect((await r.patch(`/api/characters/${id}`, { cls: "Monk", spec1: "Mistweaver", spec2: "" })).json().character.cls).toBe("Monk");
    // Forever garde ses règles : pas de Moine, niveau 60
    expect((await forever.post("/api/characters", { name: "Bao", cls: "Monk" })).statusCode).toBe(400);
    expect((await forever.post("/api/characters", { name: "Bao", cls: "Warrior", level: 70 })).statusCode).toBe(400);
  });

  it("raids : difficulté, effectif selon la difficulté, buffs de Midnight, inscriptions", async () => {
    const { r, user } = await retailUser("Officier");
    const g = (await r.post("/api/groups", { name: "Pasta e Basta" })).json().group;
    const at = new Date(Date.now() + 5 * 86400e3).toISOString();
    const base = `/api/groups/${g.id}/raids`;
    // Normal par défaut, 20 joueurs ; Héroïque jusqu'à 30 ; Mythique 20 sauf raid flexible
    const normal = (await r.post(base, { name: "Flèche du Vide", scheduledAt: at })).json().raid;
    let view = (await r.get(`${base}/${normal.id}`)).json();
    expect(view.raid).toMatchObject({ difficulty: "normal", size: 20, targets: { tank: 2, heal: 4, dps: 14 } });
    expect(view.coverage.map((c: { id: string }) => c.id)).toContain("mystic");
    expect(view.coverage.map((c: { id: string }) => c.id)).not.toContain("kings");
    expect((await r.post(base, { name: "Flèche du Vide", difficulty: "heroic", size: 30 })).statusCode).toBe(201);
    expect((await r.post(base, { name: "Flèche du Vide", difficulty: "heroic", size: 35 })).json().error).toBe("En Héroïque, de 10 à 30 joueurs.");
    expect((await r.post(base, { name: "Flèche du Vide", difficulty: "mythic", size: 25 })).json().error).toBe("En Mythique, ce raid se joue à 20.");
    expect((await r.post(base, { name: "Déliement de Kith'ix", difficulty: "mythic", size: 25 })).statusCode).toBe(201);
    // Changer de difficulté : effectif proposé pour la nouvelle
    expect((await r.patch(`${base}/${normal.id}/format`, { difficulty: "mythic" })).json()).toMatchObject({ difficulty: "mythic", size: 20 });
    expect((await r.patch(`${base}/${normal.id}/format`, { size: 22 })).statusCode).toBe(400);
    expect((await r.patch(`${base}/${normal.id}/format`, { difficulty: "heroic", size: 25 })).json()).toMatchObject({ difficulty: "heroic", size: 25, targets: { tank: 2, heal: 5, dps: 18 } });
    // Inscription avec une spé de Retail
    const pal = (await r.post("/api/characters", { name: "Lumen", realm: "Ysondre", cls: "Priest", spec1: "Discipline" })).json().character;
    expect((await r.put(`${base}/${normal.id}/signup`, { status: "present", characterId: pal.id, spec: "Holy Heal" })).statusCode).toBe(400);
    expect((await r.put(`${base}/${normal.id}/signup`, { status: "present", characterId: pal.id, spec: "Shadow" })).statusCode).toBe(200);
    // Raid récurrent : la difficulté suit
    const weekly = (await r.post(base, { name: "L'Abîme Venimeux", difficulty: "heroic", scheduledAt: at, weekly: { leadDays: 7 } })).json().raid;
    const tpl = (await r.get(`/api/groups/${g.id}/raid-templates`)).json().templates[0];
    expect(tpl).toMatchObject({ difficulty: "heroic", size: 20 });
    expect(weekly.id).toBeTruthy();
    expect((await r.patch(`/api/groups/${g.id}/raid-templates/${tpl.id}`, { difficulty: "mythic" })).json().template).toMatchObject({ difficulty: "mythic", size: 20 });
    expect(user.id).toBeTruthy();
  });

  it("Forever : pas de difficulté, 10, 20 ou 40", async () => {
    const { c } = await signedIn(env, "Classique");
    const g = (await c.post("/api/groups", { name: "Forever" })).json().group;
    expect((await c.post(`/api/groups/${g.id}/raids`, { name: "Molten Core", difficulty: "heroic" })).statusCode).toBe(400);
    expect((await c.post(`/api/groups/${g.id}/raids`, { name: "Molten Core", size: 25 })).statusCode).toBe(400);
    const raid = (await c.post(`/api/groups/${g.id}/raids`, { name: "Molten Core", size: 20 })).json().raid;
    expect((await c.get(`/api/groups/${g.id}/raids/${raid.id}`)).json().raid).toMatchObject({ size: 20, difficulty: null, targets: { tank: 2, heal: 5, dps: 13 } });
  });

  it("langue des noms du jeu et accès anticipé", async () => {
    const { r, user } = await retailUser("Langue");
    expect((await r.get("/api/auth/me")).json().user).toMatchObject({ gameLang: "auto", rosterPreview: false });
    expect((await r.patch("/api/account/preferences", { gameLang: "en" })).json().user.gameLang).toBe("en");
    expect((await r.patch("/api/account/preferences", { gameLang: "de" })).statusCode).toBe(400);
    // Accès anticipé (commande roster-preview sur le serveur)
    await env.app.ctx.db.update(users).set({ rosterPreview: true }).where(eq(users.id, user.id));
    expect((await r.get("/api/auth/me")).json().user.rosterPreview).toBe(true);
  });

  it("Discord : raid créé avec /raid, classes et spés de Retail, persos du bon jeu", async () => {
    const { r, forever } = await retailUser("ChefRetail");
    await linkDiscord(forever, "620000000000000001", "ChefRetail");
    const g = (await r.post("/api/groups", { name: "Roster Discord" })).json().group;
    const ids = { guildId: "620000000000000002", channelId: "620000000000000003" };
    const { code } = (await r.post(`/api/groups/${g.id}/discord/code`)).json();
    expect((await bot("POST", "/internal/discord/bind", { code, ...ids, discordUserId: "620000000000000001" })).statusCode).toBe(200);
    const created = (await bot("POST", "/internal/discord/raids", { ...ids, discordUserId: "620000000000000001", name: "Flèche du Vide", scheduledAt: "2026-12-02T19:00:00.000Z" })).json();
    expect(created.raid).toMatchObject({ size: 20, difficulty: "normal" });
    expect(created.group.game).toBe("retail");
    expect(created.raid.url.startsWith(RETAIL)).toBe(true);
    // Persos du jeu du groupe seulement, spés de Retail
    await forever.post("/api/characters", { name: "Classique", cls: "Warrior", spec1: "Arms" });
    await r.post("/api/characters", { name: "Brumelune", realm: "Hyjal", cls: "Monk", spec1: "Mistweaver" });
    const choices = (await bot("GET", `/internal/discord/raids/${created.raid.id}/choices?discordUserId=620000000000000001`)).json();
    expect(choices).toMatchObject({ mode: "member", game: "retail" });
    expect(choices.characters.map((c: { name: string }) => c.name)).toEqual(["Brumelune"]);
    expect(choices.characters[0].specs).toContainEqual({ name: "Mistweaver", role: "Heal" });
    // Invité : classe et spé de Retail
    expect((await bot("GET", `/internal/discord/raids/${created.raid.id}/choices?discordUserId=620000000000000009`)).json()).toMatchObject({ mode: "guest", game: "retail" });
    const v = (await bot("POST", `/internal/discord/raids/${created.raid.id}/signup`, { discordUserId: "620000000000000009", discordName: "Invité", status: "present", cls: "Evoker", spec: "Preservation" })).json();
    expect(v.signups).toContainEqual(expect.objectContaining({ cls: "Evoker", spec: "Preservation", role: "Heal", guest: true }));
    expect((await bot("POST", `/internal/discord/raids/${created.raid.id}/signup`, { discordUserId: "620000000000000008", discordName: "Invité 2", status: "present", cls: "Paladin", spec: "Holy Heal" })).statusCode).toBe(400);
  });
});
