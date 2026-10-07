import type { Role, SignupStatus } from "./core";
import { gameName } from "./addon";
import { LOOT_METHODS, LOOT_RESPONSES, retailLootMode, type LootMethod, type LootResponse } from "./loot";
import type { RaidLogAttendee, RaidLogExport, RaidLogLoot } from "./raidlog";
import { RETAIL_DIFFICULTIES, retailSpec, type GameLang, type RetailDifficulty } from "./retail";
import type { Game } from "./site";

/**
 * Addon « Roster » pour WoW Retail (lot R3a) : formats échangés avec le site, docs/addon-format.md,
 * section « Roster : l'addon pour WoW Retail ». Mêmes principes que les formats de Forever (une information par ligne,
 * champs séparés par « ; », aucun « | », version en tête, END qui compte les lignes), en-têtes en « RR » :
 *
 *   RRG (site → jeu) : données des groupes (raids à venir, mon inscription ; R3b : conseil du butin et objets reçus),
 *     « Copier pour le jeu » ;
 *   RRR (site → jeu) : compo d'un raid, « Export pour le jeu » de l'onglet Compo ;
 *   RRB (jeu → site) : bilan d'un raid (présence, butin, rencontres), collé sur le site (Ctrl+V).
 *
 * Noms en jeu : « Prénom-Royaume », royaume normalisé comme le jeu (GetNormalizedRealmName : sans espaces, tirets ni points).
 */

export const ROSTER_FORMAT_VERSION = 1;

/** Jeton de classe du jeu (UnitClass, 2e valeur) pour chaque classe du site (clé anglaise). */
export const RETAIL_CLASS_TOKENS: Record<string, string> = {
  "Death Knight": "DEATHKNIGHT", "Demon Hunter": "DEMONHUNTER", Druid: "DRUID", Evoker: "EVOKER", Hunter: "HUNTER", Mage: "MAGE",
  Monk: "MONK", Paladin: "PALADIN", Priest: "PRIEST", Rogue: "ROGUE", Shaman: "SHAMAN", Warlock: "WARLOCK", Warrior: "WARRIOR",
};
/** Classe du site d'après le jeton du jeu (« DEATHKNIGHT » → « Death Knight »), sinon null. */
export const retailClassOfToken = (token: string) =>
  Object.entries(RETAIL_CLASS_TOKENS).find(([, t]) => t === token.trim().toUpperCase())?.[0] ?? null;

/** Adresses publiques des deux sites (messages quand on colle le texte d'un addon sur le mauvais site). */
export const SITE_HOSTS: Record<Game, string> = { forever: "forever-roster.sleyvazh.fr", retail: "roster.sleyvazh.fr" };

const clean = (s: string) => s.replace(/[;\r\n|]/g, " ").trim();

/** Royaume tel que le jeu l'écrit dans les noms : sans espaces, tirets ni points (« Conseil des Ombres » → « ConseildesOmbres »). */
export const normalizedRealm = (realm: string) => clean(realm).replace(/[\s.-]+/g, "");

/** « Prénom-Royaume » : prénom seul (comme Forever) et royaume normalisé ; le prénom seul si le royaume manque. */
export function fullName(name: string, realm: string | null | undefined) {
  const n = gameName(name).split("-")[0] ?? "";
  const r = normalizedRealm(realm ?? "");
  return r ? `${n}-${r}` : n;
}

/** Comparaison des noms : sans casse, accents, apostrophes, espaces ni tirets. */
const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("fr").replace(/['’`\s.-]+/g, "");

/**
 * Clé de comparaison d'un nom « Prénom-Royaume » : prénom et royaume comparés à part (le premier tiret les sépare,
 * un prénom de WoW n'en a jamais). « Kaeldra-Conseil des Ombres » et « kaëldra-ConseildesOmbres » ont la même clé.
 */
export function fullNameKey(s: string) {
  const t = s.trim();
  const i = t.indexOf("-");
  return i < 0 ? fold(t) : `${fold(t.slice(0, i))}-${fold(t.slice(i + 1))}`;
}
export const sameFullName = (a: string, b: string) => fullNameKey(a) === fullNameKey(b);

/* ---------- RRG : données des groupes (site → jeu) ---------- */

/** Perso du site : nom de la fiche et royaume, écrit « Prénom-Royaume ». */
export interface RosterCharacterName { name: string; realm: string | null }

export interface RosterGroupRaid {
  id: string; name: string;
  /** Date du raid (secondes Unix, 0 si non fixée). */
  at: number;
  difficulty: RetailDifficulty | null; size: number;
  /** Mon inscription, et le perso choisi (nom et royaume de la fiche). */
  status: SignupStatus | null;
  character: RosterCharacterName | null;
  /** Mode de butin : `journal` ou `council` sur Roster (une ancienne soft reserve part en `journal`). */
  lootMode?: string;
  /** Lot R3b : conseil du butin choisi pour ce raid (persos de ses membres) ; vide ou null : celui de la ligne O. */
  council?: RosterCharacterName[] | null;
}

/** Lot R3b : lignes O et N du bloc RRG (après les R, hors du compte de END). */
export interface RosterGroupExtra {
  /** O : persos joués dans le groupe par le propriétaire et les officiers (conseil du butin par défaut). */
  council?: RosterCharacterName[];
  /**
   * N : objets reçus sur la période du groupe (colonne « Reçus » du conseil) : libellé court et complet, puis une entrée
   * par joueur (ses persos du groupe, main d'abord, qui partagent le compte) ou par perso.
   */
  counts?: { short: string; label: string; entries: { names: RosterCharacterName[]; n: number }[] };
}

/** Nom d'un perso dans une liste (O, L, N) : « Prénom-Royaume », sans les séparateurs des listes (« , », « : », « + »). */
const listName = (c: RosterCharacterName) => fullName(c.name, c.realm).replace(/[,:+]/g, "");
/** Noms sans doublon (même nom en jeu), dans l'ordre donné. */
function uniqueNames(list: RosterCharacterName[]) {
  const seen = new Set<string>();
  return list.map(listName).filter(n => {
    const k = fullNameKey(n);
    if (!n || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
/** Liste triée « Prénom-Royaume,Prénom-Royaume » (lignes O et L). */
const nameList = (list: RosterCharacterName[]) => uniqueNames(list).sort((a, b) => a.localeCompare(b)).join(",");

/**
 * Bloc RRG d'un groupe : raids à venir avec mon inscription ; lot R3b : conseil par défaut (O), conseil choisi pour
 * chaque raid (L) et objets reçus (N). Spécification : docs/addon-format.md (RRG, version 1).
 */
export function buildRRG(group: { id: string; name: string }, generatedAt: number, raids: RosterGroupRaid[], extra: RosterGroupExtra = {}): string {
  const lines = raids.map(r => ["R", r.id, Math.max(0, Math.floor(r.at)), clean(r.name), r.difficulty ?? "", Math.max(0, Math.round(r.size)),
    r.status ?? "", r.character ? fullName(r.character.name, r.character.realm) : "", r.lootMode ? retailLootMode(r.lootMode) : ""].join(";"));
  // Lot R3b, après les R et hors du compte de END : un addon 0.1 les ignore sans signaler de texte incomplet
  const council = nameList(extra.council ?? []);
  const counts = (extra.counts?.entries ?? []).map(e => ({ names: uniqueNames(e.names).join("+"), n: Math.round(e.n) }))
    .filter(e => e.names).map(e => `${e.names}:${e.n}`).join(",");
  const after = [
    ...(council ? [`O;${council}`] : []),
    ...raids.flatMap(r => { const l = nameList(r.council ?? []); return l ? [`L;${r.id};${l}`] : []; }),
    ...(extra.counts && counts ? [["N", clean(extra.counts.short), clean(extra.counts.label), counts].join(";")] : []),
  ];
  return [`RRG;${ROSTER_FORMAT_VERSION};${group.id};${Math.floor(generatedAt)};${clean(group.name)}`, ...lines, ...after, `END;${lines.length}`].join("\n");
}

/* ---------- RRR : compo d'un raid (site → jeu) ---------- */

export interface RosterExportMember {
  /** Nom de la fiche (et son royaume), ou pseudo Discord pour une inscription sans compte. */
  name: string; realm: string | null;
  /** Classe du site (« Death Knight »…), envoyée en jeton du jeu. */
  cls: string;
  spec: string | null;
  role: Role | null;
  /** Place dans la compo (0 = pas placé). */
  group: number; pos: number;
  status: SignupStatus | null;
  source: "site" | "discord";
}

/** Nom envoyé pour un membre : « Prénom-Royaume » pour un perso du site, le pseudo Discord sinon. */
export const memberGameName = (m: Pick<RosterExportMember, "name" | "realm" | "source">) => (m.source === "site" ? fullName(m.name, m.realm) : clean(m.name));

/** Rôle d'une spé de Retail pour une classe (« Frost » : DPS en chevalier de la mort comme en mage). */
export const retailRoleOf = (cls: string, spec: string | null | undefined): Role | null => (spec ? retailSpec(cls, spec)?.role ?? null : null);

/** Bloc RRR d'un raid. Ordre : placés par groupe et place, puis non placés par nom. */
export function buildRRR(raid: { id: string; name: string; scheduledAt: string | null; difficulty: RetailDifficulty | null; size: number }, members: RosterExportMember[]): string {
  const unix = raid.scheduledAt ? Math.floor(new Date(raid.scheduledAt).getTime() / 1000) : 0;
  const sorted = [...members].sort((a, b) => (a.group || 99) - (b.group || 99) || a.pos - b.pos || memberGameName(a).localeCompare(memberGameName(b)));
  return [
    `RRR;${ROSTER_FORMAT_VERSION};${raid.id};${unix};${clean(raid.name)};${raid.difficulty ?? ""};${Math.max(0, Math.round(raid.size))}`,
    ...sorted.map(m => ["M", memberGameName(m), RETAIL_CLASS_TOKENS[m.cls] ?? clean(m.cls).toUpperCase().replace(/\s+/g, ""), m.role ?? "",
      clean(m.spec ?? ""), m.group, m.pos, m.status ?? "", m.source].join(";")),
    `END;${sorted.length}`,
  ].join("\n");
}

/** Macros « /inv Prénom-Royaume », découpées pour tenir dans les 255 caractères d'une macro. */
export function rosterInviteMacros(names: string[], max = 255): string[] {
  const macros: string[] = [];
  const seen = new Set<string>();
  let cur = "";
  for (const raw of names) {
    const n = clean(raw);
    if (!n || seen.has(fullNameKey(n))) continue;
    seen.add(fullNameKey(n));
    const line = `/inv ${n}`;
    if (cur && cur.length + 1 + line.length > max) { macros.push(cur); cur = ""; }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) macros.push(cur);
  return macros;
}

/* ---------- RRB : bilan d'un raid (jeu → site) ---------- */

/** Fin d'une rencontre de boss (ligne E) : identifiant du jeu, nom du boss, heure, vaincu ou non. */
export interface RaidLogEncounter { encounterId: number; boss: string; at: number; killed: boolean }

/** Bilan RRB lu : comme un bilan de Forever, noms en « Prénom-Royaume », plus les rencontres et la difficulté du jeu. */
export interface RosterRaidLog extends RaidLogExport {
  encounters: RaidLogEncounter[];
  difficulty?: RetailDifficulty;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PEOPLE = 80, MAX_LOOT = 200, MAX_ENCOUNTERS = 100;
/** Longueur maximale d'un « Prénom-Royaume » (prénom de 12 lettres, royaume normalisé). */
export const FULL_NAME_MAX = 64;
const txt = (s: string | undefined, max: number) => (s ?? "").replace(/[|\r\n]/g, "").trim().slice(0, max);
const int = (s: string | undefined) => { const n = Number(s); return s?.trim() !== "" && Number.isInteger(n) && n >= 0 ? n : null; };
const person = (s: string | undefined) => txt(s, FULL_NAME_MAX).replace(/\s+/g, "");

/**
 * Texte de l'autre addon collé sur ce site (`game` : jeu du site où l'on colle) : messages clairs, le texte n'est jamais lu.
 * `otherHost` : adresse de l'autre site (par défaut celle de production).
 */
export function foreignAddonErrors(text: string, game: Game, otherHost?: string): string[] {
  if (game === "retail") {
    const host = otherHost ?? SITE_HOSTS.forever;
    if (/(^|\n)\s*FRC;/.test(text)) return [`Ce texte vient de l'addon Forever Roster : colle-le sur ${host}. Sur Roster, les persos viennent de Battle.net (« Importer depuis Battle.net ») ou se créent à la main.`];
    if (/(^|\n)\s*FR[A-Z];/.test(text)) return [`Ce texte vient de l'addon Forever Roster : colle-le sur ${host}.`];
    return [];
  }
  const host = otherHost ?? SITE_HOSTS.retail;
  return /(^|\n)\s*RR[A-Z];/.test(text) ? [`Ce texte vient de l'addon Roster (WoW Retail) : colle-le sur ${host}.`] : [];
}

function parseRRBBlock(lines: string[]): { ok: true; data: RosterRaidLog } | { ok: false; error: string } {
  const head = lines[0]!.split(";");
  if (head[1] !== "1") return { ok: false, error: `version de bilan non gérée (${head[1] ?? "?"}) : mets le site à jour` };
  const raidId = (head[2] ?? "").trim(), start = int(head[3]), end = int(head[4]);
  if (!UUID.test(raidId)) return { ok: false, error: "bilan sans raid du site (copie les données du site dans l'addon avant le raid)" };
  if (start === null || end === null || end < start) return { ok: false, error: "heures du bilan illisibles" };
  const data: RosterRaidLog = { raidId: raidId.toLowerCase(), start, end, recorder: person(head[5]), raidName: txt(head[6], 60), attendees: [], loot: [], encounters: [] };
  if (txt(head[7], 60)) data.instance = txt(head[7], 60);
  if (head[8]?.trim() === "1") data.lead = true;
  const diff = head[9]?.trim();
  if ((RETAIL_DIFFICULTIES as readonly string[]).includes(diff ?? "")) data.difficulty = diff as RetailDifficulty;
  let count: number | null = null;
  let lines2 = 0;
  for (const line of lines.slice(1)) {
    const f = line.trim().split(";");
    if (f[0] === "A") {
      const name = person(f[1]), first = int(f[2]), last = int(f[3]), samples = int(f[4]);
      if (!name || first === null || last === null || samples === null) return { ok: false, error: `ligne de présence illisible : ${line.slice(0, 40)}` };
      lines2++;
      const a: RaidLogAttendee = { name, first, last: Math.max(first, last), samples };
      if (data.attendees.length < MAX_PEOPLE) data.attendees.push(a);
    } else if (f[0] === "L") {
      const itemId = int(f[1]), at = int(f[3]), name = person(f[2]);
      if (!itemId || at === null || !name) return { ok: false, error: `ligne de butin illisible : ${line.slice(0, 40)}` };
      lines2++;
      const entry: RaidLogLoot = { itemId, name, at, boss: txt(f[4], 60) };
      if ((LOOT_METHODS as readonly string[]).includes(f[5] ?? "")) entry.method = f[5] as LootMethod;
      if ((LOOT_RESPONSES as readonly string[]).includes(f[6] ?? "")) entry.response = f[6] as LootResponse;
      if (txt(f[7], 60)) entry.detail = txt(f[7], 60);
      // Nom de l'objet en fin de ligne (ajout possible du format : le site n'a pas la base des objets de Retail)
      if (txt(f[8], 80)) entry.itemName = txt(f[8], 80);
      if (data.loot.length < MAX_LOOT) data.loot.push(entry);
    } else if (f[0] === "E") {
      const encounterId = int(f[1]), at = int(f[3]), killed = f[4]?.trim();
      if (encounterId === null || at === null || (killed !== "1" && killed !== "0")) return { ok: false, error: `ligne de rencontre illisible : ${line.slice(0, 40)}` };
      lines2++;
      if (data.encounters.length < MAX_ENCOUNTERS) data.encounters.push({ encounterId, boss: txt(f[2], 60), at, killed: killed === "1" });
    } else if (f[0] === "END") {
      count = int(f[1]);
    }
  }
  if (count === null) return { ok: false, error: "bilan incomplet : recopie tout le texte, jusqu'à la ligne END" };
  if (count !== lines2) return { ok: false, error: "bilan incomplet (nombre de lignes)" };
  return { ok: true, data };
}

/**
 * Bilans de raid de Roster (blocs RRB) contenus dans un texte collé : un ou plusieurs blocs, les blocs abîmés signalés
 * sans bloquer les autres. Un texte de l'addon Forever Roster (FRC, FRB…) est signalé, jamais lu.
 */
export function parseRRB(text: string, opts: { otherHost?: string } = {}): { data: RosterRaidLog[]; errors: string[] } {
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("RRB;")) { current = [line]; blocks.push(current); }
    else if (/^(RR|FR)[A-Z];/.test(line)) current = null;
    else if (current && line) current.push(line);
  }
  const data: RosterRaidLog[] = [], errors: string[] = [...foreignAddonErrors(text, "retail", opts.otherHost)];
  for (const b of blocks.slice(0, 5)) {
    const r = parseRRBBlock(b);
    if (r.ok) data.push(r.data); else errors.push(r.error);
  }
  return { data, errors };
}

/** Rencontres d'un bilan, une ligne par boss (ordre de la première tentative) : vaincu ou non, nombre d'essais. */
export function encounterSummary(encounters: RaidLogEncounter[]) {
  const byBoss = new Map<string, { encounterId: number; boss: string; tries: number; killedAt: number | null; lastAt: number }>();
  for (const e of [...encounters].sort((a, b) => a.at - b.at)) {
    const k = e.encounterId ? `#${e.encounterId}` : e.boss.toLowerCase();
    const cur = byBoss.get(k) ?? { encounterId: e.encounterId, boss: e.boss, tries: 0, killedAt: null, lastAt: e.at };
    cur.tries++;
    cur.lastAt = e.at;
    if (e.boss) cur.boss = e.boss;
    if (e.killed && cur.killedAt === null) cur.killedAt = e.at;
    byBoss.set(k, cur);
  }
  return [...byBoss.values()];
}

/** Lien Wowhead d'un objet de Retail (le site n'a pas la base des objets de Retail). */
export const retailItemLink = (id: number, lang: GameLang = "fr") => `https://www.wowhead.com/${lang === "fr" ? "fr/" : ""}item=${id}`;
