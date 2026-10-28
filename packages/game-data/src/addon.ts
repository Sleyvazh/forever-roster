import type { Role, SignupStatus } from "./core";
import { placesText, type OutingPlaces } from "./outings";
import type { BossSheet, ConsumableLine } from "./prep";
import { sealGroupBlock, type GroupBlockSigner } from "./share";

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

/**
 * Un inscrit d'un raid (ligne Y) : prénom en jeu (`gameName` du perso), statut, heure Unix du dernier changement de statut.
 * `dup` : le prénom est porté par des persos de deux joueurs différents du groupe (écrit « Prénom? » : l'addon ne le prend
 * jamais pour le sien).
 */
export interface GroupExportSignup { name: string; status: SignupStatus; at: number; dup?: boolean }

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
  /**
   * Liste des inscrits du site (ligne Y, signée : rien de personnel). Un tableau, même vide, écrit la ligne (« liste connue ») ;
   * absent, pas de ligne Y (comportement d'avant : « inscription inconnue »).
   */
  signups?: GroupExportSignup[];
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
 * Lot I : objets reçus sur la période du groupe, pour la colonne du conseil du butin. Une entrée par joueur
 * (ses persos du groupe, qui partagent le compte) ou par perso, selon le réglage du groupe.
 */
export interface GroupExportCounts { short: string; label: string; entries: { names: string[]; n: number }[] }

/** Partage entre joueurs : persos du groupe (ligne M) et signataire du site (ligne Z). */
export interface GroupExportShare {
  /** Tous les persos rangés dans le groupe sur le site (mains et alts de chaque membre), noms des fiches. */
  members?: string[];
  /** Signataire de l'API (absent : bloc sans ligne Z, jamais partagé par l'addon). */
  sign?: GroupBlockSigner;
}

/**
 * Sortie donjon du jour ou de demain (ligne X, addon 1.6.1) : rien de personnel, l'addon reconnaît ses persos dans les
 * listes. Inscrit du site : son perso (prénom en jeu) ; inscrit Discord sans compte : `guest` (écrit « @pseudo »).
 */
export interface GroupExportOuting {
  id: string;
  /** Heure (secondes Unix) ; 0 : « dès que complet ». */
  at: number;
  /** Clé de FOREVER_DUNGEONS, ou « other ». */
  dungeon: string; title: string;
  min: number | null; max: number | null;
  creator: string;
  places: OutingPlaces;
  /** Inscrits par rôle et liste d'attente, dans l'ordre d'arrivée. */
  tanks: OutingExportMember[]; heals: OutingExportMember[]; dps: OutingExportMember[];
  waiting: (OutingExportMember & { role: Role })[];
  note: string;
}
export interface OutingExportMember { name: string; guest?: boolean }

/** Nom d'un inscrit dans la ligne X : prénom en jeu, ou « @pseudo » Discord (sans « , » ni « : », séparateurs des listes). */
const outingName = (m: OutingExportMember) => (m.guest ? `@${clean(m.name).replace(/[,:\s]+/g, "")}` : gameName(m.name).replace(/[,:]/g, ""));
const outingNames = (list: OutingExportMember[]) => list.map(outingName).filter(n => n && n !== "@").join(",");

/**
 * Ligne Y d'un raid : `Y;<raid>;<prénom>[?]:<statut>:<depuis>,…` (docs/addon-format.md, section FRG). Prénom en jeu sans
 * « , : ? ; | » (séparateurs de la ligne) ; une entrée sans prénom est omise ; `?` marque un prénom porté par deux joueurs.
 */
export function signupsLine(raidId: string, list: GroupExportSignup[]): string {
  const entries = list.map(s => ({ s, name: gameName(s.name).replace(/[,:?;|]/g, "") })).filter(e => e.name)
    .map(({ s, name }) => `${name}${s.dup ? "?" : ""}:${s.status}:${Math.floor(s.at)}`);
  return `Y;${raidId};${entries.join(",")}`;
}

/**
 * Lignes Y d'un bloc : 16 000 octets au plus en tout (UTF-8, sauts de ligne compris). Le texte partagé entre joueurs
 * (canonique, Z, END) doit rester sous la limite de l'addon (60 000 octets, Share.lua) ; le reste du bloc garde sa place.
 */
export const MAX_SIGNUP_BYTES = 16_000;

/**
 * Lignes Y des raids qui ont une liste, dans l'ordre des raids (lignes R) ; on s'arrête au premier raid dont la ligne ferait
 * dépasser MAX_SIGNUP_BYTES : ce raid et les suivants n'ont pas de ligne Y (l'addon fait pour eux comme avant la liste).
 */
function signupsLines(raids: GroupExportRaid[]): string[] {
  const out: string[] = [];
  const encoder = new TextEncoder();
  let size = 0;
  for (const r of raids) {
    if (!Array.isArray(r.signups)) continue;
    const line = signupsLine(r.id, r.signups);
    const bytes = encoder.encode(line).length + 1;
    if (size + bytes > MAX_SIGNUP_BYTES) break;
    out.push(line);
    size += bytes;
  }
  return out;
}

/** Ligne X d'une sortie (docs/addon-format.md, section FRG). */
export function outingLine(o: GroupExportOuting): string {
  return ["X", o.id, o.at, clean(o.dungeon), clean(o.title), o.min ?? "", o.max ?? "", gameName(o.creator), placesText(o.places),
    outingNames(o.tanks), outingNames(o.heals), outingNames(o.dps),
    o.waiting.map(w => ({ role: w.role, n: outingName(w) })).filter(w => w.n && w.n !== "@").map(w => `${w.role}:${w.n}`).join(","),
    clean(o.note).slice(0, 80)].join(";");
}

/**
 * Export d'un groupe pour l'addon : raids à venir (pour s'inscrire en jeu), patrons recherchés ou connus
 * et objets BiS recherchés (infobulles, sacs, alerte au butin) ; partage entre joueurs : liste des inscrits (Y),
 * persos du groupe (M) et signature du site (Z). Spécification : docs/addon-format.md.
 */
export function groupAddonExport(group: { id: string; name: string }, generatedAt: number, raids: GroupExportRaid[], patterns: GroupExportPattern[], bis: GroupExportBis[] = [], council: string[] = [], counts?: GroupExportCounts, share: GroupExportShare = {}, outings: GroupExportOuting[] = []): string {
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
    // Lot I : N objets reçus sur la période (« Nom+Alt:3,Autre:0 » : les persos d'un même joueur partagent le compte)
    ...(counts?.entries.length ? [["N", clean(counts.short), clean(counts.label),
      counts.entries.map(e => [...new Set(e.names.map(gameName).filter(Boolean))].join("+") + ":" + Math.round(e.n)).filter(x => !x.startsWith(":")).join(",")].join(";")] : []),
    // Sorties donjon : X, une par sortie du jour ou de demain (addon 1.6.1), après les autres lignes non comptées
    ...outings.map(outingLine),
    // Liste des inscrits : Y, une par raid dont `signups` est un tableau (même vide), après les X, avant M ; signée, hors de END ;
    // 16 000 octets au plus (signupsLines)
    ...signupsLines(raids),
    // Partage entre joueurs : M (persos du groupe, prénoms comme la ligne O) toujours, en dernier ; Z ajoutée par sealGroupBlock
    `M;${list(share.members ?? [])}`,
  ];
  return sealGroupBlock("FRG", [`FRG;${ADDON_FORMAT_VERSION};${group.id};${generatedAt};${clean(group.name)}`, ...lines, ...extra], lines.length, share.sign);
}
