import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gameHotfixes, users } from "../src/db/schema";
import { hotfixesSince, loadHotfixCaches, saveHotfixes } from "../src/gamedata/cache-store";
import { parseDbCache } from "../src/gamedata/dbcache";
import { collectHotfixes } from "../src/gamedata/hotfix";
import { HOTFIX_LAYOUTS } from "../src/gamedata/hotfix-layouts";
import { cacheFile, encodeRow } from "./cache-helpers";
import { Client, setup, signedIn, type TestEnv } from "./helpers";

/**
 * Cache du jeu partagé (lot D2) : les contributeurs envoient leur DBCache.bin (page Addon ou Roster Companion), le site
 * garde le dernier état de chaque ligne utile ; les admins du site nomment les contributeurs (choix de Flo : contributeurs
 * de confiance seulement).
 */
let env: TestEnv;
const RETAIL = "http://roster.test";
beforeAll(async () => { env = await setup({ RETAIL_ORIGIN: RETAIL }); });
afterAll(async () => { await env.close(); });

const H = (t: string) => HOTFIX_LAYOUTS[t]!.hash;
const OCTETS = { "content-type": "application/octet-stream" };
const spell = (id: number, name: string, push: number, status?: number) =>
  ({ table: H("SpellName"), id, push, ...(status ? { status } : { data: encodeRow("SpellName", { Name_lang: name }) }) });
const makeAdmin = (id: string) => env.app.ctx.db.update(users).set({ siteAdmin: true }).where(eq(users.id, id));

const device = (token: string) => ({
  post: (url: string, body: Buffer, host?: string) => env.app.inject({ method: "POST", url, payload: body, headers: { authorization: `Bearer ${token}`, ...OCTETS, ...(host ? { host } : {}) } }),
});
async function pair(site: Client) {
  const start = (await env.app.inject({ method: "POST", url: "/api/devices/pair", payload: { name: "PC", platform: "Windows 11", appVersion: "0.3.3" } })).json();
  expect((await site.post("/api/devices/pair/approve", { code: start.userCode })).statusCode).toBe(200);
  return (await env.app.inject({ method: "POST", url: "/api/devices/pair/poll", payload: { pairId: start.pairId } })).json().token as string;
}

describe("cache du jeu envoyé par les contributeurs", () => {
  it("seuls les admins du site et les contributeurs qu'ils nomment peuvent envoyer", async () => {
    const admin = await signedIn(env, "AdminCache");
    await makeAdmin(admin.user.id);
    const pahpool = await signedIn(env, "Pahpool");
    const file = cacheFile([spell(1, "Sort", 100)]);

    // Pas contributeur : refusé, sur la page comme par l'appli
    expect((await pahpool.c.get("/api/gamedata/cache")).json()).toEqual({ contributor: false, last: null });
    const refused = await pahpool.c.req("POST", "/api/gamedata/cache", file, OCTETS);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toMatch(/contributeurs des données du jeu/);
    const token = await pair(pahpool.c);
    expect((await device(token).post("/api/sync/gamecache", file)).statusCode).toBe(403);
    // Un joueur ne peut ni voir ni nommer
    expect((await pahpool.c.get("/api/admin/gamedata")).statusCode).toBe(403);
    expect((await pahpool.c.post("/api/admin/gamedata/contributors", { who: pahpool.email })).statusCode).toBe(403);

    // L'admin envoie tout de suite ; il nomme Pahpool par son pseudo
    const sent = await admin.c.req("POST", "/api/gamedata/cache", file, OCTETS);
    expect(sent.json()).toEqual({ build: 70938, rows: 1, newRows: 1, already: false });
    expect((await admin.c.post("/api/admin/gamedata/contributors", { who: "pahpool" })).json()).toMatchObject({ name: "Pahpool", admin: false });
    expect((await admin.c.post("/api/admin/gamedata/contributors", { who: "personne@example.test" })).statusCode).toBe(404);

    // Pahpool envoie par l'appli : sa ligne plus récente remplace celle de l'admin, la plus ancienne n'est pas prise
    const fromApp = await device(token).post("/api/sync/gamecache", cacheFile([spell(1, "Sort corrigé", 200), spell(2, "Nouveau", 150), spell(3, "Ancien", 1)]));
    expect(fromApp.json()).toEqual({ build: 70938, rows: 3, newRows: 3, already: false });
    const older = await device(token).post("/api/sync/gamecache", cacheFile([spell(1, "Plus ancien", 150), spell(2, "Nouveau", 150), spell(3, "Ancien", 1, 2)], 70888));
    expect(older.json()).toMatchObject({ rows: 3, newRows: 0 });
    // Le même fichier une deuxième fois : déjà reçu, rien n'est relu
    const again = await device(token).post("/api/sync/gamecache", cacheFile([spell(1, "Plus ancien", 150), spell(2, "Nouveau", 150), spell(3, "Ancien", 1, 2)], 70888));
    expect(again.json()).toMatchObject({ already: true, newRows: 0 });
    const caches = await loadHotfixCaches(env.app.ctx.db);
    const names = collectHotfixes(caches).tables.get("SpellName")!;
    expect([1, 2, 3].map(id => names.get(id)?.Name_lang)).toEqual(["Sort corrigé", "Nouveau", "Ancien"]);
    expect((await pahpool.c.get("/api/gamedata/cache")).json()).toMatchObject({ contributor: true, last: { via: "app", build: 70888, newRows: 0 } });

    // Page des admins : contributeurs (admins compris), derniers envois, correctifs gardés
    const view = (await admin.c.get("/api/admin/gamedata")).json();
    expect(view.contributors.map((c: { name: string; admin: boolean; lastAt: string | null }) => [c.name, c.admin, !!c.lastAt])).toEqual([["AdminCache", true, true], ["Pahpool", false, true]]);
    expect(view.uploads.map((u: { name: string; via: string; newRows: number }) => [u.name, u.via, u.newRows])).toEqual([["Pahpool", "app", 0], ["Pahpool", "app", 3], ["AdminCache", "site", 1]]);
    expect(view.hotfixes).toEqual({ total: 3, sinceImport: 3 });
    // Le journal du compte nommé le dit, sans l'IP de l'admin
    const journal = (await pahpool.c.get("/api/account/audit")).json().events;
    expect(journal.find((e: { type: string }) => e.type === "game_contributor_set")).toMatchObject({ ip: null, meta: { by: "AdminCache" } });

    // Retiré : il ne peut plus envoyer
    expect((await admin.c.del(`/api/admin/gamedata/contributors/${pahpool.user.id}`)).json()).toEqual({ ok: true, stillAdmin: false });
    expect((await device(token).post("/api/sync/gamecache", cacheFile([spell(9, "x", 300)]))).statusCode).toBe(403);
  });

  it("refuse un fichier qui n'est pas un cache du jeu, et l'adresse de Roster", async () => {
    const admin = await signedIn(env, "AdminFichier");
    await makeAdmin(admin.user.id);
    const bad = await admin.c.req("POST", "/api/gamedata/cache", Buffer.from("PNG pas un cache"), OCTETS);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/pas un cache du jeu/);
    expect((await admin.c.req("POST", "/api/gamedata/cache", { file: "json" })).statusCode).toBe(400);
    const token = await pair(admin.c);
    expect((await device(token).post("/api/sync/gamecache", cacheFile([]), "roster.test")).statusCode).toBe(404);
  });

  it("garde les lignes retirées et les seules tables lues par l'import, par version du client", async () => {
    const { db } = env.app.ctx;
    await db.delete(gameHotfixes);
    const r = await saveHotfixes(db, parseDbCache(cacheFile([
      spell(10, "Gardée", 5), spell(11, "", 5, 2),
      { table: 0x12345678, id: 1, data: Buffer.from("table que l'import ne lit pas") },
    ], 70900)), null, new Date("2026-11-17T20:00:00Z"));
    expect(r).toEqual({ rows: 2, newRows: 2 });
    await saveHotfixes(db, parseDbCache(cacheFile([spell(12, "Autre version", 6)], 70938)), null, new Date("2026-11-17T21:00:00Z"));
    const caches = await loadHotfixCaches(db);
    expect(caches.map(c => [c.build, c.records.map(x => x.id), c.removed.map(x => x.id)])).toEqual([[70900, [10], [11]], [70938, [12], []]]);
    expect(await hotfixesSince(db, new Date("2026-11-17T20:30:00Z"))).toBe(1);
    expect(await hotfixesSince(db, null)).toBe(3);
  });
});
