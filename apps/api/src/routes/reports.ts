import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { discordDeletions, reports } from "../db/schema";
import { badRequest, forbidden, notFound, parse } from "../lib/http";
import {
  normalizeScreenshot, REPORT_AREAS, REPORT_KINDS, REPORT_STATUSES, reportsChannel, reportView, SCREENSHOT_WINDOW_MS,
} from "../lib/reports";
import { currentUser, requireAuth } from "../lib/session";
import { siteOf } from "../lib/site";

/**
 * « Signaler un bug ou une idée » (les deux adresses) : joueurs connectés, suivi dans « Mes signalements » ;
 * page admin pour les comptes site_admin (statut, réponse). Le bot poste chaque signalement dans le salon des admins.
 */
const idParam = z.object({ id: z.uuid() });
const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export async function reportRoutes(app: FastifyInstance) {
  const { db, cfg } = app.ctx;
  app.addHook("preHandler", requireAuth);
  const admin = (req: FastifyRequest) => {
    const u = currentUser(req);
    if (!u.siteAdmin) throw forbidden("Réservé aux admins du site.");
    return u;
  };

  app.post("/", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const u = currentUser(req);
    const b = parse(z.object({
      kind: z.enum(REPORT_KINDS), area: z.enum(REPORT_AREAS),
      title: text(3, 120), body: text(5, 4000), page: z.string().trim().max(300).optional(),
    }), req.body);
    const [row] = await db.insert(reports).values({
      userId: u.id, author: u.displayName, game: siteOf(cfg, req).game, kind: b.kind, area: b.area, title: b.title, body: b.body,
      page: b.page ?? "", userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300), addonVersion: u.addonVersion,
    }).returning();
    return reply.code(201).send({ report: reportView(row!) });
  });

  // Capture jointe juste après l'envoi (une fois, 15 min) ; corps : l'image brute
  app.put("/:id/image", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async req => {
    const u = currentUser(req);
    const { id } = parse(idParam, req.params);
    if (!Buffer.isBuffer(req.body)) throw badRequest("Envoie une image PNG, JPEG ou WebP.");
    const [r] = await db.select({ id: reports.id, hasImage: sql<boolean>`${reports.image} IS NOT NULL`, createdAt: reports.createdAt })
      .from(reports).where(and(eq(reports.id, id), eq(reports.userId, u.id)));
    if (!r) throw notFound("Signalement introuvable.");
    if (r.hasImage || Date.now() - r.createdAt.getTime() > SCREENSHOT_WINDOW_MS) throw badRequest("La capture se joint juste après l'envoi du signalement.");
    const image = await normalizeScreenshot(req.body);
    await db.update(reports).set({ image, discordChangedAt: new Date(), updatedAt: new Date() }).where(eq(reports.id, id));
    return { ok: true };
  });

  app.get("/:id/image", async (req, reply) => {
    const u = currentUser(req);
    const { id } = parse(idParam, req.params);
    const [r] = await db.select({ userId: reports.userId, image: reports.image }).from(reports).where(eq(reports.id, id));
    if (!r?.image || (r.userId !== u.id && !u.siteAdmin)) throw notFound("Image introuvable.");
    return reply.type("image/webp").header("Content-Disposition", "inline").header("Cache-Control", "private, max-age=86400").send(r.image);
  });

  // Mes signalements (les deux adresses), les plus récents d'abord
  app.get("/mine", async req => {
    const u = currentUser(req);
    const rows = await db.select().from(reports).where(eq(reports.userId, u.id)).orderBy(desc(reports.createdAt)).limit(50);
    return { reports: rows.map(reportView) };
  });
  /** Réponses pas encore lues (pastille du menu du compte). */
  app.get("/unseen", async req => {
    const u = currentUser(req);
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(reports)
      .where(and(eq(reports.userId, u.id), isNotNull(reports.repliedAt), isNull(reports.replySeenAt)));
    return { n };
  });
  app.post("/mine/seen", async req => {
    const u = currentUser(req);
    await db.update(reports).set({ replySeenAt: new Date() })
      .where(and(eq(reports.userId, u.id), isNotNull(reports.repliedAt), isNull(reports.replySeenAt)));
    return { ok: true };
  });

  /* ----- Admins du site ----- */

  app.get("/admin", async req => {
    admin(req);
    const { status } = parse(z.object({ status: z.enum([...REPORT_STATUSES, "open", "all"]).default("open") }), req.query);
    const where = status === "all" ? undefined : status === "open" ? inArray(reports.status, ["new", "wip"]) : eq(reports.status, status);
    const rows = await db.select().from(reports).where(where).orderBy(desc(reports.createdAt)).limit(200);
    const counts = Object.fromEntries((await db.select({ s: reports.status, n: count() }).from(reports).groupBy(reports.status)).map(c => [c.s, c.n]));
    return { reports: rows.map(reportView), counts, channel: !!(await reportsChannel(db)) };
  });

  app.patch("/admin/:id", async req => {
    const u = admin(req);
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ status: z.enum(REPORT_STATUSES).optional(), reply: z.string().trim().max(2000).optional() }), req.body);
    if (b.status === undefined && b.reply === undefined) throw badRequest("Rien à changer.");
    const [row] = await db.update(reports).set({
      ...(b.status && { status: b.status }),
      // Nouvelle réponse : le joueur la voit avec une pastille jusqu'à ce qu'il ouvre « Mes signalements »
      ...(b.reply !== undefined && { reply: b.reply, repliedAt: b.reply ? new Date() : null, repliedBy: b.reply ? u.displayName : null, replySeenAt: null }),
      discordChangedAt: new Date(), updatedAt: new Date(),
    }).where(eq(reports.id, id)).returning();
    if (!row) throw notFound("Signalement introuvable.");
    return { report: reportView(row) };
  });

  app.delete("/admin/:id", async req => {
    admin(req);
    const { id } = parse(idParam, req.params);
    const [row] = await db.delete(reports).where(eq(reports.id, id)).returning({ channelId: reports.discordChannelId, messageId: reports.discordMessageId });
    if (!row) throw notFound("Signalement introuvable.");
    if (row.channelId && row.messageId) await db.insert(discordDeletions).values({ channelId: row.channelId, messageId: row.messageId });
    return { ok: true };
  });
}
