import { CLASS_SPECS, CLASSES, specDef, specSlug, type ClassName } from "@forever/game-data";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Icônes de classe et de spé en émojis d'application Discord (visibles partout où le bot écrit).
 * Les fichiers viennent du dossier icons/ du serveur (monté en lecture seule) ; ils ne sont
 * jamais dans le dépôt. Émoji « fr_<classe> » pour la classe, « fr_<classe>_<spé> » pour une spé
 * (ex. fr_druid_feral_bear) ; « fr_<classe>_<n> » (arbre n, ancien rangement) reste reconnu en repli.
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

/** Nom d'émoji d'une spé (32 caractères au plus, limite de Discord). */
export function specEmojiName(cls: string, spec: string) {
  const c = CLASSES[cls as ClassName];
  return c ? `fr_${c.slug}_${specSlug(spec).replace(/-/g, "_")}`.slice(0, 32) : null;
}

/** Émoji de la spé si on l'a, sinon celui de son arbre, sinon celui de la classe, sinon rien. */
export function makeLookup(ids: Map<string, string>): EmojiLookup {
  return (cls, spec) => {
    const def = spec ? specDef(cls, spec) : null;
    for (const name of [def ? specEmojiName(cls, spec!) : null, def ? emojiName(cls, def.tree) : null, emojiName(cls)]) {
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
  for (const sub of ["class", "spec", "tree"]) {
    let entries: string[];
    try { entries = await readdir(path.join(dir, sub)); } catch { continue; }
    for (const f of entries.sort()) {
      const ext = path.extname(f).toLowerCase();
      if (!EXT.has(ext)) continue;
      const stem = path.basename(f, ext);
      let name: string | null = null;
      if (sub === "class") {
        const cls = slugToClass.get(stem);
        name = cls ? emojiName(cls) : null;
      } else if (sub === "tree") {
        const m = /^([a-z]+)-([123])$/.exec(stem);
        const cls = m && slugToClass.get(m[1]!);
        name = cls ? emojiName(cls, Number(m![2]) - 1) : null;
      } else {
        // spec/<classe>-<spé> : on retrouve la spé exacte du site
        const [slug, ...rest] = stem.split("-");
        const cls = slug ? slugToClass.get(slug) : undefined;
        const spec = cls && (CLASS_SPECS as Record<string, { name: string }[]>)[cls]?.find(d => specSlug(d.name) === rest.join("-"));
        name = cls && spec ? specEmojiName(cls, spec.name) : null;
      }
      if (name && !out.some(o => o.name === name)) out.push({ name, file: path.join(dir, sub, f) });
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
