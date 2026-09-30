import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCsv } from "../src/gamedata/csv";
import { extract, fillFromEra, readItems } from "../src/gamedata/extract";
import { isEraBuild, isForeverBuild, latestBuild, latestEraBuild, readItemTables, readTables } from "../src/gamedata/source";
import { storeGameData } from "../src/gamedata/store";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/gamedata");
const ERA = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/gamedata-era");
let env: TestEnv;
beforeAll(async () => {
  env = await setup();
  const tables = await readTables(FIXTURES);
  const data = extract(tables);
  data.items = fillFromEra(data.items, readItems({ ...(await readItemTables(ERA)), ItemClass: tables.ItemClass, ItemSubClass: tables.ItemSubClass }, "era").items);
  await storeGameData(env.app.ctx.db, data, "1.60.1.70009", { eraBuild: "1.15.9.69722" });
});
afterAll(async () => { await env.close(); });

describe("import des tables du client", () => {
  it("lit un CSV avec guillemets, virgules et retours à la ligne", () => {
    expect(parseCsv('ID,Name\n1,"a, ""b""\nc"\r\n2,d\n')).toEqual([{ ID: "1", Name: 'a, "b"\nc' }, { ID: "2", Name: "d" }]);
  });

  it("reconnaît les versions de Forever et choisit la plus récente", async () => {
    expect(isForeverBuild("1.60.1.70009")).toBe(true);
    expect(isForeverBuild("1.15.9.69722")).toBe(false);
    const fake = (async () => Response.json({
      wow_classic_era: [{ version: "1.15.9.69722" }],
      wow_classic_beta: [{ version: "1.60.1.69913" }, { version: "1.60.1.70009" }],
      wow: [{ version: "12.0.1.66000" }],
    })) as unknown as typeof fetch;
    expect(await latestBuild(fake)).toEqual({ product: "wow_classic_beta", version: "1.60.1.70009" });
  });

  it("joint les recettes : produit, composants, patron, compétence requise", async () => {
    const { recipes, items } = extract(await readTables(FIXTURES));
    const byId = new Map(recipes.map(r => [r.spellId, r]));
    // Le rang du métier (sans effet ni composant) et les sorts de classe sont ignorés
    expect(byId.has(2108)).toBe(false);
    expect(byId.has(78)).toBe(false);
    expect(byId.get(2152)).toMatchObject({ createdItemId: 2304, fromItem: false, reqSkill: 1, category: "Materials", reagents: [{ id: 2318, n: 1 }] });
    // Seuil requis lu sur l'objet Patron
    expect(byId.get(19080)).toMatchObject({ taughtBy: [15090], fromItem: true, reqSkill: 285, reagents: [{ id: 8170, n: 20 }, { id: 2318, n: 4 }] });
    // Patron qui passe par un sort « apprendre » (effet 36)
    expect(byId.get(19100)).toMatchObject({ taughtBy: [15091], reqSkill: 90 });
    expect(byId.get(7418)).toMatchObject({ enchant: "+5 Health", skillLine: 333 });
    expect(items.find(i => i.id === 19019)).toMatchObject({ name: "Thunderfury, Blessed Blade of the Windseeker", quality: 5, kind: "Weapon · Sword" });
  });

  it("complète avec Classic Era les objets absents du client Forever", async () => {
    const tables = await readTables(FIXTURES);
    const forever = extract(tables).items;
    const era = readItems({ ...(await readItemTables(ERA)), ItemClass: tables.ItemClass, ItemSubClass: tables.ItemSubClass }, "era").items;
    const all = fillFromEra(forever, era);
    // Ajouté : absent de Forever, objet d'origine
    expect(all.find(i => i.id === 5404)).toMatchObject({ name: "Serpent's Shoulders", inventoryType: 3, kind: "Armor · Leather", origin: "era", reqLevel: 18 });
    // Jamais remplacé : l'objet Forever reste la référence
    expect(all.find(i => i.id === 2318)).toMatchObject({ name: "Light Leather", origin: "forever" });
    // Saison de la Découverte exclue
    expect(all.some(i => i.id === 211385)).toBe(false);
    expect(all).toHaveLength(forever.length + 1);

    expect(isEraBuild("1.15.9.69722")).toBe(true);
    expect(isEraBuild("1.60.1.70124")).toBe(false);
    const fake = (async () => Response.json({
      wow_classic_era: [{ version: "1.15.8.60000" }, { version: "1.15.9.69722" }],
      wow_classic_era_ptr: [{ version: "1.15.10.70000" }],
      wow_classic_beta: [{ version: "1.60.1.70124" }],
    })) as unknown as typeof fetch;
    expect(await latestEraBuild(fake)).toEqual({ product: "wow_classic_era", version: "1.15.9.69722" });
  });

  it("refuse une table dont la structure a changé", async () => {
    const t = await readTables(FIXTURES);
    t.SpellReagents = t.SpellReagents.map(({ Reagent_0: _, ...rest }) => rest);
    expect(() => extract(t)).toThrow(/SpellReagents.*Reagent_0/);
  });
});

describe("API données du jeu", () => {
  it("donne l'état de l'import et cherche un objet par emplacement", async () => {
    const { c } = await signedIn(env);
    expect((await c.get("/api/gamedata/status")).json()).toMatchObject({ build: "1.60.1.70009", recipes: 4, eraBuild: "1.15.9.69722", eraItems: 1 });
    const shoulders = (await c.get("/api/gamedata/items?q=serpent&slot=Shoulder")).json().items;
    expect(shoulders).toEqual([expect.objectContaining({ id: 5404, name: "Serpent's Shoulders", origin: "era" })]);
    const head = (await c.get("/api/gamedata/items?q=helm&slot=Head")).json().items;
    expect(head.map((i: { name: string }) => i.name)).toEqual(["Helm of Might"]);
    expect((await c.get("/api/gamedata/items?q=hat&slot=Legs")).json().items).toEqual([]);
    // Les jokers SQL sont traités comme du texte
    expect((await c.get("/api/gamedata/items?q=%25%25")).json().items).toEqual([]);
    expect((await c.get("/api/gamedata/items?q=a")).statusCode).toBe(400);
    const lw = (await c.get("/api/gamedata/professions/Leatherworking/recipes")).json();
    expect(lw.recipes.map((r: { spellId: number }) => r.spellId)).toEqual([2152, 19100, 19080]);
    expect(lw.items[15090].name).toBe("Pattern: Warbear Woolies");
    const batch = (await c.get("/api/gamedata/items/batch?ids=16866,19019,424242")).json().items;
    expect(Object.keys(batch).sort()).toEqual(["16866", "19019"]);
    expect(batch[16866]).toMatchObject({ name: "Helm of Might", quality: 4, itemLevel: 66 });
    expect((await c.get("/api/gamedata/items/batch?ids=1;DROP")).statusCode).toBe(400);
  });

  it("exige une session", async () => {
    const { Client } = await import("./helpers");
    expect((await new Client(env).get("/api/gamedata/status")).statusCode).toBe(401);
  });
});

describe("patrons des persos et « qui crafte quoi »", () => {
  it("coche un patron, le limite aux métiers du perso et le montre au groupe", async () => {
    const lw = await signedIn(env, "Tanneur"), other = await signedIn(env, "Guildeux"), outsider = await signedIn(env, "Inconnu");
    const ch = (await lw.c.post("/api/characters", {
      name: "Tournicoti", professions: { prof1: { name: "Leatherworking", skill: 300 }, prof2: { name: "Skinning", skill: 300 }, cooking: 0, fishing: 0, firstAid: 0 },
    })).json().character;

    expect((await lw.c.put(`/api/characters/${ch.id}/recipes/19080`, { status: "known" })).statusCode).toBe(200);
    expect((await lw.c.put(`/api/characters/${ch.id}/recipes/19100`, { status: "wanted" })).statusCode).toBe(200);
    // Enchanting n'est pas un métier de ce perso : accepté (le métier peut être en cours d'enregistrement),
    // mais ignoré par l'onglet Artisans tant que le perso n'a pas ce métier ; recette inconnue ; statut invalide
    expect((await lw.c.put(`/api/characters/${ch.id}/recipes/7418`, { status: "known" })).statusCode).toBe(200);
    expect((await lw.c.put(`/api/characters/${ch.id}/recipes/999999`, { status: "known" })).statusCode).toBe(400);
    expect((await lw.c.put(`/api/characters/${ch.id}/recipes/19080`, { status: "maybe" })).statusCode).toBe(400);
    // Personne d'autre ne peut modifier ni lire hors groupe
    expect((await other.c.put(`/api/characters/${ch.id}/recipes/2152`, { status: "known" })).statusCode).toBe(404);
    expect((await outsider.c.get(`/api/characters/${ch.id}/recipes`)).statusCode).toBe(404);

    const g = (await lw.c.post("/api/groups", { name: "Artisans" })).json().group;
    const inv = (await lw.c.post(`/api/groups/${g.id}/invites`, { maxUses: 1, expiresInHours: 24 })).json().invite;
    await other.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });

    expect((await other.c.get(`/api/characters/${ch.id}/recipes`)).json().recipes).toHaveLength(3);
    const found = (await other.c.get(`/api/groups/${g.id}/crafters?q=woolies`)).json();
    expect(found.recipes).toHaveLength(1);
    expect(found.recipes[0]).toMatchObject({ spellId: 19080, item: { name: "Warbear Woolies", quality: 4 }, known: [{ name: "Tournicoti", owner: "Tanneur" }], wanted: [] });
    const wanted = (await other.c.get(`/api/groups/${g.id}/crafters?profession=Leatherworking`)).json().recipes.find((r: { spellId: number }) => r.spellId === 19100);
    expect(wanted.wanted).toHaveLength(1);
    // « Où l'obtenir » : recette, patron et artisans des groupes du joueur (pas pour un inconnu)
    expect((await other.c.get("/api/gamedata/items/batch?ids=15065,16866")).json().items).toMatchObject({ 15065: { crafted: true }, 16866: { crafted: false } });
    const src = (await other.c.get("/api/gamedata/items/15065/sources")).json();
    expect(src.crafted).toEqual([{
      spellId: 19080, recipe: "Warbear Woolies", profession: "Leatherworking", reqSkill: 285, trainer: false,
      patterns: [{ id: 15090, name: "Pattern: Warbear Woolies", quality: 3 }], crafters: [{ name: "Tournicoti", owner: "Tanneur", mine: false }],
    }]);
    expect((await lw.c.get("/api/gamedata/items/15065/sources")).json().crafted[0].crafters).toEqual([{ name: "Tournicoti", owner: "Tanneur", mine: true }]);
    expect((await outsider.c.get("/api/gamedata/items/15065/sources")).json().crafted[0].crafters).toEqual([]);
    expect((await other.c.get("/api/gamedata/items/16866/sources")).json()).toEqual({ crafted: [] });
    expect((await outsider.c.get(`/api/groups/${g.id}/crafters`)).statusCode).toBe(404);
    expect((await other.c.get(`/api/groups/${g.id}/crafters?q=bracer`)).json().recipes).toEqual([]);
    // Changer de métier retire ses patrons de l'onglet Artisans
    await lw.c.patch(`/api/characters/${ch.id}`, { professions: { prof1: { name: "Enchanting", skill: 300 }, prof2: { name: "Skinning", skill: 300 }, cooking: 0, fishing: 0, firstAid: 0 } });
    expect((await other.c.get(`/api/groups/${g.id}/crafters?q=bracer`)).json().recipes).toHaveLength(1);
    expect((await other.c.get(`/api/groups/${g.id}/crafters?q=woolies`)).json().recipes).toEqual([]);
    await lw.c.patch(`/api/characters/${ch.id}`, { professions: { prof1: { name: "Leatherworking", skill: 300 }, prof2: { name: "Skinning", skill: 300 }, cooking: 0, fishing: 0, firstAid: 0 } });

    // Décocher supprime ; supprimer le perso nettoie ses patrons
    await lw.c.put(`/api/characters/${ch.id}/recipes/19100`, { status: null });
    expect((await lw.c.get(`/api/characters/${ch.id}/recipes`)).json().recipes).toEqual(expect.arrayContaining([{ spellId: 19080, status: "known", skillLine: 165 }]));
    await lw.c.del(`/api/characters/${ch.id}`);
    expect((await other.c.get(`/api/groups/${g.id}/crafters`)).json().recipes).toEqual([]);
  });

  it("enregistre l'objet choisi dans la base pour l'équipement", async () => {
    const { c } = await signedIn(env);
    const ch = (await c.post("/api/characters", { name: "Stuff" })).json().character;
    const r = await c.patch(`/api/characters/${ch.id}`, { gear: { Head: { cur: "Helm of Might", curId: 16866, q: 4, bis: "Helm of Might", bisId: 16866, bisQ: 4 } } });
    expect(r.statusCode).toBe(200);
    expect(r.json().character.gear.Head.curId).toBe(16866);
    // Progression affichée au survol dans la compo
    const g = (await c.post("/api/groups", { name: "Stuffés" })).json().group;
    const list = (await c.get(`/api/groups/${g.id}/characters`)).json().characters;
    expect(list[0].gearStats).toEqual({ ilvl: 66, filled: 1, got: 0, bis: 1, total: 17 });
  });
});
