import { CLASSES, specDef, type ClassName } from "@forever/game-data";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Icônes de classe et de spé en émojis d'application Discord (visibles partout où le bot écrit).
 * Les fichiers viennent du dossier icons/ du serveur (monté en lecture seule) ; ils ne sont
 * jamais dans le dépôt. Émoji « fr_<classe> » pour la classe, « fr_<classe>_<n> » pour l'arbre n.
 */

export type EmojiLookup = (cls: string, spec?: string | null) => string;
export const noEmoji: EmojiLookup = () => "";

const MAX_BYTES = 256 * 1024; // limite de Discord pour un émoji
const EXT = new Set([".png", ".jpg", ".jpeg", ".gif"]);

export function emojiName(cls: string, tree?: number | null) {
  const c = CLASSES[cls as ClassName];
  if (!c) return null;
  return tree === undefined || tree === null ? `fr_${c.slug}` : `fr_${c.slug}_${tree + 1}`;
}

/** Émoji de la spé (arbre principal) si on l'a, sinon celui de la classe, sinon rien. */
export function makeLookup(ids: Map<string, string>): EmojiLookup {
  return (cls, spec) => {
    const tree = spec ? specDef(cls, spec)?.tree : undefined;
    for (const name of [tree !== undefined ? emojiName(cls, tree) : null, emojiName(cls)]) {
      const id = name && ids.get(name);
      if (id) return `<:${name}:${id}>`;
    }
    return "";
  };
}

/** Fichiers d'icônes disponibles → nom d'émoji attendu. */
export async function iconFiles(dir: string): Promise<{ name: string; file: string }[]> {
  const out: { name: string; file: string }[] = [];
  const slugToClass = new Map<string, string>(Object.entries(CLASSES).map(([k, v]) => [v.slug, k]));
  for (const sub of ["class", "tree"]) {
    let entries: string[];
    try { entries = await readdir(path.join(dir, sub)); } catch { continue; }
    for (const f of entries.sort()) {
      const ext = path.extname(f).toLowerCase();
      if (!EXT.has(ext)) continue;
      const stem = path.basename(f, ext);
      const m = sub === "class" ? /^([a-z]+)$/.exec(stem) : /^([a-z]+)-([123])$/.exec(stem);
      const cls = m && slugToClass.get(m[1]!);
      if (!cls) continue;
      const name = emojiName(cls, sub === "tree" ? Number(m![2]) - 1 : null)!;
      if (!out.some(o => o.name === name)) out.push({ name, file: path.join(dir, sub, f) });
    }
  }
  return out;
}

export interface EmojiApi {
  list(): Promise<{ id: string; name: string | null }[]>;
  create(name: string, data: Buffer): Promise<{ id: string; name: string | null }>;
}

/** Envoie à Discord les icônes qui n'y sont pas encore ; renvoie la table nom → id. */
export async function syncEmojis(dir: string, api: EmojiApi, log: (msg: string) => void) {
  const ids = new Map<string, string>();
  for (const e of await api.list()) if (e.name?.startsWith("fr_")) ids.set(e.name, e.id);
  let added = 0;
  for (const { name, file } of await iconFiles(dir)) {
    if (ids.has(name)) continue;
    const { size } = await stat(file);
    if (size > MAX_BYTES) { log(`Icône trop lourde pour un émoji (${Math.round(size / 1024)} Ko > 256 Ko) : ${file}`); continue; }
    try {
      const e = await api.create(name, await readFile(file));
      ids.set(name, e.id);
      added++;
    } catch (err) { log(`Émoji ${name} refusé par Discord : ${(err as Error).message}`); }
  }
  if (added) log(`${added} émoji(s) ajouté(s).`);
  return ids;
}
