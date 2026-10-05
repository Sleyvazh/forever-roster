/**
 * Export d'un perso par l'addon (format FRC v1, voir docs/addon-format.md) : lecture côté site.
 * L'addon envoie ce que le jeu affiche ; on le traduit dans le vocabulaire du site (classes, races, métiers, emplacements).
 */
import { CLASSES, GEAR_SLOTS, PRIMARY_PROFESSIONS, SIGNUP_STATUSES, type ClassName, type SignupStatus } from "./core";

type Slot = (typeof GEAR_SLOTS)[number];

/** Emplacements du jeu (INVSLOT) → emplacements du site. */
const SLOT_BY_INVSLOT: Record<number, Slot> = {
  1: "Head", 2: "Neck", 3: "Shoulder", 15: "Back", 5: "Chest", 9: "Wrist", 10: "Hands", 6: "Waist", 7: "Legs", 8: "Feet",
  11: "Finger 1", 12: "Finger 2", 13: "Trinket 1", 14: "Trinket 2", 16: "Main Hand", 17: "Off Hand", 18: "Ranged / Relic",
};
const RACE_BY_FILE: Record<string, string> = {
  Human: "Human", Dwarf: "Dwarf", NightElf: "Night Elf", Gnome: "Gnome", Orc: "Orc", Scourge: "Undead", Undead: "Undead", Tauren: "Tauren", Troll: "Troll",
};
/** Race du jeu → race du site. Les Skyborne ont un seul nom de fichier : la faction départage High Order et Windshaper. */
const raceFromGame = (file: string, faction: string) =>
  file === "Skyborne" ? (faction === "Horde" ? "Skyborne (Windshaper)" : faction === "Alliance" ? "Skyborne (High Order)" : null) : RACE_BY_FILE[file] ?? null;
/** Noms des métiers tels que le jeu les affiche (anglais ou français) → nom du site. */
const PROFESSION_NAMES: Record<string, string> = {
  alchemy: "Alchemy", alchimie: "Alchemy", blacksmithing: "Blacksmithing", forge: "Blacksmithing", enchanting: "Enchanting", enchantement: "Enchanting",
  engineering: "Engineering", "ingénierie": "Engineering", herbalism: "Herbalism", herboristerie: "Herbalism", leatherworking: "Leatherworking",
  "travail du cuir": "Leatherworking", mining: "Mining", minage: "Mining", skinning: "Skinning", "dépeçage": "Skinning", tailoring: "Tailoring",
  couture: "Tailoring", jewelcrafting: "Jewelcrafting", joaillerie: "Jewelcrafting",
  cooking: "Cooking", cuisine: "Cooking", fishing: "Fishing", "pêche": "Fishing", "first aid": "First Aid", secourisme: "First Aid",
};
export const professionFromGame = (name: string) => PROFESSION_NAMES[name.trim().toLowerCase()] ?? null;

export interface ExportedTalentNode { id: number; rank: number; max: number; x: number; y: number; spell: number; sub: number; tree: number }
export interface CharacterExport {
  name: string; realm: string; cls: ClassName | null; race: string | null; level: number; faction: string; time: number; addon: string;
  gear: Partial<Record<Slot, number>>;
  /** Métiers reconnus, avec leur compétence. */
  professions: { name: string; skill: number; max: number; primary: boolean }[];
  /** Patrons connus : identifiant du sort de fabrication, ou de l'objet fabriqué quand le jeu ne donne que lui. */
  recipes: { profession: string | null; spellId?: number; itemId?: number }[];
  /** Fenêtres de métier du jeu que le site ne gère pas (ex. Poisons du voleur) : leurs patrons sont ignorés. */
  ignored: string[];
  talents: ExportedTalentNode[];
  /** Inscriptions faites en jeu (fenêtre « Groupe » de l'addon), à reporter sur le site. */
  signups: { groupId: string; raidId: string; status: SignupStatus }[];
  /** Patrons marqués « recherché » (on) ou retirés en jeu, par l'objet patron. */
  wanted: { itemId: number; on: boolean }[];
  /** Lot G : consommables demandés pour les raids à venir, comptés dans les sacs (et la banque) : objet → quantité. */
  consumables: Record<number, number>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const int = (s: string | undefined) => { const n = Number.parseInt(s ?? "", 10); return Number.isFinite(n) ? n : 0; };

export function parseCharacterExport(text: string): { ok: true; data: CharacterExport } | { ok: false; error: string } {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const head = lines[0]?.split(";") ?? [];
  if (head[0] !== "FRC") return { ok: false, error: "Ce n'est pas un export de perso : dans le jeu, tape /fr export et copie tout le texte." };
  // v1 : une ligne par objet, patron et talent ; v2 (format court) : listes séparées par des virgules
  const version = head[1] === "2" ? 2 : head[1] === "1" ? 1 : 0;
  if (!version) return { ok: false, error: `Version d'export non gérée (${head[1] ?? "?"}) : mets le site ou l'addon à jour.` };
  const end = lines.at(-1)?.split(";");
  if (end?.[0] !== "END" || int(end[1]) !== lines.length - 2) return { ok: false, error: "Export incomplet : recopie tout le texte, jusqu'à la ligne END." };
  if (lines.length > 2000) return { ok: false, error: "Export trop long." };

  const clsToken = head[4] ?? "";
  const cls = (Object.keys(CLASSES) as ClassName[]).find(c => c.toUpperCase() === clsToken) ?? null;
  const data: CharacterExport = {
    name: (head[2] ?? "").slice(0, 40), realm: (head[3] ?? "").slice(0, 60), cls, race: raceFromGame(head[5] ?? "", head[7] ?? ""),
    level: Math.min(60, Math.max(1, int(head[6]))), faction: head[7] ?? "", time: int(head[8]), addon: (head[9] ?? "").slice(0, 20),
    gear: {}, professions: [], recipes: [], ignored: [], talents: [], signups: [], wanted: [], consumables: {},
  };
  for (const line of lines.slice(1, -1)) {
    const f = line.split(";");
    if (f[0] === "G") {
      const pairs = version === 2 ? (f[1] ?? "").split(",").map(p => p.split(":")) : [[f[1], f[2]]];
      for (const [s, i] of pairs) {
        const slot = SLOT_BY_INVSLOT[int(s)], id = int(i);
        if (slot && id > 0) data.gear[slot] = id;
      }
    } else if (f[0] === "P") {
      const name = professionFromGame(f[1] ?? "");
      if (name) data.professions.push({ name, skill: Math.min(300, int(f[2])), max: int(f[3]), primary: name in PRIMARY_PROFESSIONS });
    } else if (f[0] === "R") {
      const profession = professionFromGame(f[1] ?? "");
      if (!profession) {
        const raw = (f[1] ?? "").slice(0, 40);
        if (raw && !data.ignored.includes(raw)) data.ignored.push(raw);
        continue;
      }
      for (const key of (f[2] ?? "").split(",")) {
        const id = int(key.slice(1));
        if (id <= 0) continue;
        if (key[0] === "s") data.recipes.push({ profession, spellId: id });
        else if (key[0] === "i") data.recipes.push({ profession, itemId: id });
      }
    } else if (f[0] === "S") {
      const [, groupId = "", raidId = "", status = ""] = f;
      if (UUID.test(groupId) && UUID.test(raidId) && (SIGNUP_STATUSES as readonly string[]).includes(status)) {
        data.signups = data.signups.filter(s => s.raidId !== raidId).concat({ groupId, raidId, status: status as SignupStatus });
      }
    } else if (f[0] === "W") {
      const itemId = int(f[1]);
      if (itemId > 0) data.wanted = data.wanted.filter(w => w.itemId !== itemId).concat({ itemId, on: f[2] === "1" });
    } else if (f[0] === "K") {
      // Consommables : objet:quantité, séparés par des virgules
      for (const p of (f[1] ?? "").split(",").slice(0, 60)) {
        const [id, n] = p.split(":");
        if (int(id) > 0 && int(n) >= 0) data.consumables[int(id)] = Math.min(9999, int(n));
      }
    } else if (f[0] === "T" && version === 2) {
      // Seulement les talents pris : arbre, puis nœud:rang
      const tree = int(f[1]);
      for (const p of (f[2] ?? "").split(",")) {
        const [id, rank] = p.split(":");
        if (int(id) > 0 && int(rank) > 0) data.talents.push({ id: int(id), rank: Math.min(20, int(rank)), max: 0, x: 0, y: 0, spell: 0, sub: 0, tree });
      }
    } else if (f[0] === "T") {
      data.talents.push({ id: int(f[1]), rank: int(f[2]), max: int(f[3]), x: int(f[4]), y: int(f[5]), spell: int(f[6]), sub: int(f[7]), tree: int(f[8]) });
    }
  }
  return { ok: true, data };
}

/**
 * Export de l'addon pour plusieurs persos (un bloc FRC par perso, à la suite). Un bloc abîmé est signalé sans bloquer les autres.
 */
export function parseCharacterExports(text: string): { ok: true; data: CharacterExport[]; errors: string[] } | { ok: false; error: string } {
  const lines = text.split(/\r?\n/);
  const blocks: string[][] = [];
  let inChar = false; // un bilan de raid (FRB) peut suivre les persos : ses lignes ne leur appartiennent pas
  for (const line of lines) {
    if (line.trim().startsWith("FRC;")) { blocks.push([line]); inChar = true; }
    else if (/^\s*FR[A-Z];/.test(line)) inChar = false;
    else if (inChar) blocks.at(-1)!.push(line);
  }
  if (!blocks.length) return parseCharacterExport(text) as { ok: false; error: string };
  if (blocks.length > 50) return { ok: false, error: "Export trop long." };
  const data: CharacterExport[] = [], errors: string[] = [];
  for (const b of blocks) {
    const r = parseCharacterExport(b.join("\n"));
    if (r.ok) data.push(r.data);
    else errors.push(`${b[0]?.split(";")[2] || "?"} : ${r.error}`);
  }
  if (!data.length) return { ok: false, error: errors[0] ?? "Export illisible." };
  return { ok: true, data, errors };
}

/**
 * Métiers du site à partir de l'export : les deux métiers principaux les plus avancés, et les secondaires.
 */
export function professionsFromExport(list: CharacterExport["professions"]) {
  const primary = list.filter(p => p.primary).sort((a, b) => b.skill - a.skill).slice(0, 2);
  const sec = (name: string) => list.find(p => p.name === name)?.skill ?? 0;
  return {
    prof1: { name: primary[0]?.name ?? "", skill: primary[0]?.skill ?? 0 },
    prof2: { name: primary[1]?.name ?? "", skill: primary[1]?.skill ?? 0 },
    cooking: sec("Cooking"), fishing: sec("Fishing"), firstAid: sec("First Aid"),
  };
}
