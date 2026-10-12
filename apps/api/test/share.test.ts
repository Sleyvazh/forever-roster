import { spawnSync } from "node:child_process";
import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalGroupBlock, groupBlockSignature, splitGroupBlocks, type GroupBlockKind } from "@forever/game-data";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { syncSigner } from "../src/lib/sync-signing";
import { groupExport } from "../src/routes/addon";
import { frgEtag } from "../src/routes/sync";
import { Client, ORIGIN, setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

/**
 * Partage entre joueurs : le site signe chaque bloc RRG et FRG qu'il sert (SYNC_SIGNING_KEY), avec la clé de TEST
 * (addon/tests/fixtures/site-test-key.pem, keyId a3de5db8). Signatures vérifiées ici par Node, avec la clé publique.
 * Noms fictifs.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixture = (name: string) => readFileSync(path.join(ROOT, "addon/tests/fixtures", name), "utf8");
const PRIVATE_PEM = fixture("site-test-key.pem"), PUBLIC_PEM = fixture("site-test-key.pub.pem");
const KEY = Buffer.from(PRIVATE_PEM).toString("base64");
const RETAIL = "http://roster.test";

class RetailClient extends Client {
  override req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    return super.req(method, url, body, { host: "roster.test", origin: RETAIL, ...headers });
  }
}

let env: TestEnv;
beforeAll(async () => { env = await setup({ SYNC_SIGNING_KEY: KEY, RETAIL_ORIGIN: RETAIL }); });
afterAll(async () => { await env.close(); });

/** Signature du bloc vérifiée par Node avec la clé publique de test, sur sa forme canonique. */
function verified(block: string, kind: GroupBlockKind) {
  const s = groupBlockSignature(block);
  if (!s || s.keyId !== "a3de5db8") return false;
  return createVerify("sha256").update(Buffer.from(canonicalGroupBlock(block, kind), "utf8")).verify(PUBLIC_PEM, s.signature, "base64");
}
const header = (text: string) => text.split("\n")[0];
/** Deux textes générés dans la même seconde (la date de génération est dans l'en-tête signé). */
async function sameSecond(a: () => Promise<string>, b: () => Promise<string>) {
  for (let i = 0; i < 5; i++) {
    const [ta, tb] = [await a(), await b()];
    if (header(ta) === header(tb)) return [ta, tb] as const;
  }
  throw new Error("dates de génération toujours différentes");
}

/** Groupe de Forever : officière Greta (perso Greta Coulé), membre Thalwen (et son alt Brindille), un raid demain. */
async function foreverScene(tag: string, raid: Record<string, unknown> = {}) {
  const gm = await signedIn(env, `Greta${tag}`), mem = await signedIn(env, `Thalwen${tag}`);
  const g = (await gm.c.post("/api/groups", { name: `Les Veilleurs ${tag}` })).json().group;
  const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 5, expiresInHours: 24 })).json().invite;
  expect((await mem.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) })).statusCode).toBe(200);
  const greta = (await gm.c.post("/api/characters", { name: "Greta Coulé", race: "Tauren", cls: "Druid" })).json().character;
  const thalwen = (await mem.c.post("/api/characters", { name: "Thalwen", race: "Orc", cls: "Warrior" })).json().character;
  const brindille = (await mem.c.post("/api/characters", { name: "Brindille", race: "Troll", cls: "Mage" })).json().character;
  for (const [c, ch] of [[gm.c, greta], [mem.c, thalwen], [mem.c, brindille]] as const) {
    expect((await c.put(`/api/groups/${g.id}/characters/${ch.id}`, { assigned: true })).statusCode).toBe(200);
  }
  const r = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "Molten Core", scheduledAt: new Date(Date.now() + 86400e3).toISOString(), ...raid })).json().raid;
  expect((await gm.c.put(`/api/groups/${g.id}/raids/${r.id}/signup`, { status: "present", characterId: greta.id })).statusCode).toBe(200);
  expect((await mem.c.put(`/api/groups/${g.id}/raids/${r.id}/signup`, { status: "late", characterId: brindille.id })).statusCode).toBe(200);
  return { gm, mem, g, raid: r };
}

describe("clé du site", () => {
  it("GET /api/sync/key : keyId et clé publique, sans connexion ; 404 sans clé", async () => {
    const res = await env.app.inject({ method: "GET", url: "/api/sync/key" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.keyId).toBe("a3de5db8");
    expect(createPublicKey(body.publicKey).equals(createPublicKey(PUBLIC_PEM))).toBe(true);

    const bare = await buildApp({ ctx: { ...env.app.ctx, cfg: { ...env.cfg, SYNC_SIGNING_KEY: "" } }, rateLimit: false });
    expect((await bare.inject({ method: "GET", url: "/api/sync/key" })).statusCode).toBe(404);
    await bare.close();
  });

  it("SYNC_SIGNING_KEY vérifiée au démarrage, avec une erreur claire", () => {
    const cfg = (key: string) => loadConfig({ APP_ORIGIN: ORIGIN, DATABASE_URL: "postgres://x", SYNC_SIGNING_KEY: key });
    const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");
    expect(syncSigner(cfg(KEY))?.keyId).toBe("a3de5db8");
    expect(syncSigner(cfg(""))).toBeNull();
    expect(() => cfg(PRIVATE_PEM)).toThrow(/SYNC_SIGNING_KEY: le fichier PEM de la clé privée, encodé en base64/);
    expect(() => cfg(b64("bonjour"))).toThrow(/SYNC_SIGNING_KEY: ce n'est pas un fichier PEM/);
    expect(() => cfg(b64(PUBLIC_PEM))).toThrow(/SYNC_SIGNING_KEY: c'est la clé publique/);
    expect(() => cfg(b64(PRIVATE_PEM.replace("MIIE", "MIIX")))).toThrow(/SYNC_SIGNING_KEY: clé privée illisible/);
    const small = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" });
    expect(() => cfg(b64(small))).toThrow(/SYNC_SIGNING_KEY: clé RSA de 2048 bits attendue \(reçu : 1024 bits\)/);
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" });
    expect(() => cfg(b64(ec))).toThrow(/SYNC_SIGNING_KEY: clé RSA attendue \(reçu : ec\)/);
  });
});

describe("« Copier pour le jeu » signé", () => {
  it("FRG : ligne M (persos du groupe) et Z, vérifiée par Node ; même signature pour deux joueurs inscrits différemment", async () => {
    const s = await foreverScene("A");
    const [a, b] = await sameSecond(async () => (await s.gm.c.get("/api/addon/export")).json().text, async () => (await s.mem.c.get("/api/addon/export")).json().text);
    expect(a).toContain(";Molten Core;present;Greta;journal");
    expect(b).toContain(";Molten Core;late;Brindille;journal");
    const lines = a.split("\n");
    expect(lines.slice(-3, -1).map(l => l.split(";")[0])).toEqual(["M", "Z"]);
    expect(lines.at(-3)).toBe("M;Brindille,Greta,Thalwen");
    expect(lines.at(-1)).toBe("END;1");
    expect(verified(a, "FRG")).toBe(true);
    expect(verified(b, "FRG")).toBe(true);
    expect(canonicalGroupBlock(a, "FRG")).toBe(canonicalGroupBlock(b, "FRG"));
    expect(groupBlockSignature(a)).toEqual(groupBlockSignature(b));
    // Un seul groupe (onglet Raids) : signé aussi
    expect(verified((await s.mem.c.get(`/api/groups/${s.g.id}/addon-export`)).json().text, "FRG")).toBe(true);
  });

  it("plusieurs groupes : chaque bloc signé ; sans clé, mêmes blocs sans ligne Z", async () => {
    const s = await foreverScene("B");
    const g2 = (await s.gm.c.post("/api/groups", { name: "Les Retardataires B" })).json().group;
    const all = (await s.gm.c.get("/api/addon/export")).json().text as string;
    const blocks = splitGroupBlocks(all, "FRG");
    // Un bloc par groupe, dans l'ordre des noms ; le groupe sans perso a une ligne M vide
    expect(blocks.map(b => b.split(";")[2])).toEqual([g2.id, s.g.id]);
    expect(blocks[0]).toMatch(/\nM;\nZ;a3de5db8;[^\n]+\nEND;0$/);
    expect(blocks.every(b => verified(b, "FRG"))).toBe(true);

    const signer = syncSigner(env.cfg);
    const [signed, plain] = await sameSecond(async () => (await groupExport(env.app.ctx.db, s.g.id, s.gm.user.id, signer)).text,
      async () => (await groupExport(env.app.ctx.db, s.g.id, s.gm.user.id, null)).text);
    expect(plain).not.toMatch(/\nZ;/);
    expect(plain).toMatch(/\nM;Brindille,Greta,Thalwen\nEND;1$/);
    expect(signed.split("\n").filter(l => !l.startsWith("Z;")).join("\n")).toBe(plain);
  });

  it("soft reserve cachée : réservations propres à chacun, bloc non signé (jamais partagé)", async () => {
    const s = await foreverScene("C", { lootMode: "softres", srHidden: true });
    const text = (await s.mem.c.get(`/api/groups/${s.g.id}/addon-export`)).json().text as string;
    expect(text).toMatch(/\nM;Brindille,Greta,Thalwen\nEND;1$/);
    expect(groupBlockSignature(text)).toBeNull();
    // Réservations visibles : signé
    expect((await s.gm.c.patch(`/api/groups/${s.g.id}/raids/${s.raid.id}/loot`, { srHidden: false })).statusCode).toBe(200);
    expect(verified((await s.mem.c.get(`/api/groups/${s.g.id}/addon-export`)).json().text, "FRG")).toBe(true);
  });

  it("RRG (Roster) : M en Prénom-Royaume et Z, même signature pour l'officière et le membre", async () => {
    const login = async (name: string) => {
      const { email, password } = await signedIn(env, name);
      const r = new RetailClient(env);
      expect((await r.post("/api/auth/login", { email, password })).statusCode).toBe(200);
      return r;
    };
    const off = await login("KaeldraD"), mem = await login("TharokD");
    const g = (await off.post("/api/groups", { name: "Pasta e Basta D" })).json().group;
    const inv = (await off.post(`/api/groups/${g.id}/invites`, { maxUses: 5, expiresInHours: 24 })).json().invite;
    expect((await mem.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) })).statusCode).toBe(200);
    const raid = (await off.post(`/api/groups/${g.id}/raids`, { name: "Flèche du Vide", difficulty: "heroic", size: 25, scheduledAt: new Date(Date.now() + 86400e3).toISOString() })).json().raid;
    const kaeldra = (await off.post("/api/characters", { name: "Kaeldra", realm: "Hyjal", cls: "Demon Hunter", spec1: "Devourer" })).json().character;
    const tharok = (await mem.post("/api/characters", { name: "Tharok", realm: "Conseil des Ombres", cls: "Death Knight", spec1: "Blood" })).json().character;
    expect((await off.put(`/api/groups/${g.id}/raids/${raid.id}/signup`, { status: "present", characterId: kaeldra.id, spec: "Devourer" })).statusCode).toBe(200);
    expect((await mem.put(`/api/groups/${g.id}/characters/${tharok.id}`, { assigned: true })).statusCode).toBe(200);

    const [a, b] = await sameSecond(async () => (await off.get("/api/addon/export")).json().text, async () => (await mem.get("/api/addon/export")).json().text);
    expect(a).toMatch(/^RRG;1;/);
    expect(a).toContain(";heroic;25;present;Kaeldra-Hyjal;journal");
    expect(b).toContain(";heroic;25;;;journal");
    expect(a.split("\n").at(-3)).toBe("M;Kaeldra-Hyjal,Tharok-ConseildesOmbres");
    expect(verified(a, "RRG") && verified(b, "RRG")).toBe(true);
    expect(groupBlockSignature(a)).toEqual(groupBlockSignature(b));
  });
});

describe("Roster Companion", () => {
  it("/api/sync/frg signé ; l'empreinte (ETag) ne dépend ni de la date ni de la signature, mais de la clé", async () => {
    const s = await foreverScene("E");
    const anon = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
      env.app.inject({ method: method as "GET", url, headers, ...(body !== undefined ? { payload: body as object } : {}) });
    const start = (await anon("POST", "/api/devices/pair", { name: "PC-GRETA", platform: "Windows 11", appVersion: "0.1.0" })).json();
    expect((await s.gm.c.post("/api/devices/pair/approve", { code: start.userCode })).statusCode).toBe(200);
    const token = (await anon("POST", "/api/devices/pair/poll", { pairId: start.pairId })).json().token as string;
    const res = await anon("GET", "/api/sync/frg", undefined, { authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);
    const text = res.json().text as string;
    expect(splitGroupBlocks(text, "FRG").every(b => verified(b, "FRG"))).toBe(true);
    // Même données, autre seconde : autre signature, même empreinte ; autre clé : autre empreinte
    const later = text.replace(/^(FRG;1;[^;]+;)\d+/, "$11").replace(/^Z;a3de5db8;.*$/m, "Z;a3de5db8;QUJD");
    expect(frgEtag(later)).toBe(frgEtag(text));
    expect(frgEtag(later.replace("Z;a3de5db8;", "Z;0badc0de;"))).not.toBe(frgEtag(text));
    expect(frgEtag(text.replace(";present;", ";late;"))).not.toBe(frgEtag(text));
    expect((await anon("GET", "/api/sync/frg", undefined, { authorization: `Bearer ${token}`, "if-none-match": res.headers.etag as string })).statusCode).toBe(304);
  });
});

describe("scripts/site-key.mjs", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [path.join(ROOT, "scripts/site-key.mjs"), ...args], { cwd: ROOT, encoding: "utf8" });

  it("SiteKey.lua depuis la clé publique de test : keyId a3de5db8, même clé que la fixture des tests Lua", () => {
    const r = run("addon/tests/fixtures/site-test-key.pub.pem");
    expect(r.status).toBe(0);
    const out = r.stdout.split("\n");
    expect(out.slice(0, 4)).toEqual(readFileSync(path.join(ROOT, "addon/shared/SiteKey.lua"), "utf8").split("\n").slice(0, 4));
    const keyLine = fixture("SiteKeyTest.lua").trim().split("\n").at(-1);
    expect(out[4]).toBe(keyLine);
    expect(out[4]).toMatch(/^ns\.SITE_KEYS\["a3de5db8"\] = \{ n = "[0-9a-f]{512}", e = 65537 \}$/);
  });

  it("refuse une clé privée et un fichier manquant", () => {
    const priv = run("addon/tests/fixtures/site-test-key.pem");
    expect(priv.status).toBe(1);
    expect(priv.stderr).toContain("c'est une clé privée");
    expect(run("introuvable.pem").status).toBe(1);
    expect(run().status).toBe(1);
  });
});
