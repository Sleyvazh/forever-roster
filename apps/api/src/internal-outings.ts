import {
  characterRoles, classRoles, dayKeyOf, dungeonsFor, FOREVER_DUNGEONS, hasDungeonLevel, MAX_OPEN_OUTINGS_PER_PLAYER, OTHER_DUNGEON, OUTING_ROLES, OUTING_SOON_MS,
  pickCharacterFor, specForRole, type Role,
} from "@forever/game-data";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "./config";
import type { Db } from "./db/client";
import { characters, groupCharacters, groups, outingNotices, outings, users } from "./db/schema";
import { badRequest, forbidden, parse } from "./lib/http";
import {
  assertForever, createOuting, joinOuting, leaveOuting, loadOuting, noticePayload, openCounts, outingDiscordView, OUTINGS_CHANNEL, purgeExpired, signupsOf,
} from "./lib/outings";
import { fullNames } from "./lib/guild";
import { canDm } from "./lib/reach";
import { siteForGame } from "./lib/site";

/**
 * API interne du bot pour les sorties donjon (Forever) : annonces à publier, mettre à jour ou effacer, inscription par
 * boutons (membre lié ou inscrit sans compte), /sortie, et MP (sortie complète, 15 min avant, heure changée, annulée,
 * place libérée). Mêmes règles que le site (lib/outings.ts).
 */

const snowflake = z.string().regex(/^\d{5,25}$/);
const idParam = z.object({ id: z.uuid() });
const role = z.enum(OUTING_ROLES);

type Helpers = {
  linkedMember(discordUserId: string, groupId: string): Promise<{ user: { id: string; displayName: string } | null; role: "owner" | "officer" | "member" | null }>;
  groupForChannel(guildId: string, channelId: string): Promise<typeof groups.$inferSelect>;
};

export function outingRoutes(app: FastifyInstance, db: Db, cfg: Config, h: Helpers) {
  const origin = (game: "forever" | "retail") => siteForGame(cfg, game).origin;
  const view = async (id: string) => {
    const v = await outingDiscordView(db, id, origin("forever"));
    if (!v) throw badRequest("Cette sortie n'existe plus.");
    return v;
  };

  /** Persos d'un joueur pour une sortie de ce groupe : de Forever, rangés dans le groupe ou sans groupe, avec une classe. */
  const charactersOf = (userId: string, groupId: string) => db.select({
    id: characters.id, name: characters.name, cls: characters.cls, spec1: characters.spec1, spec2: characters.spec2, level: characters.level, isMain: groupCharacters.isMain,
  }).from(characters).leftJoin(groupCharacters, eq(groupCharacters.characterId, characters.id))
    .where(and(eq(characters.userId, userId), eq(characters.game, "forever"), sql`${characters.cls} <> ''`, or(isNull(groupCharacters.groupId), eq(groupCharacters.groupId, groupId))))
    .orderBy(asc(characters.sortOrder), asc(characters.createdAt));

  /* ----- Annonces ----- */

  /**
   * Sorties à publier ou à mettre à jour : changées depuis la dernière publication, pas dans le bon salon, ou rendues un
   * autre jour (« demain » devient « ce soir » après minuit). Les sorties passées sont d'abord purgées (message effacé).
   */
  app.get("/internal/discord/outings/outbox", async () => {
    const now = new Date();
    await purgeExpired(db, now);
    const today = dayKeyOf(now);
    const rows = await db.select({ id: outings.id }).from(outings).innerJoin(groups, eq(groups.id, outings.groupId))
      .where(and(
        isNotNull(OUTINGS_CHANNEL), gt(outings.expiresAt, now),
        or(isNull(outings.discordSyncedAt), sql`${outings.discordSyncedAt} < date_trunc('milliseconds', ${outings.discordChangedAt})`,
          sql`${outings.discordChannelId} IS DISTINCT FROM ${OUTINGS_CHANNEL}`, sql`${outings.discordRenderedOn} IS DISTINCT FROM ${today}::date`),
      )).orderBy(asc(outings.discordChangedAt)).limit(20);
    const list = [];
    for (const r of rows) { const v = await outingDiscordView(db, r.id, origin("forever"), now); if (v) list.push(v); }
    return { outings: list };
  });

  app.post("/internal/discord/outings/:id/published", async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ channelId: snowflake, messageId: snowflake, changedAt: z.iso.datetime({ offset: true }), renderedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.body);
    await db.update(outings).set({ discordChannelId: body.channelId, discordMessageId: body.messageId, discordSyncedAt: new Date(body.changedAt), discordRenderedOn: body.renderedOn })
      .where(eq(outings.id, id));
    return { ok: true };
  });

  app.get("/internal/discord/outings/:id/view", async (req: FastifyRequest) => view(parse(idParam, req.params).id));

  /* ----- Inscription par les boutons ----- */

  /** Qui clique : un membre lié (avec ses persos qui ont le niveau et tiennent le rôle), ou un inscrit sans compte. */
  app.get("/internal/discord/outings/:id/choices", async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const q = parse(z.object({ discordUserId: snowflake, role }), req.query);
    const { outing, group } = await loadOuting(db, id);
    const { user, role: member } = await h.linkedMember(q.discordUserId, group.id);
    const { placed, waiting } = (await signupsOf(db, [id])).get(id)!;
    const cur = [...placed, ...waiting].find(s => (user && member ? s.userId === user.id : s.discordUserId === q.discordUserId && !s.userId));
    const current = cur ? { role: cur.role, waiting: !!cur.waitingSince, characterId: cur.characterId, cls: cur.cls, spec: cur.spec } : null;
    if (!user || !member) return { mode: "guest" as const, linked: !!user, current, levels: outing.minLevel ? `${outing.minLevel}-${outing.maxLevel}` : "" };
    const range = outing.minLevel && outing.maxLevel ? { min: outing.minLevel, max: outing.maxLevel } : null;
    const all = await charactersOf(user.id, group.id);
    const fit = all.filter(c => (!range || hasDungeonLevel(range, c.level)) && classRoles(c.cls).includes(q.role))
      // Ceux dont une spé tient ce rôle d'abord, le main, puis le plus haut
      .sort((a, b) => Number(characterRoles(b).includes(q.role)) - Number(characterRoles(a).includes(q.role)) || Number(!!b.isMain) - Number(!!a.isMain) || b.level - a.level);
    return {
      mode: "member" as const, linked: true, current, creator: outing.createdBy === user.id,
      levels: range ? `${range.min}-${range.max}` : "", anyAtLevel: all.some(c => !range || hasDungeonLevel(range, c.level)),
      characters: fit.map(c => ({ id: c.id, name: c.name, cls: c.cls, level: c.level, spec: specForRole(c, q.role) })),
    };
  });

  app.post("/internal/discord/outings/:id/signup", async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({
      discordUserId: snowflake, discordName: z.string().trim().min(1).max(64), role,
      characterId: z.uuid().nullable().optional(), cls: z.string().max(20).optional(), spec: z.string().max(20).optional(), wait: z.boolean().optional(),
    }), req.body);
    const { group } = await loadOuting(db, id);
    const { user, role: member } = await h.linkedMember(body.discordUserId, group.id);
    const result = user && member
      ? await joinOuting(db, id, { kind: "user", id: user.id, displayName: user.displayName }, { role: body.role, characterId: body.characterId, spec: body.spec, wait: body.wait }, origin("forever"))
      : await joinOuting(db, id, { kind: "guest", discordUserId: body.discordUserId, displayName: body.discordName }, { role: body.role, cls: body.cls, spec: body.spec, wait: body.wait }, origin("forever"));
    return { result, view: await view(id) };
  });

  app.delete("/internal/discord/outings/:id/signup/:discordUserId", async (req: FastifyRequest) => {
    const { id, discordUserId } = parse(idParam.extend({ discordUserId: snowflake }), req.params);
    const { group } = await loadOuting(db, id);
    const { user, role: member } = await h.linkedMember(discordUserId, group.id);
    const who = user && member ? { kind: "user" as const, id: user.id, displayName: user.displayName } : { kind: "guest" as const, discordUserId, displayName: "" };
    const removed = await leaveOuting(db, id, who, origin("forever"));
    return { removed, view: await view(id) };
  });

  /* ----- /sortie ----- */

  /** Donjon tapé dans /sortie : une clé (complétion), un nom connu, sinon une sortie « Autre » avec ce titre. */
  const dungeonOf = (text: string) => {
    const t = text.trim();
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    const byKey = FOREVER_DUNGEONS.find(d => d.key === t);
    if (byKey) return { dungeon: byKey.key, title: null };
    const n = norm(t);
    const exact = FOREVER_DUNGEONS.filter(d => norm(d.name) === n || norm(d.name.replace(/^The /, "")) === n);
    const prefix = FOREVER_DUNGEONS.filter(d => n.length >= 3 && (norm(d.name).startsWith(n) || norm(d.name.replace(/^The /, "")).startsWith(n)));
    const one = exact[0] ?? (prefix.length === 1 ? prefix[0] : null);
    return one ? { dungeon: one.key, title: null } : { dungeon: OTHER_DUNGEON, title: t };
  };

  /** Complétion du donjon de /sortie : triés pour le perso du joueur, avec « N persos au niveau ». */
  app.get("/internal/discord/outings/dungeons", async (req: FastifyRequest) => {
    const q = parse(z.object({ guildId: snowflake, channelId: snowflake, discordUserId: snowflake, q: z.string().max(60).default("") }), req.query);
    let g: typeof groups.$inferSelect;
    try { g = await h.groupForChannel(q.guildId, q.channelId); } catch { return { choices: [] }; }
    if (g.game !== "forever") return { choices: [] };
    const levels = (await db.select({ level: characters.level }).from(groupCharacters).innerJoin(characters, eq(characters.id, groupCharacters.characterId))
      .where(eq(groupCharacters.groupId, g.id))).map(r => r.level);
    const { user, role: member } = await h.linkedMember(q.discordUserId, g.id);
    const mine = user && member ? await charactersOf(user.id, g.id) : [];
    const me = pickCharacterFor(null, mine.map(c => ({ ...c, isMain: !!c.isMain })));
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const wanted = norm(q.q.trim());
    const { fit, off } = dungeonsFor(me?.level ?? 60, levels);
    const list = [...fit, ...off].filter(c => !wanted || norm(c.dungeon.name).includes(wanted) || c.dungeon.key.includes(wanted));
    return {
      choices: list.slice(0, 25).map(c => ({ key: c.dungeon.key, name: c.dungeon.name, levels: `${c.dungeon.min}-${c.dungeon.max}`, count: c.count, fits: !c.off && !!me })),
    };
  });

  app.post("/internal/discord/outings", async (req: FastifyRequest) => {
    const body = parse(z.object({
      guildId: snowflake, channelId: snowflake, discordUserId: snowflake,
      dungeon: z.string().trim().min(1).max(60), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), at: z.iso.datetime({ offset: true }).nullable(),
      note: z.string().max(200).optional(),
    }), req.body);
    const g = await h.groupForChannel(body.guildId, body.channelId);
    assertForever(g);
    const { user, role: member } = await h.linkedMember(body.discordUserId, g.id);
    if (!user) throw forbidden("Lie d'abord ton compte Discord au site (Compte & sécurité).");
    if (!member) throw forbidden("Tu n'es pas membre de ce groupe.");
    const d = dungeonOf(body.dungeon);
    const dg = FOREVER_DUNGEONS.find(x => x.key === d.dungeon);
    // Son perso : celui qui a le niveau (main d'abord), dans le rôle de sa spé principale
    const mine = (await charactersOf(user.id, g.id)).map(c => ({ ...c, isMain: !!c.isMain }));
    const ch = pickCharacterFor(dg ? { min: dg.min, max: dg.max } : null, mine);
    if (!ch) throw badRequest(mine.length ? `Aucun de tes persos n'a le niveau de ${dg!.name} (${dg!.min}-${dg!.max}).` : "Tu n'as aucun perso de WoW Forever sur le site : ajoute-en un dans « Mes persos ».");
    const r: Role = characterRoles(ch)[0] ?? "DPS";
    const id = await createOuting(db, g, member, { id: user.id, displayName: user.displayName }, {
      dungeon: d.dungeon, title: d.title, day: body.day, at: body.at, note: body.note, characterId: ch.id, role: r,
    });
    const n = await openCounts(db, g.id, user.id);
    return { view: await view(id), character: ch.name, role: r, open: { mine: n.mine, max: MAX_OPEN_OUTINGS_PER_PLAYER } };
  });

  /* ----- MP ----- */

  /**
   * MP à envoyer : d'abord les rappels dus (15 min avant, une fois par sortie, inscrits qui ont une place), puis la file
   * (sortie complète, heure changée, annulée, place libérée). Chaque MP n'est remis qu'une fois au bot.
   */
  app.post("/internal/discord/outings/notices/claim", async () => {
    const now = new Date();
    const due = await db.select({ id: outings.id }).from(outings)
      .where(and(isNull(outings.soonNotifiedAt), isNotNull(outings.scheduledAt), gt(outings.expiresAt, now),
        lte(outings.scheduledAt, new Date(now.getTime() + OUTING_SOON_MS)), gt(outings.scheduledAt, new Date(now.getTime() - 5 * 60e3)))).limit(20);
    if (due.length) {
      const claimed = await db.update(outings).set({ soonNotifiedAt: now }).where(and(inArray(outings.id, due.map(d => d.id)), isNull(outings.soonNotifiedAt))).returning();
      for (const o of claimed) {
        const [g] = await db.select().from(groups).where(eq(groups.id, o.groupId));
        const { placed } = (await signupsOf(db, [o.id])).get(o.id)!;
        const ids = placed.flatMap(s => (s.userId ? [s.userId] : []));
        const us = ids.length ? await db.select({ id: users.id, discordId: users.discordId, reminders: users.discordReminders }).from(users).where(inArray(users.id, ids)) : [];
        const byUser = new Map(us.map(u => [u.id, u]));
        const base = noticePayload(o, g!, origin("forever"));
        const rows = placed.flatMap(s => {
          const u = s.userId ? byUser.get(s.userId) : null;
          const to = s.userId ? (u && canDm(u) ? u.discordId : null) : s.discordUserId;
          return to ? [{ discordUserId: to, kind: "soon" as const, payload: { ...base, role: s.role, character: s.characterName || s.cls, isCreator: !!s.userId && s.userId === o.createdBy, count: placed.length } }] : [];
        });
        if (rows.length) await db.insert(outingNotices).values(rows);
      }
    }
    const notices = await db.update(outingNotices).set({ claimedAt: now })
      .where(inArray(outingNotices.id, db.select({ id: outingNotices.id }).from(outingNotices).where(isNull(outingNotices.claimedAt)).orderBy(asc(outingNotices.id)).limit(50)))
      .returning({ id: outingNotices.id, discordUserId: outingNotices.discordUserId, kind: outingNotices.kind, payload: outingNotices.payload });
    // Ménage : MP remis depuis plus d'une semaine
    await db.delete(outingNotices).where(lte(outingNotices.claimedAt, new Date(now.getTime() - 7 * 86400e3)));
    // Nom complet des persos quand la liste de guilde le donne (sortie encore là)
    const ids = [...new Set(notices.map(n => n.payload.outingId))];
    const groupOf = new Map(ids.length ? (await db.select({ id: outings.id, g: outings.groupId }).from(outings).where(inArray(outings.id, ids))).map(o => [o.id, o.g]) : []);
    const names = new Map<string, Awaited<ReturnType<typeof fullNames>>>();
    for (const g of new Set(groupOf.values())) names.set(g, await fullNames(db, g));
    for (const n of notices) {
      const full = names.get(groupOf.get(n.payload.outingId) ?? "");
      if (!full) continue;
      n.payload = { ...n.payload, creator: full(n.payload.creator), ...(n.payload.character && { character: full(n.payload.character) }) };
    }
    return { notices: notices.sort((a, b) => a.id - b.id) };
  });
}
