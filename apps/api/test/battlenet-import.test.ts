import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bnetImports } from "../src/db/schema";
import { Client, setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

/** R2b (Roster) : import des persos du compte Battle.net, « Mettre à jour », mise à jour du groupe. Blizzard est simulé. */
const RETAIL = "http://roster.test";
class RetailClient extends Client {
  override req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    return super.req(method, url, body, { host: "roster.test", origin: RETAIL, ...headers });
  }
}

let env: TestEnv;
beforeAll(async () => { env = await setup({ RETAIL_ORIGIN: RETAIL, BNET_API_HOST: "https://api.bnet.test" }); });
afterAll(async () => { await env.close(); });

async function retailUser(name: string) {
  const { email, password, c: forever, user } = await signedIn(env, name);
  const r = new RetailClient(env);
  expect((await r.post("/api/auth/login", { email, password })).statusCode).toBe(200);
  return { r, forever, user };
}

/** Profils publics simulés : modifiables d'un test à l'autre. */
const profiles: Record<string, object | null> = {
  "hyjal/brumelune": { id: 1001, level: 90, character_class: { id: 10 }, active_spec: { name: "Mistweaver" }, equipped_item_level: 712.4 },
  "kaelthas/vaelis": null, // profil masqué
  "hyjal/petit": { id: 1003, level: 23, character_class: { id: 8 }, active_spec: { name: "Frost" }, equipped_item_level: 40 },
};
const seen: string[] = [];
function mockBlizzard() {
  env.fetchMock.impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    seen.push(`${url.host}${url.pathname} ${auth.split(" ")[0]}`);
    if (url.host === "oauth.bnet.test" && url.pathname === "/token") {
      const body = new URLSearchParams(String(init?.body));
      if (body.get("grant_type") === "client_credentials") return Response.json({ access_token: "app-token", expires_in: 86400 });
      return Response.json({ access_token: "user-token" });
    }
    if (url.host === "api.bnet.test" && url.pathname === "/profile/user/wow") {
      if (auth !== "Bearer user-token") return new Response("", { status: 401 });
      expect(url.searchParams.get("namespace")).toBe("profile-eu");
      return Response.json({ wow_accounts: [
        { characters: [
          { id: 1003, name: "Petit", level: 23, realm: { name: "Hyjal", slug: "hyjal" }, playable_class: { id: 8 }, faction: { type: "ALLIANCE" } },
          { id: 1001, name: "Brumelune", level: 90, realm: { name: "Hyjal", slug: "hyjal" }, playable_class: { id: 10 }, faction: { type: "ALLIANCE" } },
          { id: 1009, name: "Inconnu", level: 90, realm: { name: "Hyjal", slug: "hyjal" }, playable_class: { id: 99 } },
        ] },
        { characters: [{ id: 1002, name: "Vaelis", level: 90, realm: { name: "Kael'Thas", slug: "kaelthas" }, playable_class: { id: 2 }, faction: { type: "HORDE" } }] },
      ] });
    }
    const m = url.pathname.match(/^\/profile\/wow\/character\/([^/]+)\/([^/]+)$/);
    if (url.host === "api.bnet.test" && m) {
      if (auth !== "Bearer app-token") return new Response("", { status: 401 });
      const p = profiles[`${m[1]}/${decodeURIComponent(m[2]!)}`];
      return p ? Response.json(p) : new Response("", { status: 404 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

async function importList(r: Client) {
  const start = await r.post("/api/auth/battlenet/import");
  expect(start.statusCode).toBe(200);
  const url = new URL(start.json().url);
  expect(url.searchParams.get("scope")).toBe("openid wow.profile");
  return r.get(`/api/auth/battlenet/callback?code=abc&state=${url.searchParams.get("state")}`);
}

describe("Roster : import Battle.net", () => {
  it("import : liste du compte, persos cochés créés ou reliés, niveau d'objet et spé active", async () => {
    mockBlizzard();
    const { r, forever, user } = await retailUser("Importeur");
    // Forever Roster : pas d'import (persos de WoW Forever)
    expect((await forever.post("/api/auth/battlenet/import")).statusCode).toBe(400);
    // Fiche faite à la main avant l'import : reliée, pas en double
    const manual = (await r.post("/api/characters", { name: "Vaelis", realm: "Kael'Thas", cls: "Paladin", spec1: "Protection" })).json().character;

    expect((await r.get("/api/battlenet/import")).statusCode).toBe(404);
    const cb = await importList(r);
    expect(cb.headers.location).toBe(`${RETAIL}/persos?bnet=import`);
    const list = (await r.get("/api/battlenet/import")).json().characters;
    expect(list.map((c: { name: string }) => c.name)).toEqual(["Brumelune", "Vaelis", "Petit"]); // niveau 90 d'abord, classe inconnue écartée
    expect(list.find((c: { name: string }) => c.name === "Vaelis")).toMatchObject({ cls: "Paladin", realm: "Kael'Thas", faction: "Horde", existing: manual.id });

    const res = await r.post("/api/battlenet/import", { ids: [1001, 1002] });
    expect(res.statusCode).toBe(201);
    const out = res.json();
    expect(out).toMatchObject({ created: 1, linked: 1 });
    expect(out.failed).toEqual([{ name: "Vaelis", reason: "introuvable chez Blizzard (nom, royaume, ou profil masqué)" }]);
    const brume = out.characters.find((c: { name: string }) => c.name === "Brumelune");
    expect(brume).toMatchObject({ cls: "Monk", realm: "Hyjal", realmSlug: "hyjal", level: 90, ilvl: 712, activeSpec: "Mistweaver", spec1: "Mistweaver", bnet: true });
    expect(out.characters.find((c: { name: string }) => c.name === "Vaelis")).toMatchObject({ id: manual.id, spec1: "Protection", bnet: true, ilvl: null });
    // Déjà là : un second import ne crée pas de doublon
    expect((await r.post("/api/battlenet/import", { ids: [1001] })).json()).toMatchObject({ created: 0, linked: 1 });
    expect((await r.get("/api/characters")).json().characters).toHaveLength(2);
    // Le jeton de l'utilisateur ne sert qu'à la liste ; les profils passent par le jeton de l'application
    expect(seen).toContain("api.bnet.test/profile/user/wow Bearer");

    // « Mettre à jour » : la spé principale reste celle du site, la spé active suit le jeu
    profiles["hyjal/brumelune"] = { id: 1001, level: 90, character_class: { id: 10 }, active_spec: { name: "Windwalker" }, equipped_item_level: 715.6 };
    const upd = (await r.post(`/api/battlenet/characters/${brume.id}/refresh`)).json().character;
    expect(upd).toMatchObject({ ilvl: 716, activeSpec: "Windwalker", spec1: "Mistweaver" });
    expect((await r.post(`/api/battlenet/characters/${manual.id}/refresh`)).json().error).toContain("introuvable chez Blizzard");

    // Nom ou royaume changé à la main : plus relié à Battle.net
    const moved = (await r.patch(`/api/characters/${brume.id}`, { realm: "Ysondre" })).json().character;
    expect(moved).toMatchObject({ bnet: false, ilvl: null, activeSpec: "", realmSlug: "" });

    // Liste expirée
    await env.app.ctx.db.update(bnetImports).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(bnetImports.userId, user.id));
    expect((await r.post("/api/battlenet/import", { ids: [1001] })).statusCode).toBe(404);
  });

  it("le retour de Battle.net doit venir du même compte, connecté dans ce navigateur", async () => {
    mockBlizzard();
    const a = await retailUser("Alpha");
    const start = await a.r.post("/api/auth/battlenet/import");
    const state = new URL(start.json().url).searchParams.get("state");
    const b = await retailUser("Beta");
    // Le cookie du state est propre au navigateur d'Alpha : Beta ne peut pas finir son import
    const cb = await b.r.get(`/api/auth/battlenet/callback?code=abc&state=${state}`);
    expect(cb.headers.location).toContain("error=bnet_state");
    expect((await b.r.get("/api/battlenet/import")).statusCode).toBe(404);
  });

  it("officiers : mettre à jour les persos du groupe d'un coup", async () => {
    mockBlizzard();
    profiles["hyjal/brumelune"] = { id: 1001, level: 90, character_class: { id: 10 }, active_spec: { name: "Mistweaver" }, equipped_item_level: 712 };
    const off = await retailUser("Officier");
    const g = (await off.r.post("/api/groups", { name: "Pasta e Basta" })).json().group;
    const ch = (await off.r.post("/api/characters", { name: "Brumelune", realm: "Hyjal", cls: "Monk" })).json().character;
    expect((await off.r.put(`/api/groups/${g.id}/characters/${ch.id}`, { assigned: true })).statusCode).toBe(200);
    const res = (await off.r.post(`/api/battlenet/groups/${g.id}/refresh`)).json();
    expect(res).toMatchObject({ updated: 1, fresh: 0, failed: [] });
    // Lu il y a moins de 10 minutes : pas relu
    expect((await off.r.post(`/api/battlenet/groups/${g.id}/refresh`)).json()).toMatchObject({ updated: 0, fresh: 1 });
    const inv = (await off.r.post(`/api/groups/${g.id}/invites`, { maxUses: 2, expiresInHours: 24 })).json().invite;
    const member = await retailUser("Membre");
    await member.r.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    expect((await member.r.post(`/api/battlenet/groups/${g.id}/refresh`)).statusCode).toBe(403);
  });
});
