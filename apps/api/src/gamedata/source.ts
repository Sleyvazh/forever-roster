import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "./csv";
import { TABLES, type TableName, type Tables } from "./extract";

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

/** Dernière version de Forever publiée sur wago.tools, tous produits confondus (bêta puis live). */
export async function latestBuild(fetchImpl: typeof fetch = fetch): Promise<{ product: string; version: string }> {
  const res = await fetchImpl(`${WAGO}/api/builds`, { headers: UA });
  if (!res.ok) throw new Error(`wago.tools /api/builds : HTTP ${res.status}`);
  const data = await res.json() as Record<string, { version: string }[]>;
  let best: { product: string; version: string } | null = null;
  for (const [product, list] of Object.entries(data)) {
    if (!Array.isArray(list)) continue;
    for (const b of list) if (b?.version && isForeverBuild(b.version) && (!best || newer(b.version, best.version))) best = { product, version: b.version };
  }
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

/** Lit les tables depuis un dossier de fichiers <Table>.csv (import hors ligne, tests). */
export async function readTables(dir: string): Promise<Tables> {
  const out = {} as Tables;
  for (const name of Object.keys(TABLES) as TableName[]) out[name] = parseCsv(await readFile(path.join(dir, `${name}.csv`), "utf8"));
  return out;
}
