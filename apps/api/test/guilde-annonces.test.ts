import { LAUNCH_AT, type GuildLinkResponse } from "@forever/game-data";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { groups } from "../src/db/schema";
import { buildInternalApp } from "../src/internal";
import { DAY, frl, HOUR, m, NOW, paste, scene as sceneOf } from "./guild-helpers";
import { setup, type TestEnv } from "./helpers";

/** Lot « Guilde » côté bot : annonces Discord des niveaux (Course au 60), nom complet des persos dans les annonces. Noms inventés. */

let env: TestEnv;
let internal: FastifyInstance;
const SECRET = "secret-interne-de-test-assez-long-0123456789";
beforeAll(async () => { env = await setup(); internal = await buildInternalApp(env.app.ctx); await internal.ready(); });
afterAll(async () => { await internal.close(); await env.close(); });
afterEach(() => { env.app.ctx.now = undefined; });

const db = () => env.app.ctx.db;
const bot = (method: string, url: string, payload?: object) =>
  internal.inject({ method: method as "GET", url, headers: { authorization: `Bearer ${SECRET}` }, ...(payload ? { payload } : {}) });
const setNow = (unix: number) => { env.app.ctx.now = () => new Date(unix * 1000); };
const L = LAUNCH_AT / 1000;
const scene = (name: string, others: string[] = []) => sceneOf(env, name, others);

describe("annonces Discord des niveaux (bot)", () => {
  it("réglage des officiers ; une seule fois par perso et par palier ; rien avant la sortie ; pas de premier relevé ni d'anciennes montées", async () => {
    const s = await scene("Les Hérauts", ["Vexou"]);
    await db().update(groups).set({ discordGuildId: "100000000000000001", discordChannelId: "100000000000000002" }).where(eq(groups.id, s.g.id));
    const K = m("Kaeldra Brisevent", 45), V = m("Morwen Cendrevoile", 45, { cls: "MAGE" }), Y = m("Ysalis Clairsang", 60, { cls: "PRIEST" });
    const at = (d: number) => Math.round(L + d * DAY);
    setNow(at(9.5));
    await paste(s.owner, frl({ at: at(3), members: [K, V, Y] }));
    await paste(s.owner, frl({ at: at(9), members: [{ ...K, level: 59 }, { ...V, level: 50 }, Y], levels: [["Kaeldra", 60, at(9.1), K.guid]] }));
    const claim = async () => (await bot("POST", "/internal/discord/guild/levels/claim")).json().announces as { name: string; level: number; rank: number; exact: boolean; when: string; channelId: string; group: { name: string } }[];
    setNow(L - DAY);
    expect(await claim()).toEqual([]);
    setNow(at(9.5));
    // Les 60 seulement (défaut) : Kaeldra (exact) ; pas Ysalis (déjà 60 au premier relevé)
    expect(await claim()).toEqual([expect.objectContaining({ name: K.name, level: 60, rank: 2, exact: true, when: "samedi 14/11 à 02:24", channelId: "100000000000000002", group: { id: s.g.id, name: "Les Hérauts" } })]);
    expect(await claim()).toEqual([]);
    // Tous les 10 niveaux : Morwen 50 (vu entre deux relevés), une fois
    expect((await s.p.Vexou!.c.put(`/api/groups/${s.g.id}/guild/announces`, { announce: "tens" })).statusCode).toBe(403);
    expect((await s.owner.c.put(`/api/groups/${s.g.id}/guild/announces`, { announce: "tens" })).json()).toEqual({ announce: "tens" });
    // Kaeldra et Morwen ont passé le 50 dans le même relevé, après Ysalis (60 au premier relevé) : 2e ex æquo
    expect((await claim()).map(a => [a.name, a.level, a.rank, a.exact]).sort()).toEqual([[K.name, 50, 2, false], [V.name, 50, 2, false]]);
    expect(await claim()).toEqual([]);
    // Rien : plus rien n'est annoncé
    await s.owner.c.put(`/api/groups/${s.g.id}/guild/announces`, { announce: "none" });
    await paste(s.owner, frl({ at: at(9.6), members: [{ ...K, level: 60 }, { ...V, level: 60 }, Y] }));
    expect(await claim()).toEqual([]);
    // Montée trop ancienne (plus de 3 jours) : jamais annoncée, même en remettant le réglage
    await s.owner.c.put(`/api/groups/${s.g.id}/guild/announces`, { announce: "sixty" });
    setNow(at(13));
    expect(await claim()).toEqual([]);
    expect((await s.get<GuildLinkResponse>(s.owner, "/guild/link")).announce).toBe("sixty");
  });

  it("nom complet du perso dans les annonces de raid quand la fiche n'a que le prénom", async () => {
    const s = await scene("Les Plumes");
    await db().update(groups).set({ discordGuildId: "100000000000000011", discordChannelId: "100000000000000012" }).where(eq(groups.id, s.g.id));
    const c = (await s.owner.c.post("/api/characters", { name: "Kaeldra", race: "Orc", cls: "Warrior", spec1: "Protection", level: 60 })).json().character;
    await paste(s.owner, frl({ at: NOW() - HOUR, members: [m("Kaeldra Brisevent", 60), m("Morwen Cendrevoile", 40)] }));
    const raid = (await s.owner.c.post(`/api/groups/${s.g.id}/raids`, { name: "Onyxia", scheduledAt: new Date(Date.now() + 2 * DAY * 1000).toISOString() })).json().raid;
    await s.owner.c.put(`/api/groups/${s.g.id}/raids/${raid.id}/signup`, { status: "present", characterId: c.id, spec: "Protection" });
    const view = (await bot("GET", `/internal/discord/raids/${raid.id}/view`)).json();
    expect(view.signups.map((x: { characterName: string }) => x.characterName)).toEqual(["Kaeldra Brisevent"]);
  });
});

