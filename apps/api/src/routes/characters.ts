import { and, asc, eq, inArray, max, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { characters, groupMembers, users } from "../db/schema";
import { characterFields, crossCheck } from "../lib/character-schema";
import { badRequest, notFound, parse } from "../lib/http";
import { currentUser, requireAuth } from "../lib/session";

const MAX_CHARACTERS = 50;
const idParam = z.object({ id: z.uuid() });

export type CharacterRow = typeof characters.$inferSelect;
export const toApi = (c: CharacterRow) => ({
  id: c.id, userId: c.userId, name: c.name, race: c.race, cls: c.cls, spec1: c.spec1, spec2: c.spec2, level: c.level,
  talents: c.talents, talentLink: c.talentLink, professions: c.professions, gear: c.gear, legacy: c.legacy, notes: c.notes,
  sortOrder: c.sortOrder, updatedAt: c.updatedAt,
});

/** Un perso est visible par son propriétaire et par les membres des groupes qu'ils partagent. */
async function canSee(app: FastifyInstance, viewerId: string, ownerId: string) {
  if (viewerId === ownerId) return true;
  const gm1 = app.ctx.db.select({ g: groupMembers.groupId }).from(groupMembers).where(eq(groupMembers.userId, viewerId));
  const rows = await app.ctx.db.select({ g: groupMembers.groupId }).from(groupMembers)
    .where(and(eq(groupMembers.userId, ownerId), inArray(groupMembers.groupId, gm1))).limit(1);
  return rows.length > 0;
}

export async function characterRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  app.get("/", async (req) => {
    const u = currentUser(req);
    const rows = await db.select().from(characters).where(eq(characters.userId, u.id)).orderBy(asc(characters.sortOrder), asc(characters.createdAt));
    return { characters: rows.map(toApi) };
  });

  app.post("/", async (req, reply) => {
    const u = currentUser(req);
    const body = parse(characterFields.partial().extend({ name: characterFields.shape.name }), req.body);
    const merged = { race: "", cls: "", spec1: "", spec2: "", talents: "", ...body };
    const err = crossCheck(merged); if (err) throw badRequest(err);
    const [{ n, top }] = await db.select({ n: sql<number>`count(*)::int`, top: max(characters.sortOrder) }).from(characters).where(eq(characters.userId, u.id)) as [{ n: number; top: number | null }];
    if (n >= MAX_CHARACTERS) throw badRequest(`Limite de ${MAX_CHARACTERS} personnages atteinte.`);
    const [row] = await db.insert(characters).values({ ...body, userId: u.id, sortOrder: (top ?? -1) + 1 }).returning();
    return reply.code(201).send({ character: toApi(row!) });
  });

  app.put("/order", async (req) => {
    const u = currentUser(req);
    const { ids } = parse(z.object({ ids: z.array(z.uuid()).max(MAX_CHARACTERS) }), req.body);
    const own = await db.select({ id: characters.id }).from(characters).where(eq(characters.userId, u.id));
    const ownIds = new Set(own.map(r => r.id));
    if (ids.length !== ownIds.size || !ids.every(id => ownIds.has(id))) throw badRequest("La liste doit contenir exactement tes personnages.");
    await db.transaction(async tx => {
      for (const [i, id] of ids.entries()) await tx.update(characters).set({ sortOrder: i }).where(and(eq(characters.id, id), eq(characters.userId, u.id)));
    });
    return { ok: true };
  });

  app.get("/:id", async (req) => {
    const u = currentUser(req);
    const { id } = parse(idParam, req.params);
    const [row] = await db.select({ c: characters, owner: users.displayName }).from(characters)
      .innerJoin(users, eq(users.id, characters.userId)).where(eq(characters.id, id));
    // 404 aussi quand le perso existe mais n'est pas visible : on ne confirme pas son existence.
    if (!row || !(await canSee(app, u.id, row.c.userId))) throw notFound("Personnage introuvable.");
    return { character: toApi(row.c), owner: row.owner, editable: row.c.userId === u.id };
  });

  app.patch("/:id", async (req) => {
    const u = currentUser(req);
    const { id } = parse(idParam, req.params);
    const patch = parse(characterFields.partial(), req.body);
    const [existing] = await db.select().from(characters).where(and(eq(characters.id, id), eq(characters.userId, u.id)));
    if (!existing) throw notFound("Personnage introuvable.");
    const next = { ...existing, ...patch };
    const err = crossCheck(next); if (err) throw badRequest(err);
    const [row] = await db.update(characters).set({ ...patch, updatedAt: new Date() }).where(eq(characters.id, id)).returning();
    return { character: toApi(row!) };
  });

  app.delete("/:id", async (req) => {
    const u = currentUser(req);
    const { id } = parse(idParam, req.params);
    const [row] = await db.delete(characters).where(and(eq(characters.id, id), eq(characters.userId, u.id))).returning({ id: characters.id });
    if (!row) throw notFound("Personnage introuvable.");
    return { ok: true };
  });
}
