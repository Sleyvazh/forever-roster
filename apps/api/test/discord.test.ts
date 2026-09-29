import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildInternalApp } from "../src/internal";
import { Client, ORIGIN, setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
let internal: FastifyInstance;
const SECRET = "secret-interne-de-test-assez-long-0123456789";
beforeAll(async () => { env = await setup(); internal = await buildInternalApp(env.app.ctx); await internal.ready(); });
afterAll(async () => { await internal.close(); await env.close(); });

const bot = (method: string, url: string, payload?: object, secret = SECRET) =>
  internal.inject({ method: method as "GET", url, headers: { authorization: `Bearer ${secret}` }, ...(payload ? { payload } : {}) });

function mockDiscord(id: string, username: string) {
  env.fetchMock.impl = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith("/api/oauth2/token")) return Response.json({ access_token: "at", token_type: "Bearer" });
    if (u.endsWith("/api/users/@me")) return Response.json({ id, username, global_name: username });
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

/** Lie le compte Discord d'un joueur connecté (flux OAuth complet). */
async function linkDiscord(c: Client, id: string, name: string) {
  mockDiscord(id, name);
  const start = await c.post("/api/auth/discord/link");
  const state = new URL(start.json().url).searchParams.get("state")!;
  const cb = await c.get(`/api/auth/discord/callback?code=abc&state=${state}`);
  return cb.headers.location as string;
}

describe("liaison du compte Discord", () => {
  it("lie puis délie, avec un state vérifié", async () => {
    const { c } = await signedIn(env, "Lieur");
    const start = await c.post("/api/auth/discord/link");
    const url = new URL(start.json().url);
    expect(url.origin + url.pathname).toBe("https://discord.test/oauth2/authorize");
    expect(url.searchParams.get("scope")).toBe("identify");

    // State d'un autre navigateur : refusé
    const other = await signedIn(env, "Autre");
    const stolen = await other.c.get(`/api/auth/discord/callback?code=abc&state=${url.searchParams.get("state")}`);
    expect(stolen.headers.location).toBe(`${ORIGIN}/account?error=discord_state`);

    expect(await linkDiscord(c, "111111111111111111", "Flo")).toBe(`${ORIGIN}/account?discord=linked`);
    expect((await c.get("/api/auth/me")).json().user.discordUsername).toBe("Flo");
    // Le même Discord ne peut pas être lié à un second compte
    expect(await linkDiscord(other.c, "111111111111111111", "Flo")).toBe(`${ORIGIN}/account?error=discord_taken`);
    expect((await c.del("/api/account/discord")).statusCode).toBe(200);
    expect((await c.get("/api/auth/me")).json().user.discordUsername).toBeNull();
  });
});

describe("API interne du bot", () => {
  it("refuse toute requête sans le bon secret", async () => {
    expect((await bot("GET", "/internal/discord/outbox", undefined, "mauvais")).statusCode).toBe(401);
    expect((await internal.inject({ method: "GET", url: "/internal/discord/outbox" })).statusCode).toBe(401);
    // L'API interne n'est pas servie par l'application publique
    expect((await new Client(env).get("/internal/discord/outbox")).statusCode).toBe(404);
  });

  it("lie un salon, crée un raid, inscrit un membre lié et un invité, puis publie", async () => {
    const gm = await signedIn(env, "Officier"), p1 = await signedIn(env, "Membre");
    const g = (await gm.c.post("/api/groups", { name: "Guilde Discord" })).json().group;
    const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 5, expiresInHours: 24 })).json().invite;
    await p1.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    await linkDiscord(gm.c, "222222222222222222", "Chef");
    await linkDiscord(p1.c, "333333333333333333", "Druide");
    const druid = (await p1.c.post("/api/characters", { name: "Tournicoti", race: "Tauren", cls: "Druid", spec1: "Feral Cat" })).json().character;
    const ids = { guildId: "900000000000000001", channelId: "900000000000000002" };

    // Code : réservé aux officiers, à usage unique ; un simple membre ne peut pas lier le salon
    expect((await p1.c.post(`/api/groups/${g.id}/discord/code`)).statusCode).toBe(403);
    const { code } = (await gm.c.post(`/api/groups/${g.id}/discord/code`)).json();
    expect((await bot("POST", "/internal/discord/bind", { code, ...ids, discordUserId: "333333333333333333" })).statusCode).toBe(403);
    expect((await bot("POST", "/internal/discord/bind", { code: "FAUXCODE", ...ids, discordUserId: "222222222222222222" })).statusCode).toBe(400);
    expect((await bot("POST", "/internal/discord/bind", { code: code.toLowerCase(), ...ids, discordUserId: "222222222222222222" })).json().group.name).toBe("Guilde Discord");
    expect((await bot("POST", "/internal/discord/bind", { code, ...ids, discordUserId: "222222222222222222" })).statusCode).toBe(400);
    expect((await gm.c.get(`/api/groups/${g.id}`)).json().group.discordLinked).toBe(true);

    // /raid : officier seulement
    const when = "2026-11-12T20:00:00.000Z";
    expect((await bot("POST", "/internal/discord/raids", { ...ids, discordUserId: "333333333333333333", name: "Onyxia", scheduledAt: when })).statusCode).toBe(403);
    const created = (await bot("POST", "/internal/discord/raids", { ...ids, discordUserId: "222222222222222222", name: "Onyxia", scheduledAt: when, description: "Résistance feu" })).json();
    const raidId = created.raid.id;
    expect(created.raid.url).toBe(`${ORIGIN}/groups/${g.id}/raids/${raidId}`);

    // Le membre lié choisit parmi ses persos ; l'invité choisit classe et spé
    const choices = (await bot("GET", `/internal/discord/raids/${raidId}/choices?discordUserId=333333333333333333`)).json();
    expect(choices.mode).toBe("member");
    expect(choices.characters[0]).toMatchObject({ name: "Tournicoti", cls: "Druid" });
    expect(choices.characters[0].specs.map((s: { name: string }) => s.name)).toContain("Feral Bear");
    expect((await bot("GET", `/internal/discord/raids/${raidId}/choices?discordUserId=444444444444444444`)).json().mode).toBe("guest");

    await bot("POST", `/internal/discord/raids/${raidId}/signup`, { discordUserId: "333333333333333333", discordName: "Druide", status: "present", characterId: druid.id, spec: "Feral Bear" });
    expect((await bot("POST", `/internal/discord/raids/${raidId}/signup`, { discordUserId: "444444444444444444", discordName: "Invité", status: "present", cls: "Mage" })).statusCode).toBe(400);
    const v = (await bot("POST", `/internal/discord/raids/${raidId}/signup`, { discordUserId: "444444444444444444", discordName: "Invité", status: "late", cls: "Mage", spec: "Frost" })).json();
    expect(v.signups).toEqual([
      expect.objectContaining({ displayName: "Membre", characterName: "Tournicoti", spec: "Feral Bear", role: "Tank", status: "present", guest: false }),
      expect.objectContaining({ displayName: "Invité", cls: "Mage", spec: "Frost", role: "DPS", status: "late", guest: true }),
    ]);
    // Visible aussi sur le site
    expect((await gm.c.get(`/api/groups/${g.id}/raids/${raidId}`)).json().signups).toHaveLength(2);

    // Publication : le raid est dans la file, puis n'y est plus une fois confirmé
    let out = (await bot("GET", "/internal/discord/outbox")).json();
    const item = out.raids.find((r: { raid: { id: string } }) => r.raid.id === raidId);
    expect(item).toMatchObject({ channelId: ids.channelId, messageId: null });
    await bot("POST", `/internal/discord/raids/${raidId}/published`, { channelId: ids.channelId, messageId: "900000000000000003", changedAt: item.raid.changedAt });
    out = (await bot("GET", "/internal/discord/outbox")).json();
    expect(out.raids.find((r: { raid: { id: string } }) => r.raid.id === raidId)).toBeUndefined();

    // Une inscription depuis le site la remet dans la file, avec le message à modifier
    await p1.c.put(`/api/groups/${g.id}/raids/${raidId}/signup`, { status: "tentative", characterId: druid.id });
    out = (await bot("GET", "/internal/discord/outbox")).json();
    expect(out.raids.find((r: { raid: { id: string } }) => r.raid.id === raidId)).toMatchObject({ messageId: "900000000000000003" });

    // Supprimer le raid programme la suppression de l'annonce
    await gm.c.del(`/api/groups/${g.id}/raids/${raidId}`);
    out = (await bot("GET", "/internal/discord/outbox")).json();
    expect(out.deletions).toEqual([expect.objectContaining({ channelId: ids.channelId, messageId: "900000000000000003" })]);
    expect((await bot("DELETE", `/internal/discord/deletions/${out.deletions[0].id}`)).statusCode).toBe(200);
  });

  it("changer de salon, délier ou supprimer le groupe efface les anciennes annonces", async () => {
    const gm = await signedIn(env, "Chef2");
    await linkDiscord(gm.c, "555555555555555555", "Chef2");
    const g = (await gm.c.post("/api/groups", { name: "Guilde Mobile" })).json().group;
    const bind = async (channelId: string) => {
      const { code } = (await gm.c.post(`/api/groups/${g.id}/discord/code`)).json();
      return bot("POST", "/internal/discord/bind", { code, guildId: "910000000000000001", channelId, discordUserId: "555555555555555555" });
    };
    const drain = async () => {
      const { deletions } = (await bot("GET", "/internal/discord/outbox")).json();
      for (const d of deletions) await bot("DELETE", `/internal/discord/deletions/${d.id}`);
      return deletions.map((d: { channelId: string; messageId: string }) => `${d.channelId}/${d.messageId}`);
    };
    await drain();
    await bind("910000000000000002");
    const raid = (await bot("POST", "/internal/discord/raids", { guildId: "910000000000000001", channelId: "910000000000000002", discordUserId: "555555555555555555", name: "BWL", scheduledAt: "2026-12-01T20:00:00.000Z" })).json();
    const publish = async (channelId: string, messageId: string) => {
      const item = (await bot("GET", "/internal/discord/outbox")).json().raids.find((r: { raid: { id: string } }) => r.raid.id === raid.raid.id);
      await bot("POST", `/internal/discord/raids/${raid.raid.id}/published`, { channelId, messageId, changedAt: item.raid.changedAt });
    };
    await publish("910000000000000002", "910000000000000010");

    // Nouveau salon : l'annonce de l'ancien est effacée, le raid est republié dans le nouveau
    await bind("910000000000000003");
    expect(await drain()).toEqual(["910000000000000002/910000000000000010"]);
    const again = (await bot("GET", "/internal/discord/outbox")).json().raids.find((r: { raid: { id: string } }) => r.raid.id === raid.raid.id);
    expect(again).toMatchObject({ channelId: "910000000000000003", messageId: null });
    await publish("910000000000000003", "910000000000000011");

    // Délier le salon
    await gm.c.del(`/api/groups/${g.id}/discord`);
    expect(await drain()).toEqual(["910000000000000003/910000000000000011"]);

    // Supprimer le groupe
    await bind("910000000000000004");
    await publish("910000000000000004", "910000000000000012");
    await gm.c.del(`/api/groups/${g.id}`);
    expect(await drain()).toEqual(["910000000000000004/910000000000000012"]);
  });
});
