import type { Role, SignupStatus } from "./core";
import type { BossSheet, ConsumableLine } from "./prep";

/**
 * Export d'un raid pour un addon WoW (format « FRR », version 1) et macros d'invitation.
 * Spécification : docs/addon-format.md. Pensé pour être lu en Lua avec strsplit(";", ligne) :
 * pas de « | » (caractère d'échappement de WoW), une information par ligne, champs sans « ; ».
 */

export const ADDON_FORMAT_VERSION = 1;

export interface ExportMember {
  /** Nom du perso (ou pseudo Discord pour une inscription sans compte). */
  name: string;
  cls: string;
  spec: string | null;
  role: Role | null;
  /** Place dans la compo (0 = pas placé). */
  group: number;
  pos: number;
  status: SignupStatus | null;
  /** « site » (perso du site) ou « discord » (inscription libre, nom non garanti en jeu). */
  source: "site" | "discord";
}

const clean = (s: string) => s.replace(/[;\r\n|]/g, " ").trim();

/**
 * Nom du perso tel que le jeu le connaît : Forever permet un nom de famille (« Greta Coulé »),
 * mais le jeu (invitations, export de l'addon) n'utilise que le prénom.
 */
export const gameName = (name: string) => clean(name).split(/\s+/)[0] ?? "";

/** L'export du jeu (prénom seul) correspond-il à cette fiche (prénom + nom de famille éventuel) ? */
export const sameCharacter = (exportName: string, ficheName: string) =>
  gameName(exportName).normalize("NFC").toLocaleLowerCase("fr") === gameName(ficheName).normalize("NFC").toLocaleLowerCase("fr");

export function addonExport(raid: { id: string; name: string; scheduledAt: string | null }, members: ExportMember[]): string {
  const unix = raid.scheduledAt ? Math.floor(new Date(raid.scheduledAt).getTime() / 1000) : 0;
  const sorted = [...members].sort((a, b) => (a.group || 99) - (b.group || 99) || a.pos - b.pos || a.name.localeCompare(b.name));
  const lines = [
    `FRR;${ADDON_FORMAT_VERSION};${raid.id};${unix};${clean(raid.name)}`,
    ...sorted.map(m => ["M", m.source === "site" ? gameName(m.name) : clean(m.name), m.cls.toUpperCase(), m.role ?? "", clean(m.spec ?? ""), m.group, m.pos, m.status ?? "", m.source].join(";")),
    `END;${sorted.length}`,
  ];
  return lines.join("\n");
}

/** Macros « /inv Nom » découpées pour tenir dans la limite de 255 caractères d'une macro. */
export function inviteMacros(names: string[], max = 255): string[] {
  const macros: string[] = [];
  let cur = "";
  for (const n of [...new Set(names.map(gameName).filter(Boolean))]) {
    const line = `/inv ${n}`;
    if (cur && cur.length + 1 + line.length > max) { macros.push(cur); cur = ""; }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) macros.push(cur);
  return macros;
}

/* ---------- Données du groupe pour l'addon (format « FRG », version 1) ---------- */

export interface GroupExportRaid {
  id: string; name: string;
  /** Date du raid (secondes Unix, 0 si non fixée). */
  at: number;
  /** Mon inscription actuelle, et le perso choisi (prénom en jeu). */
  status: SignupStatus | null; character: string | null;
  /** Lot C2 : mode de butin du raid, et réservations (soft reserve) avec leur bonus SR+. */
  lootMode?: string;
  reserves?: { itemId: number; by: { name: string; bonus: number }[] }[];
  /** Lot G : consommables demandés, fiches de boss (noms des persos en jeu) et conseil du butin choisi pour ce raid. */
  consumables?: ConsumableLine[];
  bosses?: (Omit<BossSheet, "rows"> & { rows: { label: string; names: string[]; text: string }[] })[];
  council?: string[] | null;
  /** Inscrits qui viennent, avec leur rôle (et type de DPS) : pour savoir quels consommables chacun doit avoir. */
  roster?: { name: string; role: Role | null; dps: string | null }[];
}
export interface GroupExportPattern {
  /** Objet « Patron / Plans / Recette » tel qu'il apparaît dans les sacs. */
  itemId: number; recipe: string;
  /** Persos du groupe qui le recherchent / qui connaissent déjà la recette. */
  wanted: string[]; known: string[];
}

const list = (names: string[]) => [...new Set(names.map(gameName).filter(Boolean))].sort((a, b) => a.localeCompare(b)).join(",");

/** Objet BiS d'un ou plusieurs persos du groupe, qu'ils n'ont pas encore. */
export interface GroupExportBis { itemId: number; characters: string[] }

/**
 * Export d'un groupe pour l'addon : raids à venir (pour s'inscrire en jeu), patrons recherchés ou connus
 * et objets BiS recherchés (infobulles, sacs, alerte au butin). Spécification : docs/addon-format.md.
 */
export function groupAddonExport(group: { id: string; name: string }, generatedAt: number, raids: GroupExportRaid[], patterns: GroupExportPattern[], bis: GroupExportBis[] = [], council: string[] = []): string {
  const lines = [
    ...raids.map(r => ["R", r.id, r.at, clean(r.name), r.status ?? "", r.character ? gameName(r.character) : "", r.lootMode ?? ""].join(";")),
    ...patterns.filter(p => p.wanted.length || p.known.length)
      .map(p => ["P", p.itemId, clean(p.recipe), list(p.wanted), list(p.known)].join(";")),
    ...bis.filter(b => b.characters.length).map(b => ["B", b.itemId, list(b.characters)].join(";")),
  ];
  // Lignes du lot C2, après les autres et hors du compte de END : un addon plus ancien les ignore sans erreur
  const extra = [
    ...raids.flatMap(r => (r.reserves ?? []).filter(x => x.by.length)
      .map(x => ["S", r.id, x.itemId, x.by.map(b => `${gameName(b.name)}:${Math.max(0, Math.round(b.bonus))}`).join(",")].join(";"))),
    ...(council.length ? [["O", list(council)].join(";")] : []),
    // Lot G : C consommable demandé, F fiche de boss, T tâche de la fiche, L conseil du butin de ce raid, I inscrit (rôle)
    ...raids.flatMap(r => [
      ...(r.consumables ?? []).map(c => ["C", r.id, c.itemId, c.n, c.for, clean(c.name)].join(";")),
      ...(r.bosses ?? []).map(boss => ({ ...boss, rows: boss.rows.filter(row => row.label.trim() || row.text.trim() || row.names.length) }))
        .filter(boss => boss.rows.length).flatMap((boss, i) => [
          ["F", r.id, i + 1, boss.encounterId ?? "", boss.npcIds.join(","), clean(boss.name)].join(";"),
          ...boss.rows.map(row => ["T", r.id, i + 1, clean(row.label), list(row.names), clean(row.text)].join(";")),
        ]),
      ...(r.council?.length ? [["L", r.id, list(r.council)].join(";")] : []),
      ...((r.consumables ?? []).length ? (r.roster ?? []).map(m => ["I", r.id, gameName(m.name), m.role ?? "", m.dps ?? ""].join(";")) : []),
    ]),
  ];
  return [`FRG;${ADDON_FORMAT_VERSION};${group.id};${generatedAt};${clean(group.name)}`, ...lines, ...extra, `END;${lines.length}`].join("\n");
}
