import { MAX_OPEN_OUTINGS_PER_PLAYER, OUTING_ROLES, outingDays } from "@forever/game-data";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { characters, groupCharacters, groups, users } from "../db/schema";
import { membership } from "../lib/groups";
import { notFound, parse, forbidden } from "../lib/http";
import {
  assertForever, canManage, cancelOuting, createOuting, groupOutings, joinOuting, leaveOuting, loadOuting, mayCreate, moveOuting, openCounts,
  removeSignup, signupName, signupsOf, updateOuting, zoneOf,
} from "../lib/outings";
import { canDm } from "../lib/reach";
import { currentUser, requireAuth } from "../lib/session";
import { siteForGame } from "../lib/site";

/** Sorties donjon (Forever) : onglet Sorties du groupe. Logique dans lib/outings.ts (partagée avec le bot). */

const gid = z.object({ id: z.uuid() });
const oid = gid.extend({ outingId: z.uuid() });
const role = z.enum(OUTING_ROLES);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const at = z.iso.datetime({ offset: true }).nullable();
const places = z.object({ tank: z.int().min(0).max(5), heal: z.int().min(0).max(5), dps: z.int().min(0).max(5) });

export async function outingRoutes(app: FastifyInstance) {
  const { db, cfg } = app.ctx;
  app.addHook("preHandler", requireAuth);

  /** Membre d'un groupe de Forever : son rôle et le groupe. */
  async function forGroup(groupId: string, userId: string) {
    const role = await membership(db, groupId, userId);
    const [g] = await db.select().from(groups).where(eq(groups.id, groupId));
    if (!g) throw notFound("Guilde introuvable.");
    assertForever(g);
    return { role, g, origin: siteForGame(cfg, g.game).origin };
  }

  /**
   * Sorties du jour et de demain, avec de quoi s'inscrire en un clic : mes persos (rangés dans le groupe, ou sans groupe)
   * et les niveaux des persos du groupe (« N persos de la guilde ont le niveau »).
   */
  app.get("/:id/outings", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    const { role, g } = await forGroup(id, u.id);
    const rows = await groupOutings(db, id);
    const sign = await signupsOf(db, rows.map(o => o.id));
    // Joignables par MP (vue du créateur et des officiers)
    const userIds = [...new Set([...sign.values()].flatMap(e => [...e.placed, ...e.waiting]).flatMap(s => (s.userId ? [s.userId] : [])))];
    const people = userIds.length ? await db.select({ id: users.id, displayName: users.displayName, discordId: users.discordId, reminders: users.discordReminders })
      .from(users).where(inArray(users.id, userIds)) : [];
    const byUser = new Map(people.map(p => [p.id, p]));
    const mineChars = await db.select({ id: characters.id, name: characters.name, cls: characters.cls, spec1: characters.spec1, spec2: characters.spec2, level: characters.level,
      isMain: groupCharacters.isMain, groupId: groupCharacters.groupId })
      .from(characters).leftJoin(groupCharacters, eq(groupCharacters.characterId, characters.id))
      .where(and(eq(characters.userId, u.id), eq(characters.game, "forever"), or(isNull(groupCharacters.groupId), eq(groupCharacters.groupId, id))))
      .orderBy(asc(characters.sortOrder), asc(characters.createdAt));
    const levels = await db.select({ level: characters.level }).from(groupCharacters).innerJoin(characters, eq(characters.id, groupCharacters.characterId))
      .where(eq(groupCharacters.groupId, id));
    const counts = await openCounts(db, id, u.id);
    return {
      outings: rows.map(o => {
        const e = sign.get(o.id)!;
        const manage = canManage(o, u.id, role);
        const one = (s: (typeof e.placed)[number]) => {
          const p = s.userId ? byUser.get(s.userId) : null;
          return {
            id: s.id, role: s.role, name: signupName(s), cls: s.cls, spec: s.spec, guest: !s.userId, mine: s.userId === u.id, creator: !!s.userId && s.userId === o.createdBy,
            ...(manage && {
              player: p && p.displayName !== s.characterName ? p.displayName : null,
              dm: s.userId ? (p?.discordId ? (canDm(p) ? "yes" : "dm-off") : "no-discord") : "yes",
            }),
          };
        };
        return {
          id: o.id, dungeon: o.dungeon, title: o.title, minLevel: o.minLevel, maxLevel: o.maxLevel, zone: zoneOf(o.dungeon),
          day: o.day, at: o.scheduledAt, expiresAt: o.expiresAt, places: { tank: o.tanks, heal: o.heals, dps: o.dps }, note: o.note,
          creator: { userId: o.createdBy, name: o.creatorName, me: o.createdBy === u.id },
          signups: e.placed.map(one), waiting: e.waiting.map(one), canManage: manage,
        };
      }),
      canCreate: mayCreate(g.outingCreators, role), creators: g.outingCreators,
      open: { mine: counts.mine, max: MAX_OPEN_OUTINGS_PER_PLAYER },
      ...outingDays(),
      me: { characters: mineChars.filter(c => c.cls).map(({ groupId, isMain, ...c }) => ({ ...c, isMain: !!isMain, inGroup: groupId === id })) },
      levels: levels.map(l => l.level),
    };
  });

  app.post("/:id/outings", async (req, reply) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    const { role: myRole, g } = await forGroup(id, u.id);
    const body = parse(z.object({
      dungeon: z.string().trim().min(1).max(40), title: z.string().max(80).nullable().optional(), day, at, note: z.string().max(200).optional(),
      places: places.optional(), characterId: z.uuid(), role,
    }), req.body);
    const outingId = await createOuting(db, g, myRole, { id: u.id, displayName: u.displayName }, body);
    return reply.code(201).send({ outing: { id: outingId } });
  });

  /** S'inscrire, changer de rôle ou de perso, ou se mettre en attente (`wait`). */
  app.put("/:id/outings/:outingId/signup", async (req) => {
    const u = currentUser(req);
    const p = parse(oid, req.params);
    const { origin } = await forGroup(p.id, u.id);
    await loadOuting(db, p.outingId, p.id);
    const body = parse(z.object({ role, characterId: z.uuid(), spec: z.string().max(20).optional(), wait: z.boolean().optional() }), req.body);
    return { result: await joinOuting(db, p.outingId, { kind: "user", id: u.id, displayName: u.displayName }, body, origin) };
  });

  app.delete("/:id/outings/:outingId/signup", async (req) => {
    const u = currentUser(req);
    const p = parse(oid, req.params);
    const { origin } = await forGroup(p.id, u.id);
    await loadOuting(db, p.outingId, p.id);
    return { ok: await leaveOuting(db, p.outingId, { kind: "user", id: u.id, displayName: u.displayName }, origin) };
  });

  /** Créateur et officiers. */
  async function managed(groupId: string, outingId: string, userId: string) {
    const ctx = await forGroup(groupId, userId);
    const { outing } = await loadOuting(db, outingId, groupId);
    if (!canManage(outing, userId, ctx.role)) throw forbidden("Seuls le créateur de la sortie et les officiers peuvent la modifier.");
    return { ...ctx, outing };
  }

  app.delete("/:id/outings/:outingId/signups/:signupId", async (req) => {
    const u = currentUser(req);
    const p = parse(oid.extend({ signupId: z.uuid() }), req.params);
    const { outing, g, origin } = await managed(p.id, p.outingId, u.id);
    await removeSignup(db, outing, g, p.signupId, origin);
    return { ok: true };
  });

  /** Places (5 en tout) et note. */
  app.patch("/:id/outings/:outingId", async (req) => {
    const u = currentUser(req);
    const p = parse(oid, req.params);
    const { outing, g, origin } = await managed(p.id, p.outingId, u.id);
    const body = parse(z.object({ places: places.optional(), note: z.string().max(200).optional() }), req.body);
    await updateOuting(db, outing, g, body, origin, u.id);
    return { ok: true };
  });

  /** Changer l'heure (ou le jour) : les inscrits restent et sont prévenus. */
  app.put("/:id/outings/:outingId/time", async (req) => {
    const u = currentUser(req);
    const p = parse(oid, req.params);
    const { outing, g, origin } = await managed(p.id, p.outingId, u.id);
    const body = parse(z.object({ day, at }), req.body);
    await moveOuting(db, outing, g, body, origin, { kind: "user", id: u.id, displayName: u.displayName });
    return { ok: true };
  });

  /** Annuler : tout le monde est prévenu, le message Discord est effacé. */
  app.delete("/:id/outings/:outingId", async (req) => {
    const u = currentUser(req);
    const p = parse(oid, req.params);
    const { outing, g, origin } = await managed(p.id, p.outingId, u.id);
    await cancelOuting(db, outing, g, origin, { kind: "user", id: u.id, displayName: u.displayName });
    return { ok: true };
  });
}
