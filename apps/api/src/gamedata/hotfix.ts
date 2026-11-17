import type { DbCache } from "./dbcache";
import { HOTFIX_LAYOUTS } from "./hotfix-layouts";

/**
 * Correctifs du serveur de Forever, lus dans le cache du jeu (DBCache.bin) et appliqués aux tables du client comme le fait
 * le jeu : une ligne du correctif remplace celle des fichiers (ou s'y ajoute), une ligne « retirée » disparaît.
 *
 * Le cache contient bien plus que les objets : leurs effets (ItemEffect, ItemXItemEffect, SpellEffect, SpellName, Spell),
 * les sets (ItemSet, ItemSetSpell), les apparences qui donnent les icônes, les talents modifiés (Trait*) et des recettes
 * (SkillLineAbility, SpellReagents). Chaque ligne est décodée d'après la disposition de sa table (hotfix-layouts.ts,
 * généré depuis WoWDBDefs) en colonnes nommées comme les CSV de wago.tools, pour passer ensuite par le même chemin.
 *
 * Plusieurs caches (plusieurs joueurs) s'additionnent : pour une même ligne, le correctif le plus récent (numéro de
 * diffusion le plus grand) l'emporte.
 */

type FieldType = "i8" | "u8" | "i16" | "u16" | "i32" | "u32" | "i64" | "u64" | "f32" | "s";
interface Field { name: string; type: FieldType; count: number }
const SIZE: Record<Exclude<FieldType, "s">, number> = { i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, i64: 8, u64: 8, f32: 4 };

const parsed = new Map<string, Field[]>();
function fieldsOf(table: string): Field[] | undefined {
  const def = HOTFIX_LAYOUTS[table];
  if (!def) return undefined;
  let f = parsed.get(table);
  if (!f) {
    f = def.fields.split(" ").map(s => {
      const [name, spec] = s.split(":") as [string, string];
      const [type, count] = spec.split("*");
      return { name, type: type as FieldType, count: count ? Number(count) : 1 };
    });
    parsed.set(table, f);
  }
  return f;
}
const tableOfHash = new Map(Object.entries(HOTFIX_LAYOUTS).map(([name, d]) => [d.hash, name]));

/** Nombre décimal sur 32 bits écrit comme dans les CSV (« 0.95 », pas « 0.949999988079071 »). */
const float = (v: number) => String(Number.isFinite(v) ? Number(v.toPrecision(7)) : 0);

/**
 * Une ligne de correctif → colonnes nommées (tableaux : Nom_0, Nom_1…), ID compris. null si les données ne correspondent
 * pas exactement à la disposition (version du client différente) : mieux vaut ignorer la ligne que lire des valeurs fausses.
 */
export function decodeHotfixRow(table: string, id: number, data: Buffer): Record<string, string> | null {
  const fields = fieldsOf(table);
  if (!fields) return null;
  const row: Record<string, string> = { ID: String(id) };
  let o = 0;
  try {
    for (const f of fields) {
      for (let k = 0; k < f.count; k++) {
        const key = f.count > 1 ? `${f.name}_${k}` : f.name;
        if (f.type === "s") {
          const end = data.indexOf(0, o);
          if (end < 0) return null;
          row[key] = data.toString("utf8", o, end);
          o = end + 1;
          continue;
        }
        if (o + SIZE[f.type] > data.length) return null;
        switch (f.type) {
          case "i8": row[key] = String(data.readInt8(o)); break;
          case "u8": row[key] = String(data.readUInt8(o)); break;
          case "i16": row[key] = String(data.readInt16LE(o)); break;
          case "u16": row[key] = String(data.readUInt16LE(o)); break;
          case "i32": row[key] = String(data.readInt32LE(o)); break;
          case "u32": row[key] = String(data.readUInt32LE(o)); break;
          case "i64": row[key] = String(data.readBigInt64LE(o)); break;
          case "u64": row[key] = String(data.readBigUInt64LE(o)); break;
          case "f32": row[key] = float(data.readFloatLE(o)); break;
        }
        o += SIZE[f.type];
      }
    }
  } catch { return null; }
  if (o !== data.length) return null;
  // Identifiant dans les données (tables à identifiant « en ligne ») : il doit être celui de l'enregistrement
  if (row.ID !== String(id)) return null;
  return row;
}

/** Correctifs d'une table : ligne décodée, ou null si le serveur l'a retirée. */
export type TableHotfixes = Map<number, Record<string, string> | null>;
export interface TableCounts { rows: number; removed: number; unreadable: number; latestBuild: number; latestRows: number; latestUnreadable: number }
export interface Hotfixes {
  tables: Map<string, TableHotfixes>;
  /**
   * Par table : lignes lues, retirées, illisibles (disposition différente) ; et pour la version du client la plus récente
   * de la table, ses lignes lues et illisibles (des lignes d'une ancienne version peuvent ne plus se lire sans que la
   * table soit en cause).
   */
  counts: Map<string, TableCounts>;
  builds: number[];
}

/**
 * Réunit les correctifs de plusieurs caches. Pour chaque ligne, le plus récent l'emporte (numéro de diffusion, puis ordre
 * des fichiers) ; les tables que l'import ne lit pas sont ignorées.
 */
export function collectHotfixes(caches: DbCache[]): Hotfixes {
  const best = new Map<string, { table: string; id: number; push: number; build: number; data: Buffer | null }>();
  for (const cache of caches) {
    const all = [...cache.records.map(r => ({ ...r, removed: false })), ...cache.removed.map(r => ({ ...r, data: Buffer.alloc(0), removed: true }))];
    for (const r of all) {
      const table = tableOfHash.get(r.table);
      if (!table) continue;
      const key = `${table}:${r.id}`;
      const cur = best.get(key);
      if (cur && cur.push > r.push) continue;
      best.set(key, { table, id: r.id, push: r.push, build: cache.build, data: r.removed ? null : r.data });
    }
  }
  const tables = new Map<string, TableHotfixes>();
  const counts = new Map<string, TableCounts>();
  const latest = new Map<string, number>();
  for (const { table, build, data } of best.values()) if (data && build > (latest.get(table) ?? -1)) latest.set(table, build);
  for (const { table, id, build, data } of best.values()) {
    const c = counts.get(table) ?? { rows: 0, removed: 0, unreadable: 0, latestBuild: latest.get(table) ?? 0, latestRows: 0, latestUnreadable: 0 };
    counts.set(table, c);
    let row: Record<string, string> | null = null;
    if (data) {
      row = decodeHotfixRow(table, id, data);
      const isLatest = build === c.latestBuild;
      if (!row) { c.unreadable++; if (isLatest) c.latestUnreadable++; continue; }
      c.rows++; if (isLatest) c.latestRows++;
    } else c.removed++;
    const t = tables.get(table) ?? new Map();
    t.set(id, row);
    tables.set(table, t);
  }
  return { tables, counts, builds: caches.map(c => c.build) };
}

/**
 * Part de lignes illisibles, parmi celles de la version du client la plus récente de la table, au-delà de laquelle la table
 * est ignorée (disposition changée : relancer scripts/hotfix-layouts.mjs). Une ligne illisible est toujours ignorée seule.
 */
const MAX_UNREADABLE = 0.1;

/** `skipped` : « absent » (table non téléchargée), « illisible » (trop de lignes ne correspondent pas à la disposition). */
export interface HotfixReport { table: string; added: number; replaced: number; removed: number; unreadable: number; skipped: false | "absent" | "illisible" }

/**
 * Applique les correctifs aux tables lues (CSV de wago.tools), sur place. Une table dont trop de lignes sont illisibles
 * n'est pas touchée ; une table absente des fichiers (non téléchargée) non plus.
 */
export function applyHotfixes(tables: Partial<Record<string, Record<string, string>[]>>, hot: Hotfixes): HotfixReport[] {
  const report: HotfixReport[] = [];
  for (const [table, fixes] of hot.tables) {
    const rows = tables[table];
    const c = hot.counts.get(table)!;
    const r: HotfixReport = { table, added: 0, replaced: 0, removed: 0, unreadable: c.unreadable, skipped: false };
    report.push(r);
    if (c.latestUnreadable > (c.latestRows + c.latestUnreadable) * MAX_UNREADABLE) { r.skipped = "illisible"; continue; }
    if (!rows) { r.skipped = "absent"; continue; }
    const at = new Map(rows.map((row, i) => [row.ID, i]));
    const gone = new Set<number>();
    for (const [id, row] of fixes) {
      const i = at.get(String(id));
      if (row === null) { if (i !== undefined) { gone.add(i); r.removed++; } continue; }
      if (i !== undefined) { rows[i] = { ...rows[i], ...row }; r.replaced++; }
      else { rows.push(row); r.added++; }
    }
    if (gone.size) tables[table] = rows.filter((_, i) => !gone.has(i));
  }
  // Une table dont la disposition a changé pour une partie seulement des lignes : on le dit aussi
  for (const [table, c] of hot.counts) {
    if (!hot.tables.has(table) && c.unreadable) report.push({ table, added: 0, replaced: 0, removed: 0, unreadable: c.unreadable, skipped: "illisible" });
  }
  return report.sort((a, b) => a.table.localeCompare(b.table));
}

/** Identifiants d'objets retirés par le serveur (ItemSparse) : à ne pas compléter avec Classic Era non plus. */
export function removedItems(hot: Hotfixes) {
  return new Set([...(hot.tables.get("ItemSparse") ?? new Map()).entries()].filter(([, row]) => row === null).map(([id]) => id));
}
