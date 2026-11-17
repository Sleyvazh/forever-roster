import { describe, expect, it } from "vitest";
import { parseDbCache, splitCaches, TABLE_HASH } from "../src/gamedata/dbcache";
import { cacheFile } from "./cache-helpers";

describe("cache de correctifs du client (DBCache.bin)", () => {
  it("garde le dernier état de chaque ligne : valide, retirée par le serveur ; ignore les identifiants inconnus", () => {
    const buf = cacheFile([
      { table: TABLE_HASH.ItemSparse, id: 5404, data: Buffer.from("v1") },
      { table: TABLE_HASH.ItemSparse, id: 5404, data: Buffer.from("v2") },
      { table: TABLE_HASH.ItemSparse, id: 280000, data: Buffer.from("retiré ensuite") },
      { table: TABLE_HASH.ItemSparse, id: 280000, status: 2 },
      { table: TABLE_HASH.ItemSparse, id: 6099, status: 2, push: -1 },
      { table: TABLE_HASH.ItemSparse, id: 999999, status: 3 }, // demandé par le client, inconnu du serveur
      { table: 0x12345678, id: 1, data: Buffer.from("autre table") },
    ]);
    const cache = parseDbCache(buf);
    expect(cache.build).toBe(70938);
    expect(cache.records.map(r => [r.id, r.data.toString()])).toEqual([[5404, "v2"], [1, "autre table"]]);
    expect(cache.removed.map(r => r.id).sort((x, y) => x - y)).toEqual([6099, 280000]);
  });

  it("refuse un fichier inconnu, une autre version ou un fichier tronqué", () => {
    expect(() => parseDbCache(Buffer.from("PNG pas un cache"))).toThrow(/XFTH/);
    const v10 = cacheFile([]); v10.writeUInt32LE(10, 4);
    expect(() => parseDbCache(v10)).toThrow(/Version/);
    const cut = cacheFile([{ table: TABLE_HASH.Item, id: 1, data: Buffer.alloc(43) }]);
    expect(() => parseDbCache(cut.subarray(0, cut.length - 10))).toThrow(/tronqué/);
  });

  it("plusieurs caches dans un seul flux (entrée standard du conteneur)", () => {
    const a = cacheFile([{ table: TABLE_HASH.Item, id: 1, data: Buffer.from("a") }]), b = cacheFile([], 70888);
    expect(splitCaches(a)).toEqual([a]);
    const stream = Buffer.concat([Buffer.from(`FRCACHES\n${a.length}\n`), a, Buffer.from(`${b.length}\n`), b]);
    expect(splitCaches(stream).map(parseDbCache).map(c => c.build)).toEqual([70938, 70888]);
    expect(() => splitCaches(Buffer.from("n'importe quoi"))).toThrow(/illisible/);
    expect(() => splitCaches(stream.subarray(0, stream.length - 5))).toThrow(/tronqué/);
  });
});
