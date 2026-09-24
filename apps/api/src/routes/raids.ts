import { computeCoverage, GROUP_SIZE, RAID_GROUPS } from "@forever/game-data";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { characters, groupMembers, raids, users, type RaidSlot } from "../db/schema";
import { audit } from "../lib/audit";
import { membership, requireRole } from "../lib/groups";
import { badRequest, notFound, parse } from "../lib/http";
import { currentUser, requireAuth } from "../lib/session";

const MAX_RAIDS_PER_GROUP = 100;
const raidParams = z.object({ id: z.uuid(), raidId: z.uuid() });
const raidFields = z.object({
  name: z.string().trim().min(2).max(60),
  scheduledAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
const slot = z.object({ group: z.int().min(1).max(RAID_GROUPS), pos: z.int().min(1).max(GROUP_SIZE), characterId: z.uuid() });

export async function raidRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  async function loadRaid(groupId: string, raidId: string) {
    const [r] = await db.select().from(raids).where(and(eq(raids.id, raidId), eq(raids.groupId, groupId)));
    if (!r) throw notFound("Raid introuvable.");
    return r;
  }

  async function slotCharacters(groupId: string, slots: RaidSlot[]) {
    const ids = slots.map(s => s.characterId);
    if (!ids.length) return [];
    return db.select({ id: characters.id, name: characters.name, cls: characters.cls, spec1: characters.spec1, level: characters.level, race: characters.race, owner: users.displayName })
      .from(characters)
      .innerJoin(groupMembers, and(eq(groupMembers.userId, characters.userId), eq(groupMembers.groupId, groupId)))
      .innerJoin(users, eq(users.id, characters.userId))
      .where(inArray(characters.id, ids));
  }

  function withCoverage(slots: RaidSlot[], chars: Awaited<ReturnType<typeof slotCharacters>>) {
    const byId = new Map(chars.map(c => [c.id, c]));
    // Un perso dont le joueur a quitté le groupe disparaît de la composition.
    const live = slots.filter(s => byId.has(s.characterId));
    const coverage = computeCoverage(live.map(s => ({ characterId: s.characterId, cls: byId.get(s.characterId)!.cls, spec: byId.get(s.characterId)!.spec1 || null, group: s.group })));
    return { slots: live, characters: chars, coverage: coverage.map(c => ({ id: c.effect.id, covered: c.covered, sources: c.sources, missingGroups: c.missingGroups })) };
  }

  app.get("/:id/raids", async (req) => {
    const u = currentUser(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await membership(db, id, u.id);
    const rows = await db.select({ id: raids.id, name: raids.name, scheduledAt: raids.scheduledAt, slots: raids.slots, updatedAt: raids.updatedAt })
      .from(raids).where(eq(raids.groupId, id)).orderBy(desc(raids.scheduledAt), asc(raids.name));
    return { raids: rows.map(r => ({ id: r.id, name: r.name, scheduledAt: r.scheduledAt, filled: r.slots.length, updatedAt: r.updatedAt })) };
  });

  app.post("/:id/raids", async (req, reply) => {
    const u = currentUser(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await requireRole(db, id, u.id, "officer");
    const body = parse(raidFields, req.body);
    const existing = await db.select({ id: raids.id }).from(raids).where(eq(raids.groupId, id));
    if (existing.length >= MAX_RAIDS_PER_GROUP) throw badRequest(`Limite de ${MAX_RAIDS_PER_GROUP} raids atteinte.`);
    const [r] = await db.insert(raids).values({
      groupId: id, name: body.name, scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null, createdBy: u.id,
    }).returning();
    await audit(db, req, "raid_created", { userId: u.id, groupId: id, meta: { raidId: r!.id, name: body.name } });
    return reply.code(201).send({ raid: { id: r!.id } });
  });

  app.get("/:id/raids/:raidId", async (req) => {
    const u = currentUser(req);
    const p = parse(raidParams, req.params);
    const role = await membership(db, p.id, u.id);
    const r = await loadRaid(p.id, p.raidId);
    const chars = await slotCharacters(p.id, r.slots);
    return { raid: { id: r.id, name: r.name, scheduledAt: r.scheduledAt, updatedAt: r.updatedAt }, canEdit: role !== "member", ...withCoverage(r.slots, chars) };
  });

  app.put("/:id/raids/:raidId", async (req) => {
    const u = currentUser(req);
    const p = parse(raidParams, req.params);
    await requireRole(db, p.id, u.id, "officer");
    await loadRaid(p.id, p.raidId);
    const body = parse(raidFields.extend({ slots: z.array(slot).max(RAID_GROUPS * GROUP_SIZE) }), req.body);

    const seatKeys = new Set(body.slots.map(s => `${s.group}:${s.pos}`));
    const charIds = new Set(body.slots.map(s => s.characterId));
    if (seatKeys.size !== body.slots.length) throw badRequest("Deux personnages occupent la même place.");
    if (charIds.size !== body.slots.length) throw badRequest("Un personnage ne peut occuper qu'une place.");
    const chars = await slotCharacters(p.id, body.slots);
    if (chars.length !== charIds.size) throw badRequest("Certains personnages n'appartiennent pas à un membre du groupe.");

    await db.update(raids).set({
      name: body.name, scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null, slots: body.slots, updatedAt: new Date(),
    }).where(eq(raids.id, p.raidId));
    return withCoverage(body.slots, chars);
  });

  app.delete("/:id/raids/:raidId", async (req) => {
    const u = currentUser(req);
    const p = parse(raidParams, req.params);
    await requireRole(db, p.id, u.id, "officer");
    const r = await loadRaid(p.id, p.raidId);
    await db.delete(raids).where(eq(raids.id, r.id));
    await audit(db, req, "raid_deleted", { userId: u.id, groupId: p.id, meta: { raidId: r.id, name: r.name } });
    return { ok: true };
  });
}
