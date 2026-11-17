import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDbCache } from "../src/gamedata/dbcache";
import { addDetails } from "../src/gamedata/details";
import { extract } from "../src/gamedata/extract";
import { applyHotfixes, collectHotfixes, decodeHotfixRow, removedItems } from "../src/gamedata/hotfix";
import { HOTFIX_LAYOUTS } from "../src/gamedata/hotfix-layouts";
import { readDetailTables, readTables } from "../src/gamedata/source";
import { cacheFile, encodeRow } from "./cache-helpers";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/gamedata");
const H = (t: string) => HOTFIX_LAYOUTS[t]!.hash;

/** Lignes réelles du cache d'un client de Forever 1.60.1.70938 (17/11/2026). */
const REAL = {
  BludstoneHammer: "00000000426c756473746f6e652048616d6d657200000000009a99193f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000401f0000050d000000000000000000000000000000000000000000000000000000000000000000000600000007000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff01000000000000000000000000000000ffffffffffffffff7dcd000071030400010000000000803f0000803f00000000044000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000034080000000000003d00ffff000000000000030200020000000038150300",
  BludstoneHammerItem: "020000000402150300000000ffc00702000800000000000000000000000000000000000000000000000000",
  ArcanistRegalia: "417263616e69737420526567616c696100000000000000000000003768040038680400396804003a6804003b6804003c6804003d6804003e680400000000000000000000000000000000000000000000000000000000000000000000000000",
  PotionEffectLink: "1ca7030080680400",
  PotionEffect: "0000ffff00000000c0d401000400ca0f0000000000000000",
};
const hex = (s: string) => Buffer.from(s, "hex");

describe("correctifs du serveur lus dans le cache du jeu", () => {
  it("décode les lignes réelles comme les CSV de wago.tools (objet, set, effet)", () => {
    expect(decodeHotfixRow("ItemSparse", 13028, hex(REAL.BludstoneHammer))).toMatchObject({
      ID: "13028", Display_lang: "Bludstone Hammer", ItemLevel: "61", RequiredLevel: "56", OverallQualityID: "3", InventoryType: "21",
      StatModifier_bonusStat_0: "6", StatPercentEditor_0: "8000", StatModifier_bonusStat_1: "7", StatPercentEditor_1: "3333",
      DmgVariance: "0.6", ItemDelay: "2100", SellPrice: "52605", Bonding: "2",
    });
    expect(decodeHotfixRow("Item", 13028, hex(REAL.BludstoneHammerItem))).toMatchObject({ ClassID: "2", SubclassID: "4", InventoryType: "21", IconFileDataID: "133056" });
    const set = decodeHotfixRow("ItemSet", 2138, hex(REAL.ArcanistRegalia))!;
    expect(set.Name_lang).toBe("Arcanist Regalia");
    expect([0, 1, 7, 8].map(k => set[`ItemID_${k}`])).toEqual(["288823", "288824", "288830", "0"]);
    expect(decodeHotfixRow("ItemXItemEffect", 171436, hex(REAL.PotionEffectLink))).toEqual({ ID: "171436", ItemEffectID: "239388", ItemID: "288896" });
    expect(decodeHotfixRow("ItemEffect", 239388, hex(REAL.PotionEffect))).toMatchObject({ SpellID: "4042", TriggerType: "0", CategoryCoolDownMSec: "120000" });
  });

  it("refuse une ligne qui ne correspond pas exactement à la disposition", () => {
    expect(decodeHotfixRow("ItemXItemEffect", 1, hex("1ca70300806804"))).toBeNull(); // trop courte
    expect(decodeHotfixRow("ItemXItemEffect", 1, hex("1ca703008068040000"))).toBeNull(); // trop longue
    expect(decodeHotfixRow("ItemSet", 1, Buffer.from("sans zéro final"))).toBeNull();
    expect(decodeHotfixRow("TableInconnue", 1, Buffer.alloc(4))).toBeNull();
    // Identifiant dans les données différent de celui de l'enregistrement
    expect(decodeHotfixRow("ItemModifiedAppearance", 5, encodeRow("ItemModifiedAppearance", { ID: 6, ItemID: 1 }))).toBeNull();
  });

  it("plusieurs caches : le correctif le plus récent l'emporte, retraits compris", () => {
    const a = parseDbCache(cacheFile([
      { table: H("SpellName"), id: 1, push: 100, data: encodeRow("SpellName", { Name_lang: "Ancien nom" }) },
      { table: H("SpellName"), id: 2, push: 300, data: encodeRow("SpellName", { Name_lang: "Gardé" }) },
      { table: H("SpellName"), id: 3, push: 100, data: encodeRow("SpellName", { Name_lang: "Retiré plus tard" }) },
    ]));
    const b = parseDbCache(cacheFile([
      { table: H("SpellName"), id: 1, push: 200, data: encodeRow("SpellName", { Name_lang: "Nouveau nom" }) },
      { table: H("SpellName"), id: 2, push: 150, data: encodeRow("SpellName", { Name_lang: "Plus ancien" }) },
      { table: H("SpellName"), id: 3, push: 250, status: 2 },
      { table: H("SpellName"), id: 4, push: 250, data: Buffer.from("illisible") },
      { table: 0x12345678, id: 5, data: Buffer.from("table non lue par l'import") },
    ]));
    const hot = collectHotfixes([a, b]);
    const names = hot.tables.get("SpellName")!;
    expect(names.get(1)?.Name_lang).toBe("Nouveau nom");
    expect(names.get(2)?.Name_lang).toBe("Gardé");
    expect(names.get(3)).toBeNull();
    expect(names.has(4)).toBe(false);
    expect(hot.counts.get("SpellName")).toEqual({ rows: 2, removed: 1, unreadable: 1 });
    expect([...hot.tables.keys()]).toEqual(["SpellName"]);
  });

  it("applique comme le jeu : remplace, ajoute, retire ; laisse une table illisible ou absente", () => {
    const tables: Partial<Record<string, Record<string, string>[]>> = {
      SpellName: [{ ID: "1", Name_lang: "Fichier" }, { ID: "2", Name_lang: "Retirée" }, { ID: "3", Name_lang: "Intacte" }],
      ItemSet: [{ ID: "9", Name_lang: "Set des fichiers", ItemID_0: "1" }],
    };
    const hot = collectHotfixes([parseDbCache(cacheFile([
      { table: H("SpellName"), id: 1, data: encodeRow("SpellName", { Name_lang: "Correctif" }) },
      { table: H("SpellName"), id: 2, status: 2 },
      { table: H("SpellName"), id: 9, data: encodeRow("SpellName", { Name_lang: "Nouvelle" }) },
      // ItemSet : 1 ligne lisible sur 2, au-delà de 10 % d'illisibles → table laissée telle quelle
      { table: H("ItemSet"), id: 9, data: encodeRow("ItemSet", { Name_lang: "Set corrigé" }) },
      { table: H("ItemSet"), id: 10, data: Buffer.from("illisible") },
      // Table non téléchargée (absente des fichiers) : rien à corriger
      { table: H("TraitEdge"), id: 1, data: encodeRow("TraitEdge", { ID: 1 }) },
    ]))]);
    const report = applyHotfixes(tables, hot);
    expect(tables.SpellName).toEqual([{ ID: "1", Name_lang: "Correctif" }, { ID: "3", Name_lang: "Intacte" }, { ID: "9", Name_lang: "Nouvelle" }]);
    expect(tables.ItemSet).toEqual([{ ID: "9", Name_lang: "Set des fichiers", ItemID_0: "1" }]);
    expect(report).toEqual([
      { table: "ItemSet", added: 0, replaced: 0, removed: 0, unreadable: 1, skipped: "illisible" },
      { table: "SpellName", added: 1, replaced: 1, removed: 1, unreadable: 0, skipped: false },
      { table: "TraitEdge", added: 0, replaced: 0, removed: 0, unreadable: 0, skipped: "absent" },
    ]);
  });

  it("de bout en bout : un objet révélé avec son effet, un objet corrigé, un objet retiré par le serveur", async () => {
    const tables = await readTables(FIXTURES);
    const details = await readDetailTables(FIXTURES);
    const hot = collectHotfixes([parseDbCache(cacheFile([
      // Objet de Forever absent des fichiers, avec un effet « Chances quand vous touchez » (sort 21992 des fichiers)
      { table: H("ItemSparse"), id: 290001, data: encodeRow("ItemSparse", { Display_lang: "Lame de Forever", ItemLevel: 80, RequiredLevel: 60, OverallQualityID: 4, InventoryType: 13, ItemDelay: 2600, DmgVariance: 0.4, ...{ StatModifier_bonusStat_0: 7, StatPercentEditor_0: 10000 } }) },
      { table: H("Item"), id: 290001, data: encodeRow("Item", { ClassID: 2, SubclassID: 7, InventoryType: 13, IconFileDataID: 135274 }) },
      { table: H("ItemEffect"), id: 900001, data: encodeRow("ItemEffect", { TriggerType: 2, SpellID: 21992 }) },
      { table: H("ItemXItemEffect"), id: 900001, data: encodeRow("ItemXItemEffect", { ItemEffectID: 900001, ItemID: 290001 }) },
      // Leather Hat rééquilibré par Forever
      { table: H("ItemSparse"), id: 4000, data: encodeRow("ItemSparse", { Display_lang: "Leather Hat", ItemLevel: 25, RequiredLevel: 20, OverallQualityID: 2, InventoryType: 1 }) },
      // Light Leather retiré par le serveur
      { table: H("ItemSparse"), id: 2318, status: 2 },
    ]))]);
    const all: Partial<Record<string, Record<string, string>[]>> = { ...tables, ...details };
    applyHotfixes(all, hot);
    const data = extract(all as typeof tables);
    addDetails(data.items, { ...all, ItemEffect: all.ItemEffect, ItemXItemEffect: all.ItemXItemEffect, SpellEffect: all.SpellEffect });
    const byId = new Map(data.items.map(i => [i.id, i]));
    expect(byId.get(290001)).toMatchObject({ name: "Lame de Forever", itemLevel: 80, reqLevel: 60, quality: 4, classId: 2, subclassId: 7, origin: "forever", iconFileId: 135274 });
    expect(byId.get(290001)!.details?.effects?.[0]).toMatchObject({ trigger: 2 });
    expect(byId.get(290001)!.details?.effects?.[0]?.text).toMatch(/^Blasts your enemy with lightning/);
    expect(byId.get(290001)!.details?.dmg?.speed).toBe(2.6);
    expect(byId.get(4000)).toMatchObject({ itemLevel: 25, reqLevel: 20 });
    expect(byId.has(2318)).toBe(false);
    expect([...removedItems(hot)]).toEqual([2318]);
  });
});
