/**
 * Lecture du cache de correctifs du client (Cache/ADB/<langue>/DBCache.bin).
 *
 * Une bonne part des données de Forever n'est pas dans les fichiers du jeu : le serveur envoie des correctifs aux clients
 * (objets, leurs effets, sets, talents, recettes…), et chaque client les garde dans ce cache. wago.tools ne publie que les
 * fichiers ; ce cache est donc la seule source pour ces lignes. Elles sont décodées et appliquées par hotfix.ts.
 *
 * Format (version 9) : en-tête « XFTH », version, build, empreinte (32 octets), soit 44 octets ;
 * puis des enregistrements : « XFTH », région, numéro de diffusion (push), identifiant unique, empreinte de table, id de
 * ligne, taille, statut, puis la ligne brute (chaînes terminées par un zéro). Statuts : 1 valide, 2 ligne retirée par le
 * serveur, 3 identifiant inconnu du serveur (demandé par le client, rien à en tirer), 4 non public.
 */

const MAGIC = 0x48544658; // « XFTH »
const HEADER = 44, RECORD_HEADER = 32;
/** Empreintes des deux tables des objets (les autres : hotfix-layouts.ts). */
export const TABLE_HASH = { ItemSparse: 0x919be54e, Item: 0x50238ec2 } as const;
const VALID = 1, REMOVED = 2;

export interface CacheRecord { table: number; id: number; push: number; data: Buffer }
export interface DbCache {
  version: number; build: number;
  /** Dernier état valide de chaque ligne. */
  records: CacheRecord[];
  /** Lignes retirées par le serveur (dernier état connu) : elles disparaissent aussi des fichiers. */
  removed: Omit<CacheRecord, "data">[];
}

export function parseDbCache(buf: Buffer): DbCache {
  if (buf.length < HEADER || buf.readUInt32LE(0) !== MAGIC) throw new Error("Ce fichier n'est pas un DBCache.bin (en-tête XFTH absent).");
  const version = buf.readUInt32LE(4), build = buf.readUInt32LE(8);
  if (version !== 9) throw new Error(`Version de DBCache.bin non gérée : ${version} (attendue : 9).`);
  // Dernier état connu de chaque ligne : un enregistrement plus loin dans le fichier remplace le précédent.
  const latest = new Map<string, { rec: CacheRecord; removed: boolean }>();
  let off = HEADER;
  while (off + RECORD_HEADER <= buf.length) {
    if (buf.readUInt32LE(off) !== MAGIC) throw new Error(`DBCache.bin illisible à l'octet ${off}.`);
    const push = buf.readInt32LE(off + 8), table = buf.readUInt32LE(off + 16), id = buf.readUInt32LE(off + 20);
    const size = buf.readInt32LE(off + 24), status = buf.readUInt8(off + 28);
    if (size < 0 || off + RECORD_HEADER + size > buf.length) throw new Error(`DBCache.bin tronqué à l'octet ${off}.`);
    const key = `${table}:${id}`;
    if (status === VALID && size > 0) latest.set(key, { rec: { table, id, push, data: buf.subarray(off + RECORD_HEADER, off + RECORD_HEADER + size) }, removed: false });
    else if (status === REMOVED) latest.set(key, { rec: { table, id, push, data: Buffer.alloc(0) }, removed: true });
    off += RECORD_HEADER + size;
  }
  const records: CacheRecord[] = [], removed: Omit<CacheRecord, "data">[] = [];
  for (const { rec, removed: r } of latest.values()) {
    if (r) removed.push({ table: rec.table, id: rec.id, push: rec.push });
    else records.push(rec);
  }
  return { version, build, records, removed };
}

/**
 * Plusieurs caches dans un seul flux (entrée standard du conteneur) : « FRCACHES\n », puis pour chaque fichier sa taille
 * en octets suivie d'un saut de ligne, puis ses octets. Un flux qui commence par « XFTH » est un cache seul.
 */
export function splitCaches(buf: Buffer): Buffer[] {
  if (buf.length >= 4 && buf.readUInt32LE(0) === MAGIC) return [buf];
  const head = "FRCACHES\n";
  if (buf.toString("latin1", 0, head.length) !== head) throw new Error("Flux de caches illisible (attendu : FRCACHES ou un DBCache.bin).");
  const out: Buffer[] = [];
  let off = head.length;
  while (off < buf.length) {
    const nl = buf.indexOf(0x0a, off);
    const size = nl > off && nl - off <= 12 ? Number(buf.toString("latin1", off, nl)) : NaN;
    if (!Number.isInteger(size) || size <= 0 || nl + 1 + size > buf.length) throw new Error(`Flux de caches tronqué à l'octet ${off}.`);
    out.push(buf.subarray(nl + 1, nl + 1 + size));
    off = nl + 1 + size;
  }
  return out;
}
