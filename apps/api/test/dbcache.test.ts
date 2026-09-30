import { describe, expect, it } from "vitest";
import { decodeItemSparse, itemsFromCache, mergeCache, parseDbCache, TABLE_HASH } from "../src/gamedata/dbcache";
import type { ItemRow } from "../src/gamedata/extract";

/** Construit un DBCache.bin (version 9) à partir d'enregistrements. */
function cacheFile(records: { table: number; id: number; status?: number; data?: Buffer }[]) {
  const header = Buffer.alloc(44);
  header.write("XFTH", 0, "latin1"); header.writeUInt32LE(9, 4); header.writeUInt32LE(69977, 8);
  const parts: Buffer[] = [header];
  records.forEach((r, i) => {
    const data = r.data ?? Buffer.alloc(0);
    const h = Buffer.alloc(32);
    h.write("XFTH", 0, "latin1"); h.writeInt32LE(70, 4); h.writeInt32LE(1000 + i, 8); h.writeUInt32LE(i, 12);
    h.writeUInt32LE(r.table, 16); h.writeUInt32LE(r.id, 20); h.writeInt32LE(data.length, 24); h.writeUInt8(r.status ?? 1, 28);
    parts.push(h, data);
  });
  return Buffer.concat(parts);
}
function sparse(name: string, ilvl: number, req: number, inv: number, quality: number) {
  const tail = Buffer.alloc(302);
  tail.writeUInt16LE(ilvl, 302 - 22); tail.writeUInt8(req, 302 - 4); tail.writeUInt8(inv, 302 - 3); tail.writeUInt8(quality, 302 - 2);
  return Buffer.concat([Buffer.from(`\0\0\0\0${name}\0`, "utf8"), tail]);
}
function item(cls: number, sub: number, inv: number) {
  const b = Buffer.alloc(43); b.writeUInt8(cls, 0); b.writeUInt8(sub, 4); b.writeUInt8(inv, 6); return b;
}
const row = (id: number, name: string, origin: ItemRow["origin"]): ItemRow =>
  ({ id, name, quality: 1, itemLevel: 1, reqLevel: 0, classId: 0, subclassId: 0, inventoryType: 0, kind: "", origin });

describe("cache de correctifs du client (DBCache.bin)", () => {
  it("lit les objets révélés, garde le dernier état et ignore les autres tables", () => {
    const buf = cacheFile([
      { table: TABLE_HASH.ItemSparse, id: 5404, data: sparse("Serpent's Shoulders (v1)", 20, 15, 3, 2) },
      { table: TABLE_HASH.ItemSparse, id: 5404, data: sparse("Serpent's Shoulders", 23, 18, 3, 3) },
      { table: TABLE_HASH.Item, id: 5404, data: item(4, 2, 3) },
      { table: TABLE_HASH.ItemSparse, id: 280000, data: sparse("Objet retiré", 10, 5, 1, 2) },
      { table: TABLE_HASH.ItemSparse, id: 280000, status: 2 },
      { table: 0x12345678, id: 1, data: Buffer.from("autre table") },
    ]);
    const cache = parseDbCache(buf);
    expect(cache.build).toBe(69977);
    const { rows } = itemsFromCache(cache, new Map([[4, "Armor"]]), new Map([["4:2", "Leather"]]));
    expect(rows).toEqual([{ id: 5404, name: "Serpent's Shoulders", quality: 3, itemLevel: 23, reqLevel: 18, classId: 4, subclassId: 2, inventoryType: 3, kind: "Armor · Leather", origin: "forever" }]);
  });

  it("ajoute sans jamais écraser un objet des fichiers du jeu, mais remplace un complément Classic Era", () => {
    const cacheRows = [row(1, "Du cache", "forever"), row(2, "Du cache", "forever"), row(3, "Du cache", "forever")];
    const { items, added, replacedEra } = mergeCache([row(1, "Fichiers Forever", "forever"), row(2, "Classic Era", "era")], cacheRows);
    expect(Object.fromEntries(items.map(i => [i.id, i.name]))).toEqual({ 1: "Fichiers Forever", 2: "Du cache", 3: "Du cache" });
    expect({ added, replacedEra }).toEqual({ added: 1, replacedEra: 1 });
  });

  it("refuse un fichier inconnu ou une structure qui a changé", () => {
    expect(() => parseDbCache(Buffer.from("PNG pas un cache"))).toThrow(/XFTH/);
    const v10 = cacheFile([]); v10.writeUInt32LE(10, 4);
    expect(() => parseDbCache(v10)).toThrow(/Version/);
    expect(decodeItemSparse(Buffer.concat([Buffer.from("\0\0\0\0Nom\0"), Buffer.alloc(290)]))).toBeNull();
    const broken = cacheFile(Array.from({ length: 5 }, (_, i) => ({ table: TABLE_HASH.ItemSparse, id: i + 1, data: Buffer.from("\0\0\0\0Nom\0abc") })));
    expect(() => itemsFromCache(parseDbCache(broken), new Map(), new Map())).toThrow(/format du client a changé/);
  });
});
