import { readFileSync } from "node:fs";
import { createVerify } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalGroupBlock, groupBlockSignature, type GroupBlockKind } from "@forever/game-data";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { raidSignups } from "../src/db/schema";
import { signUpDiscordGuest } from "../src/lib/signups";
import { syncSigner } from "../src/lib/sync-signing";
import { groupExport } from "../src/routes/addon";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

/**
 * Copier-coller facultatif, côté API : heure du dernier changement de statut d'une inscription (`status_at`), liste des
 * inscrits servie dans le bloc FRG signé (ligne Y), réglage « mes inscriptions faites en jeu peuvent passer par un
 * officier » (`gameRelay`). Clé de TEST du partage (addon/tests/fixtures, keyId a3de5db8). Noms fictifs.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixture = (name: string) => readFileSync(path.join(ROOT, "addon/tests/fixtures", name), "utf8");
const PRIVATE_PEM = fixture("site-test-key.pem"), PUBLIC_PEM = fixture("site-test-key.pub.pem");
const KEY = Buffer.from(PRIVATE_PEM).toString("base64");

let env: TestEnv;
beforeAll(async () => { env = await setup({ SYNC_SIGNING_KEY: KEY }); });
afterAll(async () => { await env.close(); });

/** Signature du bloc vérifiée par Node avec la clé publique de test, sur sa forme canonique. */
function verified(block: string, kind: GroupBlockKind) {
  const s = groupBlockSignature(block);
  if (!s || s.keyId !== "a3de5db8") return false;
  return createVerify("sha256").update(Buffer.from(canonicalGroupBlock(block, kind), "utf8")).verify(PUBLIC_PEM, s.signature, "base64");
}
/** Les horodatages de la base ont la précision de la milliseconde : un court temps d'arrêt rend les changements visibles. */
const tick = () => new Promise(r => setTimeout(r, 40));
const db = () => env.app.ctx.db;

/**
 * Groupe de Forever : officière Greta (perso Greta Coulé), membre Thalwen (persos Thalwen et Brindille), un raid demain.
 * Thalwen s'inscrit en retard avec Brindille AVANT Greta (présente) : l'ordre d'arrivée est Brindille, puis Greta.
 */
async function scene(tag: string) {
  const gm = await signedIn(env, `Greta${tag}`), mem = await signedIn(env, `Thalwen${tag}`);
  const g = (await gm.c.post("/api/groups", { name: `Les Veilleurs ${tag}` })).json().group;
  const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 9, expiresInHours: 24 })).json().invite;
  const join = async (p: { c: { post: (u: string, b?: unknown) => Promise<{ statusCode: number }> } }) =>
    expect((await p.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) })).statusCode).toBe(200);
  await join(mem);
  const char = async (p: typeof gm, name: string, cls: string, race: string) => {
    const ch = (await p.c.post("/api/characters", { name, race, cls })).json().character;
    expect((await p.c.put(`/api/groups/${g.id}/characters/${ch.id}`, { assigned: true })).statusCode).toBe(200);
    return ch as { id: string };
  };
  const greta = await char(gm, "Greta Coulé", "Druid", "Tauren");
  const thalwen = await char(mem, "Thalwen", "Warrior", "Orc");
  const brindille = await char(mem, "Brindille", "Mage", "Troll");
  const raid = async (name: string, days: number) =>
    (await gm.c.post(`/api/groups/${g.id}/raids`, { name, scheduledAt: new Date(Date.now() + days * 86400e3).toISOString() })).json().raid as { id: string };
  const r = await raid("Molten Core", 1);
  const signup = async (p: typeof gm, raidId: string, body: Record<string, unknown>) =>
    expect((await p.c.put(`/api/groups/${g.id}/raids/${raidId}/signup`, body)).statusCode).toBe(200);
  await signup(mem, r.id, { status: "late", characterId: brindille.id });
  await tick();
  await signup(gm, r.id, { status: "present", characterId: greta.id });
  return { gm, mem, g, greta, thalwen, brindille, raid: r, newRaid: raid, signup, join, char };
}

/** Ligne d'inscription en base (heure du dernier changement de statut comprise). */
const signupRow = async (raidId: string, by: { userId: string } | { discordUserId: string }) => {
  const [row] = await db().select({ id: raidSignups.id, status: raidSignups.status, spec: raidSignups.spec, statusAt: raidSignups.statusAt, updatedAt: raidSignups.updatedAt })
    .from(raidSignups).where(and(eq(raidSignups.raidId, raidId), "userId" in by ? eq(raidSignups.userId, by.userId) : eq(raidSignups.discordUserId, by.discordUserId)));
  return row!;
};

describe("status_at : heure du dernier changement de statut", () => {
  it("status_at bouge seulement quand le statut change", async () => {
    const s = await scene("A");
    const who = { userId: s.mem.user.id };
    const base = `/api/groups/${s.g.id}/raids/${s.raid.id}`;
    const first = await signupRow(s.raid.id, who);
    expect(first.status).toBe("late");
    expect(first.statusAt).toBeInstanceOf(Date);

    // L'officier change la spé seulement : le statut est le même, status_at ne bouge pas (la ligne, elle, a changé)
    await tick();
    expect((await s.gm.c.patch(`${base}/signups/${first.id}`, { spec: "Fire" })).statusCode).toBe(200);
    const afterSpec = await signupRow(s.raid.id, who);
    expect(afterSpec.spec).toBe("Fire");
    expect(afterSpec.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
    expect(afterSpec.statusAt.getTime()).toBe(first.statusAt.getTime());

    // Même statut redonné par l'officier avec une autre spé : inchangé
    await tick();
    expect((await s.gm.c.patch(`${base}/signups/${first.id}`, { status: "late", spec: "Frost" })).statusCode).toBe(200);
    expect((await signupRow(s.raid.id, who)).statusAt.getTime()).toBe(first.statusAt.getTime());

    // Le joueur se réinscrit (signUpSiteUser) avec le même statut, autre spé et autre note : inchangé
    await tick();
    await s.signup(s.mem, s.raid.id, { status: "late", characterId: s.brindille.id, spec: "Arcane", note: "Je serai là à 21 h" });
    const again = await signupRow(s.raid.id, who);
    expect(again.spec).toBe("Arcane");
    expect(again.updatedAt.getTime()).toBeGreaterThan(afterSpec.updatedAt.getTime());
    expect(again.statusAt.getTime()).toBe(first.statusAt.getTime());

    // L'officier passe l'inscrit sur le banc : plus récent
    await tick();
    expect((await s.gm.c.patch(`${base}/signups/${first.id}`, { status: "bench" })).statusCode).toBe(200);
    const benched = await signupRow(s.raid.id, who);
    expect(benched.status).toBe("bench");
    expect(benched.statusAt.getTime()).toBeGreaterThan(first.statusAt.getTime());

    // Le joueur change de statut en se réinscrivant : plus récent encore
    await tick();
    await s.signup(s.mem, s.raid.id, { status: "present", characterId: s.brindille.id });
    const back = await signupRow(s.raid.id, who);
    expect(back.status).toBe("present");
    expect(back.statusAt.getTime()).toBeGreaterThan(benched.statusAt.getTime());
  });

  it("invité Discord : même règle (signUpDiscordGuest)", async () => {
    const s = await scene("B");
    const guest = { discordUserId: "discord-invite-1" };
    const sign = (status: "present" | "tentative") => signUpDiscordGuest(db(), s.raid.id, { ...guest, displayName: "Fantôme" }, { status, cls: "Warrior", spec: "Fury" });
    await sign("present");
    const first = await signupRow(s.raid.id, guest);
    await tick();
    await sign("present");
    expect((await signupRow(s.raid.id, guest)).statusAt.getTime()).toBe(first.statusAt.getTime());
    await tick();
    await sign("tentative");
    expect((await signupRow(s.raid.id, guest)).statusAt.getTime()).toBeGreaterThan(first.statusAt.getTime());
  });
});

describe("FRG : ligne Y (liste des inscrits)", () => {
  it("une ligne Y par raid : ordre d'arrivée, main d'un absent sans perso, invité Discord omis, signée", async () => {
    const s = await scene("Y");
    // Ondine : main « Ondine Verte » et alt « Ondinette », absente sans perso → écrite au prénom de son main
    const ondine = await signedIn(env, "OndineY");
    await s.join(ondine);
    await s.char(ondine, "Ondine Verte", "Priest", "Human");
    await s.char(ondine, "Ondinette", "Rogue", "Human");
    await s.signup(ondine, s.raid.id, { status: "absent" });
    // Sansperso : aucun perso dans la guilde, absent → omis
    const vide = await signedIn(env, "VideY");
    await s.join(vide);
    await s.signup(vide, s.raid.id, { status: "absent" });
    // Un invité Discord (pas de compte) : jamais dans la ligne
    await signUpDiscordGuest(db(), s.raid.id, { discordUserId: "discord-invite-y", displayName: "Fantôme" }, { status: "present", cls: "Warrior", spec: "Fury" });
    // Thalwen a deux persos au même prénom : un seul joueur, pas un homonyme
    await s.char(s.mem, "Brindille Dos", "Mage", "Troll");
    // Raid sans aucun inscrit : ligne Y vide, quand même présente
    const videRaid = await s.newRaid("Onyxia", 2);

    const signer = syncSigner(env.cfg);
    const text = (await groupExport(db(), s.g.id, s.mem.user.id, signer)).text;
    const lines = text.split("\n");
    const yLines = lines.filter(l => l.startsWith("Y;"));
    expect(yLines).toHaveLength(2);
    const mc = yLines.find(l => l.startsWith(`Y;${s.raid.id};`))!;
    const entries = mc.split(";")[2]!.split(",");
    // Ordre d'arrivée : Brindille (Thalwen), Greta, puis Ondine (absente)
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatch(/^Brindille:late:\d{10}$/);
    expect(entries[1]).toMatch(/^Greta:present:\d{10}$/);
    expect(entries[2]).toMatch(/^Ondine:absent:\d{10}$/);
    expect(mc).not.toMatch(/Fant|Vide|Ondinette|\?/);
    expect(yLines.find(l => l.startsWith(`Y;${videRaid.id};`))).toBe(`Y;${videRaid.id};`);

    // Heure du changement de statut : celle de la base, en secondes
    const row = await signupRow(s.raid.id, { userId: s.mem.user.id });
    expect(mc).toContain(`Brindille:late:${Math.floor(row.statusAt.getTime() / 1000)}`);

    // Placement : après les R (et les X), avant M ; END ne compte pas les Y ; bloc signé et vérifié, identique pour tous
    const kinds = lines.map(l => l.split(";")[0]);
    expect(kinds.lastIndexOf("R")).toBeLessThan(kinds.indexOf("Y"));
    expect(kinds.lastIndexOf("Y")).toBeLessThan(kinds.indexOf("M"));
    expect(lines.at(-1)).toBe("END;2");
    expect(verified(text, "FRG")).toBe(true);
    const other = (await groupExport(db(), s.g.id, s.gm.user.id, signer)).text;
    expect(other.split("\n").filter(l => l.startsWith("Y;"))).toEqual(yLines);
    expect(verified(other, "FRG")).toBe(true);
    expect(await groupExport(db(), s.g.id, s.gm.user.id, null)).toMatchObject({ text: expect.stringContaining(`\nY;${s.raid.id};Brindille:late:`) });
  });

  it("un prénom porté par deux joueurs est écrit « Prénom? » ; un changement de statut se voit dans la ligne", async () => {
    const s = await scene("H");
    // Un autre joueur a un perso « Greta Dubois » dans la guilde : Greta (Coulé) et Greta (Dubois) sont homonymes
    const rival = await signedIn(env, "RivaleH");
    await s.join(rival);
    const dubois = await s.char(rival, "Greta Dubois", "Rogue", "Human");
    const signer = syncSigner(env.cfg);
    const entries = async () => ((await groupExport(db(), s.g.id, s.mem.user.id, signer)).text.split("\n").find(l => l.startsWith("Y;"))!).split(";")[2]!.split(",");
    let list = await entries();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatch(/^Brindille:late:/);
    expect(list[1]).toMatch(/^Greta\?:present:/);
    // Homonyme inscrit lui aussi : les deux sont marqués
    await s.signup(rival, s.raid.id, { status: "tentative", characterId: dubois.id });
    list = await entries();
    expect(list.map(e => e.split(":").slice(0, 2).join(":"))).toEqual(["Brindille:late", "Greta?:present", "Greta?:tentative"]);
    expect(verified((await groupExport(db(), s.g.id, s.mem.user.id, signer)).text, "FRG")).toBe(true);

    // Changement de statut de Brindille : nouvelle heure dans la ligne
    const before = Number(list[0]!.split(":")[2]);
    await new Promise(r => setTimeout(r, 1100));
    await s.signup(s.mem, s.raid.id, { status: "bench", characterId: s.brindille.id });
    list = await entries();
    expect(list[0]).toMatch(/^Brindille:bench:\d+$/);
    expect(Number(list[0]!.split(":")[2])).toBeGreaterThan(before);
  });
});

describe("réglage gameRelay", () => {
  it("vrai par défaut dans /auth/me ; PATCH /api/account/preferences { gameRelay: false } le passe à faux", async () => {
    const { c } = await signedIn(env, "RelaisR");
    expect((await c.get("/api/auth/me")).json().user.gameRelay).toBe(true);
    const off = await c.patch("/api/account/preferences", { gameRelay: false });
    expect(off.statusCode).toBe(200);
    expect(off.json().user.gameRelay).toBe(false);
    expect((await c.get("/api/auth/me")).json().user.gameRelay).toBe(false);
    // La langue seule ne touche pas au relais ; les deux ensemble sont acceptés
    const lang = await c.patch("/api/account/preferences", { gameLang: "en" });
    expect(lang.json().user).toMatchObject({ gameLang: "en", gameRelay: false });
    const both = await c.patch("/api/account/preferences", { gameLang: "fr", gameRelay: true });
    expect(both.json().user).toMatchObject({ gameLang: "fr", gameRelay: true });
    // Au moins un réglage, et du bon type
    const none = await c.patch("/api/account/preferences", {});
    expect(none.statusCode).toBe(400);
    expect(none.json().error).toMatch(/réglage/i);
    expect((await c.patch("/api/account/preferences", { gameRelay: "non" })).statusCode).toBe(400);
    expect((await c.get("/api/auth/me")).json().user.gameRelay).toBe(true);
  });
});
