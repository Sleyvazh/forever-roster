import type { ItemRow } from "./extract";

/**
 * Lecture du cache de correctifs du client (Cache/ADB/<langue>/DBCache.bin).
 *
 * Environ 40 % des objets de Forever ne sont pas dans les fichiers du jeu : le serveur les envoie
 * aux clients dès qu'un joueur les découvre (correctifs à chaud), et le client les garde dans ce cache.
 * wago.tools ne publie que les fichiers ; ce cache est donc la seule source pour ces objets.
 *
 * Format (version 9) : en-tête « XFTH », version, build, empreinte (32 octets), soit 44 octets ;
 * puis des enregistrements : « XFTH », région, push, identifiant unique, empreinte de table, id de ligne,
 * taille, statut (1 = valide, 2 = supprimé), puis la ligne brute (chaînes terminées par un zéro).
 */

const MAGIC = 0x48544658; // « XFTH »
const HEADER = 44, RECORD_HEADER = 32;
export const TABLE_HASH = { ItemSparse: 0x919be54e, Item: 0x50238ec2 } as const;
const VALID = 1, DELETED = 2;

export interface CacheRecord { table: number; id: number; push: number; data: Buffer }
export interface DbCache { version: number; build: number; records: CacheRecord[] }

export function parseDbCache(buf: Buffer): DbCache {
  if (buf.length < HEADER || buf.readUInt32LE(0) !== MAGIC) throw new Error("Ce fichier n'est pas un DBCache.bin (en-tête XFTH absent).");
  const version = buf.readUInt32LE(4), build = buf.readUInt32LE(8);
  if (version !== 9) throw new Error(`Version de DBCache.bin non gérée : ${version} (attendue : 9).`);
  // Dernier état connu de chaque ligne : un enregistrement plus loin dans le fichier remplace le précédent.
  const latest = new Map<string, CacheRecord | null>();
  let off = HEADER;
  while (off + RECORD_HEADER <= buf.length) {
    if (buf.readUInt32LE(off) !== MAGIC) throw new Error(`DBCache.bin illisible à l'octet ${off}.`);
    const push = buf.readInt32LE(off + 8), table = buf.readUInt32LE(off + 16), id = buf.readUInt32LE(off + 20);
    const size = buf.readInt32LE(off + 24), status = buf.readUInt8(off + 28);
    if (size < 0 || off + RECORD_HEADER + size > buf.length) throw new Error(`DBCache.bin tronqué à l'octet ${off}.`);
    const key = `${table}:${id}`;
    if (status === VALID && size > 0) latest.set(key, { table, id, push, data: buf.subarray(off + RECORD_HEADER, off + RECORD_HEADER + size) });
    else if (status === DELETED) latest.set(key, null);
    off += RECORD_HEADER + size;
  }
  return { version, build, records: [...latest.values()].filter((r): r is CacheRecord => !!r) };
}

/** Taille de la partie fixe d'une ligne ItemSparse de Forever 1.60 (après les 5 chaînes). */
const ITEM_SPARSE_TAIL = 302;
const ITEM_SIZE = 43;

/** Ligne ItemSparse : Description, Display3, Display2, Display1, Display, puis les champs fixes. */
export function decodeItemSparse(data: Buffer) {
  let i = 0;
  const strings: string[] = [];
  for (let n = 0; n < 5; n++) {
    const end = data.indexOf(0, i);
    if (end < 0) return null;
    strings.push(data.toString("utf8", i, end));
    i = end + 1;
  }
  if (data.length - i !== ITEM_SPARSE_TAIL) return null;
  const len = data.length;
  return {
    name: strings[4]!,
    itemLevel: data.readUInt16LE(len - 22),
    reqLevel: data.readUInt8(len - 4),
    inventoryType: data.readUInt8(len - 3),
    quality: Math.min(7, data.readUInt8(len - 2)),
  };
}

/** Ligne Item : classe, sous-classe, emplacement. */
export function decodeItem(data: Buffer) {
  if (data.length !== ITEM_SIZE) return null;
  return { classId: data.readUInt8(0), subclassId: data.readUInt8(4), inventoryType: data.readUInt8(6) };
}

/**
 * Objets du cache prêts à insérer. S'arrête si trop de lignes ne correspondent pas à la structure
 * connue (nouvelle version du client) : mieux vaut ne rien importer que des objets faux.
 */
export function itemsFromCache(cache: DbCache, className: Map<number, string>, subName: Map<string, string>) {
  const items = new Map<number, Buffer>(), bases = new Map<number, Buffer>();
  for (const r of cache.records) {
    if (r.table === TABLE_HASH.ItemSparse) items.set(r.id, r.data);
    else if (r.table === TABLE_HASH.Item) bases.set(r.id, r.data);
  }
  const rows: ItemRow[] = [];
  let unreadable = 0;
  for (const [id, data] of items) {
    const s = decodeItemSparse(data);
    if (!s || !s.name) { unreadable++; continue; }
    const b = bases.get(id);
    const base = b ? decodeItem(b) : null;
    const classId = base?.classId ?? 0, subclassId = base?.subclassId ?? 0;
    const kind = [className.get(classId), subName.get(`${classId}:${subclassId}`)].filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i).join(" · ");
    rows.push({ id, name: s.name, quality: s.quality, itemLevel: s.itemLevel, reqLevel: s.reqLevel, classId, subclassId, inventoryType: base?.inventoryType ?? s.inventoryType, kind, origin: "forever" });
  }
  if (items.size && unreadable > items.size * 0.1) {
    throw new Error(`${unreadable} objets sur ${items.size} ne correspondent pas à la structure connue : le format du client a changé.`);
  }
  return { rows, unreadable };
}

/** Ajoute les objets du cache : ils remplacent les compléments Classic Era, jamais les objets des fichiers Forever. */
export function mergeCache(items: ItemRow[], cacheRows: ItemRow[]): { items: ItemRow[]; added: number; replacedEra: number } {
  const byId = new Map(items.map(i => [i.id, i]));
  let added = 0, replacedEra = 0;
  for (const r of cacheRows) {
    const cur = byId.get(r.id);
    if (!cur) { byId.set(r.id, r); added++; }
    else if (cur.origin === "era") { byId.set(r.id, r); replacedEra++; }
  }
  return { items: [...byId.values()], added, replacedEra };
}
