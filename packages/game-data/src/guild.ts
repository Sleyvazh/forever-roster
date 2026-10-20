/**
 * Guilde du jeu (Forever, lot « Guilde ») : lecture du relevé de l'addon (format FRL v1, docs/addon-format.md),
 * suggestions tirées des notes de guilde, règles de la Course au 60, et types des réponses de l'API
 * (routes /api/groups/:id/guild…, /api/groups/:id/home), partagés tels quels avec le site.
 *
 * La clé d'un perso de guilde est son GUID (`Player-<serveur>-<hex>`) : les prénoms ne sont pas uniques dans une
 * guilde, et une guilde mélange plusieurs serveurs. Le nom complet (« Prénom Nom ») sert à l'affichage.
 */
import { CLASSES, LAUNCH_AT, MAX_LEVEL, type ClassName } from "./core";
import { GAME_TIMEZONE, zonedParts } from "./time";

/* ---------- GUID et noms ---------- */

const GUID_RE = /^Player-(\d{1,6})-([0-9A-Fa-f]{1,16})$/;
/** GUID d'un perso du jeu, normalisé (hexadécimal en majuscules) ; null s'il n'en est pas un. */
export function normalizeGuid(s: string | null | undefined): string | null {
  const m = GUID_RE.exec((s ?? "").trim());
  return m ? `Player-${m[1]}-${m[2]!.toUpperCase()}` : null;
}

const clean = (s: string | undefined, max: number) => (s ?? "").replace(/[|\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/** Prénom d'un nom complet (« Greta Coulé » → « Greta », « Greta-Royaume » → « Greta »). */
export const firstNameOf = (name: string) => clean(name, 80).split(/[\s-]/)[0] ?? "";
/** Comparaison des noms : sans casse ni accents. */
export const nameKey = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("fr").replace(/\s+/g, " ").trim();
/** Clé d'une guilde du jeu, comme l'addon : « <guilde>-<royaume>-<faction> ». */
export const guildKeyOf = (g: { name: string; realm: string; faction: string }) => `${g.name}-${g.realm}-${g.faction}`;

/* ---------- FRL v1 : relevé de la guilde (jeu → site) ---------- */

export const GUILD_EVENT_TYPES = ["invite", "join", "promote", "demote", "remove", "quit"] as const;
export type GuildEventType = (typeof GUILD_EVENT_TYPES)[number];

export interface GuildRosterMember {
  guid: string;
  /** Nom tel que le jeu le donne (« Prénom Nom »). */
  name: string;
  cls: ClassName | null;
  level: number;
  rank: string;
  /** 0 : maître de guilde. */
  rankIndex: number;
  online: boolean;
  /** Hors ligne depuis (heures, d'après le jeu) ; 0 en ligne, null si inconnu. */
  hoursOffline: number | null;
  note: string;
  officerNote: string;
}
export interface GuildLogEntry {
  type: GuildEventType;
  /** Joueur 1 (qui invite, promeut, renvoie ; qui arrive ou part) et joueur 2 (qui est invité, promu, renvoyé). */
  player1: string; player2: string;
  /** Nouveau rang (promotion, rétrogradation). */
  rankIndex: number | null;
  /** Il y a (heures, d'après le jeu : la date n'est connue qu'à l'heure près). */
  hoursAgo: number;
}
export interface GuildXpLine { name: string; guid: string | null; level: number; xp: number; xpMax: number; at: number }
export interface GuildLevelLine { name: string; guid: string | null; level: number; at: number }
export interface GuildExport {
  name: string; faction: string; realm: string; addon: string;
  /** Liste de guilde (null : pas relevée). `total` : nombre de membres donné par le jeu ; complète si toutes les lignes M sont là. */
  roster: { at: number; by: string; officerNotes: boolean; myRank: string; total: number; complete: boolean; members: GuildRosterMember[]; skipped: number } | null;
  /** Journal de guilde, les plus récents d'abord. */
  journal: { at: number; by: string; events: GuildLogEntry[] } | null;
  xp: GuildXpLine[];
  levels: GuildLevelLine[];
}

/** Taille d'un bloc FRL (guilde de 1 000 membres, banque comprise). */
export const MAX_FRL_BYTES = 256 * 1024;
const MAX_FRL_LINES = 6000;
const int = (s: string | undefined) => { const n = Number.parseInt((s ?? "").trim(), 10); return Number.isFinite(n) ? n : null; };
const nat = (s: string | undefined) => { const n = int(s); return n !== null && n >= 0 ? n : null; };
const classOf = (token: string | undefined) => (Object.keys(CLASSES) as ClassName[]).find(c => c.toUpperCase() === (token ?? "").trim().toUpperCase()) ?? null;

function parseFRLBlock(lines: string[]): { ok: true; data: GuildExport } | { ok: false; error: string } {
  const head = lines[0]!.split(";");
  if (head[1] !== "1") return { ok: false, error: `version du relevé de guilde non gérée (${head[1] ?? "?"}) : mets le site à jour` };
  const end = lines.at(-1)!.split(";");
  if (end[0] !== "END" || nat(end[1]) !== lines.length - 2) return { ok: false, error: "relevé de guilde incomplet : recopie tout le texte, jusqu'à la ligne END" };
  if (lines.length > MAX_FRL_LINES) return { ok: false, error: "relevé de guilde trop long" };
  const name = clean(head[2], 60), faction = clean(head[3], 20), realm = clean(head[9], 60);
  if (!name) return { ok: false, error: "relevé sans guilde (perso sans guilde ?)" };
  const rosterAt = nat(head[4]) ?? 0;
  const data: GuildExport = {
    name, faction, realm, addon: clean(head[10], 20),
    roster: rosterAt > 0 ? { at: rosterAt, by: clean(head[5], 80), officerNotes: head[6]?.trim() === "1", myRank: clean(head[7], 60), total: nat(head[8]) ?? 0, complete: false, members: [], skipped: 0 } : null,
    journal: null, xp: [], levels: [],
  };
  let mLines = 0;
  const seen = new Set<string>();
  for (const line of lines.slice(1, -1)) {
    const f = line.split(";");
    if (f[0] === "M" && data.roster) {
      mLines++;
      const guid = normalizeGuid(f[10]), level = nat(f[3]), mName = clean(f[1], 80);
      if (!guid || !mName || level === null || seen.has(guid)) { data.roster.skipped++; continue; }
      seen.add(guid);
      const hours = nat(f[7]);
      data.roster.members.push({
        guid, name: mName, cls: classOf(f[2]), level: Math.min(MAX_LEVEL, Math.max(1, level)), rank: clean(f[4], 60), rankIndex: Math.min(20, nat(f[5]) ?? 0),
        online: f[6]?.trim() === "1", hoursOffline: f[6]?.trim() === "1" ? 0 : hours, note: clean(f[8], 200), officerNote: data.roster.officerNotes ? clean(f[9], 200) : "",
      });
    } else if (f[0] === "J") {
      const at = nat(f[1]);
      data.journal = at ? { at, by: clean(f[2], 80), events: [] } : null;
    } else if (f[0] === "E" && data.journal) {
      const type = (f[1] ?? "").trim() as GuildEventType, hours = nat(f[5]);
      if (!GUILD_EVENT_TYPES.includes(type) || hours === null || data.journal.events.length >= 200) continue;
      data.journal.events.push({ type, player1: clean(f[2], 80), player2: clean(f[3], 80), rankIndex: nat(f[4]), hoursAgo: hours });
    } else if (f[0] === "P") {
      const level = nat(f[2]), xp = nat(f[3]), xpMax = nat(f[4]), at = nat(f[5]);
      if (level === null || level < 1 || xp === null || xpMax === null || !at || data.xp.length >= 60) continue;
      data.xp.push({ name: clean(f[1], 80), guid: normalizeGuid(f[6]), level: Math.min(MAX_LEVEL, level), xp, xpMax, at });
    } else if (f[0] === "U") {
      const level = nat(f[2]), at = nat(f[3]);
      if (level === null || level < 2 || level > MAX_LEVEL || !at || data.levels.length >= 60 * 60) continue;
      data.levels.push({ name: clean(f[1], 80), guid: normalizeGuid(f[4]), level, at });
    }
    // B, T, I, X, O (banque) : lus dans un lot suivant
  }
  if (data.roster) data.roster.complete = data.roster.total > 0 && mLines >= data.roster.total;
  return { ok: true, data };
}

/** Blocs FRL d'un texte (lignes de chaque bloc, de l'en-tête à END), 5 au plus. */
export function guildBlocks(text: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("FRL;")) { current = [line]; blocks.push(current); }
    else if (/^(FR|RR)[A-Z];/.test(line)) current = null;
    else if (current && line) current.push(line);
  }
  return blocks.slice(0, 5);
}

/** Un relevé de guilde lu, avec son texte (gardé tel quel pour une guilde proposée). */
export interface GuildBlock { data: GuildExport; text: string }

/** Relevés de guilde d'un texte collé ou envoyé (un bloc FRL par guilde, après les persos). Un bloc abîmé est signalé sans bloquer les autres. */
export function parseGuildBlocks(text: string): { blocks: GuildBlock[]; errors: string[] } {
  const blocks: GuildBlock[] = [], errors: string[] = [];
  for (const b of guildBlocks(text)) {
    const r = parseFRLBlock(b);
    if (r.ok) blocks.push({ data: r.data, text: b.join("\n") }); else errors.push(r.error);
  }
  return { blocks, errors };
}
export function parseGuildExports(text: string): { data: GuildExport[]; errors: string[] } {
  const r = parseGuildBlocks(text);
  return { data: r.blocks.map(b => b.data), errors: r.errors };
}

/* ---------- Suggestions tirées des notes de guilde ---------- */

/**
 * Nom désigné par une note de guilde comme main de ce perso : « Alt de X », « Alt X », « X alt », « Alt: X », « Alt - X »,
 * « Reroll de X », « Reroll X », « RR X », « Main: X », « (X) », « [X] », « <X> », « X's alt »… (sans casse ni accents,
 * français et anglais). Null sinon (« Main » ou « Alt » seuls ne désignent personne). La note qui vaut exactement le nom
 * d'un membre est reconnue par resolveNoteTarget.
 */
export function noteTarget(note: string): string | null {
  const n = clean(note, 200);
  if (!n) return null;
  const name = "([\\p{L}][\\p{L}'’]*(?: [\\p{L}][\\p{L}'’]*)?)";
  // Séparateur après le mot-clé : ponctuation, « de » / « of » / « d' », ou une espace (jamais collé : « Altaïr » n'est pas « Alt aïr »)
  const sep = "(?:\\s*[:=\\-–]\\s*|\\s+(?:de|of)\\s+|\\s+d['’]\\s*|\\s+)";
  const forms = [
    new RegExp(`^(?:alt|reroll|rr|double compte|dc|perso)${sep}${name}$`, "iu"),
    // Nom au plus court : « Kaeldra's alt » → « Kaeldra »
    new RegExp(`^${name.replace(/\*/g, "*?")}(?:'s|’s)?\\s+(?:alt|reroll|rr)$`, "iu"),
    new RegExp(`^main${sep}${name}$`, "iu"),
    new RegExp(`^[(\\[<]\\s*${name}\\s*[)\\]>]$`, "iu"),
  ];
  for (const re of forms) {
    const m = re.exec(n);
    const x = m?.[1]?.trim();
    if (x && !/^(alt|main|reroll|rr)$/i.test(x)) return x;
  }
  return null;
}

/**
 * Membre désigné par une note : nom complet, sinon prénom s'il n'y en a qu'un. Plusieurs candidats : « ambiguë ».
 * `members` : membres actuels (le perso de la note exclu).
 */
export function resolveNoteTarget<M extends { guid: string; name: string }>(note: string, members: readonly M[]): { target: M | null; candidates: M[] } | null {
  const raw = clean(note, 200);
  // Note sans forme reconnue : seulement si elle vaut exactement le nom (ou le prénom) d'un membre
  const wanted = nameKey(noteTarget(raw) ?? raw);
  if (!wanted) return null;
  const full = members.filter(m => nameKey(m.name) === wanted);
  const byFirst = !wanted.includes(" ") ? members.filter(m => nameKey(firstNameOf(m.name)) === wanted) : [];
  const found = full.length ? full : byFirst;
  if (!found.length) return null;
  return { target: found.length === 1 ? found[0]! : null, candidates: found.length > 1 ? found.slice(0, 5) : [] };
}

/* ---------- Course au 60 ---------- */

/** Annonces Discord des montées de niveau : rien, les 60 seulement (défaut), ou tous les 10 niveaux (20 à 60). */
export const LEVEL_ANNOUNCES = ["none", "sixty", "tens"] as const;
export type LevelAnnounce = (typeof LEVEL_ANNOUNCES)[number];
export const DEFAULT_LEVEL_ANNOUNCE: LevelAnnounce = "sixty";
/** Paliers annoncés selon le réglage. */
export const announcedLevels = (a: LevelAnnounce): number[] => (a === "none" ? [] : a === "sixty" ? [MAX_LEVEL] : [20, 30, 40, 50, 60]);
/** Jalons de la course (colonnes 20, 40, 60). */
export const RACE_MILESTONES = [20, 40, 60] as const;
export type RaceMilestone = (typeof RACE_MILESTONES)[number];
/** Départ de la course : la sortie, le 5/11 à 00:00 (heure de Paris). */
export const RACE_START = LAUNCH_AT;
/** Jour de la course (1 le jour de la sortie) ; null avant le départ. */
export function raceDay(now = Date.now()): number | null {
  if (now < RACE_START) return null;
  return Math.floor((now - RACE_START) / 86400e3) + 1;
}
/** Jours entiers entre la sortie et un instant (« 9 jours après la sortie »). */
export const daysSinceLaunch = (at: number) => Math.max(0, Math.floor((at - RACE_START) / 86400e3));
/** Rang écrit (« 1re », « 2e », « 10e ») : comme sur la maquette, « 1re de la guilde ». */
export const ordinalFr = (n: number) => (n === 1 ? "1re" : `${n}e`);
/** « 9 jours après la sortie », « le jour de la sortie ». */
export const afterLaunchText = (at: number) => {
  const d = daysSinceLaunch(at);
  return d === 0 ? "le jour de la sortie" : `${d} jour${d > 1 ? "s" : ""} après la sortie`;
};
/** Texte d'une annonce de niveau (Discord) : « 🏆 Kaeldra Nom atteint le niveau 60, 1re de la guilde, 9 jours après la sortie. » */
export function levelAnnounceText(a: { name: string; level: number; rank: number; at: number }) {
  return a.level >= MAX_LEVEL
    ? `🏆 ${a.name} atteint le niveau ${a.level}, ${ordinalFr(a.rank)} de la guilde, ${afterLaunchText(a.at)}.`
    : `⬆️ ${a.name} atteint le niveau ${a.level} · ${ordinalFr(a.rank)} de la guilde.`;
}
/** « samedi 14/11 à 16:52 » (exact) ou « vers le 14/11 » (date du relevé), heure de Paris. */
export function raceDateText(at: number, exact: boolean, timeZone = GAME_TIMEZONE) {
  const z = zonedParts(new Date(at), timeZone);
  const day = `${z.day}/${String(z.month).padStart(2, "0")}`;
  if (!exact) return `vers le ${day}`;
  const wd = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"][z.weekday - 1];
  return `${wd} ${day} à ${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}`;
}

/* ---------- Réponses de l'API (site) ---------- */

/** Date d'un niveau : exacte (notée par l'addon à la montée) ou approximative (jour du relevé de la liste de guilde, « vers le »). */
export interface RaceDate { at: string | null; exact: boolean }
/** Rattachement d'un perso à un joueur. account : persos du même compte du site (GUID envoyé par l'addon). */
export type GuildLinkSource = "account" | "note" | "officer" | "declared";

/** Perso de la guilde du jeu (GET /api/groups/:id/guild, /guild/chars). */
export interface GuildChar {
  guid: string;
  /** Nom complet tel que le jeu le donne, et prénom. */
  name: string; firstName: string;
  cls: ClassName | null;
  /** Race de la fiche du site (si le perso est rattaché à un compte qui l'a), sinon null. */
  race: string | null;
  level: number;
  rank: string; rankIndex: number;
  online: boolean;
  /** Dernière connexion (relevé moins « hors ligne depuis ») ; null si inconnue. */
  lastOnlineAt: string | null;
  /** Arrivée dans la guilde : journal de guilde (à l'heure près) ou relevé qui l'a vu arriver (approx) ; null : déjà là au premier relevé. */
  joinedAt: string | null; joinedApprox: boolean;
  note: string;
  /** Note d'officier : seulement pour les officiers du site (absente sinon). */
  officerNote?: string;
  /** % d'XP dans le niveau (addon du joueur), null sinon. */
  xpPct: number | null;
  /** Joueur auquel le perso appartient (clé de GuildPlayer), null s'il est « à rattacher ». */
  player: string | null;
  /** Main de son joueur (un perso seul est son propre main) ; false : alt, ou « à rattacher ». */
  isMain: boolean;
  /** Lien qui le rattache (null : perso seul, son propre joueur). confirmed : réponse à « Est-ce ton perso ? » (null : pas encore). */
  link: { source: GuildLinkSource; confirmed: boolean | null; by: string | null } | null;
  /** Mon perso (rattaché à mon compte). */
  mine: boolean;
}
/** Un joueur : un compte du site (« u:<id> ») ou un joueur sans compte (« p:<id> » rattaché par un officier, « m:<guid> » perso seul). */
export interface GuildPlayer {
  key: string;
  account: { userId: string; displayName: string; avatarId: string | null } | null;
  /** GUID du main, puis des alts (du plus haut niveau au plus bas). */
  main: string; alts: string[];
  online: boolean; lastOnlineAt: string | null;
  me: boolean;
}
/** Suggestion tirée d'une note : le main désigné (ou plusieurs candidats si le prénom est ambigu). */
export interface GuildSuggestion {
  from: "note" | "officerNote";
  /** Texte de la note. */
  note: string;
  target: { guid: string; name: string; player: string | null } | null;
  candidates: { guid: string; name: string }[];
}
/** Perso « à rattacher » (bande des officiers) : arrivé depuis peu, ou une note propose son main. */
export interface GuildUnattached { guid: string; reason: "new" | "note"; suggestion: GuildSuggestion | null }
/** « Est-ce ton perso ? » : un officier a rattaché ce perso à mon compte. */
export interface GuildQuestion { guid: string; name: string; cls: ClassName | null; level: number; by: string | null; at: string }
export interface GuildRosterInfo {
  /** Liste relevée le, par (perso en jeu), complète ou non ; membres actuels. */
  at: string; by: string; complete: boolean; total: number;
}
/** Guilde du jeu liée (Administration) ; null si la guilde du site n'est pas liée. */
export interface GuildLinkInfo {
  name: string; realm: string; faction: string;
  linkedAt: string; linkedBy: string;
  /** Lien fait automatiquement (premier relevé d'un officier) ou à la main (guilde proposée). */
  auto: boolean;
  roster: GuildRosterInfo | null;
  journalAt: string | null;
}
export interface GuildMembersResponse {
  link: GuildLinkInfo | null;
  players: GuildPlayer[];
  chars: GuildChar[];
  /** Officiers seulement (vide pour les membres). */
  unattached: GuildUnattached[];
  questions: GuildQuestion[];
  canManage: boolean;
  me: { player: string | null };
}
export interface GuildCharsResponse { chars: GuildChar[]; total: number; players: Pick<GuildPlayer, "key" | "account" | "main">[] }

export type GuildMoveKind = "join" | "leave" | "remove" | "promote" | "demote";
/** Événement de l'historique (journal de guilde) : arrivée (invité par), départ, renvoi (par), promotion ou rétrogradation (par, nouveau rang). */
export interface GuildMove {
  id: number; kind: GuildMoveKind;
  /** À l'heure près (journal du jeu). */
  at: string;
  who: { name: string; guid: string | null; cls: ClassName | null; level: number | null; joinedAt: string | null };
  by: string | null;
  rank: string | null;
}
export interface GuildHistoryResponse {
  moves: GuildMove[];
  journal: { at: string; by: string } | null;
  /** Plus ancien événement gardé (journal relevé depuis…). */
  since: string | null;
  more: boolean;
}

export interface RaceChar {
  guid: string; name: string; cls: ClassName | null; race: string | null;
  level: number; xpPct: number | null;
  /** Le joueur a l'addon (XP ou heures exactes relevées pour ce perso). */
  addon: boolean;
  /** Niveaux pris sur les 7 derniers jours. */
  weekGain: number;
  /** Dernière montée (date du niveau actuel). */
  last: RaceDate | null;
  /** Jalons atteints (absent : pas encore), avec leur date si elle est connue. */
  milestones: Partial<Record<RaceMilestone, RaceDate>>;
  isMain: boolean;
  /** Parti de la guilde (seulement sur un podium figé). */
  left?: boolean;
}
export interface RaceRow {
  rank: number; tie: boolean;
  player: string;
  account: { userId: string; displayName: string } | null;
  me: boolean;
  /** Perso le plus avancé du joueur, puis ses alts. */
  best: RaceChar; alts: RaceChar[];
}
export interface RaceCharRow { rank: number; tie: boolean; player: string; me: boolean; char: RaceChar; mainName: string | null }
export interface RacePodiumPlace {
  place: 1 | 2 | 3; tie: boolean;
  char: RaceChar; player: string | null;
  /** 60 atteint (null : encore en course, `racing`). */
  reached: RaceDate | null; days: number | null; racing: boolean;
}
export interface GuildRaceResponse {
  startsAt: string; started: boolean;
  /** Jour de la course (1 le jour de la sortie). */
  day: number | null;
  linked: boolean;
  /** « Premiers 60 » : figé dès qu'il y en a 3 ; complété par les premiers encore en course. */
  podium: { frozen: boolean; sixties: number; places: RacePodiumPlace[] };
  firstByClass: { cls: ClassName; char: RaceChar; player: string; me: boolean }[];
  /** Une ligne par joueur (son perso le plus avancé, ses alts à déplier). */
  rows: RaceRow[];
  /** « Tous les persos » : une ligne par perso. */
  chars: RaceCharRow[];
  me: { rank: number; tie: boolean; player: string } | null;
  announce: LevelAnnounce;
}

/** Accueil d'une guilde (Forever) : aujourd'hui et demain, mini-course, mouvements de la semaine. */
export type HomeAgendaItem =
  | {
    kind: "raid"; id: string; name: string; at: string; size: number;
    counts: { coming: number; tank: number; heal: number; dps: number; tentative: number };
    mine: { status: string; characterName: string | null } | null;
    /** Mon main dans la guilde (inscription en un clic). */
    mainId: string | null;
  }
  | {
    kind: "outing"; id: string; title: string; dungeon: string; levels: string; day: string; at: string | null;
    places: { tank: number; heal: number; dps: number };
    missing: { tank: number; heal: number; dps: number };
    waiting: number; full: boolean; creator: string;
    mine: { role: string; characterName: string; waiting: boolean; creator: boolean } | null;
    /** « + Heal avec Brindille » : mon perso qui a le niveau, pour chaque rôle qui manque. */
    suggest: { role: "Tank" | "Heal" | "DPS"; characterId: string; characterName: string }[];
  };
export interface HomeRace {
  startsAt: string; started: boolean; day: number | null; linked: boolean;
  podium: RacePodiumPlace[];
  me: { rank: number; tie: boolean; name: string; level: number; xpPct: number | null; weekGain: number } | null;
}
export interface GuildHomeResponse {
  today: string; tomorrow: string;
  agenda: HomeAgendaItem[];
  /** Sorties du jour et de demain : toutes, et celles qui ne sont pour aucun de mes persos (non listées). */
  outings: { total: number; hidden: number };
  race: HomeRace;
  /** Arrivées, départs, promotions des 7 derniers jours. */
  moves: GuildMove[];
  guild: { linked: boolean; name: string | null; rosterAt: string | null };
  questions: GuildQuestion[];
}

/** Lien de la guilde (Administration) : guilde liée, guildes proposées (officiers), réglage des annonces. */
export interface GuildLinkProposal { key: string; name: string; realm: string; faction: string; by: string; at: string; members: number }
export interface GuildLinkResponse { link: GuildLinkInfo | null; proposals: GuildLinkProposal[]; announce: LevelAnnounce; canManage: boolean }
