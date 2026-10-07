import { and, asc, count, desc, eq, gt, inArray, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client";
import { discordDeletions, feedbackMessages, feedbacks, feedbackSeen, feedbackSettings } from "../db/schema";
import { audit } from "../lib/audit";
import { bus } from "../lib/events";
import { FEEDBACK_KEEP_DAYS, FEEDBACK_MAX_REPLY, FEEDBACK_STATUSES, feedbackView, forgetFeedbacks } from "../lib/feedback";
import { requireRole } from "../lib/groups";
import { badRequest, notFound, parse } from "../lib/http";
import { currentUser, requireAuth } from "../lib/session";

/**
 * Avis Discord suivis par le groupe (Administration → Avis), pour le chef et les officiers seulement : statut,
 * conversation, réponse (envoyée en MP par le bot), suppression, et « Ne plus recevoir » (retire le lien avec le serveur).
 */

const gid = z.object({ id: z.uuid() });
const fid = gid.extend({ feedbackId: z.uuid() });

/** Dernière visite de l'officier dans les avis du groupe. */
export async function feedbackSeenAt(db: Db, userId: string, groupId: string) {
  const [s] = await db.select({ at: feedbackSeen.seenAt }).from(feedbackSeen).where(and(eq(feedbackSeen.userId, userId), eq(feedbackSeen.groupId, groupId)));
  return s?.at ?? null;
}

/** Pour l'onglet Administration : le groupe suit-il des avis, et combien ont du nouveau depuis la dernière visite. */
export async function feedbackSummary(db: Db, userId: string, groupId: string) {
  const [link] = await db.select({ guildName: feedbackSettings.guildName }).from(feedbackSettings).where(eq(feedbackSettings.groupId, groupId)).limit(1);
  const seenAt = await feedbackSeenAt(db, userId, groupId);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(feedbacks)
    .where(and(eq(feedbacks.groupId, groupId), isNotNull(feedbacks.text), seenAt ? gt(feedbacks.authorAt, seenAt) : undefined));
  return { linked: !!link, unseen: n };
}

export async function groupFeedbackRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  async function owned(groupId: string, feedbackId: string) {
    const [f] = await db.select().from(feedbacks).where(and(eq(feedbacks.id, feedbackId), eq(feedbacks.groupId, groupId), isNotNull(feedbacks.text)));
    if (!f) throw notFound("Avis introuvable.");
    return f;
  }
  const changed = (g: string) => bus.group({ t: "feedback", g });

  app.get("/:id/feedback", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "officer");
    const { status } = parse(z.object({ status: z.enum([...FEEDBACK_STATUSES, "open", "all"]).default("open") }), req.query);
    await forgetFeedbacks(db);
    const seenAt = await feedbackSeenAt(db, u.id, id);
    const mine = and(eq(feedbacks.groupId, id), isNotNull(feedbacks.text));
    const where = status === "all" ? mine : status === "open" ? and(mine, inArray(feedbacks.status, ["new", "wip"])) : and(mine, eq(feedbacks.status, status));
    const rows = await db.select().from(feedbacks).where(where).orderBy(desc(feedbacks.authorAt)).limit(100);
    const msgs = rows.length ? await db.select().from(feedbackMessages).where(inArray(feedbackMessages.feedbackId, rows.map(r => r.id))).orderBy(asc(feedbackMessages.createdAt)) : [];
    const counts = Object.fromEntries((await db.select({ s: feedbacks.status, n: count() }).from(feedbacks).where(mine).groupBy(feedbacks.status)).map(c => [c.s, c.n]));
    const links = await db.select({ guildName: feedbackSettings.guildName, allowAnonymous: feedbackSettings.allowAnonymous }).from(feedbackSettings).where(eq(feedbackSettings.groupId, id));
    return {
      feedbacks: rows.map(f => feedbackView(f, msgs.filter(m => m.feedbackId === f.id), seenAt)),
      counts, sources: links.map(l => ({ guildName: l.guildName || "serveur Discord", allowAnonymous: l.allowAnonymous })),
      seenAt, keepDays: FEEDBACK_KEEP_DAYS,
    };
  });

  /** L'officier a vu les avis : les pastilles disparaissent (les « Nouveau » restent affichés pendant la lecture). */
  app.post("/:id/feedback/seen", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "officer");
    const now = new Date();
    await db.insert(feedbackSeen).values({ userId: u.id, groupId: id, seenAt: now })
      .onConflictDoUpdate({ target: [feedbackSeen.userId, feedbackSeen.groupId], set: { seenAt: now } });
    return { ok: true };
  });

  app.patch("/:id/feedback/:feedbackId", async (req) => {
    const u = currentUser(req);
    const { id, feedbackId } = parse(fid, req.params);
    await requireRole(db, id, u.id, "officer");
    const { status } = parse(z.object({ status: z.enum(FEEDBACK_STATUSES) }), req.body);
    const f = await owned(id, feedbackId);
    if (f.status === status) return { ok: true };
    const closing = status === "done" || status === "refused";
    const now = new Date();
    await db.update(feedbacks).set({
      status, discordChangedAt: now, updatedAt: now,
      // Clos : l'auteur reste joignable 30 jours ; rouvert : à nouveau sans limite (s'il n'est pas déjà oublié)
      closedAt: closing ? (f.closedAt ?? now) : null,
    }).where(eq(feedbacks.id, feedbackId));
    changed(id);
    return { ok: true };
  });

  /** Réponse écrite sur le site : le bot l'envoie en MP à l'auteur et la note sous l'avis dans Discord. */
  app.post("/:id/feedback/:feedbackId/reply", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const u = currentUser(req);
    const { id, feedbackId } = parse(fid, req.params);
    await requireRole(db, id, u.id, "officer");
    const { text } = parse(z.object({ text: z.string().trim().min(2).max(FEEDBACK_MAX_REPLY) }), req.body);
    const f = await owned(id, feedbackId);
    if (!f.authorId) throw badRequest(`L'auteur de cet avis n'est plus joignable : l'avis est clos depuis plus de ${FEEDBACK_KEEP_DAYS} jours.`);
    const now = new Date();
    await db.insert(feedbackMessages).values({ feedbackId, from: "team", name: u.displayName, text, source: "site", delivered: null, createdAt: now });
    await db.update(feedbacks).set({ updatedAt: now, ...(f.status === "new" && { status: "wip" as const, discordChangedAt: now }) }).where(eq(feedbacks.id, feedbackId));
    changed(id);
    return reply.code(201).send({ ok: true });
  });

  /** Supprime l'avis du site et son message dans le salon de l'équipe (le bot l'efface). */
  app.delete("/:id/feedback/:feedbackId", async (req) => {
    const u = currentUser(req);
    const { id, feedbackId } = parse(fid, req.params);
    await requireRole(db, id, u.id, "officer");
    const f = await owned(id, feedbackId);
    await db.delete(feedbacks).where(eq(feedbacks.id, f.id));
    await db.insert(discordDeletions).values({ channelId: f.channelId, messageId: f.messageId });
    changed(id);
    return { ok: true };
  });

  /** « Ne plus recevoir » : les avis du ou des serveurs liés restent dans Discord, sans suivi sur le site. */
  app.delete("/:id/feedback-link", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "officer");
    const gone = await db.update(feedbackSettings).set({ groupId: null, updatedAt: new Date() }).where(eq(feedbackSettings.groupId, id))
      .returning({ guildName: feedbackSettings.guildName });
    for (const g of gone) await audit(db, req, "group_feedback_unlinked", { userId: u.id, groupId: id, meta: { name: g.guildName || "serveur Discord" } });
    changed(id);
    return { ok: true, removed: gone.length };
  });

}
