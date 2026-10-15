/**
 * Donjons de WoW Forever, pour les sorties à 5 (lot « Sorties donjon ») : une seule difficulté chacun.
 *
 * Sources (recherche du 15/10/2026) :
 * - **nouveaux** (`new`, `confirmed`) : noms et fourchettes officiels donnés par Blizzard (Kaivax, forums EU,
 *   « clarification » après la BlizzCon : Krol'dok Stronghold est pour les niveaux 40-45, pas 55) ; zones d'après le
 *   panel de la BlizzCon (Icy Veins, Wowhead, Warcraft Tavern) ;
 * - **Classic** (`confirmed: false`) : fourchettes de Classic, qui varient selon les sources (Wowhead, GameSkinny ;
 *   Zul'Farrak d'après progameguides et PC Games) : à corriger quand le jeu sera sorti.
 * Upper Blackrock Spire n'y est pas : c'est un raid à 10, il passe par l'onglet Raids (cahier des charges, §3).
 */

export interface ForeverDungeon {
  /** Clé stable (sorties, ligne X du FRG). */
  key: string;
  /** Nom anglais, comme dans le jeu. */
  name: string;
  min: number;
  max: number;
  zone: string;
  /** Donjon propre à WoW Forever. */
  new: boolean;
  /** Fourchette officielle ; faux pour celles de Classic, à confirmer. */
  confirmed: boolean;
}

const nw = (key: string, name: string, min: number, max: number, zone: string): ForeverDungeon => ({ key, name, min, max, zone, new: true, confirmed: true });
const cl = (key: string, name: string, min: number, max: number, zone: string): ForeverDungeon => ({ key, name, min, max, zone, new: false, confirmed: false });

/** Les 28 donjons des sorties (9 de Forever, 19 de Classic), du plus bas au plus haut. */
export const FOREVER_DUNGEONS: readonly ForeverDungeon[] = [
  cl("ragefire-chasm", "Ragefire Chasm", 13, 18, "Orgrimmar"),
  nw("hall-of-thanes", "The Hall of Thanes", 13, 18, "Ironforge"),
  nw("ruins-of-lordaeron", "Ruins of Lordaeron", 15, 20, "Tirisfal Glades"),
  cl("wailing-caverns", "Wailing Caverns", 17, 24, "The Barrens"),
  cl("deadmines", "The Deadmines", 17, 26, "Westfall"),
  cl("shadowfang-keep", "Shadowfang Keep", 22, 30, "Silverpine Forest"),
  cl("blackfathom-deeps", "Blackfathom Deeps", 24, 32, "Ashenvale"),
  cl("stockade", "The Stockade", 24, 32, "Stormwind City"),
  nw("excavation-site", "Excavation Site: Wetlands", 24, 29, "Wetlands"),
  nw("city-of-dalaran", "City of Dalaran", 28, 33, "Alterac Mountains"),
  cl("gnomeregan", "Gnomeregan", 29, 38, "Dun Morogh"),
  cl("razorfen-kraul", "Razorfen Kraul", 29, 38, "The Barrens"),
  cl("scarlet-monastery", "Scarlet Monastery", 34, 45, "Tirisfal Glades"),
  nw("drowned-city", "The Drowned City", 35, 40, "Stranglethorn Vale"),
  cl("razorfen-downs", "Razorfen Downs", 37, 46, "The Barrens"),
  nw("kroldok-stronghold", "Krol'dok Stronghold", 40, 45, "Riverglades"),
  cl("uldaman", "Uldaman", 41, 51, "Badlands"),
  cl("zulfarrak", "Zul'Farrak", 44, 54, "Tanaris"),
  cl("maraudon", "Maraudon", 46, 55, "Desolace"),
  nw("alcaz-prison", "Alcaz Prison", 48, 53, "Dustwallow Marsh"),
  cl("sunken-temple", "Sunken Temple", 50, 56, "Swamp of Sorrows"),
  cl("blackrock-depths", "Blackrock Depths", 52, 60, "Blackrock Mountain"),
  nw("blackmaw-hold", "Blackmaw Hold", 55, 60, "Azshara"),
  cl("lower-blackrock-spire", "Lower Blackrock Spire", 55, 60, "Blackrock Mountain"),
  cl("dire-maul", "Dire Maul", 55, 60, "Feralas"),
  nw("shapers-terrace", "Shaper's Terrace", 58, 60, "Un'Goro Crater"),
  cl("stratholme", "Stratholme", 58, 60, "Eastern Plaguelands"),
  cl("scholomance", "Scholomance", 58, 60, "Western Plaguelands"),
];

/** Entrée « Autre (quête de groupe, élite…) » : titre libre, sans fourchette. */
export const OTHER_DUNGEON = "other";

const BY_KEY = new Map(FOREVER_DUNGEONS.map(d => [d.key, d]));
export const dungeonByKey = (key: string): ForeverDungeon | null => BY_KEY.get(key) ?? null;

/** Le perso a-t-il le niveau du donjon (fourchette incluse) ? */
export const hasDungeonLevel = (d: { min: number; max: number }, level: number) => level >= d.min && level <= d.max;

/** « N persos de la guilde ont le niveau » : persos du groupe (alts compris) dans la fourchette. */
export const charactersAtLevel = (d: { min: number; max: number }, levels: readonly number[]) => levels.filter(l => hasDungeonLevel(d, l)).length;

export interface DungeonChoice {
  dungeon: ForeverDungeon;
  /** Persos de la guilde qui ont le niveau. */
  count: number;
  /** Hors fourchette du perso : « low » (pas encore le niveau, `min` au-dessus), « high » (donjon trop bas). */
  off: "low" | "high" | null;
}

/**
 * Donjons triés pour un perso : d'abord ceux de sa fourchette (les plus fréquentés par la guilde, puis les plus hauts),
 * ensuite les autres, du plus proche de son niveau au plus loin (à égalité, ceux qui viennent avant ceux qui sont
 * dépassés). `levels` : niveaux des persos de la guilde.
 */
export function dungeonsFor(level: number, levels: readonly number[] = [], list: readonly ForeverDungeon[] = FOREVER_DUNGEONS): { fit: DungeonChoice[]; off: DungeonChoice[] } {
  const all = list.map(dungeon => ({
    dungeon, count: charactersAtLevel(dungeon, levels),
    off: level < dungeon.min ? "low" as const : level > dungeon.max ? "high" as const : null,
  }));
  const dist = (c: DungeonChoice) => (c.off === "low" ? c.dungeon.min - level : c.off === "high" ? level - c.dungeon.max : 0);
  const byName = (a: DungeonChoice, b: DungeonChoice) => a.dungeon.name.localeCompare(b.dungeon.name, "en");
  return {
    fit: all.filter(c => !c.off).sort((a, b) => b.count - a.count || b.dungeon.min - a.dungeon.min || byName(a, b)),
    off: all.filter(c => c.off).sort((a, b) => dist(a) - dist(b) || Number(a.off === "high") - Number(b.off === "high") || byName(a, b)),
  };
}

/** Raison en clair d'un donjon hors fourchette (« dès le niveau 58 », « trop bas pour Brindille »). */
export function dungeonOffReason(c: Pick<DungeonChoice, "dungeon" | "off">, characterName: string) {
  if (c.off === "low") return `dès le niveau ${c.dungeon.min}`;
  if (c.off === "high") return `trop bas pour ${characterName}`;
  return "";
}

/**
 * Perso pré-choisi pour un donjon (ou une sortie) parmi les siens : celui qui a le niveau, le main d'abord, sinon le
 * plus haut. Sans fourchette (« Autre ») : le main, sinon le plus haut. null si aucun n'a le niveau.
 */
export function pickCharacterFor<C extends { level: number; isMain?: boolean }>(range: { min: number; max: number } | null, chars: readonly C[]): C | null {
  const ok = range ? chars.filter(c => hasDungeonLevel(range, c.level)) : [...chars];
  return ok.sort((a, b) => Number(!!b.isMain) - Number(!!a.isMain) || b.level - a.level)[0] ?? null;
}
