import { and, asc, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { absences } from "../db/schema";
import { applyUserAbsences, MAX_ABSENCES, removeAbsenceSignups } from "../lib/absences";
import { badRequest, notFound, parse } from "../lib/http";
import { currentUser, requireAuth } from "../lib/session";

/**
 * Mes absences déclarées (lot F) : une période (du … au …) ou des jours de la semaine. Les raids sans réponse de ces
 * jours passent en « Absent » dans tous mes groupes. Motif facultatif, visible des officiers ou de tout le groupe.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ");
const view = (a: typeof absences.$inferSelect) => ({
  id: a.id, startDate: a.startDate, endDate: a.endDate, weekdays: a.weekdays, reason: a.reason, reasonVisibility: a.reasonVisibility,
});
/** Absences encore utiles : jours de la semaine, ou période pas encore finie. */
const active = sql`(${absences.endDate} is null or ${absences.endDate} >= current_date - 1)`;

export async function absenceRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  app.get("/", async (req) => {
    const u = currentUser(req);
    const rows = await db.select().from(absences).where(and(eq(absences.userId, u.id), active)).orderBy(asc(absences.startDate), asc(absences.createdAt));
    return { absences: rows.map(view) };
  });

  app.post("/", async (req, reply) => {
    const u = currentUser(req);
    const body = parse(z.object({
      startDate: day.optional(), endDate: day.optional(),
      weekdays: z.array(z.int().min(1).max(7)).max(7).optional(),
      reason: z.string().trim().max(120).default(""),
      reasonVisibility: z.enum(["officers", "group"]).default("officers"),
    }), req.body);
    const weekdays = [...new Set(body.weekdays ?? [])].sort();
    const period = !!(body.startDate || body.endDate);
    if (period === weekdays.length > 0) throw badRequest("Choisis une période (du … au …) ou des jours de la semaine.");
    if (period) {
      if (!body.startDate || !body.endDate) throw badRequest("Indique le début et la fin de l'absence.");
      if (body.endDate < body.startDate) throw badRequest("La fin de l'absence est avant son début.");
      if (body.endDate < new Date().toISOString().slice(0, 10)) throw badRequest("Cette période est déjà passée.");
      if (Date.parse(body.endDate) - Date.parse(body.startDate) > 180 * 86400e3) throw badRequest("Six mois au plus par absence.");
    }
    const n = await db.$count(absences, and(eq(absences.userId, u.id), active));
    if (n >= MAX_ABSENCES) throw badRequest(`Limite de ${MAX_ABSENCES} absences.`);
    const [a] = await db.insert(absences).values({
      userId: u.id, startDate: period ? body.startDate! : null, endDate: period ? body.endDate! : null, weekdays,
      reason: body.reason, reasonVisibility: body.reasonVisibility,
    }).returning();
    const marked = await applyUserAbsences(db, u.id, a!);
    return reply.code(201).send({ absence: view(a!), raids: marked });
  });

  app.delete("/:id", async (req) => {
    const u = currentUser(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const [a] = await db.delete(absences).where(and(eq(absences.id, id), eq(absences.userId, u.id))).returning();
    if (!a) throw notFound("Absence introuvable.");
    return { ok: true, raids: await removeAbsenceSignups(db, u.id, a) };
  });
}

/** Absences à venir d'un joueur, pour sa fiche dans un groupe : le motif selon le choix du joueur. */
export async function sheetAbsences(db: FastifyInstance["ctx"]["db"], userId: string, viewer: { id: string; officer: boolean }) {
  const rows = await db.select().from(absences).where(and(eq(absences.userId, userId), or(isNull(absences.endDate), gte(absences.endDate, sql`current_date`))))
    .orderBy(asc(absences.startDate), asc(absences.createdAt));
  return rows.map(a => ({
    startDate: a.startDate, endDate: a.endDate, weekdays: a.weekdays,
    reason: viewer.id === userId || viewer.officer || a.reasonVisibility === "group" ? a.reason : "",
  }));
}
