import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gameHotfixes, gameItems, gameRecipes, groupMembers, users } from "../src/db/schema";
import { TABLE_HASH } from "../src/gamedata/dbcache";
import { setup, signedIn, type TestEnv } from "./helpers";

/**
 * Module BiS (lot BiS-1) : objets candidats d'une spé, poids (défaut, guilde, joueur), corrections d'un admin du site.
 */
let env: TestEnv;
beforeAll(async () => {
  env = await setup();
  const db = env.app.ctx.db;
  const base = { quality: 3, itemLevel: 60, reqLevel: 55, kind: "", origin: "forever" as const };
  await db.insert(gameItems).values([
    // Cuir vu en jeu
    { ...base, id: 13404, name: "Mask of the Unforgiven", classId: 4, subclassId: 2, inventoryType: 1, details: { stats: [[7, 13], [32, 14], [31, 20]] } },
    // Jamais vu, sans source : sort des BiS (raid Classic)
    { ...base, id: 21693, name: "Guise of the Devourer", quality: 4, classId: 4, subclassId: 2, inventoryType: 1, details: { stats: [[3, 19]] } },
    // Graine web (Alterac exalté)
    { ...base, id: 19325, name: "Don Julio's Band", quality: 4, classId: 4, subclassId: 0, inventoryType: 11, details: { stats: [[31, 10]] } },
    // Fabriqué (recette) mais jamais vu : provenance « auto », pas obtenable à elle seule
    { ...base, id: 3, name: "Crafted Pants", classId: 4, subclassId: 2, inventoryType: 7, details: { stats: [[38, 46]] } },
    // JcJ : faction lue dans le nom
    { ...base, id: 16564, name: "General's Leather Legguards", quality: 4, classId: 4, subclassId: 2, inventoryType: 7, details: { pvpRank: 12, stats: [[3, 20]] } },
    // Plaques : jamais pour un Druide ; arme d'hast non plus
    { ...base, id: 1, name: "Plate Helm", classId: 4, subclassId: 4, inventoryType: 1, details: {} },
    { ...base, id: 19167, name: "Blackfury", classId: 2, subclassId: 6, inventoryType: 17, details: {} },
    // Idole (relique 8) et masse à deux mains
    { ...base, id: 220606, name: "Idol of the Dream", classId: 4, subclassId: 8, inventoryType: 28, details: { effects: [{ trigger: 1, text: "Rip +2 s." }] } },
    { ...base, id: 12796, name: "Hammer of the Titans", classId: 2, subclassId: 5, inventoryType: 17, details: { dmg: { min: 163, max: 246, speed: 3.8, dps: 53.9 } } },
    // Niveau trop bas
    { ...base, id: 2, name: "Low Cap", reqLevel: 20, classId: 4, subclassId: 2, inventoryType: 1, details: {} },
    // Sans niveau requis (récompense de quête, set de donjon de Forever) : gardé d'après son niveau d'objet
    { ...base, id: 226788, name: "Feralheart Bands", reqLevel: 0, itemLevel: 65, classId: 4, subclassId: 2, inventoryType: 9, details: { stats: [[4, 10], [3, 8]] } },
    { ...base, id: 4, name: "Low Quest Reward", reqLevel: 0, itemLevel: 30, classId: 4, subclassId: 2, inventoryType: 9, details: {} },
  ]);
  await db.insert(gameHotfixes).values([
    { tableHash: TABLE_HASH.ItemSparse, rowId: 13404, push: 1, data: Buffer.from([1]), build: 71037 },
    { tableHash: TABLE_HASH.ItemSparse, rowId: 16564, push: 1, data: Buffer.from([1]), build: 71037 },
    { tableHash: TABLE_HASH.ItemSparse, rowId: 226788, push: 1, data: Buffer.from([1]), build: 71037 },
    // Retiré par le serveur : ne compte pas comme vu
    { tableHash: TABLE_HASH.ItemSparse, rowId: 21693, push: 1, removed: true, data: Buffer.alloc(0), build: 71037 },
  ]);
  await db.insert(gameRecipes).values({ spellId: 19107, skillLine: 165, name: "Crafted Pants", reqSkill: 300, trivialLow: 320, trivialHigh: 340, createdItemId: 3 });
  // Enchantements : une recette avec ses composants et son patron, un arcanum
  await db.insert(gameItems).values([
    { ...base, id: 16203, name: "Greater Eternal Essence", quality: 2, classId: 7, subclassId: 0, inventoryType: 0, details: { icon: "inv_enchant_essenceeternallarge" } },
    { ...base, id: 16204, name: "Illusion Dust", quality: 1, classId: 7, subclassId: 0, inventoryType: 0, details: {} },
    { ...base, id: 900001, name: "Formula: Enchant Bracer - Superior Agility", classId: 9, subclassId: 8, inventoryType: 0, details: { icon: "inv_misc_note_01" } },
    { ...base, id: 18330, name: "Lesser Arcanum of Voracity", classId: 0, subclassId: 0, inventoryType: 0, details: { icon: "inv_misc_gem_02" } },
  ]);
  await db.insert(gameRecipes).values({ spellId: 990001, skillLine: 333, name: "Enchant Bracer - Superior Agility", reqSkill: 300, trivialLow: 310, trivialHigh: 320,
    reagents: [{ id: 16203, n: 2 }, { id: 16204, n: 6 }], taughtBy: [900001], fromItem: true });
});
afterAll(async () => { await env.close(); });

const makeAdmin = (id: string) => env.app.ctx.db.update(users).set({ siteAdmin: true }).where(eq(users.id, id));

describe("objets candidats", () => {
  it("objets portables par le Félin, avec vu en jeu, provenance et faction", async () => {
    const { c } = await signedIn(env, "Tournicoti");
    const r = await c.get("/api/bis/druid-feral-cat/items");
    expect(r.statusCode).toBe(200);
    const items = r.json().items as any[];
    const by = Object.fromEntries(items.map(i => [i.name, i]));
    expect(Object.keys(by).sort()).toEqual([
      "Crafted Pants", "Don Julio's Band", "Feralheart Bands", "General's Leather Legguards", "Guise of the Devourer", "Hammer of the Titans",
      "Idol of the Dream", "Mask of the Unforgiven",
    ]);
    expect(by["Mask of the Unforgiven"]).toMatchObject({ seen: true, faction: null, source: { kind: "drop", where: "Stratholme", from: "seed" } });
    expect(by["Guise of the Devourer"]).toMatchObject({ seen: false, source: null });
    expect(by["Don Julio's Band"].source).toMatchObject({ kind: "reputation", standing: "exalted", from: "seed" });
    expect(by["Crafted Pants"].source).toEqual({ kind: "craft", profession: "Leatherworking", skill: 300, from: "auto" });
    expect(by["General's Leather Legguards"]).toMatchObject({ faction: "Horde", pvpRank: 12, seen: true });
    expect(by["Idol of the Dream"].source).toMatchObject({ kind: "craft", profession: "Enchanting", skill: 320, from: "seed" });
    expect((await c.get("/api/bis/inconnu/items")).statusCode).toBe(404);
  });

  it("connexion requise", async () => {
    expect((await env.app.inject({ method: "GET", url: "/api/bis/druid-feral-cat/items" })).statusCode).toBe(401);
  });
});

describe("enchantements conseillés", () => {
  it("recette avec ses composants et l'icône de son patron, arcanum, recette introuvable", async () => {
    const { c } = await signedIn(env, "Enchanteur");
    const r = (await c.get("/api/bis/druid-feral-cat/enchants")).json();
    const wrist = r.slots.Wrist.best;
    expect(wrist.recipe).toEqual({ spellId: 990001, name: "Enchant Bracer - Superior Agility", reqSkill: 300 });
    expect(wrist.item.details.icon).toBe("inv_misc_note_01");
    expect(wrist.reagents.map((g: any) => [g.n, g.item.name])).toEqual([[2, "Greater Eternal Essence"], [6, "Illusion Dust"]]);
    expect(r.slots.Head.best.item.name).toBe("Lesser Arcanum of Voracity");
    expect(r.slots.Feet.best).toMatchObject({ recipe: null, item: null, reagents: [], fr: "Agilité supérieure (+7)" });
    expect((await c.get("/api/bis/druid-feral-bear/enchants")).json().slots).toEqual({});
  });
});

describe("poids", () => {
  it("défaut, guilde (officiers) et joueur", async () => {
    const gm = await signedIn(env, "Officier");
    const member = await signedIn(env, "Membre");
    const g = (await gm.c.post("/api/groups", { name: "Les Félins" })).json().group;
    await env.app.ctx.db.insert(groupMembers).values({ groupId: g.id, userId: member.user.id, role: "member" });

    const first = (await member.c.get(`/api/bis/druid-feral-cat/weights?groupId=${g.id}`)).json();
    expect(first).toMatchObject({ profile: "druid-feral-cat", hitCap: 8, group: null, me: null, canEditGroup: false });
    expect(first.defaults).toMatchObject({ str: 2, agi: 2.1, hit: 20 });

    // Un membre ne règle pas les poids de la guilde
    expect((await member.c.put(`/api/bis/druid-feral-cat/weights/group/${g.id}`, { weights: { hit: 15 } })).statusCode).toBe(403);
    expect((await gm.c.put(`/api/bis/druid-feral-cat/weights/group/${g.id}`, { weights: { hit: 15 } })).statusCode).toBe(200);
    // Mes poids à moi, et une clé inconnue refusée
    expect((await member.c.put("/api/bis/druid-feral-cat/weights/me", { weights: { agi: 2.5 } })).statusCode).toBe(200);
    expect((await member.c.put("/api/bis/druid-feral-cat/weights/me", { weights: { foo: 1 } })).statusCode).toBe(400);
    const after = (await member.c.get(`/api/bis/druid-feral-cat/weights?groupId=${g.id}`)).json();
    expect(after).toMatchObject({ group: { hit: 15 }, me: { agi: 2.5 } });
    expect((await gm.c.get(`/api/bis/druid-feral-cat/weights?groupId=${g.id}`)).json()).toMatchObject({ canEditGroup: true, me: null });

    // Revenir aux valeurs de la guilde / de la spé
    await member.c.put("/api/bis/druid-feral-cat/weights/me", { weights: null });
    await gm.c.put(`/api/bis/druid-feral-cat/weights/group/${g.id}`, { weights: null });
    expect((await member.c.get(`/api/bis/druid-feral-cat/weights?groupId=${g.id}`)).json()).toMatchObject({ group: null, me: null });

    // Guilde dont on n'est pas membre
    const other = await signedIn(env, "Ailleurs");
    expect((await other.c.get(`/api/bis/druid-feral-cat/weights?groupId=${g.id}`)).statusCode).toBe(404);
  });
});

describe("corrections d'un admin du site", () => {
  it("non obtenable, faction et provenance ; réservé aux admins", async () => {
    const admin = await signedIn(env, "AdminBis");
    const player = await signedIn(env, "JoueurBis");
    expect((await player.c.put("/api/bis/items/13404", { unobtainable: true })).statusCode).toBe(403);
    await makeAdmin(admin.user.id);
    expect((await admin.c.put("/api/bis/items/13404", { unobtainable: true })).statusCode).toBe(200);
    expect((await admin.c.put("/api/bis/items/21693", { source: { kind: "raid", where: "Ahn'Qiraj" }, faction: "both" })).statusCode).toBe(200);
    expect((await admin.c.put("/api/bis/items/16564", { faction: "Alliance" })).statusCode).toBe(200);
    expect((await admin.c.put("/api/bis/items/999999", { unobtainable: true })).statusCode).toBe(404);
    expect((await admin.c.put("/api/bis/items/13404", { source: { kind: "drop", ref: "javascript:alert(1)" } })).statusCode).toBe(400);

    const items = (await player.c.get("/api/bis/druid-feral-cat/items")).json().items as any[];
    const by = Object.fromEntries(items.map(i => [i.id, i]));
    expect(by[13404].unobtainable).toBe(true);
    expect(by[21693].source).toEqual({ kind: "raid", where: "Ahn'Qiraj", from: "admin" });
    expect(by[16564].faction).toBe("Alliance");

    // Tout remis à zéro : la correction disparaît
    await admin.c.put("/api/bis/items/13404", { unobtainable: false });
    const again = (await player.c.get("/api/bis/druid-feral-cat/items")).json().items as any[];
    expect(again.find(i => i.id === 13404).unobtainable).toBe(false);
  });
});

describe("import : rang JcJ, réputation et races (module BiS)", () => {
  it("lus dans ItemSparse et gardés dans l'infobulle", async () => {
    const { buildScales, computeDetails, rawFromSparse } = await import("../src/gamedata/details");
    const sc = buildScales({});
    const raw = (extra: Record<string, string>) => ({ ...rawFromSparse({ ItemLevel: "60", OverallQualityID: "4", InventoryType: "7", ...extra }), classId: 4, subclassId: 2 });
    // General's Leather Legguards : rang 12 rangé 16 par le jeu ; toutes les races (-1)
    expect(computeDetails(raw({ RequiredPVPRank: "16", AllowableRace_0: "-1" }), sc)).toMatchObject({ pvpRank: 12 });
    expect(computeDetails(raw({ RequiredPVPRank: "16", AllowableRace_0: "-1" }), sc).races).toBeUndefined();
    // Warden's Signet of Ferocity : faction 2819 exalté (7)
    expect(computeDetails(raw({ MinFactionID: "2819", MinReputation: "7" }), sc).rep).toEqual({ factionId: 2819, standing: 7 });
    expect(computeDetails(raw({ AllowableRace_0: "77" }), sc).races).toBe(77);
    expect(computeDetails(raw({}), sc)).not.toHaveProperty("pvpRank");
  });
});
