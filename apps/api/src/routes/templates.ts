import { and, asc, count, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LOOT_MODES } from "@forever/game-data";
import { raidTemplates } from "../db/schema";
import { audit } from "../lib/audit";
import { membership, requireRole } from "../lib/groups";
import { badRequest, notFound, parse } from "../lib/http";
import { ensureRecurringRaids, MAX_TEMPLATES_PER_GROUP } from "../lib/recurring";
import { currentUser, requireAuth } from "../lib/session";
import { bus } from "../lib/events";

/** Raids récurrents d'un groupe : lecture pour les membres, gestion par les officiers. */
const fields = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(1000).default(""),
  weekday: z.int().min(1).max(7),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure au format HH:MM"),
  leadDays: z.int().min(1).max(28).default(7),
  lootMode: z.enum(LOOT_MODES).default("journal"),
  srHidden: z.boolean().default(false),
  active: z.boolean().default(true),
});
const gid = z.object({ id: z.uuid() });
const tid = gid.extend({ templateId: z.uuid() });
const view = (t: typeof raidTemplates.$inferSelect) => ({
  id: t.id, name: t.name, description: t.description, weekday: t.weekday, time: t.time, leadDays: t.leadDays, active: t.active, generatedUntil: t.generatedUntil,
  lootMode: t.lootMode, srHidden: t.srHidden,
});

export async function templateRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  app.get("/:id/raid-templates", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await membership(db, id, u.id);
    const rows = await db.select().from(raidTemplates).where(eq(raidTemplates.groupId, id)).orderBy(asc(raidTemplates.weekday), asc(raidTemplates.time));
    return { templates: rows.map(view) };
  });

  app.post("/:id/raid-templates", async (req, reply) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "officer");
    const body = parse(fields, req.body);
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(raidTemplates).where(eq(raidTemplates.groupId, id));
    if (n >= MAX_TEMPLATES_PER_GROUP) throw badRequest(`Limite de ${MAX_TEMPLATES_PER_GROUP} raids récurrents atteinte.`);
    const [t] = await db.insert(raidTemplates).values({ ...body, groupId: id, createdBy: u.id }).returning();
    const created = await ensureRecurringRaids(db, new Date(), t!.id);
    await audit(db, req, "raid_template_created", { userId: u.id, groupId: id, meta: { templateId: t!.id, name: t!.name, weekday: t!.weekday, time: t!.time } });
    bus.group({ t: "raids", g: id });
    return reply.code(201).send({ template: view(t!), created });
  });

  app.patch("/:id/raid-templates/:templateId", async (req) => {
    const u = currentUser(req);
    const p = parse(tid, req.params);
    await requireRole(db, p.id, u.id, "officer");
    const body = parse(fields.partial(), req.body);
    const [t] = await db.update(raidTemplates).set({ ...body, updatedAt: new Date() })
      .where(and(eq(raidTemplates.id, p.templateId), eq(raidTemplates.groupId, p.id))).returning();
    if (!t) throw notFound("Raid récurrent introuvable.");
    const created = await ensureRecurringRaids(db, new Date(), t.id);
    await audit(db, req, "raid_template_updated", { userId: u.id, groupId: p.id, meta: { templateId: t.id, name: t.name } });
    bus.group({ t: "raids", g: p.id });
    return { template: view(t), created };
  });

  /** Supprime le modèle ; les raids déjà créés restent (ils ont peut-être des inscrits). */
  app.delete("/:id/raid-templates/:templateId", async (req) => {
    const u = currentUser(req);
    const p = parse(tid, req.params);
    await requireRole(db, p.id, u.id, "officer");
    const [t] = await db.delete(raidTemplates).where(and(eq(raidTemplates.id, p.templateId), eq(raidTemplates.groupId, p.id))).returning();
    if (!t) throw notFound("Raid récurrent introuvable.");
    await audit(db, req, "raid_template_deleted", { userId: u.id, groupId: p.id, meta: { templateId: t.id, name: t.name } });
    bus.group({ t: "raids", g: p.id });
    return { ok: true };
  });
}
