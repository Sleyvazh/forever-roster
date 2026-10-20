import {
  firstNameOf, guildKeyOf, LAUNCH_AT, MAX_LEVEL, nameKey, parseGuildBlocks, RACE_START,
  type GuildBlock, type GuildExport, type ImportResult,
} from "@forever/game-data";
import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { gameGuilds, groupMembers, groups, guildEvents, guildLevels, guildLinkProposals, guildMembers, type FrozenPodiumPlace } from "../db/schema";
import { audit } from "./audit";
import { bus } from "./events";
import type { GroupRole } from "./groups";

/**
 * Relevé de la guilde du jeu (FRL, lot « Guilde ») appliqué aux guildes du site. Règles (contrat du 20/10) :
 * - tout membre d'une guilde du site liée à cette guilde du jeu peut envoyer le relevé ; un relevé d'une autre guilde
 *   du jeu est ignoré ;
 * - le lien se fait tout seul au premier relevé d'un officier (ou du propriétaire) quand il n'a qu'une guilde Forever
 *   sans lien ; s'il en a plusieurs, la guilde du jeu est proposée dans l'Administration de chacune. Un lien fait avant
 *   la sortie (bêta) est remplacé par le premier relevé d'une autre guilde du jeu envoyé par un officier après la sortie ;
 * - la liste la plus récente (heure de l'en-tête) l'emporte ; une liste complète (lignes M = membres du jeu) marque les
 *   absents comme partis ; les notes d'officier ne sont gardées que d'un officier du site dont l'en-tête dit 1 ;
 * - journal dédoublonné (dates à l'heure près), niveaux (date exacte des lignes U, sinon date du relevé) et XP (lignes P).
 */

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;
type User = { id: string; displayName: string };
type MemberRow = typeof guildMembers.$inferSelect;
type GuildRow = typeof gameGuilds.$inferSelect;

const HOUR = 3600e3;
/** Deux lectures du même événement du journal (« il y a N heures ») diffèrent de moins d'une heure ; marge de 2 h. */
const EVENT_TOLERANCE = 2 * HOUR;
const plural = (n: number, w: string, ws = `${w}s`) => `${n} ${n > 1 ? ws : w}`;
const officerRole = (r: GroupRole) => r === "owner" || r === "officer";
/** Lien fait pendant la bêta : remplacé par la vraie guilde après la sortie. */
const provisional = (g: Pick<GuildRow, "linkedAt">, now: number) => g.linkedAt.getTime() < LAUNCH_AT && now >= LAUNCH_AT;

export interface GuildApplySummary { roster: "applied" | "older" | null; members: number; complete: boolean; arrivals: number; departures: number; events: number; levels: number; xp: number }

/** Membres repérés par un nom du journal ou d'une ligne P / U : nom complet, sinon prénom unique. */
function byNameIndex(members: readonly Pick<MemberRow, "guid" | "name" | "leftAt">[]) {
  const full = new Map<string, string[]>(), first = new Map<string, string[]>();
  for (const m of members) {
    const f = nameKey(m.name), p = nameKey(firstNameOf(m.name));
    full.set(f, [...(full.get(f) ?? []), m.guid]);
    first.set(p, [...(first.get(p) ?? []), m.guid]);
  }
  return (name: string): string | null => {
    const k = nameKey(name);
    const a = full.get(k) ?? (k.includes(" ") ? [] : first.get(k) ?? []);
    return a.length === 1 ? a[0]! : null;
  };
}

/** Lien guilde du site ↔ guilde du jeu (le lien précédent, de la bêta, est effacé avec ses données). */
export async function linkGameGuild(db: Tx, groupId: string, g: Pick<GuildExport, "name" | "realm" | "faction">, user: User, auto: boolean) {
  await db.delete(gameGuilds).where(eq(gameGuilds.groupId, groupId));
  const [row] = await db.insert(gameGuilds).values({
    groupId, key: guildKeyOf(g), name: g.name, realm: g.realm, faction: g.faction, linkedBy: user.id, linkedByName: user.displayName, auto,
  }).returning();
  await db.delete(guildLinkProposals).where(eq(guildLinkProposals.groupId, groupId));
  return row!;
}

/** Applique un relevé à une guilde du site déjà liée à cette guilde du jeu. officer : l'envoyeur est officier ou propriétaire. */
export async function applyGuildExport(db: Db, groupId: string, g: GuildExport, opts: { officer: boolean; now?: Date }): Promise<GuildApplySummary> {
  const now = opts.now ?? new Date();
  // Heures du relevé (horloge du PC du joueur) : jamais dans le futur, sinon un relevé daté de 2099 bloquerait tous les suivants
  const when = (unix: number) => new Date(Math.min(unix * 1000, now.getTime()));
  const sum: GuildApplySummary = { roster: null, members: 0, complete: false, arrivals: 0, departures: 0, events: 0, levels: 0, xp: 0 };
  await db.transaction(async tx => {
    // Un relevé à la fois par guilde (Roster Companion de plusieurs membres en même temps)
    const [gg] = await tx.select().from(gameGuilds).where(eq(gameGuilds.groupId, groupId)).for("update");
    if (!gg) return;
    const existing = await tx.select().from(guildMembers).where(eq(guildMembers.groupId, groupId));
    const byGuid = new Map(existing.map(m => [m.guid, m]));
    const levelRows: (typeof guildLevels.$inferInsert)[] = [];
    const leaving: MemberRow[] = [];
    /** Arrivés (ou revenus) dans cette liste : leur arrivée est cherchée dans le journal (après leur départ, s'ils reviennent). */
    const arrived = new Map<string, Date | null>();
    const guildPatch: Partial<GuildRow> = {};

    // 1. Liste de guilde : la plus récente l'emporte
    if (g.roster) {
      const rosterAt = when(g.roster.at);
      if (gg.rosterAt && rosterAt.getTime() <= gg.rosterAt.getTime()) sum.roster = "older";
      else {
        sum.roster = "applied"; sum.members = g.roster.members.length; sum.complete = g.roster.complete;
        const keepOfficerNotes = opts.officer && g.roster.officerNotes;
        const rows: (typeof guildMembers.$inferInsert)[] = [];
        for (const m of g.roster.members) {
          const e = byGuid.get(m.guid);
          const back = !!e?.leftAt; // revenu après un départ : nouvelle arrivée
          if (!e || back) { sum.arrivals += gg.firstRosterAt ? 1 : 0; arrived.set(m.guid, e?.leftAt ?? null); }
          const level = Math.max(m.level, e?.level ?? 0);
          rows.push({
            groupId, guid: m.guid, name: m.name, cls: m.cls ?? e?.cls ?? "", level, rank: m.rank, rankIndex: m.rankIndex, online: m.online,
            lastOnlineAt: m.hoursOffline === null ? (e?.lastOnlineAt ?? null) : new Date(rosterAt.getTime() - m.hoursOffline * HOUR),
            note: m.note, officerNote: keepOfficerNotes ? m.officerNote : (e?.officerNote ?? ""),
            xp: e?.xp ?? null, xpMax: e?.xpMax ?? null, xpLevel: e?.xpLevel ?? null, xpAt: e?.xpAt ?? null,
            firstSeenAt: e && !back ? e.firstSeenAt : rosterAt, seenAt: rosterAt,
            joinedAt: e && !back ? e.joinedAt : null, leftAt: null, updatedAt: now,
          });
          // Niveaux : premier relevé (« seen », pas une montée), puis chaque niveau pris entre deux listes (date du relevé)
          if (!e) { if (level >= 2) levelRows.push({ groupId, guid: m.guid, level, reachedAt: rosterAt, source: "seen" }); }
          else for (let l = e.level + 1; l <= level; l++) levelRows.push({ groupId, guid: m.guid, level: l, reachedAt: rosterAt, source: "roster" });
        }
        for (let i = 0; i < rows.length; i += 200) {
          await tx.insert(guildMembers).values(rows.slice(i, i + 200)).onConflictDoUpdate({
            target: [guildMembers.groupId, guildMembers.guid],
            set: {
              name: sql`excluded.name`, cls: sql`excluded.cls`, level: sql`excluded.level`, rank: sql`excluded.rank`, rankIndex: sql`excluded.rank_index`,
              online: sql`excluded.online`, lastOnlineAt: sql`excluded.last_online_at`, note: sql`excluded.note`, officerNote: sql`excluded.officer_note`,
              firstSeenAt: sql`excluded.first_seen_at`, seenAt: sql`excluded.seen_at`, joinedAt: sql`excluded.joined_at`, leftAt: sql`excluded.left_at`, updatedAt: sql`excluded.updated_at`,
            },
          });
        }
        // Liste complète : les absents sont partis (date précisée plus bas par le journal)
        if (g.roster.complete) {
          const present = new Set(g.roster.members.map(m => m.guid));
          leaving.push(...existing.filter(m => !m.leftAt && !present.has(m.guid)));
        }
        Object.assign(guildPatch, { rosterAt, rosterBy: g.roster.by, rosterComplete: g.roster.complete, rosterTotal: g.roster.total, ...(!gg.firstRosterAt && { firstRosterAt: rosterAt }) });
        for (const r of rows) byGuid.set(r.guid, { ...(byGuid.get(r.guid) as MemberRow), ...(r as MemberRow) });
      }
    }
    const members = [...byGuid.values()];
    const find = byNameIndex(members);
    const findActive = byNameIndex(members.filter(m => !m.leftAt || leaving.some(l => l.guid === m.guid)));

    // 2. Journal : dédoublonné (même événement, mêmes joueurs, à moins de 2 h près)
    const newEvents: { type: string; player1: string; player2: string; at: Date }[] = [];
    if (g.journal && g.journal.events.length) {
      const jAt = when(g.journal.at).getTime();
      const ranks = new Map<number, string>();
      for (const m of members) if (!ranks.has(m.rankIndex)) ranks.set(m.rankIndex, m.rank);
      if (g.roster) for (const m of g.roster.members) ranks.set(m.rankIndex, m.rank);
      const incoming = g.journal.events.map(e => ({ ...e, at: new Date(jAt - e.hoursAgo * HOUR) })).sort((a, b) => a.at.getTime() - b.at.getTime());
      const oldest = incoming[0]!.at.getTime();
      const stored = await tx.select().from(guildEvents).where(and(eq(guildEvents.groupId, groupId), gte(guildEvents.at, new Date(oldest - EVENT_TOLERANCE))));
      const used = new Set<number>();
      const tuple = (e: { type: string; player1: string; player2: string; rankIndex: number | null }) => `${e.type}|${nameKey(e.player1)}|${nameKey(e.player2)}|${e.rankIndex ?? ""}`;
      const inserts: (typeof guildEvents.$inferInsert)[] = [];
      for (const e of incoming) {
        const k = tuple(e);
        let best: (typeof stored)[number] | null = null;
        for (const s of stored) {
          if (used.has(s.id) || tuple(s) !== k) continue;
          const d = Math.abs(s.at.getTime() - e.at.getTime());
          if (d <= EVENT_TOLERANCE && (!best || d < Math.abs(best.at.getTime() - e.at.getTime()))) best = s;
        }
        if (best) {
          used.add(best.id);
          // La lecture la plus proche de l'événement : la plus ancienne (« il y a » arrondi en dessous)
          if (e.at.getTime() < best.at.getTime()) await tx.update(guildEvents).set({ at: e.at }).where(eq(guildEvents.id, best.id));
          continue;
        }
        inserts.push({ groupId, type: e.type, player1: e.player1, player2: e.player2, rankIndex: e.rankIndex, rankName: e.rankIndex === null ? null : ranks.get(e.rankIndex) ?? null, at: e.at });
        newEvents.push({ type: e.type, player1: e.player1, player2: e.player2, at: e.at });
      }
      if (inserts.length) await tx.insert(guildEvents).values(inserts);
      sum.events = inserts.length;
      if (!gg.journalAt || jAt > gg.journalAt.getTime()) Object.assign(guildPatch, { journalAt: new Date(jAt), journalBy: g.journal.by });
    }

    // 3. Arrivées et départs précisés par le journal
    const subject = (e: { type: string; player1: string; player2: string }) => (e.type === "join" || e.type === "quit" ? e.player1 : e.player2);
    const departures = new Map<string, Date>();
    const goneEvents = leaving.length || newEvents.some(e => e.type === "quit" || e.type === "remove")
      ? await tx.select({ type: guildEvents.type, player1: guildEvents.player1, player2: guildEvents.player2, at: guildEvents.at }).from(guildEvents)
        .where(and(eq(guildEvents.groupId, groupId), inArray(guildEvents.type, ["quit", "remove"])))
      : [];
    for (const m of leaving) {
      // Dernier départ lu après son dernier relevé, sinon la date de cette liste
      const ev = goneEvents.filter(e => find(subject(e)) === m.guid && e.at.getTime() >= m.seenAt.getTime() - HOUR).sort((a, b) => b.at.getTime() - a.at.getTime())[0];
      departures.set(m.guid, ev?.at ?? (guildPatch.rosterAt as Date));
    }
    // Départ lu dans le journal sans liste complète : seulement s'il date d'après le dernier relevé où il figure
    for (const e of newEvents.filter(x => x.type === "quit" || x.type === "remove")) {
      const guid = findActive(subject(e));
      const m = guid ? byGuid.get(guid) : null;
      if (m && !m.leftAt && !departures.has(m.guid) && e.at.getTime() > m.seenAt.getTime()) departures.set(m.guid, e.at);
    }
    for (const [guid, at] of departures) await tx.update(guildMembers).set({ leftAt: at, online: false, updatedAt: now }).where(and(eq(guildMembers.groupId, groupId), eq(guildMembers.guid, guid)));
    sum.departures = departures.size;
    // Arrivée : dernière arrivée lue avant (ou une heure après) le dernier relevé où il figure ; pour un membre revenu,
    // seulement après son départ. Membres arrivés dans cette liste, et ceux dont l'arrivée vient d'être lue.
    const joiners = new Map(arrived);
    for (const e of newEvents.filter(x => x.type === "join")) {
      const guid = find(e.player1);
      if (guid && !joiners.has(guid)) joiners.set(guid, null);
    }
    const joins = joiners.size ? await tx.select({ player1: guildEvents.player1, at: guildEvents.at }).from(guildEvents)
      .where(and(eq(guildEvents.groupId, groupId), eq(guildEvents.type, "join"))) : [];
    for (const [guid, after] of joiners) {
      const m = byGuid.get(guid);
      if (!m || m.leftAt || departures.has(guid)) continue;
      const ev = joins.filter(e => find(e.player1) === guid && e.at.getTime() <= m.seenAt.getTime() + HOUR && (!after || e.at.getTime() > after.getTime()))
        .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
      if (ev && (!m.joinedAt || m.joinedAt.getTime() < ev.at.getTime())) {
        await tx.update(guildMembers).set({ joinedAt: ev.at }).where(and(eq(guildMembers.groupId, groupId), eq(guildMembers.guid, guid)));
        m.joinedAt = ev.at;
      }
    }

    // 4. XP (lignes P) : la plus récente ; un niveau plus haut que la liste est repris (date du relevé de l'XP)
    for (const x of g.xp) {
      // GUID (addon 1.6.2) ; sans lui (addon plus ancien), le nom complet ou le prénom unique
      const guid = x.guid ? (byGuid.has(x.guid) ? x.guid : null) : find(x.name);
      const m = guid ? byGuid.get(guid) : null;
      if (!m) continue;
      const at = when(x.at);
      if (m.xpAt && m.xpAt.getTime() >= at.getTime()) continue;
      const level = Math.max(m.level, x.level);
      for (let l = m.level + 1; l <= level; l++) levelRows.push({ groupId, guid: m.guid, level: l, reachedAt: at, source: "roster" });
      await tx.update(guildMembers).set({ xp: x.xpMax > 0 ? Math.min(x.xp, x.xpMax) : null, xpMax: x.xpMax > 0 ? x.xpMax : null, xpLevel: x.level, xpAt: at, level })
        .where(and(eq(guildMembers.groupId, groupId), eq(guildMembers.guid, m.guid)));
      m.level = level; m.xpAt = at;
      sum.xp++;
    }

    // 5. Niveaux : approximatifs d'abord (jamais à la place d'une date connue), puis exacts (lignes U, à la place d'une date approximative)
    if (levelRows.length) {
      for (let i = 0; i < levelRows.length; i += 500) await tx.insert(guildLevels).values(levelRows.slice(i, i + 500)).onConflictDoNothing();
    }
    const exact: (typeof guildLevels.$inferInsert)[] = [];
    for (const u of g.levels) {
      const guid = u.guid ? (byGuid.has(u.guid) ? u.guid : null) : find(u.name);
      const m = guid ? byGuid.get(guid) : null;
      if (!m) continue;
      exact.push({ groupId, guid: m.guid, level: u.level, reachedAt: when(u.at), source: "exact" });
      if (u.level > m.level) {
        await tx.update(guildMembers).set({ level: u.level }).where(and(eq(guildMembers.groupId, groupId), eq(guildMembers.guid, m.guid)));
        m.level = u.level;
      }
    }
    for (let i = 0; i < exact.length; i += 500) {
      const res = await tx.insert(guildLevels).values(exact.slice(i, i + 500)).onConflictDoUpdate({
        target: [guildLevels.groupId, guildLevels.guid, guildLevels.level],
        set: { reachedAt: sql`excluded.reached_at`, source: sql`'exact'` },
        setWhere: sql`${guildLevels.source} <> 'exact'`,
      }).returning({ guid: guildLevels.guid });
      sum.levels += res.length;
    }

    if (Object.keys(guildPatch).length) await tx.update(gameGuilds).set(guildPatch).where(eq(gameGuilds.groupId, groupId));
    await freezePodium(tx, groupId);
  });
  return sum;
}

/** « Premiers 60 » figés dès le troisième : gardés tels quels ensuite (un départ ne les change plus). */
export async function freezePodium(db: Tx, groupId: string) {
  const [gg] = await db.select({ podium: gameGuilds.podium }).from(gameGuilds).where(eq(gameGuilds.groupId, groupId));
  if (!gg || gg.podium) return;
  const rows = await db.select({ guid: guildLevels.guid, at: guildLevels.reachedAt, source: guildLevels.source, name: guildMembers.name, cls: guildMembers.cls })
    .from(guildLevels).innerJoin(guildMembers, and(eq(guildMembers.groupId, guildLevels.groupId), eq(guildMembers.guid, guildLevels.guid)))
    .where(and(eq(guildLevels.groupId, groupId), eq(guildLevels.level, MAX_LEVEL), gte(guildLevels.reachedAt, new Date(RACE_START))))
    .orderBy(asc(guildLevels.reachedAt), asc(guildMembers.name));
  if (rows.length < 3) return;
  // Les trois premiers, et ceux qui sont ex æquo avec le troisième
  const podium: FrozenPodiumPlace[] = [];
  for (const [i, r] of rows.entries()) {
    const prev = podium[i - 1];
    const tie = !!prev && prev.at === r.at.toISOString();
    if (i >= 3 && !tie) break;
    podium.push({ guid: r.guid, name: r.name, cls: r.cls, at: r.at.toISOString(), exact: r.source === "exact", place: tie ? prev.place : i + 1, tie });
    if (tie) prev.tie = true;
  }
  await db.update(gameGuilds).set({ podium }).where(and(eq(gameGuilds.groupId, groupId), isNull(gameGuilds.podium)));
}

function summaryText(s: GuildApplySummary) {
  const parts: string[] = [];
  if (s.roster === "applied") {
    parts.push(`liste de ${plural(s.members, "membre")}${s.complete ? " (complète)" : " (partielle)"}`);
    if (s.arrivals) parts.push(plural(s.arrivals, "arrivée"));
  } else if (s.roster === "older") parts.push("liste plus ancienne que celle du site (gardée)");
  if (s.departures) parts.push(plural(s.departures, "départ"));
  if (s.events) parts.push(`journal : ${plural(s.events, "nouvel événement", "nouveaux événements")}`);
  if (s.levels) parts.push(plural(s.levels, "niveau noté", "niveaux notés"));
  if (s.xp) parts.push(`XP de ${plural(s.xp, "perso")}`);
  return parts.join(", ") || "rien de nouveau";
}

/** Relevés de guilde d'un texte collé ou envoyé (Ctrl+V, Roster Companion) : un résultat par guilde du jeu. */
export async function importGuildText(db: Db, user: User, text: string) {
  const r = parseGuildBlocks(text);
  return { results: await importGuildExports(db, user, r.blocks), errors: r.errors };
}

export async function importGuildExports(db: Db, user: User, blocks: readonly GuildBlock[], now: Date = new Date()): Promise<ImportResult[]> {
  if (!blocks.length) return [];
  const out: ImportResult[] = [];
  const mine = await db.select({ id: groups.id, name: groups.name, role: groupMembers.role, gg: gameGuilds })
    .from(groupMembers).innerJoin(groups, eq(groups.id, groupMembers.groupId)).leftJoin(gameGuilds, eq(gameGuilds.groupId, groups.id))
    .where(and(eq(groupMembers.userId, user.id), eq(groups.game, "forever"))).orderBy(asc(groups.name));
  for (const { data: g, text } of blocks) {
    const key = guildKeyOf(g);
    const base = { key: `frl:${key}`, kind: "guild" as const, name: `Guilde ${g.name}` };
    try {
      let targets = mine.filter(m => m.gg?.key === key);
      const linked: string[] = [];
      if (!targets.length) {
        // Premier relevé d'un officier : lien automatique s'il n'a qu'une guilde Forever sans lien, sinon proposé à chacune
        const free = mine.filter(m => officerRole(m.role) && (!m.gg || provisional(m.gg, now.getTime())));
        if (free.length === 1) {
          const f = free[0]!;
          const replaced = f.gg;
          f.gg = await db.transaction(tx => linkGameGuild(tx, f.id, g, user, true));
          await audit(db, null, "guild_linked", { userId: user.id, groupId: f.id, meta: { guild: g.name, realm: g.realm, faction: g.faction, auto: true, ...(replaced && { replaced: replaced.name }) } });
          targets = [f];
          linked.push(f.name);
        } else if (free.length > 1) {
          for (const f of free) {
            await db.insert(guildLinkProposals).values({
              groupId: f.id, key, name: g.name, realm: g.realm, faction: g.faction, members: g.roster?.total ?? 0, proposedBy: user.id, proposedByName: user.displayName, text,
            }).onConflictDoUpdate({
              target: [guildLinkProposals.groupId, guildLinkProposals.key],
              set: { members: g.roster?.total ?? 0, proposedBy: user.id, proposedByName: user.displayName, text, createdAt: now },
            });
            bus.group({ t: "guild", g: f.id });
          }
          out.push({ ...base, status: "ignored", message: `à lier : la guilde du jeu est proposée dans l'Administration de ${free.map(f => `« ${f.name} »`).join(", ")}` });
          continue;
        } else {
          const other = mine.find(m => m.gg);
          out.push({
            ...base, status: "ignored",
            message: other
              ? `ignoré : « ${other.name} » est liée à la guilde du jeu ${other.gg!.name}, pas à ${g.name}`
              : mine.length
                ? "ignoré : aucune de tes guildes du site n'est liée à cette guilde du jeu (le premier relevé d'un officier fait le lien)"
                : "ignoré : tu n'es dans aucune guilde du site",
          });
          continue;
        }
      }
      const parts: string[] = [];
      for (const t of targets) {
        const s = await applyGuildExport(db, t.id, g, { officer: officerRole(t.role), now });
        parts.push(`${targets.length > 1 || linked.length ? `${t.name}${linked.includes(t.name) ? " (liée)" : ""} : ` : ""}${summaryText(s)}`);
        bus.group({ t: "guild", g: t.id });
      }
      out.push({ ...base, status: "updated", message: parts.join(" · "), groups: targets.map(t => ({ id: t.id, name: t.name })) });
    } catch {
      out.push({ ...base, status: "error", message: "relevé de guilde impossible à enregistrer" });
    }
  }
  return out;
}
