import { HOTFIX_LAYOUTS } from "../src/gamedata/hotfix-layouts";

/** Construit un DBCache.bin (version 9) à partir d'enregistrements. */
export function cacheFile(records: { table: number; id: number; status?: number; push?: number; data?: Buffer }[], build = 70938) {
  const header = Buffer.alloc(44);
  header.write("XFTH", 0, "latin1"); header.writeUInt32LE(9, 4); header.writeUInt32LE(build, 8);
  const parts: Buffer[] = [header];
  records.forEach((r, i) => {
    const data = r.data ?? Buffer.alloc(0);
    const h = Buffer.alloc(32);
    h.write("XFTH", 0, "latin1"); h.writeInt32LE(93, 4); h.writeInt32LE(r.push ?? 112000 + i, 8); h.writeUInt32LE(i, 12);
    h.writeUInt32LE(r.table, 16); h.writeUInt32LE(r.id, 20); h.writeInt32LE(data.length, 24); h.writeUInt8(r.status ?? 1, 28);
    parts.push(h, data);
  });
  return Buffer.concat(parts);
}

const SIZE: Record<string, number> = { i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, i64: 8, u64: 8, f32: 4 };
/** Ligne de correctif d'une table, d'après sa disposition (valeurs absentes : 0 ou chaîne vide). */
export function encodeRow(table: string, values: Record<string, string | number>) {
  const parts: Buffer[] = [];
  for (const spec of HOTFIX_LAYOUTS[table]!.fields.split(" ")) {
    const [name, def] = spec.split(":") as [string, string];
    const [type, n] = def.split("*") as [string, string | undefined];
    const count = n ? Number(n) : 1;
    for (let k = 0; k < count; k++) {
      const v = values[count > 1 ? `${name}_${k}` : name];
      if (type === "s") { parts.push(Buffer.from(`${v ?? ""}\0`, "utf8")); continue; }
      const b = Buffer.alloc(SIZE[type]!), x = Number(v ?? 0);
      if (type === "f32") b.writeFloatLE(x);
      else if (type === "i64" || type === "u64") b.writeBigInt64LE(BigInt(x));
      else if (type.startsWith("u")) b.writeUIntLE(x, 0, SIZE[type]!);
      else b.writeIntLE(x, 0, SIZE[type]!);
      parts.push(b);
    }
  }
  return Buffer.concat(parts);
}
