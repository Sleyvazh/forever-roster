/**
 * Icônes officielles de Blizzard pour les classes propres à WoW Retail (chevalier de la mort, chasseur de démons,
 * évocateur, moine) et leurs spés, que Pahpool ne dessine pas (Roster). Ce sont des fichiers de Blizzard : ils restent
 * dans icons/retail/ du serveur, jamais dans Git. PNG 64×64 transparents, comme les icônes de rôle :
 *   icons/retail/class/<slug>.png         death-knight.png, demon-hunter.png, evoker.png, monk.png
 *   icons/retail/spec/<slug>-<spé>.png    death-knight-blood.png, evoker-augmentation.png…
 * Les slugs viennent de RETAIL_ONLY_CLASS_SLUGS et specSlug (packages/game-data) : le site et le bot les reconstruisent.
 *
 * Sources, dans l'ordre :
 *  1. classes : serveur d'images officiel de Blizzard (classicon_deathknight.jpg…), comme les icônes d'objets ;
 *  2. spés : table ChrSpecialization du client Retail sur wago.tools (produit « wow », pas Forever), rapprochée par le nom
 *     anglais de la spé (Name_lang) pour les classes 6, 10, 12 et 13 (ClassID, mêmes numéros que l'API de Blizzard) ;
 *     elle donne l'identifiant du fichier de l'icône (SpellIconFileID), téléchargé en BLP puis converti ;
 *  3. spé introuvable (absente de la table, fichier absent) : copie de l'icône de la classe, signalée dans la sortie.
 *     Une copie se reconnaît à son contenu (identique à l'icône de la classe) : elle est réessayée à l'appel suivant.
 * Idempotent : un fichier déjà là n'est pas retéléchargé ; sans réseau, on le dit et on continue (le site affiche l'initiale).
 */
import { RETAIL_CLASS_IDS, RETAIL_CLASSES, RETAIL_ONLY_CLASS_SLUGS, specSlug } from "@forever/game-data";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { blpToPng, fetchBlp } from "./blp";
import { col } from "./csv";
import { downloadDb2, listBuilds, newer, UA } from "./source";

/** Serveur d'images officiel de Blizzard (même adresse que scripts/fetch-item-icons.sh). */
export const CDN = "https://render.worldofwarcraft.com/us/icons/56";
/** Produits Retail de wago.tools, du plus sûr au plus expérimental : le premier qui a une version publiée l'emporte. */
export const RETAIL_PRODUCTS = ["wow", "wowt", "wowxptr", "wow_beta"];
/** Côté des PNG produits (comme icons/roles/). */
export const ICON_SIZE = 64;

/** Nom du fichier d'icône d'une classe propre à Retail sur le serveur d'images (« death-knight » → classicon_deathknight). */
export const classIconName = (slug: string) => `classicon_${slug.replace(/-/g, "")}`;

/** Dernière version de WoW Retail publiée sur wago.tools (produit « wow » de préférence), ou null s'il n'y en a aucune. */
export async function latestRetailBuild(fetchImpl: typeof fetch = fetch): Promise<{ product: string; version: string } | null> {
  const data = await listBuilds(fetchImpl);
  for (const product of RETAIL_PRODUCTS) {
    const list = data[product];
    if (!Array.isArray(list)) continue;
    let best: string | null = null;
    for (const b of list) if (b?.version && (!best || newer(b.version, best))) best = b.version;
    if (best) return { product, version: best };
  }
  return null;
}

/**
 * Lignes de ChrSpecialization → identifiant du fichier d'icône de chaque spé des classes propres à Retail,
 * sous la clé « <classe>:<spé> » (« Death Knight:Blood »). Rapprochement par le nom anglais, casse ignorée ;
 * les autres classes et les spés inconnues du site sont ignorées.
 */
export function findRetailSpecIcons(rows: Record<string, string>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const cls = RETAIL_CLASS_IDS[Number(col(r, "ClassID"))];
    if (!cls || !Object.hasOwn(RETAIL_ONLY_CLASS_SLUGS, cls)) continue;
    const name = col(r, "Name_lang", "Name")?.trim().toLowerCase();
    const spec = RETAIL_CLASSES[cls]?.specs.find(s => s.name.toLowerCase() === name);
    const fid = Number(col(r, "SpellIconFileID"));
    const key = spec && `${cls}:${spec.name}`;
    if (key && Number.isInteger(fid) && fid > 0 && !out.has(key)) out.set(key, fid);
  }
  return out;
}

/** JPEG du serveur d'images → PNG 64×64 (on vérifie que c'est bien un JPEG : une page d'erreur ne passe pas). */
async function fetchClassIcon(slug: string, fetchImpl: typeof fetch) {
  const url = `${CDN}/${classIconName(slug)}.jpg`;
  const res = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.toString("hex", 0, 3) !== "ffd8ff") throw new Error(`pas un JPEG (${url})`);
  return sharp(buf).resize(ICON_SIZE, ICON_SIZE, { fit: "fill" }).png().toBuffer();
}

const readIf = async (file: string) => { try { const b = await readFile(file); return b.length ? b : null; } catch { return null; } };

export interface RetailIconsResult {
  /** Fichiers écrits (slug de classe ou « <classe>-<spé> »). */
  done: string[];
  /** Spés introuvables, écrites en copie de l'icône de leur classe. */
  copied: string[];
  /** Fichiers ni téléchargés ni remplacés (avec la raison). */
  failed: string[];
  /** Fichiers déjà là, laissés tels quels. */
  skipped: number;
}

export interface RetailIconsOptions {
  /** Remplacé par les tests (faux serveur local). */
  fetch?: typeof fetch;
  log?: (m: string) => void;
  /** Branches (produits) de wago.tools où chercher les fichiers BLP ; par défaut le produit retenu puis les autres de Retail. */
  branches?: string[];
}

/**
 * Remplit <out>/class/ et <out>/spec/ avec les icônes manquantes. Ne lève jamais pour une cause réseau : les ennuis sont
 * écrits dans le journal et comptés dans `failed`, et on renvoie quand même (sortie 0 pour le script shell).
 */
export async function fetchRetailIcons(out: string, opts: RetailIconsOptions = {}): Promise<RetailIconsResult> {
  const fetchImpl = opts.fetch ?? fetch, log = opts.log ?? console.log;
  const classDir = path.join(out, "class"), specDir = path.join(out, "spec");
  await mkdir(classDir, { recursive: true });
  await mkdir(specDir, { recursive: true });
  const res: RetailIconsResult = { done: [], copied: [], failed: [], skipped: 0 };

  // 1. Classes, depuis le serveur d'images officiel (on garde les octets : repli des spés et détection des copies)
  const classPng = new Map<string, Buffer>();
  for (const [cls, slug] of Object.entries(RETAIL_ONLY_CLASS_SLUGS)) {
    const file = path.join(classDir, `${slug}.png`);
    const existing = await readIf(file);
    if (existing) { classPng.set(cls, existing); res.skipped++; continue; }
    try {
      const png = await fetchClassIcon(slug, fetchImpl);
      await writeFile(file, png);
      classPng.set(cls, png);
      res.done.push(slug);
    } catch (err) { res.failed.push(`${slug} (${(err as Error).message})`); }
  }

  // 2. Spés manquantes, ou simples copies de l'icône de classe (repli d'un appel précédent : on réessaie)
  const todo: { cls: string; spec: string; name: string; file: string }[] = [];
  for (const [cls, slug] of Object.entries(RETAIL_ONLY_CLASS_SLUGS)) {
    for (const s of RETAIL_CLASSES[cls]!.specs) {
      const name = `${slug}-${specSlug(s.name)}`, file = path.join(specDir, `${name}.png`);
      const existing = await readIf(file);
      if (existing && !classPng.get(cls)?.equals(existing)) { res.skipped++; continue; }
      todo.push({ cls, spec: s.name, name, file });
    }
  }
  if (!todo.length) { summary(log, res, null); return res; }

  let build: { product: string; version: string } | null = null, icons: Map<string, number>;
  try {
    build = await latestRetailBuild(fetchImpl);
    if (!build) throw new Error("aucune version de WoW Retail publiée");
    icons = findRetailSpecIcons(await downloadDb2("ChrSpecialization", build.version, fetchImpl));
  } catch (err) {
    log(`wago.tools injoignable (${(err as Error).message}) : les icônes de spé Retail attendront le prochain appel.`);
    res.failed.push(...todo.map(j => `${j.name} (wago.tools injoignable)`));
    summary(log, res, build);
    return res;
  }
  const branches = opts.branches ?? [...new Set([build.product, ...RETAIL_PRODUCTS])];
  for (const job of todo) {
    const fid = icons.get(`${job.cls}:${job.spec}`);
    let png: Buffer | null = null, why = fid ? `fichier ${fid} introuvable sur wago.tools` : `absente de ChrSpecialization (version ${build.version})`;
    try {
      const blp = fid ? await fetchBlp(fid, branches, fetchImpl) : null;
      if (blp) png = await blpToPng(blp, ICON_SIZE);
    } catch (err) { why = (err as Error).message; }
    if (png) { await writeFile(job.file, png); res.done.push(job.name); continue; }
    const fallback = classPng.get(job.cls);
    if (!fallback) { res.failed.push(`${job.name} (${why}, et pas d'icône de classe à copier)`); continue; }
    await writeFile(job.file, fallback);
    res.copied.push(job.name);
    log(`icône de spé introuvable : ${job.name} (${why}) ; copie de l'icône de la classe en attendant.`);
  }
  summary(log, res, build);
  return res;
}

function summary(log: (m: string) => void, res: RetailIconsResult, build: { product: string; version: string } | null) {
  const parts = [`${res.done.length} téléchargée(s)`, `${res.skipped} déjà là`];
  if (res.copied.length) parts.push(`${res.copied.length} copie(s) de l'icône de classe`);
  if (res.failed.length) parts.push(`${res.failed.length} manquante(s) : ${res.failed.join(", ")}`);
  log(`Icônes des classes Retail${build ? ` (${build.product} ${build.version})` : ""} : ${parts.join(", ")}.`);
}
