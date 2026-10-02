/**
 * Application d'un export de l'addon (bloc FRC d'un perso) à une fiche : partagée par la fiche (« Importer depuis l'addon »)
 * et la page Addon (tous les persos d'un coup). L'objectif BiS, les intitulés de spé, l'off-spec et les notes ne sont jamais touchés.
 */
import { isValidCombo, PROFESSION_SKILL_LINES, professionsFromExport, SIGNUP_LABEL, type CharacterExport } from "@forever/game-data";
import { get, post, put, type Character, type GameItem } from "./api";
import { linkFromRanks, type Talent } from "./components/TalentTrees";

export type Part = "identity" | "gear" | "professions" | "recipes" | "talents" | "signups";
export const PARTS: [Part, string][] = [
  ["identity", "Niveau, race et classe"], ["gear", "Équipement porté"], ["professions", "Métiers"],
  ["recipes", "Patrons connus et recherchés"], ["talents", "Talents"], ["signups", "Inscriptions aux raids"],
];
export const ALL_PARTS = new Set<Part>(PARTS.map(p => p[0]));

const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""}`;

/** Résumé de chaque partie de l'export (affiché à côté des cases à cocher). */
export function partSummary(d: CharacterExport, build: { split: string } | null): Record<Part, string> {
  const gear = Object.keys(d.gear).length;
  const spent = d.talents.reduce((a, t) => a + t.rank, 0);
  const marked = d.wanted.length;
  return {
    identity: `niveau ${d.level}${d.cls ? ` · ${d.cls}` : ""}${d.race ? ` · ${d.race}` : ""}`,
    gear: plural(gear, "pièce"),
    professions: d.professions.map(p => `${p.name} ${p.skill}`).join(", ") || "aucun lu (addon 0.1.3 ou plus)",
    recipes: `${plural(d.recipes.length, "patron")}${marked ? ` · ${marked} marqué${marked > 1 ? "s" : ""} en jeu` : ""}${d.recipes.length || marked ? "" : " (ouvre tes fenêtres de métier en jeu)"}${d.ignored.length ? ` · ignorés : ${d.ignored.join(", ")}` : ""}`,
    talents: build ? `répartition ${build.split} (spé principale)` : `${plural(spent, "point")} dans ${d.talents.filter(t => t.rank > 0).length} talents`,
    signups: d.signups.length ? d.signups.map(s => SIGNUP_LABEL[s.status]).join(", ") : "aucune",
  };
}

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
    for (const [slot, id] of Object.entries(d.gear)) {
      const it = items[id!];
      gear[slot] = { ...gear[slot], cur: it?.name ?? `Objet ${id}`, curId: it ? id : null, q: it?.quality ?? null };
    }
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
