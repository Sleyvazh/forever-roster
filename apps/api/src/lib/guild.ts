import {
  firstNameOf, MAX_LEVEL, nameKey, RACE_MILESTONES, RACE_START, raceDay, resolveNoteTarget,
  type ClassName, type GuildChar, type GuildLinkInfo, type GuildLinkSource, type GuildMove, type GuildMoveKind, type GuildPlayer, type GuildQuestion, type GuildSuggestion,
  type GuildUnattached, type LevelAnnounce, type RaceChar, type RaceCharRow, type RaceDate, type RacePodiumPlace, type RaceRow,
} from "@forever/game-data";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { characters, gameGuilds, groupCharacters, groupMembers, groups, guildEvents, guildLevels, guildLinks, guildMembers, guildPlayers, users } from "../db/schema";
import type { GroupRole } from "./groups";
import { badRequest, notFound } from "./http";

/**
 * Guilde du jeu (Forever, lot « Guilde ») : qui joue quoi (mains et alts), Course au 60, historique. Lu par les routes
 * (routes/guild.ts), l'accueil de la guilde et le bot (annonces). Rien n'est recopié : les joueurs se recalculent à
 * chaque lecture à partir de la liste de guilde, des liens enregistrés et des fiches du site (GUID).
 *
 * Qui possède un perso (dans l'ordre) :
 *  1. lien d'officier ou suggestion acceptée par un officier (guild_links « officer » / « note ») : il prime ;
 *  2. compte du site : le GUID est sur une fiche d'un membre de la guilde du site (envoyé par l'addon, en-tête FRC) ;
 *  3. perso déclaré par le joueur (« declared ») ;
 *  4. main choisi d'un joueur enregistré (guild_players.main_guid : joueur sans compte formé par un officier, ou main
 *     choisi par le joueur) ;
 *  sinon il est seul (son propre joueur, « m:<guid> »), ou « à rattacher » pour les officiers (arrivé depuis moins de
 *  7 jours, ou une note propose son main).
 * Un joueur sans compte dont le main n'est pas séparé par un officier rejoint le compte qui a ce main sur une fiche :
 * « s'il crée un compte plus tard et synchronise, ses persos le rejoignent ».
 */

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;
export type MemberRow = typeof guildMembers.$inferSelect;
type LinkRow = typeof guildLinks.$inferSelect;
type PlayerRow = typeof guildPlayers.$inferSelect;
type LevelRow = Pick<typeof guildLevels.$inferSelect, "guid" | "level" | "reachedAt" | "source">;

const DAY = 86400e3;
/** « À rattacher » : arrivé depuis moins de 7 jours. */
export const NEW_MEMBER_MS = 7 * DAY;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const isOfficer = (r: GroupRole | null) => r === "owner" || r === "officer";

/** Guilde du site de Forever (la guilde du jeu, la course et l'accueil sont pour Forever). */
export async function foreverGroup(db: Tx, groupId: string) {
  const [g] = await db.select().from(groups).where(eq(groups.id, groupId));
  if (!g) throw notFound("Guilde introuvable.");
  if (g.game !== "forever") throw badRequest("La guilde du jeu, la Course au 60 et l'accueil sont pour WoW Forever.");
  return g;
}

/* ---------- Chargement ---------- */

export interface GuildData {
  gg: typeof gameGuilds.$inferSelect | null;
  members: MemberRow[];
  links: LinkRow[];
  players: PlayerRow[];
  site: { userId: string; role: GroupRole; displayName: string; avatarId: string | null }[];
  /** Fiches du site des membres de la guilde du site qui portent le GUID d'un perso de la liste (race, main du site). */
  fiches: { id: string; userId: string; guid: string; name: string; race: string; isMain: boolean; syncedAt: Date | null }[];
}

export async function loadGuild(db: Tx, groupId: string): Promise<GuildData> {
  const [gg] = await db.select().from(gameGuilds).where(eq(gameGuilds.groupId, groupId));
  const members = gg ? await db.select().from(guildMembers).where(eq(guildMembers.groupId, groupId)) : [];
  const links = await db.select().from(guildLinks).where(eq(guildLinks.groupId, groupId));
  const players = await db.select().from(guildPlayers).where(eq(guildPlayers.groupId, groupId));
  const site = await db.select({ userId: groupMembers.userId, role: groupMembers.role, displayName: users.displayName, avatarId: users.avatarId })
    .from(groupMembers).innerJoin(users, eq(users.id, groupMembers.userId)).where(eq(groupMembers.groupId, groupId));
  const guids = members.map(m => m.guid);
  const fiches = guids.length && site.length ? (await db.select({
    id: characters.id, userId: characters.userId, guid: characters.guid, name: characters.name, race: characters.race, isMain: groupCharacters.isMain, syncedAt: characters.addonSyncedAt,
  }).from(characters).leftJoin(groupCharacters, and(eq(groupCharacters.characterId, characters.id), eq(groupCharacters.groupId, groupId)))
    .where(and(eq(characters.game, "forever"), inArray(characters.guid, guids), inArray(characters.userId, site.map(s => s.userId)))))
    .map(f => ({ ...f, guid: f.guid!, isMain: !!f.isMain })) : [];
  return { gg: gg ?? null, members, links, players, site, fiches };
}

/* ---------- Joueurs ---------- */

export interface Person {
  key: string;
  userId: string | null;
  /** Joueurs enregistrés réunis sous cette clé (un compte peut en avoir deux : le sien, et un joueur sans compte qui l'a rejoint). */
  stored: PlayerRow[];
  chars: MemberRow[];
  main: MemberRow;
}
export interface Owner { key: string; source: GuildLinkSource; link: LinkRow | null }

export interface Resolved {
  data: GuildData;
  persons: Map<string, Person>;
  /** Persos actuels sans joueur (seuls ou à rattacher), et ceux « à rattacher » (officiers). */
  unowned: MemberRow[];
  band: Map<string, GuildUnattached>;
  owner: (m: MemberRow) => Owner | null;
  /** Fiche du compte qui porte ce GUID. */
  evidence: Map<string, GuildData["fiches"][number]>;
  personOf: Map<string, string>;
  memberUser: Map<string, GuildData["site"][number]>;
}

/**
 * Joueurs de la guilde à partir des persos actuels (partis exclus). officer : bande « À rattacher » (sinon, ces persos
 * sont des joueurs seuls).
 */
export function resolveGuild(data: GuildData, opts: { officer: boolean; now: Date }): Resolved {
  const memberUser = new Map(data.site.map(s => [s.userId, s]));
  // Compte du site qui a ce GUID sur une fiche (le plus récemment synchronisé si deux comptes partagent un compte WoW)
  const evidence = new Map<string, GuildData["fiches"][number]>();
  for (const f of [...data.fiches].sort((a, b) => (a.syncedAt?.getTime() ?? 0) - (b.syncedAt?.getTime() ?? 0))) evidence.set(f.guid, f);
  const linkByGuid = new Map(data.links.map(l => [l.guid, l]));
  const playerById = new Map(data.players.map(p => [p.id, p]));
  // Main choisi d'un joueur enregistré (avec ou sans compte) : il lui appartient, faute d'un lien plus fort
  const mainOf = new Map<string, PlayerRow>();
  for (const p of data.players) if (p.mainGuid) mainOf.set(p.mainGuid, p);

  /** Compte d'un joueur enregistré : le sien s'il est membre, sinon celui qui a son main (si un officier ne l'a pas séparé). */
  const userOf = (p: PlayerRow): string | null => {
    if (p.userId && memberUser.has(p.userId)) return p.userId;
    if (!p.mainGuid) return null;
    const l = linkByGuid.get(p.mainGuid);
    if (l && l.playerId === p.id && l.source === "officer") return null;
    return evidence.get(p.mainGuid)?.userId ?? null;
  };
  const keyOf = (p: PlayerRow) => { const u = userOf(p); return u ? `u:${u}` : `p:${p.id}`; };
  const owner = (m: MemberRow): Owner | null => {
    const l = linkByGuid.get(m.guid);
    const p = l ? playerById.get(l.playerId) : undefined;
    if (l && p && (l.source === "officer" || l.source === "note")) return { key: keyOf(p), source: l.source, link: l };
    const ev = evidence.get(m.guid);
    if (ev) return { key: `u:${ev.userId}`, source: "account", link: null };
    if (l && p) return { key: keyOf(p), source: l.source, link: l };
    const mp = mainOf.get(m.guid);
    if (mp) return { key: keyOf(mp), source: "officer", link: null };
    return null;
  };

  const active = data.members.filter(m => !m.leftAt);
  const persons = new Map<string, Person>();
  const personOf = new Map<string, string>();
  const unowned: MemberRow[] = [];
  for (const m of active) {
    const o = owner(m);
    if (!o) { unowned.push(m); continue; }
    let p = persons.get(o.key);
    if (!p) { p = { key: o.key, userId: o.key.startsWith("u:") ? o.key.slice(2) : null, stored: [], chars: [], main: m }; persons.set(o.key, p); }
    p.chars.push(m);
    personOf.set(m.guid, o.key);
  }
  for (const pl of data.players) { const p = persons.get(keyOf(pl)); if (p) p.stored.push(pl); }

  // Bande « À rattacher » (officiers) : arrivé depuis peu, ou une note propose son main
  const band = new Map<string, GuildUnattached>();
  if (opts.officer) {
    const first = data.gg?.firstRosterAt?.getTime() ?? 0;
    for (const m of [...unowned].sort((a, b) => a.name.localeCompare(b.name))) {
      const suggestion = suggestionFor(m, active, g => personOf.get(g) ?? null);
      const arrived = (m.joinedAt ?? m.firstSeenAt).getTime();
      const recent = !!first && m.firstSeenAt.getTime() > first && opts.now.getTime() - arrived < NEW_MEMBER_MS;
      if (suggestion || recent) band.set(m.guid, { guid: m.guid, reason: suggestion ? "note" : "new", suggestion });
    }
  }
  // Les autres sont leur propre joueur
  for (const m of unowned) {
    if (band.has(m.guid)) continue;
    persons.set(`m:${m.guid}`, { key: `m:${m.guid}`, userId: null, stored: [], chars: [m], main: m });
    personOf.set(m.guid, `m:${m.guid}`);
  }
  // Main : choisi (joueur enregistré, celui du compte d'abord), sinon le main du site, sinon le plus haut niveau
  for (const p of persons.values()) {
    const has = (g: string | null | undefined) => (g ? p.chars.find(c => c.guid === g) : undefined);
    const chosen = [...p.stored].sort((a, b) => Number(!!b.userId) - Number(!!a.userId)).map(s => has(s.mainGuid)).find(Boolean);
    const site = p.userId ? p.chars.find(c => data.fiches.some(f => f.guid === c.guid && f.userId === p.userId && f.isMain)) : undefined;
    p.main = chosen ?? site ?? [...p.chars].sort(byLevel)[0]!;
  }
  return { data, persons, unowned, band, owner, evidence, personOf, memberUser };
}

const byLevel = (a: MemberRow, b: MemberRow) => b.level - a.level || a.firstSeenAt.getTime() - b.firstSeenAt.getTime() || a.name.localeCompare(b.name);

/** Suggestion tirée de la note publique, sinon de la note d'officier. */
function suggestionFor(m: MemberRow, active: readonly MemberRow[], playerOf: (guid: string) => string | null): GuildSuggestion | null {
  const others = active.filter(o => o.guid !== m.guid);
  for (const [from, note] of [["note", m.note], ["officerNote", m.officerNote]] as const) {
    if (!note.trim()) continue;
    const r = resolveNoteTarget(note, others);
    if (!r) continue;
    return {
      from, note,
      target: r.target ? { guid: r.target.guid, name: r.target.name, player: playerOf(r.target.guid) } : null,
      candidates: r.candidates.map(c => ({ guid: c.guid, name: c.name })),
    };
  }
  return null;
}

/* ---------- Vues ---------- */

/** Arrivée d'un membre : journal (à l'heure près), sinon le relevé qui l'a vu arriver (approximative) ; null s'il était là au premier relevé. */
function joined(m: MemberRow, firstRoster: Date | null) {
  if (m.joinedAt) return { joinedAt: iso(m.joinedAt), joinedApprox: false };
  if (firstRoster && m.firstSeenAt.getTime() > firstRoster.getTime()) return { joinedAt: iso(m.firstSeenAt), joinedApprox: true };
  return { joinedAt: null, joinedApprox: false };
}
export const xpPctOf = (m: Pick<MemberRow, "xp" | "xpMax" | "xpLevel" | "level">) =>
  m.level < MAX_LEVEL && m.xp !== null && m.xpMax && m.xpLevel === m.level ? Math.min(99, Math.floor((m.xp * 100) / m.xpMax)) : null;

export function charView(r: Resolved, m: MemberRow, opts: { officer: boolean; me: string }): GuildChar {
  const key = r.personOf.get(m.guid) ?? null;
  const p = key ? r.persons.get(key) : undefined;
  const o = r.owner(m);
  const ev = r.evidence.get(m.guid);
  return {
    guid: m.guid, name: m.name, firstName: firstNameOf(m.name), cls: (m.cls || null) as ClassName | null, race: ev?.race || null, level: m.level,
    rank: m.rank, rankIndex: m.rankIndex, online: m.online, lastOnlineAt: iso(m.lastOnlineAt), ...joined(m, r.data.gg?.firstRosterAt ?? null),
    note: m.note, ...(opts.officer && { officerNote: m.officerNote }), xpPct: xpPctOf(m),
    player: key, isMain: !!p && p.main.guid === m.guid,
    link: o && (o.link || o.source === "account") ? { source: o.source, confirmed: o.link?.confirmed ?? null, by: o.link?.byName || null } : null,
    mine: !!p && p.userId === opts.me,
  };
}

export function playerView(r: Resolved, p: Person, me: string): GuildPlayer {
  const acc = p.userId ? r.memberUser.get(p.userId) : undefined;
  const last = p.chars.map(c => c.lastOnlineAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
  return {
    key: p.key, account: acc ? { userId: acc.userId, displayName: acc.displayName, avatarId: acc.avatarId } : null,
    main: p.main.guid, alts: p.chars.filter(c => c.guid !== p.main.guid).sort(byLevel).map(c => c.guid),
    online: p.chars.some(c => c.online), lastOnlineAt: last ? new Date(last).toISOString() : null, me: !!p.userId && p.userId === me,
  };
}

/** « Est-ce ton perso ? » : persos rattachés à mon compte par un officier (ou une suggestion acceptée), sans réponse. */
export function questionsFor(r: Resolved, me: string): GuildQuestion[] {
  const out: GuildQuestion[] = [];
  for (const m of r.data.members) {
    if (m.leftAt) continue;
    const o = r.owner(m);
    if (!o?.link || o.link.confirmed !== null || (o.source !== "officer" && o.source !== "note") || o.key !== `u:${me}`) continue;
    if (r.evidence.get(m.guid)?.userId === me) continue;
    out.push({ guid: m.guid, name: m.name, cls: (m.cls || null) as ClassName | null, level: m.level, by: o.link.byName || null, at: o.link.createdAt.toISOString() });
  }
  return out;
}

export function linkInfo(gg: GuildData["gg"]): GuildLinkInfo | null {
  if (!gg) return null;
  return {
    name: gg.name, realm: gg.realm, faction: gg.faction, linkedAt: gg.linkedAt.toISOString(), linkedBy: gg.linkedByName, auto: gg.auto,
    roster: gg.rosterAt ? { at: gg.rosterAt.toISOString(), by: gg.rosterBy, complete: gg.rosterComplete, total: gg.rosterTotal } : null,
    journalAt: iso(gg.journalAt),
  };
}

/** Tri des joueurs : rang en jeu de leur main, puis nom. */
export const playerOrder = (a: Person, b: Person) => a.main.rankIndex - b.main.rankIndex || a.main.name.localeCompare(b.main.name);

/* ---------- Historique (journal de guilde) ---------- */

const KIND: Record<string, GuildMoveKind | null> = { join: "join", quit: "leave", remove: "remove", promote: "promote", demote: "demote", invite: null };
export const MOVE_FILTERS = { all: ["join", "quit", "remove", "promote", "demote"], joins: ["join"], leaves: ["quit", "remove"], ranks: ["promote", "demote"] } as const;

/** Événements du journal en mouvements (une arrivée porte « invité par », tiré de l'invitation qui la précède). */
export async function guildMoves(db: Tx, groupId: string, members: readonly MemberRow[], opts: { types: readonly string[]; before?: Date; since?: Date; limit: number }) {
  const rows = await db.select().from(guildEvents)
    .where(and(eq(guildEvents.groupId, groupId), inArray(guildEvents.type, [...opts.types] as never[]),
      opts.before ? lt(guildEvents.at, opts.before) : undefined, opts.since ? sql`${guildEvents.at} >= ${opts.since}` : undefined))
    .orderBy(desc(guildEvents.at), desc(guildEvents.id)).limit(opts.limit + 1);
  const more = rows.length > opts.limit;
  const page = rows.slice(0, opts.limit);
  const joins = page.filter(e => e.type === "join");
  const invites = joins.length ? await db.select().from(guildEvents).where(and(eq(guildEvents.groupId, groupId), eq(guildEvents.type, "invite"),
    sql`${guildEvents.at} >= ${new Date(Math.min(...joins.map(j => j.at.getTime())) - 7 * DAY)}`)) : [];
  const key = (s: string) => s.normalize("NFC").toLocaleLowerCase("fr");
  const byName = new Map<string, MemberRow>();
  // Membre actuel d'abord (un parti peut porter le même nom)
  for (const m of [...members].sort((a, b) => Number(!a.leftAt) - Number(!b.leftAt))) byName.set(key(m.name), m);
  const moves: GuildMove[] = page.map(e => {
    const kind = KIND[e.type]!;
    const whoName = e.type === "join" || e.type === "quit" ? e.player1 : e.player2;
    const m = byName.get(key(whoName));
    const by = e.type === "join"
      ? invites.filter(i => key(i.player2) === key(e.player1) && i.at.getTime() <= e.at.getTime() + 3600e3).sort((a, b) => b.at.getTime() - a.at.getTime())[0]?.player1 ?? null
      : e.type === "quit" ? null : e.player1 || null;
    return {
      id: e.id, kind, at: e.at.toISOString(),
      who: { name: whoName, guid: m?.guid ?? null, cls: (m?.cls || null) as ClassName | null, level: m?.level ?? null, joinedAt: iso(m?.joinedAt ?? m?.firstSeenAt) },
      by, rank: e.type === "promote" || e.type === "demote" ? e.rankName ?? null : null,
    };
  });
  return { moves, more };
}

/* ---------- Course au 60 ---------- */

export async function loadLevels(db: Tx, groupId: string): Promise<LevelRow[]> {
  return db.select({ guid: guildLevels.guid, level: guildLevels.level, reachedAt: guildLevels.reachedAt, source: guildLevels.source })
    .from(guildLevels).where(eq(guildLevels.groupId, groupId));
}

const date = (e: LevelRow): RaceDate => ({ at: e.reachedAt.toISOString(), exact: e.source === "exact", ...(e.source === "seen" && { seen: true }) });
const ms = (d: RaceDate | null | undefined) => (d?.at ? Date.parse(d.at) : Number.POSITIVE_INFINITY);

/** Ligne de la course d'un perso : niveau, % d'XP, niveaux de la semaine, dernière montée, jalons. */
export function raceChar(m: MemberRow, levels: readonly LevelRow[], opts: { now: Date; race: string | null; isMain: boolean }): RaceChar {
  const mine = levels.filter(l => l.guid === m.guid).sort((a, b) => a.level - b.level);
  const valid = mine.filter(l => l.reachedAt.getTime() >= RACE_START);
  const cur = valid.find(l => l.level === m.level);
  const milestones: RaceChar["milestones"] = {};
  for (const lv of RACE_MILESTONES) {
    if (m.level < lv) continue;
    // Date du jalon : celle du niveau, sinon celle du premier niveau au-dessus (« vers le », au plus tard ce jour-là)
    const e = valid.find(l => l.level === lv) ?? valid.filter(l => l.level >= lv).sort((a, b) => a.reachedAt.getTime() - b.reachedAt.getTime())[0];
    milestones[lv] = e ? { at: e.reachedAt.toISOString(), exact: e.source === "exact" && e.level === lv, ...(e.source === "seen" && { seen: true }) } : { at: null, exact: false };
  }
  // Niveaux de la semaine : niveau il y a 7 jours (sinon celui du premier relevé, ou celui d'avant la première montée vue)
  const t = opts.now.getTime() - 7 * DAY;
  const before = mine.filter(l => l.reachedAt.getTime() <= t).reduce((a, l) => Math.max(a, l.level), 0);
  const firstSeen = [...mine].sort((a, b) => a.reachedAt.getTime() - b.reachedAt.getTime() || a.level - b.level)[0];
  const base = before || (firstSeen ? (firstSeen.source === "seen" ? firstSeen.level : firstSeen.level - 1) : m.level);
  return {
    guid: m.guid, name: m.name, cls: (m.cls || null) as ClassName | null, race: opts.race, level: m.level, xpPct: xpPctOf(m),
    addon: !!m.xpAt || mine.some(l => l.source === "exact"), weekGain: Math.max(0, m.level - base),
    last: cur ? date(cur) : null, milestones, isMain: opts.isMain,
  };
}

/** Ordre de la course : niveau ; au 60, le premier arrivé ; sinon le % d'XP, puis le premier arrivé à ce niveau. */
export function raceCompare(a: RaceChar, b: RaceChar) {
  if (a.level !== b.level) return b.level - a.level;
  if (a.level >= MAX_LEVEL) return ms(a.milestones[60] ?? a.last) - ms(b.milestones[60] ?? b.last);
  return (b.xpPct ?? -1) - (a.xpPct ?? -1) || ms(a.last) - ms(b.last);
}
/** Rangs « 1, 2, 2, 4 » : les ex æquo (même niveau, même XP, même date) partagent le rang. */
function ranked<T>(list: T[], charOf: (x: T) => RaceChar) {
  const sorted = [...list].sort((a, b) => raceCompare(charOf(a), charOf(b)) || charOf(a).name.localeCompare(charOf(b).name));
  const out: { x: T; rank: number; tie: boolean }[] = [];
  for (const [i, x] of sorted.entries()) {
    const prev = out[i - 1];
    const same = !!prev && raceCompare(charOf(prev.x), charOf(x)) === 0;
    if (same) prev.tie = true;
    out.push({ x, rank: same ? prev.rank : i + 1, tie: same });
  }
  return out;
}

export interface RaceResult {
  started: boolean; day: number | null;
  rows: RaceRow[]; chars: RaceCharRow[];
  podium: { frozen: boolean; sixties: number; places: RacePodiumPlace[] };
  firstByClass: { cls: ClassName; char: RaceChar; player: string; me: boolean }[];
  me: { rank: number; tie: boolean; player: string } | null;
  announce: LevelAnnounce;
}

/** Course au 60 de la guilde : une ligne par joueur (ses alts dépliables), tous les persos, podium, premiers par classe. */
export function computeRace(r: Resolved, levels: readonly LevelRow[], opts: { now: Date; me: string; announce: LevelAnnounce }): RaceResult {
  const now = opts.now;
  const day = raceDay(now.getTime());
  const started = day !== null;
  const empty: RaceResult = { started, day, rows: [], chars: [], podium: { frozen: false, sixties: 0, places: [] }, firstByClass: [], me: null, announce: opts.announce };
  if (!started || !r.data.gg) return empty;
  // Persos « à rattacher » : comptés comme leur propre joueur
  const persons = [...r.persons.values()];
  for (const m of r.unowned) if (!r.persons.has(`m:${m.guid}`) && r.band.has(m.guid)) persons.push({ key: `m:${m.guid}`, userId: null, stored: [], chars: [m], main: m });
  const keyOf = new Map<string, string>();
  for (const p of persons) for (const c of p.chars) keyOf.set(c.guid, p.key);
  const chars = new Map<string, RaceChar>();
  for (const p of persons) for (const c of p.chars) chars.set(c.guid, raceChar(c, levels, { now, race: r.evidence.get(c.guid)?.race || null, isMain: p.main.guid === c.guid }));

  const rows: RaceRow[] = ranked(persons, p => bestOf(p, chars)).map(({ x: p, rank, tie }) => {
    const best = bestOf(p, chars);
    const acc = p.userId ? r.memberUser.get(p.userId) : undefined;
    return {
      rank, tie, player: p.key, account: acc ? { userId: acc.userId, displayName: acc.displayName } : null, me: !!p.userId && p.userId === opts.me,
      best, alts: p.chars.map(c => chars.get(c.guid)!).filter(c => c.guid !== best.guid).sort(raceCompare),
    };
  });
  const personBy = new Map(persons.map(p => [p.key, p]));
  const charRows: RaceCharRow[] = ranked([...chars.values()], c => c).map(({ x: c, rank, tie }) => {
    const key = keyOf.get(c.guid)!;
    const p = personBy.get(key)!;
    return { rank, tie, player: key, me: !!p.userId && p.userId === opts.me, char: c, mainName: c.isMain || p.chars.length < 2 ? null : p.main.name };
  });

  // Premiers par classe
  const byClass = new Map<ClassName, RaceChar>();
  for (const c of chars.values()) if (c.cls && (!byClass.has(c.cls) || raceCompare(c, byClass.get(c.cls)!) < 0)) byClass.set(c.cls, c);
  const firstByClass = [...byClass.entries()].sort((a, b) => raceCompare(a[1], b[1])).map(([cls, c]) => {
    const key = keyOf.get(c.guid)!;
    return { cls, char: c, player: key, me: rows.some(row => row.player === key && row.me) };
  });

  const me = rows.find(x => x.me);
  return { started, day, rows, chars: charRows, podium: podiumOf(r, levels, chars, keyOf, rows, now), firstByClass, me: me ? { rank: me.rank, tie: me.tie, player: me.player } : null, announce: opts.announce };
}

const bestOf = (p: Person, chars: Map<string, RaceChar>) => p.chars.map(c => chars.get(c.guid)!).sort(raceCompare)[0]!;

/** « Premiers 60 » : figés dès le troisième ; avant, les 60 dans l'ordre, complétés par les premiers encore en course. */
function podiumOf(r: Resolved, levels: readonly LevelRow[], chars: Map<string, RaceChar>, keyOf: Map<string, string>, rows: RaceRow[], now: Date): RaceResult["podium"] {
  const days = (at: string | null) => (at ? Math.max(0, Math.floor((Date.parse(at) - RACE_START) / DAY)) : null);
  const frozen = r.data.gg?.podium;
  if (frozen) {
    return {
      frozen: true, sixties: frozen.length,
      places: frozen.map(f => {
        const live = chars.get(f.guid);
        const reached: RaceDate = { at: f.at, exact: f.exact, ...(f.seen && { seen: true }) };
        const char: RaceChar = live ?? { guid: f.guid, name: f.name, cls: (f.cls || null) as ClassName | null, race: null, level: MAX_LEVEL, xpPct: null, addon: f.exact, weekGain: 0, last: reached, milestones: { 60: reached }, isMain: false, left: true };
        // Déjà 60 au premier relevé : ni nombre de jours ni rang
        return { place: f.place as 1 | 2 | 3, tie: f.tie, char, player: keyOf.get(f.guid) ?? null, reached, days: f.seen ? null : days(f.at), racing: false };
      }),
    };
  }
  const members = new Map(r.data.members.map(m => [m.guid, m]));
  const sixties = levels.filter(l => l.level === MAX_LEVEL && l.reachedAt.getTime() >= RACE_START && members.has(l.guid))
    .sort((a, b) => a.reachedAt.getTime() - b.reachedAt.getTime() || members.get(a.guid)!.name.localeCompare(members.get(b.guid)!.name));
  const places: RacePodiumPlace[] = [];
  for (const [i, l] of sixties.entries()) {
    const m = members.get(l.guid)!;
    const char = chars.get(l.guid) ?? { ...raceChar(m, levels, { now, race: null, isMain: false }), left: true };
    const prev = places[i - 1];
    const tie = !!prev && prev.reached?.at === l.reachedAt.toISOString();
    // Les trois premiers, et les ex æquo du troisième
    if (i >= 3 && !tie) break;
    if (tie) prev.tie = true;
    places.push({ place: (tie ? prev.place : i + 1) as 1 | 2 | 3, tie, char, player: keyOf.get(l.guid) ?? null, reached: date(l), days: l.source === "seen" ? null : days(l.reachedAt.toISOString()), racing: false });
  }
  // Encore en course : les premiers joueurs qui ne sont pas déjà sur le podium
  for (const row of rows) {
    if (places.length >= 3) break;
    if (row.best.level >= MAX_LEVEL || places.some(p => p.player === row.player)) continue;
    places.push({ place: (places.length + 1) as 1 | 2 | 3, tie: false, char: row.best, player: row.player, reached: null, days: null, racing: true });
  }
  return { frozen: false, sixties: sixties.length, places };
}

/* ---------- Noms complets (bot, annonces) ---------- */

/**
 * Nom complet d'un perso d'après la liste de guilde du jeu : par GUID, sinon par prénom s'il est unique dans la guilde
 * (« Greta » → « Greta Coulé ») ; le nom de la fiche sinon (nom déjà complet, ou guilde sans liste).
 */
export async function fullNames(db: Tx, groupId: string) {
  const rows = await db.select({ guid: guildMembers.guid, name: guildMembers.name }).from(guildMembers)
    .where(and(eq(guildMembers.groupId, groupId), isNull(guildMembers.leftAt)));
  const byGuid = new Map(rows.map(r => [r.guid, r.name]));
  const byFirst = new Map<string, string | null>();
  for (const r of rows) { const k = nameKey(firstNameOf(r.name)); byFirst.set(k, byFirst.has(k) ? null : r.name); }
  return (name: string, guid?: string | null): string => {
    if (guid && byGuid.has(guid)) return byGuid.get(guid)!;
    const n = name.trim();
    if (!n || /\s/.test(n)) return name;
    return byFirst.get(nameKey(n)) ?? name;
  };
}
