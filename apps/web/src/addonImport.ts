/**
 * Application d'un export de l'addon (bloc FRC d'un perso) à une fiche : utilisée par le collage n'importe où (Ctrl+V)
 * et la page Addon (tous les persos d'un coup). L'objectif BiS, les intitulés de spé, l'off-spec et les notes ne sont jamais touchés.
 */
import { GEAR_SLOTS, INVTYPE_2H, isValidCombo, withoutCurrent, PROFESSION_SKILL_LINES, professionsFromExport, sameCharacter, SIGNUP_LABEL, type CharacterExport } from "@forever/game-data";
import { ApiError, get, patch, post, put, type Character, type GameItem } from "./api";
import { linkFromRanks, type Talent } from "./components/TalentTrees";

export type Part = "identity" | "gear" | "professions" | "recipes" | "talents" | "signups";
export const PARTS: [Part, string][] = [
  ["identity", "Niveau, race et classe"], ["gear", "Équipement porté"], ["professions", "Métiers"],
  ["recipes", "Patrons connus et recherchés"], ["talents", "Talents"], ["signups", "Inscriptions aux raids"],
];
export const ALL_PARTS = new Set<Part>(PARTS.map(p => p[0]));

const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""}`;

/** Talents en jeu → lien du calculateur et répartition (arbres de Forever de la classe). */
export async function talentBuild(cls: string, d: CharacterExport, talents?: Talent[]) {
  if (!cls || !d.talents.length) return null;
  const list = talents ?? (await get<{ talents: Talent[] }>(`/gamedata/talents/${encodeURIComponent(cls)}`).catch(() => ({ talents: [] }))).talents;
  return list.length ? linkFromRanks(cls, list, new Map(d.talents.map(t => [t.id, t.rank]))) : null;
}

/** Champs de la fiche à modifier (à enregistrer par l'appelant). */
export async function buildPatch(c: Character, d: CharacterExport, parts: Set<Part>, talents?: Talent[]): Promise<Partial<Character>> {
  const patch: Partial<Character> = {};
  if (parts.has("identity")) {
    if (d.level !== c.level) patch.level = d.level;
    if (d.cls && !c.cls) patch.cls = d.cls;
    if (d.race && !c.race && isValidCombo(d.race, d.cls ?? c.cls)) patch.race = d.race;
  }
  if (parts.has("gear") && Object.keys(d.gear).length) {
    const ids = [...new Set(Object.values(d.gear))];
    const { items } = await get<{ items: Record<number, GameItem> }>(`/gamedata/items/batch?ids=${ids.join(",")}`);
    const gear = { ...c.gear };
    // L'export liste ce qui est porté : un emplacement absent est vide en jeu (objet retiré, main gauche sous une arme à
    // deux mains). L'objectif BiS reste.
    for (const slot of GEAR_SLOTS) {
      const id = d.gear[slot];
      const it = id ? items[id] : undefined;
      if (id) gear[slot] = { ...gear[slot], cur: it?.name ?? `Objet ${id}`, curId: it ? id : null, q: it?.quality ?? null };
      else if (gear[slot]) gear[slot] = withoutCurrent(gear[slot])!;
    }
    const main = d.gear["Main Hand"];
    if (main && items[main]?.inventoryType === INVTYPE_2H && gear["Off Hand"]) gear["Off Hand"] = withoutCurrent(gear["Off Hand"])!;
    patch.gear = gear;
  }
  if (parts.has("professions") && d.professions.length) patch.professions = professionsFromExport(d.professions);
  if (parts.has("talents") && d.talents.length) {
    patch.talentNodes = d.talents;
    const build = await talentBuild(d.cls ?? c.cls, d, talents);
    if (build) { patch.talents = build.split; patch.talentLink = build.link; }
  }
  return patch;
}

/** Ce qui s'enregistre à part : patrons connus et recherchés, inscriptions. Renvoie un résumé à afficher. */
export async function applyExtras(characterId: string, d: CharacterExport, parts: Set<Part>): Promise<string> {
  const out: string[] = [];
  if (parts.has("recipes") && d.recipes.length) {
    const res = await post<{ known: number; unknown: number }>(`/characters/${characterId}/recipes/import`, {
      spellIds: d.recipes.flatMap(x => (x.spellId ? [x.spellId] : [])), itemIds: d.recipes.flatMap(x => (x.itemId ? [x.itemId] : [])),
      professions: d.professions.map(p => p.name).filter(n => n in PROFESSION_SKILL_LINES),
    });
    out.push(`${plural(res.known, "patron")} coché${res.known > 1 ? "s" : ""}${res.unknown ? `, ${res.unknown} inconnu${res.unknown > 1 ? "s" : ""} de la base` : ""}`);
  }
  if (parts.has("recipes") && d.wanted.length) {
    const res = await post<{ added: number; removed: number; unknown: number }>(`/characters/${characterId}/recipes/wanted`, {
      add: d.wanted.filter(w => w.on).map(w => w.itemId), remove: d.wanted.filter(w => !w.on).map(w => w.itemId),
    });
    if (res.added || res.removed) out.push(`${res.added} recherché${res.added > 1 ? "s" : ""} ajouté${res.added > 1 ? "s" : ""}${res.removed ? `, ${res.removed} retiré${res.removed > 1 ? "s" : ""}` : ""}`);
  }
  if (parts.has("signups") && d.signups.length) {
    let ok = 0;
    for (const s of d.signups) {
      try { await put(`/groups/${s.groupId}/raids/${s.raidId}/signup`, { status: s.status, characterId }); ok++; } catch { /* raid supprimé ou groupe quitté */ }
    }
    out.push(`${plural(ok, "inscription")} aux raids${ok < d.signups.length ? ` (${d.signups.length - ok} impossible${d.signups.length - ok > 1 ? "s" : ""} : raid supprimé ou perso sans classe)` : ""}`);
  }
  return out.join(" · ");
}

/* ---------- Plusieurs persos d'un coup (page Addon, collage n'importe où) ---------- */

/** Fiche choisie pour un perso du jeu : id d'une fiche, « new » (la créer) ou « skip » (l'ignorer). */
export type Target = string;
export const blockKey = (d: CharacterExport) => `${d.name}-${d.realm}`;

const MAP_KEY = "fr-addon-fiches";
function rememberedMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(MAP_KEY) ?? "{}") as Record<string, string>; } catch { return {}; }
}
function remember(key: string, id: string) {
  try { localStorage.setItem(MAP_KEY, JSON.stringify({ ...rememberedMap(), [key]: id })); } catch { /* préférence non gardée */ }
}

/** Fiche proposée : celle choisie la dernière fois, sinon même prénom et même classe, sinon une nouvelle fiche. */
export function guessTarget(d: CharacterExport, mine: Character[]): Target {
  const saved = rememberedMap()[blockKey(d)];
  if (saved && mine.some(c => c.id === saved && (!c.cls || !d.cls || c.cls === d.cls))) return saved;
  return mine.find(c => sameCharacter(d.name, c.name) && (!c.cls || !d.cls || c.cls === d.cls))?.id ?? "new";
}

export interface ApplyResult { name: string; ok: boolean; msg: string }

/** Applique chaque bloc à sa fiche (créée au besoin) ; la date de dernière synchro est notée sur la fiche. */
export async function applyBlocks(blocks: CharacterExport[], targetOf: (d: CharacterExport) => Target, parts: Set<Part>, mine: Character[]): Promise<ApplyResult[]> {
  const out: ApplyResult[] = [];
  for (const d of blocks) {
    const t = targetOf(d);
    if (t === "skip") continue;
    try {
      let c = mine.find(x => x.id === t);
      if (t === "new") c = (await post<{ character: Character }>("/characters", { name: d.name })).character;
      if (!c) throw new Error("fiche introuvable");
      if (d.cls && c.cls && d.cls !== c.cls) { out.push({ name: d.name, ok: false, msg: `classe différente sur la fiche (${c.cls})` }); continue; }
      // Une nouvelle fiche prend toujours niveau, race et classe
      const p = await buildPatch(c, d, t === "new" ? new Set<Part>([...parts, "identity"]) : parts);
      // Consommables comptés en jeu (lot G) : toujours repris, ils servent à l'onglet Préparation des raids
      await patch(`/characters/${c.id}`, { ...p, addonSynced: true, ...(Object.keys(d.consumables).length && { consumables: d.consumables }) });
      const extras = await applyExtras(c.id, d, parts);
      remember(blockKey(d), c.id);
      out.push({ name: d.name, ok: true, msg: `${t === "new" ? "fiche créée" : "fiche mise à jour"}${extras ? ` · ${extras}` : ""}` });
    } catch (e) {
      out.push({ name: d.name, ok: false, msg: e instanceof ApiError ? e.message : "mise à jour impossible" });
    }
  }
  return out;
}

/** Résumé court d'un bloc (ce que l'export apporte). */
export function blockSummary(d: CharacterExport) {
  const parts = [`niv. ${d.level}`];
  const gear = Object.keys(d.gear).length;
  if (gear) parts.push(plural(gear, "pièce"));
  if (d.recipes.length) parts.push(plural(d.recipes.length, "patron"));
  if (d.talents.length) parts.push(`${d.talents.reduce((a, t) => a + t.rank, 0)} pts de talents`);
  if (d.signups.length) parts.push(plural(d.signups.length, "inscription"));
  if (d.wanted.length) parts.push(`${d.wanted.length} recherché${d.wanted.length > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

/** « il y a 2 h », « hier », « il y a 9 jours » ; stale : plus d'une semaine. */
export function syncAge(at?: string | null) {
  if (!at) return { text: "jamais synchronisé", stale: true };
  const h = (Date.now() - new Date(at).getTime()) / 3600_000;
  if (h < 1) return { text: "synchro il y a moins d'une heure", stale: false };
  if (h < 24) return { text: `synchro il y a ${Math.floor(h)} h`, stale: false };
  const d = Math.floor(h / 24);
  return { text: d === 1 ? "synchro hier" : `synchro il y a ${d} jours`, stale: d > 7 };
}
