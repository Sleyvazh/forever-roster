import { isValidSpecFor } from "@forever/game-data";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { characters, groupCharacters, groupMembers, groups, raidAsks, raids, raidSignups, users } from "../db/schema";
import { audit } from "../lib/audit";
import { bus } from "../lib/events";
import { membership, requireRole } from "../lib/groups";
import { badRequest, HttpError, notFound, parse } from "../lib/http";
import {
  canDm, groupNudgeSettings, MANUAL_NUDGE_MS, MAX_ASKS_PER_RAID, NUDGE_HOURS, pendingMembers, raidAskList,
} from "../lib/reach";
import { currentUser, requireAuth } from "../lib/session";

/** Lot D2 : relance des sans-réponse (réglage du groupe, relance à la main) et « Demander à X ». Officiers seulement. */

const gid = z.object({ id: z.uuid() });
const rid = gid.extend({ raidId: z.uuid() });
const settingsInput = z.object({
  hours: z.union([z.literal(24), z.literal(48), z.literal(72), z.null()]).optional(),
  officers: z.boolean().optional(),
});

export async function reachRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  app.get("/:id/nudge-settings", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await membership(db, id, u.id);
    return { settings: await groupNudgeSettings(db, id), choices: NUDGE_HOURS };
  });

  app.put("/:id/nudge-settings", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "officer");
    const body = parse(settingsInput, req.body);
    await db.update(groups).set({
      ...(body.hours !== undefined && { nudgeHours: body.hours }),
      ...(body.officers !== undefined && { nudgeOfficers: body.officers }),
    }).where(eq(groups.id, id));
    await audit(db, req, "group_nudge_settings", { userId: u.id, groupId: id, meta: { ...body } });
    bus.group({ t: "group", g: id });
    return { settings: await groupNudgeSettings(db, id) };
  });

  async function loadRaid(groupId: string, raidId: string) {
    const [r] = await db.select({ raid: raids, discordLinked: groups.discordChannelId }).from(raids)
      .innerJoin(groups, eq(groups.id, raids.groupId)).where(and(eq(raids.id, raidId), eq(raids.groupId, groupId)));
    if (!r) throw notFound("Raid introuvable.");
    return { ...r.raid, discordLinked: !!r.discordLinked };
  }
  const upcoming = (r: { scheduledAt: Date | null }) => !!r.scheduledAt && r.scheduledAt.getTime() > Date.now();

  /** Qui n'a pas répondu, qui le bot peut joindre, où en sont les relances et les demandes. */
  app.get("/:id/raids/:raidId/reach", async (req) => {
    const u = currentUser(req);
    const p = parse(rid, req.params);
    await requireRole(db, p.id, u.id, "officer");
    const r = await loadRaid(p.id, p.raidId);
    const settings = await groupNudgeSettings(db, p.id);
    const pending = await pendingMembers(db, p.id, r.id);
    // Membres joignables par MP (pour les boutons « Demander »)
    const members = await db.select({ userId: users.id, discordId: users.discordId, reminders: users.discordReminders })
      .from(groupMembers).innerJoin(users, eq(users.id, groupMembers.userId)).where(eq(groupMembers.groupId, p.id));
    const autoAt = settings.hours && r.scheduledAt ? new Date(r.scheduledAt.getTime() - settings.hours * 3600e3) : null;
    const nextManual = r.nudgeManualAt ? new Date(r.nudgeManualAt.getTime() + MANUAL_NUDGE_MS) : null;
    return {
      discordLinked: r.discordLinked, upcoming: upcoming(r), settings,
      auto: { at: autoAt, sentAt: r.nudgeAutoAt },
      manual: { lastAt: r.nudgeManualAt, nextAt: nextManual && nextManual.getTime() > Date.now() ? nextManual : null, queued: !!r.nudgeRequestedAt },
      pending: pending.map(m => ({
        userId: m.userId, displayName: m.displayName, main: m.main && { name: m.main.name, cls: m.main.cls, spec: m.main.spec1 },
        dm: canDm(m), why: !m.discordId ? "no-discord" as const : !m.reminders ? "dm-off" as const : null,
      })),
      dmUsers: members.filter(canDm).map(m => m.userId),
      asks: await raidAskList(db, r.id),
    };
  });

  /** « Relancer maintenant » : le bot écrit aux sans-réponse joignables. Une fois par heure au plus. */
  app.post("/:id/raids/:raidId/nudge", async (req) => {
    const u = currentUser(req);
    const p = parse(rid, req.params);
    await requireRole(db, p.id, u.id, "officer");
    const r = await loadRaid(p.id, p.raidId);
    if (!r.discordLinked) throw badRequest("Lie d'abord un salon Discord au groupe (Administration) : c'est le bot qui envoie les relances.");
    if (!upcoming(r)) throw badRequest("Ce raid est déjà passé.");
    const now = Date.now();
    if (r.nudgeManualAt && now - r.nudgeManualAt.getTime() < MANUAL_NUDGE_MS) {
      const mins = Math.ceil((r.nudgeManualAt.getTime() + MANUAL_NUDGE_MS - now) / 60e3);
      throw new HttpError(429, `Relance déjà faite : prochaine possible dans ${mins} min.`);
    }
    const reachable = (await pendingMembers(db, p.id, r.id)).filter(canDm);
    if (!reachable.length) throw badRequest("Personne à relancer : tous les membres joignables ont déjà répondu.");
    await db.update(raids).set({ nudgeRequestedAt: new Date(now), nudgeManualAt: new Date(now) }).where(eq(raids.id, r.id));
    await audit(db, req, "raid_nudged", { userId: u.id, groupId: p.id, meta: { raidId: r.id, name: r.name, count: reachable.length } });
    bus.group({ t: "raid", g: p.id, r: r.id });
    return { count: reachable.length, nextAt: new Date(now + MANUAL_NUDGE_MS) };
  });

  /** « Demander à X » : le bot demande en MP au propriétaire du perso s'il peut venir avec, dans cette spé. */
  app.post("/:id/raids/:raidId/asks", async (req, reply) => {
    const u = currentUser(req);
    const p = parse(rid, req.params);
    await requireRole(db, p.id, u.id, "officer");
    const body = parse(z.object({ characterId: z.uuid(), spec: z.string().trim().min(1).max(20) }), req.body);
    const r = await loadRaid(p.id, p.raidId);
    if (!r.discordLinked) throw badRequest("Lie d'abord un salon Discord au groupe (Administration) : c'est le bot qui envoie la demande.");
    if (!upcoming(r)) throw badRequest("Ce raid est déjà passé.");
    const [c] = await db.select({ id: characters.id, name: characters.name, cls: characters.cls, game: characters.game, userId: characters.userId, discordId: users.discordId, reminders: users.discordReminders })
      .from(groupCharacters)
      .innerJoin(characters, eq(characters.id, groupCharacters.characterId))
      .innerJoin(users, eq(users.id, characters.userId))
      .innerJoin(groupMembers, and(eq(groupMembers.groupId, groupCharacters.groupId), eq(groupMembers.userId, characters.userId)))
      .where(and(eq(groupCharacters.groupId, p.id), eq(groupCharacters.characterId, body.characterId)));
    if (!c) throw notFound("Ce perso n'est pas joué dans le groupe.");
    if (!isValidSpecFor(c.game, c.cls, body.spec)) throw badRequest(`La spé « ${body.spec} » n'existe pas pour ${c.cls}.`);
    if (!canDm(c)) throw badRequest(c.discordId ? "Ce joueur a désactivé les messages du bot." : "Ce joueur n'a pas lié son Discord : préviens-le autrement.");
    const [signed] = await db.select({ characterId: raidSignups.characterId, status: raidSignups.status }).from(raidSignups)
      .where(and(eq(raidSignups.raidId, r.id), eq(raidSignups.userId, c.userId)));
    if (signed?.characterId === c.id && (signed.status === "present" || signed.status === "late")) throw badRequest(`${c.name} est déjà inscrit à ce raid.`);
    if (await db.$count(raidAsks, eq(raidAsks.raidId, r.id)) >= MAX_ASKS_PER_RAID) throw badRequest(`Limite de ${MAX_ASKS_PER_RAID} demandes pour ce raid.`);
    const [row] = await db.insert(raidAsks).values({ raidId: r.id, characterId: c.id, userId: c.userId, spec: body.spec, askedBy: u.id, askedByName: u.displayName })
      .onConflictDoNothing().returning({ id: raidAsks.id });
    if (!row) throw new HttpError(409, `${c.name} a déjà reçu une demande pour ce raid.`);
    await audit(db, req, "raid_ask_sent", { userId: u.id, groupId: p.id, meta: { raidId: r.id, characterId: c.id, name: c.name, spec: body.spec } });
    bus.group({ t: "raid", g: p.id, r: r.id });
    return reply.code(201).send({ ask: { id: row.id } });
  });

  /** Annuler une demande (le joueur ne pourra plus y répondre ; on peut en refaire une). */
  app.delete("/:id/raids/:raidId/asks/:askId", async (req) => {
    const u = currentUser(req);
    const p = parse(rid.extend({ askId: z.uuid() }), req.params);
    await requireRole(db, p.id, u.id, "officer");
    await loadRaid(p.id, p.raidId);
    const [row] = await db.delete(raidAsks).where(and(eq(raidAsks.id, p.askId), eq(raidAsks.raidId, p.raidId))).returning({ id: raidAsks.id });
    if (!row) throw notFound("Demande introuvable.");
    bus.group({ t: "raid", g: p.id, r: p.raidId });
    return { ok: true };
  });
}
