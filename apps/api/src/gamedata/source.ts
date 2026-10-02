import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "./csv";
import { checkDetailTable, DETAIL_TABLES, ITEM_TABLES, TABLES, type DetailTableName, type DetailTables, type TableName, type Tables } from "./extract";

const WAGO = "https://wago.tools";
const UA = { "User-Agent": "forever-roster (+https://github.com/Sleyvazh/forever-roster)" };

const versionKey = (v: string) => v.split(".").map(n => Number(n));
const newer = (a: string, b: string) => {
  const x = versionKey(a), y = versionKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

/** WoW Forever porte des numéros de version 1.60.x (Classic Era est en 1.15.x). */
export const isForeverBuild = (v: string) => { const [maj, min] = versionKey(v); return maj === 1 && (min ?? 0) >= 60; };

/** Classic Era (1.13 à 1.15) : sert à compléter les objets absents du client Forever. */
export const isEraBuild = (v: string) => { const [maj, min] = versionKey(v); return maj === 1 && (min ?? 0) >= 13 && (min ?? 0) < 60; };

/** Dernière version de Classic Era (hors serveurs de test) publiée sur wago.tools. */
export async function latestEraBuild(fetchImpl: typeof fetch = fetch): Promise<{ product: string; version: string } | null> {
  const res = await fetchImpl(`${WAGO}/api/builds`, { headers: UA });
  if (!res.ok) throw new Error(`wago.tools /api/builds : HTTP ${res.status}`);
  const data = await res.json() as Record<string, { version: string }[]>;
  let best: { product: string; version: string } | null = null;
  for (const [product, list] of Object.entries(data)) {
    if (!Array.isArray(list) || !product.startsWith("wow_classic_era") || product.includes("ptr")) continue;
    for (const b of list) if (b?.version && isEraBuild(b.version) && (!best || newer(b.version, best.version))) best = { product, version: b.version };
  }
  return best;
}

/** Produits régionaux (Chine, Corée, Taïwan) : contenu et calendrier parfois différents de la version européenne. */
const isRegional = (product: string) => /_(cn|kr|tw)(_|$)/.test(product);

/**
 * Dernière version de Forever publiée sur wago.tools (bêta ou live), hors produits régionaux,
 * sauf s'il n'existe qu'eux.
 */
export async function latestBuild(fetchImpl: typeof fetch = fetch): Promise<{ product: string; version: string }> {
  const res = await fetchImpl(`${WAGO}/api/builds`, { headers: UA });
  if (!res.ok) throw new Error(`wago.tools /api/builds : HTTP ${res.status}`);
  const data = await res.json() as Record<string, { version: string }[]>;
  const pick = (allowRegional: boolean) => {
    let best: { product: string; version: string } | null = null;
    for (const [product, list] of Object.entries(data)) {
      if (!Array.isArray(list) || (!allowRegional && isRegional(product))) continue;
      for (const b of list) if (b?.version && isForeverBuild(b.version) && (!best || newer(b.version, best.version))) best = { product, version: b.version };
    }
    return best;
  };
  const best = pick(false) ?? pick(true);
  if (!best) throw new Error("Aucune version de WoW Forever trouvée sur wago.tools.");
  return best;
}

async function download(url: string, fetchImpl: typeof fetch, tries = 4): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetchImpl(url, { headers: UA });
      const text = await res.text();
      if (!res.ok || text.startsWith("{")) throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`);
      return text;
    } catch (err) {
      if (attempt >= tries) throw new Error(`Téléchargement impossible : ${url} (${(err as Error).message})`);
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
}

/** Télécharge les tables nécessaires pour une version, une par une (on reste poli avec wago.tools). */
export async function downloadTables(build: string, fetchImpl: typeof fetch = fetch, log: (m: string) => void = () => {}): Promise<Tables> {
  const out = {} as Tables;
  for (const name of Object.keys(TABLES) as TableName[]) {
    log(`  ${name}…`);
    out[name] = parseCsv(await download(`${WAGO}/db2/${name}/csv?build=${encodeURIComponent(build)}`, fetchImpl));
  }
  return out;
}

/** Tables des infobulles : chacune est facultative (absente ou modifiée → ignorée avec un avertissement). */
export async function downloadDetailTables(build: string, fetchImpl: typeof fetch = fetch, log: (m: string) => void = () => {}): Promise<DetailTables> {
  const out: DetailTables = {};
  for (const name of Object.keys(DETAIL_TABLES) as DetailTableName[]) {
    log(`  ${name}…`);
    try { out[name] = checkDetailTable(name, parseCsv(await download(`${WAGO}/db2/${name}/csv?build=${encodeURIComponent(build)}`, fetchImpl, 2)), log); }
    catch (err) { log(`  ${name} ignorée : ${(err as Error).message}`); }
  }
  return out;
}

export async function readDetailTables(dir: string, log: (m: string) => void = () => {}): Promise<DetailTables> {
  const out: DetailTables = {};
  for (const name of Object.keys(DETAIL_TABLES) as DetailTableName[]) {
    try { out[name] = checkDetailTable(name, parseCsv(await readFile(path.join(dir, `${name}.csv`), "utf8")), log); } catch { /* table absente */ }
  }
  return out;
}

/** Listfile communautaire (numéro de fichier → chemin), lu ligne par ligne sans tout garder en mémoire. */
export async function* listfileLines(fetchImpl: typeof fetch = fetch): AsyncGenerator<string> {
  const res = await fetchImpl("https://github.com/wowdev/wow-listfile/releases/latest/download/community-listfile.csv", { headers: UA });
  if (!res.ok || !res.body) throw new Error(`listfile : HTTP ${res.status}`);
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { yield buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1); }
  }
  if (buf) yield buf;
}

/** Tables des objets seules (ItemSparse, Item) d'une version, pour le complément Classic Era. */
export async function downloadItemTables(build: string, fetchImpl: typeof fetch = fetch, log: (m: string) => void = () => {}) {
  const out = {} as Pick<Tables, (typeof ITEM_TABLES)[number]>;
  for (const name of ITEM_TABLES) {
    log(`  ${name} (Classic Era)…`);
    out[name] = parseCsv(await download(`${WAGO}/db2/${name}/csv?build=${encodeURIComponent(build)}`, fetchImpl));
  }
  return out;
}

export async function readItemTables(dir: string) {
  const out = {} as Pick<Tables, (typeof ITEM_TABLES)[number]>;
  for (const name of ITEM_TABLES) out[name] = parseCsv(await readFile(path.join(dir, `${name}.csv`), "utf8"));
  return out;
}

/** Lit les tables depuis un dossier de fichiers <Table>.csv (import hors ligne, tests). */
export async function readTables(dir: string): Promise<Tables> {
  const out = {} as Tables;
  for (const name of Object.keys(TABLES) as TableName[]) out[name] = parseCsv(await readFile(path.join(dir, `${name}.csv`), "utf8"));
  return out;
}
