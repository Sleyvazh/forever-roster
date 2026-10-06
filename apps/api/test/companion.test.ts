import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devicePairings } from "../src/db/schema";
import { frgEtag } from "../src/routes/sync";
import { Client, ORIGIN, setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

const frc = (name: string, cls: string, race: string, level: number, extra: string[] = []) =>
  [`FRC;2;${name};Forever EU;${cls};${race};${level};Horde;1790000000;1.3.0`, ...extra, `END;${extra.length}`].join("\n");

/** Appareil : requêtes sans cookie ni origine, avec le jeton Bearer (comme Roster Companion). */
const device = (token: string | null) => ({
  req: (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => env.app.inject({
    method: method as "GET", url, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body !== undefined ? { payload: body as object } : {}),
  }),
});

/** Appairage complet : demande, validation sur le site par `site`, remise du jeton. */
async function pair(site: Client, name = "PC-FLO") {
  const anon = device(null);
  const start = (await anon.req("POST", "/api/devices/pair", { name, platform: "Windows 11", appVersion: "0.1.0" })).json();
  expect((await site.post("/api/devices/pair/approve", { code: start.userCode })).statusCode).toBe(200);
  const r = (await anon.req("POST", "/api/devices/pair/poll", { pairId: start.pairId })).json();
  expect(r.status).toBe("approved");
  return r.token as string;
}

describe("import de l'addon côté serveur (Ctrl+V du site)", () => {
  it("crée la fiche, retient le perso du jeu et le retrouve ensuite, même renommée", async () => {
    const { c } = await signedIn(env, "Colleur");
    const text = frc("Tournicoti", "DRUID", "Tauren", 60, ["G;1:16866,7:15065", "P;Leatherworking;300;300", "P;Skinning;295;300", "K;13444:5"]);
    const r1 = (await c.post("/api/addon/import", { text, targets: { "Tournicoti-Forever EU": "new" } })).json();
    expect(r1.errors).toEqual([]);
    expect(r1.results).toEqual([expect.objectContaining({ key: "Tournicoti-Forever EU", status: "created" })]);
    const fiche = (await c.get("/api/characters")).json().characters[0];
    expect(fiche).toMatchObject({ name: "Tournicoti", cls: "Druid", race: "Tauren", level: 60 });
    expect(fiche.gear.Head).toMatchObject({ cur: "Objet 16866", curId: null });
    expect(fiche.professions.prof1).toEqual({ name: "Leatherworking", skill: 300 });
    expect(fiche.addonSyncedAt).not.toBeNull();

    // Fiche renommée sur le site : retrouvée par le lien perso du jeu → fiche, sans choix
    await c.patch(`/api/characters/${fiche.id}`, { name: "Tourni (main)" });
    const r2 = (await c.post("/api/addon/import", { text: frc("Tournicoti", "DRUID", "Tauren", 60) })).json();
    expect(r2.results[0]).toMatchObject({ status: "updated", characterId: fiche.id });
    expect((await c.get("/api/characters")).json().characters).toHaveLength(1);

    // « Ignorer » et choix de ce qu'on importe
    const r3 = (await c.post("/api/addon/import", { text, targets: { "Tournicoti-Forever EU": "skip" } })).json();
    expect(r3.results[0]).toMatchObject({ status: "skipped" });
    const r4 = (await c.post("/api/addon/import", { text: frc("Tournicoti", "DRUID", "Tauren", 59, ["P;Mining;10;75"]), parts: ["gear"] })).json();
    expect(r4.results[0].status).toBe("updated");
    const after = (await c.get("/api/characters")).json().characters[0];
    expect(after.level).toBe(60); // identité non reprise
    expect(after.professions.prof1.name).toBe("Leatherworking");
  });

  it("refuse une classe différente et inscrit aux raids notés en jeu", async () => {
    const gm = await signedIn(env, "Cheffe");
    const g = (await gm.c.post("/api/groups", { name: "Les Inscrits" })).json().group;
    const raid = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "Onyxia", scheduledAt: new Date(Date.now() + 86400_000).toISOString() })).json().raid;
    const war = (await gm.c.post("/api/characters", { name: "Brakka", race: "Orc", cls: "Warrior" })).json().character;
    const bad = (await gm.c.post("/api/addon/import", { text: frc("Brakka", "MAGE", "Undead", 30), targets: { "Brakka-Forever EU": war.id } })).json();
    expect(bad.results[0]).toMatchObject({ status: "error", message: "classe différente sur la fiche (Warrior)" });
    const ok = (await gm.c.post("/api/addon/import", { text: frc("Brakka", "WARRIOR", "Orc", 40, [`S;${g.id};${raid.id};present`]) })).json();
    expect(ok.results[0]).toMatchObject({ status: "updated", characterId: war.id });
    expect(ok.results[0].message).toContain("1 inscription aux raids");
    const signups = (await gm.c.get(`/api/groups/${g.id}/raids/${raid.id}`)).json().signups;
    expect(signups).toEqual([expect.objectContaining({ characterId: war.id, status: "present" })]);
  });
});

describe("Roster Companion : appairage", () => {
  it("code validé sur le site, jeton remis une fois, limité à la synchro", async () => {
    const site = await signedIn(env, "Flo");
    const anon = device(null);
    const start = (await anon.req("POST", "/api/devices/pair", { name: "PC-FLO", platform: "Windows 11", appVersion: "0.1.0" })).json();
    expect(start.userCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(start.verifyUrl).toBe(`${ORIGIN}/appairer?code=${start.userCode}`);
    expect((await anon.req("POST", "/api/devices/pair/poll", { pairId: start.pairId })).json().status).toBe("pending");
    // Trop rapide : on demande à l'appli de ralentir
    expect((await anon.req("POST", "/api/devices/pair/poll", { pairId: start.pairId })).json().status).toBe("slow_down");

    // Page /appairer : connexion requise ; la saisie tolère minuscules et espaces
    expect((await new Client(env).get(`/api/devices/pair/${start.userCode}`)).statusCode).toBe(401);
    const info = (await site.c.get(`/api/devices/pair/${start.userCode.toLowerCase().replace("-", " ")}`)).json().pairing;
    expect(info).toMatchObject({ code: start.userCode, name: "PC-FLO", platform: "Windows 11", appVersion: "0.1.0" });
    // Valider exige le jeton CSRF du site
    expect((await site.c.req("POST", "/api/devices/pair/approve", { code: start.userCode }, { "x-csrf-token": "faux" })).statusCode).toBe(403);
    expect((await site.c.post("/api/devices/pair/approve", { code: start.userCode })).statusCode).toBe(200);
    expect((await site.c.post("/api/devices/pair/approve", { code: start.userCode })).statusCode).toBe(404);

    await env.app.ctx.db.update(devicePairings).set({ lastPollAt: null }).where(eq(devicePairings.userCode, start.userCode));
    const done = (await anon.req("POST", "/api/devices/pair/poll", { pairId: start.pairId })).json();
    expect(done).toMatchObject({ status: "approved", device: { name: "PC-FLO" } });
    expect(done.token).toMatch(/^rc_/);
    await env.app.ctx.db.update(devicePairings).set({ lastPollAt: null }).where(eq(devicePairings.userCode, start.userCode));
    expect((await anon.req("POST", "/api/devices/pair/poll", { pairId: start.pairId })).json().status).toBe("expired");

    const app = device(done.token);
    expect((await app.req("GET", "/api/devices/self")).json()).toMatchObject({ device: { name: "PC-FLO" }, user: { displayName: "Flo" } });
    expect((await app.req("GET", "/api/sync/frg")).statusCode).toBe(200);
    // Le jeton n'ouvre aucune route du site
    expect((await app.req("GET", "/api/characters")).statusCode).toBe(401);
    expect((await app.req("GET", "/api/account/sessions")).statusCode).toBe(401);
    expect((await device("rc_" + "x".repeat(43)).req("GET", "/api/sync/frg")).statusCode).toBe(401);

    // Compte & sécurité : appareils, journal, et déliaison
    const list = (await site.c.get("/api/devices")).json().devices;
    expect(list).toEqual([expect.objectContaining({ name: "PC-FLO", platform: "Windows 11" })]);
    const types = (await site.c.get("/api/account/audit")).json().events.map((e: { type: string }) => e.type);
    expect(types).toContain("device_linked");
    expect((await site.c.del(`/api/devices/${list[0].id}`)).statusCode).toBe(200);
    expect((await app.req("GET", "/api/sync/frg")).statusCode).toBe(401);
    expect((await site.c.get("/api/devices")).json().devices).toEqual([]);
  });

  it("refus, code expiré, et l'appli qui se délie elle-même", async () => {
    const site = await signedIn(env, "Prudente");
    const anon = device(null);
    const a = (await anon.req("POST", "/api/devices/pair", { name: "Inconnu" })).json();
    expect((await site.c.post("/api/devices/pair/deny", { code: a.userCode })).statusCode).toBe(200);
    expect((await anon.req("POST", "/api/devices/pair/poll", { pairId: a.pairId })).json().status).toBe("denied");

    const b = (await anon.req("POST", "/api/devices/pair", { name: "Trop tard" })).json();
    await env.app.ctx.db.update(devicePairings).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(devicePairings.userCode, b.userCode));
    expect((await site.c.post("/api/devices/pair/approve", { code: b.userCode })).statusCode).toBe(404);
    expect((await anon.req("POST", "/api/devices/pair/poll", { pairId: b.pairId })).json().status).toBe("expired");
    expect((await site.c.post("/api/devices/pair/approve", { code: "PAS-UN-CODE" })).statusCode).toBe(404);

    const token = await pair(site.c, "PORTABLE");
    expect((await device(token).req("DELETE", "/api/devices/self")).statusCode).toBe(200);
    expect((await device(token).req("GET", "/api/devices/self")).statusCode).toBe(401);
    const events = (await site.c.get("/api/account/audit")).json().events.map((e: { type: string }) => e.type);
    expect(events).toEqual(expect.arrayContaining(["device_pair_denied", "device_unlinked"]));
  });
});

describe("Roster Companion : synchro", () => {
  it("persos inconnus : l'appli demande, puis crée ou ignore", async () => {
    const site = await signedIn(env, "Synchro");
    const app = device(await pair(site.c));
    const text = [frc("Tournicoti", "DRUID", "Tauren", 60), frc("Banquier", "ROGUE", "Orc", 1)].join("\n");
    const first = (await app.req("POST", "/api/sync/upload", { text })).json();
    expect(first.results.map((r: { name: string; status: string }) => `${r.name}:${r.status}`)).toEqual(["Tournicoti:unknown", "Banquier:unknown"]);
    expect(first.results[0]).toMatchObject({ cls: "Druid", level: 60 });
    expect((await site.c.get("/api/characters")).json().characters).toEqual([]);

    const second = (await app.req("POST", "/api/sync/upload", { text, create: ["Tournicoti-Forever EU"], ignore: ["Banquier-Forever EU"] })).json();
    expect(second.results.map((r: { name: string; status: string }) => `${r.name}:${r.status}`)).toEqual(["Tournicoti:created", "Banquier:ignored"]);
    // Ensuite : le perso créé est mis à jour tout seul, l'ignoré reste ignoré
    const third = (await app.req("POST", "/api/sync/upload", { text })).json();
    expect(third.results.map((r: { name: string; status: string }) => `${r.name}:${r.status}`)).toEqual(["Tournicoti:updated", "Banquier:ignored"]);
    expect((await app.req("GET", "/api/sync/ignored")).json().ignored).toEqual([expect.objectContaining({ key: "Banquier-Forever EU" })]);
    expect((await app.req("POST", "/api/sync/ignored/remove", { keys: ["Banquier-Forever EU"] })).json().removed).toBe(1);
    expect((await app.req("POST", "/api/sync/upload", { text })).json().results[1].status).toBe("unknown");
    expect((await site.c.get("/api/devices")).json().devices[0].lastSyncAt).not.toBeNull();
  });

  it("bilans : celui du chef de raid n'est pas remplacé par un envoi automatique", async () => {
    const lead = await signedIn(env, "Chef"), off = await signedIn(env, "Officier2");
    const g = (await lead.c.post("/api/groups", { name: "Les Chefs" })).json().group;
    const inv = (await lead.c.post(`/api/groups/${g.id}/invites`, { maxUses: 5, expiresInHours: 24 })).json().invite;
    await off.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    await lead.c.patch(`/api/groups/${g.id}/members/${off.user.id}`, { role: "officer" });
    const raid = (await lead.c.post(`/api/groups/${g.id}/raids`, { name: "Molten Core", scheduledAt: new Date(1_790_000_000_000).toISOString() })).json().raid;
    const frb = (who: string, isLead: boolean, people: number) => [
      `FRB;2;${raid.id};1790000000;1790010000;${who};Molten Core;Molten Core;${isLead ? 1 : 0}`,
      ...Array.from({ length: people }, (_, i) => `A;Joueur${i};1790000000;1790010000;100`), `END;${people}`,
    ].join("\n");
    const leadApp = device(await pair(lead.c)), offApp = device(await pair(off.c));
    expect((await leadApp.req("POST", "/api/sync/upload", { text: frb("Chef", true, 9) })).json().results[0]).toMatchObject({ kind: "raidlog", status: "updated" });
    expect((await offApp.req("POST", "/api/sync/upload", { text: frb("Officier", false, 7) })).json().results[0]).toMatchObject({ status: "kept" });
    expect((await lead.c.get(`/api/groups/${g.id}/raids/${raid.id}`)).json().log.recorder).toBe("Chef");
    // Collé à la main sur le site : le dernier remplace, comme avant
    expect((await off.c.post("/api/addon/import", { text: frb("Officier", false, 7) })).json().results[0].status).toBe("updated");
    expect((await lead.c.get(`/api/groups/${g.id}/raids/${raid.id}`)).json().log.recorder).toBe("Officier");
    // Un simple membre : refusé
    const member = await signedIn(env, "Membre");
    await member.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    expect((await device(await pair(member.c)).req("POST", "/api/sync/upload", { text: frb("Membre", true, 3) })).json().results[0]).toMatchObject({ status: "refused" });
  });

  it("données pour le jeu : ETag stable tant que rien ne change", async () => {
    const site = await signedIn(env, "Etag");
    const g = (await site.c.post("/api/groups", { name: "Groupe ETag" })).json().group;
    const app = device(await pair(site.c));
    const r1 = await app.req("GET", "/api/sync/frg");
    expect(r1.statusCode).toBe(200);
    expect(r1.json().text).toContain("Groupe ETag");
    const etag = r1.headers.etag as string;
    expect((await app.req("GET", "/api/sync/frg", undefined, { "if-none-match": etag })).statusCode).toBe(304);
    await site.c.post(`/api/groups/${g.id}/raids`, { name: "Zul'Gurub", scheduledAt: new Date(Date.now() + 86400_000).toISOString() });
    const r2 = await app.req("GET", "/api/sync/frg", undefined, { "if-none-match": etag });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().text).toContain("Zul'Gurub");
    expect(frgEtag("FRG;1;g;1790000000;Nom\nEND;0")).toBe(frgEtag("FRG;1;g;1790009999;Nom\nEND;0"));
  });
});
