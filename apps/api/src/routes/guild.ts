import {
  characterRoles, classRoles, endOfDay, hasDungeonLevel, LEVEL_ANNOUNCES, levelsText, normalizeGuid, OUTING_ROLES, outingDays, RACE_START, roleOf,
  type GuildCharsResponse, type GuildHistoryResponse, type GuildHomeResponse, type GuildLinkResponse, type GuildMembersResponse, type GuildRaceResponse,
  type HomeAgendaItem, type SignupStatus,
} from "@forever/game-data";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client";
import { characters, gameGuilds, groupCharacters, groups, guildEvents, raids, raidSignups } from "../db/schema";
import { audit } from "../lib/audit";
import { bus } from "../lib/events";
import { membership, requireRole, type GroupRole } from "../lib/groups";
import {
  charView, computeRace, foreverGroup, guildMoves, isOfficer, linkInfo, loadGuild, loadLevels, MOVE_FILTERS, playerOrder, playerView, questionsFor, resolveGuild,
} from "../lib/guild";
import { acceptSuggestion, answerQuestion, attachMember, claimMember, detachMember, linkProposed, proposalsOf, setPlayerMain } from "../lib/guild-links";
import { notFound, parse } from "../lib/http";
import { groupOutings, signupName, signupsOf } from "../lib/outings";
import { currentUser, requireAuth } from "../lib/session";

/**
 * Guilde du jeu (Forever, lot « Guilde ») : membres, mains et alts, historique, Course au 60, accueil de la guilde.
 * Types des réponses dans packages/game-data (src/guild.ts), à utiliser tels quels par le site. Membres de la guilde du
 * site ; « officiers » = officiers et propriétaire. Une guilde de Roster (Retail) répond 400.
 *
 * Lecture (membres) :
 *   GET  /:id/guild                       → GuildMembersResponse : joueurs (main et alts), persos, bande « À rattacher »
 *                                           (officiers ; suggestions des notes), « Est-ce ton perso ? », lien de la guilde
 *   GET  /:id/guild/chars                 → GuildCharsResponse : persos, filtres ?cls=Mage&min=30&max=49&rank=2&active=7 (jours)
 *   GET  /:id/guild/history               → GuildHistoryResponse : arrivées, départs, rangs ; ?kind=all|joins|leaves|ranks&before=<ISO>&limit=50
 *   GET  /:id/guild/race                  → GuildRaceResponse : Course au 60 (podium, premiers par classe, une ligne par joueur, tous les persos, ma place)
 *   GET  /:id/home                        → GuildHomeResponse : aujourd'hui et demain (raids, sorties, mon inscription), mini-course,
 *                                           mouvements de la semaine, « Est-ce ton perso ? »
 *   GET  /:id/guild/link                  → GuildLinkResponse : guilde du jeu liée, guildes proposées (officiers), réglage des annonces
 * Officiers :
 *   POST   /:id/guild/link                { key }            → GuildLinkResponse : lier une guilde du jeu proposée
 *   DELETE /:id/guild/link                                   → { ok } : délier (efface liste, journal, niveaux ; les rattachements restent)
 *   PUT    /:id/guild/announces           { announce }       → { announce } : annonces Discord des niveaux (none | sixty | tens)
 *   PUT    /:id/guild/members/:guid/link  { to }             → { player } : « Rattacher à… » (clé d'un joueur ou d'un perso, ou « new »)
 *   POST   /:id/guild/members/:guid/accept { guid? }         → { player } : accepter la suggestion d'une note (candidat si ambiguë)
 * Officiers, ou le joueur concerné :
 *   DELETE /:id/guild/members/:guid/link                     → { ok } : détacher (le joueur : un perso qu'il a déclaré)
 *   PUT    /:id/guild/players/:key/main   { guid }           → { ok } : choisir le main d'un joueur
 * Le joueur :
 *   POST   /:id/guild/members/:guid/claim                    → { ok } : « C'est mon perso » (perso qui n'est à personne)
 *   POST   /:id/guild/members/:guid/answer { yes }           → { ok } : réponse à « Est-ce ton perso ? »
 */

const gid = z.object({ id: z.uuid() });
const guidParam = gid.extend({ guid: z.string().max(40).transform((s, c) => normalizeGuid(s) ?? (c.addIssue({ code: "custom", message: "GUID invalide" }), z.NEVER)) });
const playerKey = z.string().regex(/^(u:[0-9a-f-]{36}|p:[0-9a-f-]{36}|m:Player-\d{1,6}-[0-9A-Fa-f]{1,16})$/, "joueur invalide");
const DAY = 86400e3;
/** Raids d'aujourd'hui commencés depuis moins de 3 h : encore à l'agenda. */
const RECENT_MS = 3 * 3600e3;
const COMING: SignupStatus[] = ["present", "late"];

export async function guildRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  const now = () => app.ctx.now?.() ?? new Date();
  app.addHook("preHandler", requireAuth);

  /** Membre d'une guilde de Forever : son rôle et la guilde. */
  async function ctx(groupId: string, userId: string, min: GroupRole = "member") {
    const role = min === "member" ? await membership(db, groupId, userId) : await requireRole(db, groupId, userId, min);
    const g = await foreverGroup(db, groupId);
    return { role, g, officer: isOfficer(role) };
  }
  const changed = (groupId: string) => bus.group({ t: "guild", g: groupId });

  app.get("/:id/guild", async (req): Promise<GuildMembersResponse> => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    const { officer } = await ctx(id, u.id);
    const r = resolveGuild(await loadGuild(db, id), { officer, now: now() });
    const persons = [...r.persons.values()].sort(playerOrder);
    const shown = new Set([...persons.flatMap(p => p.chars.map(c => c.guid)), ...r.band.keys()]);
    const mine = persons.find(p => p.userId === u.id);
    return {
      link: linkInfo(r.data.gg),
      players: persons.map(p => playerView(r, p, u.id)),
      chars: r.data.members.filter(m => shown.has(m.guid)).map(m => charView(r, m, { officer, me: u.id })),
      unattached: [...r.band.values()],
      questions: questionsFor(r, u.id),
      canManage: officer,
      me: { player: mine?.key ?? null },
    };
  });

  app.get("/:id/guild/chars", async (req): Promise<GuildCharsResponse> => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    const q = parse(z.object({
      cls: z.string().max(20).optional(), min: z.coerce.number().int().min(1).max(60).optional(), max: z.coerce.number().int().min(1).max(60).optional(),
      rank: z.coerce.number().int().min(0).max(20).optional(), active: z.coerce.number().int().min(1).max(365).optional(),
    }), req.query);
    const { officer } = await ctx(id, u.id);
    const t = now();
    const r = resolveGuild(await loadGuild(db, id), { officer, now: t });
    const all = r.data.members.filter(m => !m.leftAt);
    const list = all.filter(m => (!q.cls || m.cls === q.cls) && (!q.min || m.level >= q.min) && (!q.max || m.level <= q.max) && (q.rank === undefined || m.rankIndex === q.rank)
      && (!q.active || m.online || (!!m.lastOnlineAt && t.getTime() - m.lastOnlineAt.getTime() < q.active * DAY)))
      .sort((a, b) => b.level - a.level || a.rankIndex - b.rankIndex || a.name.localeCompare(b.name));
    return {
      chars: list.map(m => charView(r, m, { officer, me: u.id })), total: all.length,
      players: [...r.persons.values()].map(p => { const v = playerView(r, p, u.id); return { key: v.key, account: v.account, main: v.main }; }),
    };
  });

  app.get("/:id/guild/history", async (req): Promise<GuildHistoryResponse> => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    const q = parse(z.object({ kind: z.enum(["all", "joins", "leaves", "ranks"]).default("all"), before: z.iso.datetime({ offset: true }).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    await ctx(id, u.id);
    const data = await loadGuild(db, id);
    if (!data.gg) return { moves: [], journal: null, since: null, more: false };
    const { moves, more } = await guildMoves(db, id, data.members, { types: MOVE_FILTERS[q.kind], before: q.before ? new Date(q.before) : undefined, limit: q.limit });
    const [oldest] = await db.select({ at: guildEvents.at }).from(guildEvents).where(eq(guildEvents.groupId, id)).orderBy(asc(guildEvents.at)).limit(1);
    return {
      moves, more,
      journal: data.gg.journalAt ? { at: data.gg.journalAt.toISOString(), by: data.gg.journalBy } : null,
      since: oldest?.at.toISOString() ?? null,
    };
  });

  app.get("/:id/guild/race", async (req): Promise<GuildRaceResponse> => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    const { g } = await ctx(id, u.id);
    const t = now();
    const r = resolveGuild(await loadGuild(db, id), { officer: true, now: t });
    const race = computeRace(r, r.data.gg ? await loadLevels(db, id) : [], { now: t, me: u.id, announce: g.levelAnnounces });
    return { startsAt: new Date(RACE_START).toISOString(), linked: !!r.data.gg, ...race };
  });

  app.get("/:id/home", async (req): Promise<GuildHomeResponse> => homeView(db, parse(gid, req.params).id, currentUser(req).id, now(), ctx));

  /* ----- Lien de la guilde du jeu, annonces ----- */

  const linkResponse = async (id: string, officer: boolean, announce: GuildLinkResponse["announce"]): Promise<GuildLinkResponse> => {
    const [gg] = await db.select().from(gameGuilds).where(eq(gameGuilds.groupId, id));
    const proposals = officer && !gg ? (await proposalsOf(db, id)).map(p => ({ ...p, at: p.at.toISOString() })) : [];
    return { link: linkInfo(gg ?? null), proposals, announce, canManage: officer };
  };

  app.get("/:id/guild/link", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    const { officer, g } = await ctx(id, u.id);
    return linkResponse(id, officer, g.levelAnnounces);
  });

  app.post("/:id/guild/link", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    const { key } = parse(z.object({ key: z.string().min(3).max(200) }), req.body);
    const { g } = await ctx(id, u.id, "officer");
    const { name } = await linkProposed(db, id, key, u);
    await audit(db, req, "guild_linked", { userId: u.id, groupId: id, meta: { guild: name, auto: false } });
    changed(id);
    return linkResponse(id, true, g.levelAnnounces);
  });

  app.delete("/:id/guild/link", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await ctx(id, u.id, "officer");
    const [gone] = await db.delete(gameGuilds).where(eq(gameGuilds.groupId, id)).returning({ name: gameGuilds.name });
    if (!gone) throw notFound("Cette guilde n'est liée à aucune guilde du jeu.");
    await audit(db, req, "guild_unlinked", { userId: u.id, groupId: id, meta: { guild: gone.name } });
    changed(id);
    return { ok: true };
  });

  app.put("/:id/guild/announces", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    const { announce } = parse(z.object({ announce: z.enum(LEVEL_ANNOUNCES) }), req.body);
    await ctx(id, u.id, "officer");
    await db.update(groups).set({ levelAnnounces: announce }).where(eq(groups.id, id));
    await audit(db, req, "guild_announces", { userId: u.id, groupId: id, meta: { announce } });
    changed(id);
    return { announce };
  });

  /* ----- Mains et alts ----- */

  app.put("/:id/guild/members/:guid/link", async (req) => {
    const u = currentUser(req);
    const p = parse(guidParam, req.params);
    const { to } = parse(z.object({ to: z.union([playerKey, z.literal("new")]) }), req.body);
    await ctx(p.id, u.id, "officer");
    const r = await attachMember(db, p.id, p.guid, to, u);
    await audit(db, req, "guild_member_linked", { userId: u.id, groupId: p.id, meta: { character: r.name, to } });
    changed(p.id);
    return { player: r.player };
  });

  app.delete("/:id/guild/members/:guid/link", async (req) => {
    const u = currentUser(req);
    const p = parse(guidParam, req.params);
    const { officer } = await ctx(p.id, u.id);
    const r = await detachMember(db, p.id, p.guid, u, officer);
    await audit(db, req, "guild_member_unlinked", { userId: u.id, groupId: p.id, meta: { character: r.name } });
    changed(p.id);
    return { ok: true };
  });

  app.post("/:id/guild/members/:guid/accept", async (req) => {
    const u = currentUser(req);
    const p = parse(guidParam, req.params);
    const body = parse(z.object({ guid: z.string().max(40).optional() }), req.body ?? {});
    await ctx(p.id, u.id, "officer");
    const r = await acceptSuggestion(db, p.id, p.guid, u, body.guid ? normalizeGuid(body.guid) ?? undefined : undefined);
    await audit(db, req, "guild_member_linked", { userId: u.id, groupId: p.id, meta: { character: r.name, to: r.player, note: true } });
    changed(p.id);
    return { player: r.player };
  });

  app.post("/:id/guild/members/:guid/claim", async (req) => {
    const u = currentUser(req);
    const p = parse(guidParam, req.params);
    await ctx(p.id, u.id);
    await claimMember(db, p.id, p.guid, u);
    changed(p.id);
    return { ok: true };
  });

  app.post("/:id/guild/members/:guid/answer", async (req) => {
    const u = currentUser(req);
    const p = parse(guidParam, req.params);
    const { yes } = parse(z.object({ yes: z.boolean() }), req.body);
    await ctx(p.id, u.id);
    await answerQuestion(db, p.id, p.guid, u, yes);
    changed(p.id);
    return { ok: true };
  });

  app.put("/:id/guild/players/:key/main", async (req) => {
    const u = currentUser(req);
    const p = parse(gid.extend({ key: playerKey }), req.params);
    const { guid } = parse(z.object({ guid: z.string().max(40) }), req.body);
    const { officer } = await ctx(p.id, u.id);
    const g = normalizeGuid(guid);
    if (!g) throw notFound("Perso introuvable.");
    await setPlayerMain(db, p.id, p.key, g, u, officer);
    changed(p.id);
    return { ok: true };
  });
}

/* ---------- Accueil de la guilde ---------- */

/**
 * Accueil (Forever) : raids et sorties d'aujourd'hui et demain (heure de Paris) avec mon inscription et, pour une sortie
 * où il manque du monde, mon perso qui a le niveau ; mini-course ; arrivées, départs et rangs des 7 derniers jours.
 */
async function homeView(db: Db, id: string, me: string, t: Date, ctx: (g: string, u: string) => Promise<{ role: GroupRole; g: typeof groups.$inferSelect }>): Promise<GuildHomeResponse> {
  const { g } = await ctx(id, me);
  const { today, tomorrow } = outingDays(t);
  const agenda: (HomeAgendaItem & { sort: number })[] = [];

  // Raids
  const raidRows = await db.select({ id: raids.id, name: raids.name, at: raids.scheduledAt, size: raids.size }).from(raids)
    .where(and(eq(raids.groupId, id), isNotNull(raids.scheduledAt), gt(raids.scheduledAt, new Date(t.getTime() - RECENT_MS)), lt(raids.scheduledAt, endOfDay(tomorrow))))
    .orderBy(asc(raids.scheduledAt));
  const signups = raidRows.length ? await db.select({ raidId: raidSignups.raidId, userId: raidSignups.userId, status: raidSignups.status, spec: raidSignups.spec, characterId: raidSignups.characterId, characterName: characters.name })
    .from(raidSignups).leftJoin(characters, eq(characters.id, raidSignups.characterId)).where(inArray(raidSignups.raidId, raidRows.map(r => r.id))) : [];
  const [main] = await db.select({ id: groupCharacters.characterId }).from(groupCharacters)
    .where(and(eq(groupCharacters.groupId, id), eq(groupCharacters.userId, me), eq(groupCharacters.isMain, true)));
  for (const r of raidRows) {
    const rows = signups.filter(s => s.raidId === r.id);
    const coming = rows.filter(s => COMING.includes(s.status));
    const role = (x: string) => coming.filter(s => s.spec && roleOf(s.spec) === x).length;
    const mine = rows.find(s => s.userId === me);
    agenda.push({
      kind: "raid", id: r.id, name: r.name, at: r.at!.toISOString(), size: r.size,
      counts: { coming: coming.length, tank: role("Tank"), heal: role("Heal"), dps: coming.filter(s => !s.spec || roleOf(s.spec) === "DPS").length, tentative: rows.filter(s => s.status === "tentative").length },
      mine: mine ? { status: mine.status, characterName: mine.characterName, characterId: mine.characterId, spec: mine.spec } : null, mainId: main?.id ?? null, sort: r.at!.getTime(),
    });
  }

  // Sorties : celles pour mes persos (niveau), les miennes, et celles sans fourchette
  const outs = (await groupOutings(db, id, t)).filter(o => o.day === today || o.day === tomorrow);
  const sign = await signupsOf(db, outs.map(o => o.id));
  const chars = await db.select({ id: characters.id, name: characters.name, cls: characters.cls, spec1: characters.spec1, spec2: characters.spec2, level: characters.level, isMain: groupCharacters.isMain })
    .from(characters).leftJoin(groupCharacters, eq(groupCharacters.characterId, characters.id))
    .where(and(eq(characters.userId, me), eq(characters.game, "forever"), or(isNull(groupCharacters.groupId), eq(groupCharacters.groupId, id))));
  const myChars = chars.filter(c => c.cls);
  let hidden = 0;
  for (const o of outs) {
    const { placed, waiting } = sign.get(o.id)!;
    const range = o.minLevel && o.maxLevel ? { min: o.minLevel, max: o.maxLevel } : null;
    const fit = myChars.filter(c => !range || hasDungeonLevel(range, c.level));
    const mine = [...placed, ...waiting].find(s => s.userId === me);
    const creator = o.createdBy === me;
    if (!mine && !creator && !fit.length) { hidden++; continue; }
    const places = { tank: o.tanks, heal: o.heals, dps: o.dps };
    const filled = { tank: placed.filter(s => s.role === "Tank").length, heal: placed.filter(s => s.role === "Heal").length, dps: placed.filter(s => s.role === "DPS").length };
    const missing = { tank: Math.max(0, places.tank - filled.tank), heal: Math.max(0, places.heal - filled.heal), dps: Math.max(0, places.dps - filled.dps) };
    const suggest = mine ? [] : OUTING_ROLES.flatMap(role => {
      if (!missing[role === "Tank" ? "tank" : role === "Heal" ? "heal" : "dps"]) return [];
      const c = fit.filter(x => classRoles(x.cls).includes(role))
        .sort((a, b) => Number(characterRoles(b).includes(role)) - Number(characterRoles(a).includes(role)) || Number(!!b.isMain) - Number(!!a.isMain) || b.level - a.level)[0];
      return c ? [{ role, characterId: c.id, characterName: c.name }] : [];
    });
    agenda.push({
      kind: "outing", id: o.id, title: o.title, dungeon: o.dungeon, levels: levelsText(o.minLevel, o.maxLevel), day: o.day, at: o.scheduledAt?.toISOString() ?? null,
      places, missing, waiting: waiting.length, full: placed.length >= o.tanks + o.heals + o.dps, creator: o.creatorName,
      mine: mine || creator ? { role: mine?.role ?? "", characterName: mine ? signupName(mine) : "", waiting: !!mine?.waitingSince, creator } : null,
      suggest, sort: o.scheduledAt?.getTime() ?? endOfDay(o.day).getTime() - 1,
    });
  }
  agenda.sort((a, b) => a.sort - b.sort);

  // Mini-course et mouvements
  const data = await loadGuild(db, id);
  const r = resolveGuild(data, { officer: true, now: t });
  const race = computeRace(r, data.gg ? await loadLevels(db, id) : [], { now: t, me, announce: g.levelAnnounces });
  const meRow = race.rows.find(x => x.me);
  const moves = data.gg ? (await guildMoves(db, id, data.members, { types: MOVE_FILTERS.all, since: new Date(t.getTime() - 7 * DAY), limit: 20 })).moves : [];
  return {
    today, tomorrow,
    agenda: agenda.map(({ sort: _, ...a }) => a as HomeAgendaItem),
    outings: { total: outs.length, hidden },
    race: {
      startsAt: new Date(RACE_START).toISOString(), started: race.started, day: race.day, linked: !!data.gg, podium: race.podium.places,
      me: meRow ? { rank: meRow.rank, tie: meRow.tie, name: meRow.best.name, cls: meRow.best.cls, level: meRow.best.level, xpPct: meRow.best.xpPct, weekGain: meRow.best.weekGain } : null,
    },
    moves,
    guild: { linked: !!data.gg, name: data.gg?.name ?? null, rosterAt: data.gg?.rosterAt?.toISOString() ?? null },
    questions: questionsFor(resolveGuild(data, { officer: false, now: t }), me),
  };
}
