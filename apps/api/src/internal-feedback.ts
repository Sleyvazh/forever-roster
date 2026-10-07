import { and, asc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "./config";
import type { Db } from "./db/client";
import { feedbackMessages, feedbacks, feedbackSettings, groups, users } from "./db/schema";
import { audit } from "./lib/audit";
import { bus } from "./lib/events";
import { FEEDBACK_KEEP_DAYS, feedbackUrl, forgetFeedbacks } from "./lib/feedback";
import { badRequest, notFound, parse } from "./lib/http";
import { siteForGame } from "./lib/site";
import { likeContains } from "./routes/gamedata";

/**
 * Avis (feedback) envoyés par le bot Discord. Fonction autonome : un serveur Discord l'utilise sans groupe ni compte
 * sur le site, avec n'importe quel jeu ; seuls les réglages du serveur et le lien auteur ↔ avis (30 jours, pour la
 * réponse) sont alors gardés, le texte reste dans Discord.
 * Suivi par un groupe (option du réglage) : texte, statut et conversation sont aussi gardés pour le chef et les
 * officiers (Administration → Avis) ; les réponses écrites sur le site partent en MP par le bot (relève).
 */

const snowflake = z.string().regex(/^\d{5,25}$/);
const guildParam = z.object({ guildId: snowflake });
const idParam = z.object({ id: z.uuid() });
const GAMES = ["forever", "retail"] as const;

export { FEEDBACK_KEEP_DAYS };

export function feedbackRoutes(app: FastifyInstance, db: Db, cfg: Config) {
  const forget = () => forgetFeedbacks(db);

  /** Groupe qui suit les avis du serveur : nom, site et adresse de la section Avis. */
  async function trackOf(groupId: string | null) {
    if (!groupId) return null;
    const [g] = await db.select({ id: groups.id, name: groups.name, game: groups.game }).from(groups).where(eq(groups.id, groupId));
    if (!g) return null;
    const site = siteForGame(cfg, g.game);
    return { groupId: g.id, groupName: g.name, game: g.game, site: site.name, url: feedbackUrl(site.origin, g.id) };
  }
  /** Groupe lié à ce serveur Discord (salon des raids ou des commandes) : seuls ceux-là peuvent suivre ses avis. */
  const linkedTo = (guildId: string) => or(eq(groups.discordGuildId, guildId), eq(groups.ordersGuildId, guildId));

  app.get("/internal/feedback/config/:guildId", async (req: FastifyRequest) => {
    const { guildId } = parse(guildParam, req.params);
    const [s] = await db.select().from(feedbackSettings).where(eq(feedbackSettings.guildId, guildId));
    return { config: s ? { ...s, track: await trackOf(s.groupId) } : null };
  });

  /** Autocomplétion de l'option « groupe » : les groupes liés à ce serveur (25 au plus, filtrés par le nom). */
  app.get("/internal/feedback/groups/:guildId", async (req: FastifyRequest) => {
    const { guildId } = parse(guildParam, req.params);
    const q = parse(z.object({ game: z.enum(GAMES).optional(), q: z.string().trim().max(60).default("") }), req.query);
    const rows = await db.select({ id: groups.id, name: groups.name, game: groups.game, raidsChannelId: groups.discordChannelId, ordersChannelId: groups.ordersChannelId,
      guild: groups.discordGuildId, ordersGuild: groups.ordersGuildId })
      .from(groups).where(and(linkedTo(guildId), q.game ? eq(groups.game, q.game) : undefined, q.q ? ilike(groups.name, likeContains(q.q)) : undefined))
      .orderBy(asc(groups.name)).limit(25);
    return {
      groups: rows.map(g => ({
        id: g.id, name: g.name, site: siteForGame(cfg, g.game).name,
        raidsChannelId: g.guild === guildId ? g.raidsChannelId : null, ordersChannelId: g.ordersGuild === guildId ? g.ordersChannelId : null,
      })),
    };
  });

  /**
   * Enregistre les réglages ; renvoie aussi les précédents (le bot retire l'ancien message du bouton).
   * groupId : absent = garde le groupe actuel, null = plus de suivi sur le site, sinon un groupe lié à ce serveur.
   */
  app.put("/internal/feedback/config/:guildId", async (req: FastifyRequest) => {
    const { guildId } = parse(guildParam, req.params);
    const body = parse(z.object({
      inboxChannelId: snowflake, panelChannelId: snowflake.nullable(), panelMessageId: snowflake.nullable(),
      allowAnonymous: z.boolean(), updatedBy: snowflake, updatedByName: z.string().trim().max(64).optional(),
      guildName: z.string().trim().max(100).optional(), groupId: z.uuid().nullable().optional(),
    }), req.body);
    const [previous] = await db.select().from(feedbackSettings).where(eq(feedbackSettings.guildId, guildId));
    const groupId = body.groupId === undefined ? previous?.groupId ?? null : body.groupId;
    if (groupId && groupId !== previous?.groupId) {
      const [g] = await db.select({ id: groups.id }).from(groups).where(and(eq(groups.id, groupId), linkedTo(guildId)));
      if (!g) throw badRequest("Ce groupe n'est pas lié à ce serveur Discord : un officier le lie d'abord avec /forever-lier ou /roster-lier (salon des raids ou des commandes).");
    }
    const values = {
      inboxChannelId: body.inboxChannelId, panelChannelId: body.panelChannelId, panelMessageId: body.panelMessageId,
      allowAnonymous: body.allowAnonymous, updatedBy: body.updatedBy, groupId,
      guildName: body.guildName ?? previous?.guildName ?? "", updatedAt: new Date(),
    };
    const [config] = await db.insert(feedbackSettings).values({ guildId, ...values })
      .onConflictDoUpdate({ target: feedbackSettings.guildId, set: values }).returning();
    if (previous?.groupId !== groupId) await linkChanged(req, previous?.groupId ?? null, groupId, values.guildName, body.updatedBy, body.updatedByName);
    return { config: { ...config!, track: await trackOf(groupId) }, previous: previous ?? null };
  });

  app.delete("/internal/feedback/config/:guildId", async (req: FastifyRequest) => {
    const { guildId } = parse(guildParam, req.params);
    const body = parse(z.object({ by: snowflake.optional(), byName: z.string().trim().max(64).optional() }).default({}), req.body ?? {});
    const [previous] = await db.delete(feedbackSettings).where(eq(feedbackSettings.guildId, guildId)).returning();
    if (previous?.groupId) await linkChanged(req, previous.groupId, null, previous.guildName, body.by ?? previous.updatedBy, body.byName);
    return { previous: previous ?? null };
  });

  /** Journal des groupes concernés : avis d'un serveur Discord reliés ou retirés (par un admin du serveur). */
  async function linkChanged(req: FastifyRequest, from: string | null, to: string | null, guildName: string, discordId: string, name?: string) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.discordId, discordId));
    const meta = { name: guildName || "serveur Discord", ...(u ? {} : { by: name ?? "un admin du serveur" }) };
    if (from) { await audit(db, req, "group_feedback_unlinked", { userId: u?.id ?? null, groupId: from, meta }); bus.group({ t: "feedback", g: from }); }
    if (to) { await audit(db, req, "group_feedback_linked", { userId: u?.id ?? null, groupId: to, meta }); bus.group({ t: "feedback", g: to }); }
  }

  /** Avis publié par le bot dans le salon de l'équipe ; gardé avec son texte si un groupe suit les avis du serveur. */
  app.post("/internal/feedback", async (req: FastifyRequest) => {
    const body = parse(z.object({
      id: z.uuid(), guildId: snowflake, channelId: snowflake, messageId: snowflake, anonymous: z.boolean(), authorId: snowflake,
      text: z.string().trim().min(1).max(2000).optional(), authorName: z.string().trim().max(100).nullable().optional(),
    }), req.body);
    await forget();
    const [s] = await db.select({ groupId: feedbackSettings.groupId }).from(feedbackSettings).where(eq(feedbackSettings.guildId, body.guildId));
    const tracked = !!(s?.groupId && body.text);
    const now = new Date();
    await db.insert(feedbacks).values({
      id: body.id, guildId: body.guildId, channelId: body.channelId, messageId: body.messageId, anonymous: body.anonymous, authorId: body.authorId,
      ...(tracked && { groupId: s!.groupId, text: body.text!, authorName: body.anonymous ? null : body.authorName ?? null }),
      // Le message vient d'être publié avec le statut « Nouveau » : rien à reporter
      authorAt: now, discordChangedAt: now, discordSyncedAt: now, createdAt: now, updatedAt: now,
    }).onConflictDoNothing();
    if (tracked) bus.group({ t: "feedback", g: s!.groupId! });
    return { ok: true, tracked };
  });

  /** Destinataire d'une réponse à un avis (connu du bot seul, jamais affiché). */
  app.get("/internal/feedback/:id", async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    await forget();
    const [f] = await db.select().from(feedbacks).where(eq(feedbacks.id, id));
    if (!f) throw notFound(`Cet avis a plus de ${FEEDBACK_KEEP_DAYS} jours, ou il a été supprimé : il n'est plus possible d'y répondre.`);
    if (!f.authorId) throw notFound(`L'auteur de cet avis n'est plus joignable : l'avis est clos depuis plus de ${FEEDBACK_KEEP_DAYS} jours.`);
    return { feedback: { id: f.id, guildId: f.guildId, channelId: f.channelId, messageId: f.messageId, anonymous: f.anonymous, authorId: f.authorId, tracked: !!f.groupId && f.text !== null } };
  });

  /** Réponse écrite dans Discord (équipe ou auteur) : ajoutée au fil d'un avis suivi. */
  app.post("/internal/feedback/:id/messages", async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({
      from: z.enum(["team", "author"]), name: z.string().trim().max(100).nullable(), text: z.string().trim().min(1).max(2000), delivered: z.boolean().optional(),
    }), req.body);
    const [f] = await db.select({ groupId: feedbacks.groupId, text: feedbacks.text, anonymous: feedbacks.anonymous, status: feedbacks.status }).from(feedbacks).where(eq(feedbacks.id, id));
    if (!f?.groupId || f.text === null) return { ok: true, tracked: false };
    const now = new Date();
    await db.insert(feedbackMessages).values({
      feedbackId: id, from: body.from, name: body.from === "author" && f.anonymous ? null : body.name, text: body.text, source: "discord",
      delivered: body.from === "team" ? body.delivered ?? true : null, createdAt: now,
    });
    await db.update(feedbacks).set({
      updatedAt: now,
      ...(body.from === "author" && { authorAt: now }),
      // Première réponse de l'équipe : « Nouveau » → « En cours »
      ...(body.from === "team" && f.status === "new" && { status: "wip" as const, discordChangedAt: now }),
    }).where(eq(feedbacks.id, id));
    bus.group({ t: "feedback", g: f.groupId });
    return { ok: true, tracked: true };
  });

  /**
   * Relève du bot : réponses écrites sur le site à envoyer en MP (avec leur trace sous l'avis), et statuts à reporter
   * sur le message de l'avis dans le salon de l'équipe.
   */
  app.get("/internal/feedback/outbox", async () => {
    await forget();
    // Auteur oublié entre-temps : la réponse ne peut plus partir
    await db.update(feedbackMessages).set({ delivered: false })
      .where(and(eq(feedbackMessages.source, "site"), isNull(feedbackMessages.delivered),
        sql`${feedbackMessages.feedbackId} IN (SELECT ${feedbacks.id} FROM ${feedbacks} WHERE ${feedbacks.authorId} IS NULL)`));
    const replies = await db.select({
      id: feedbackMessages.id, feedbackId: feedbacks.id, responder: feedbackMessages.name, text: feedbackMessages.text,
      authorId: feedbacks.authorId, guildId: feedbacks.guildId, channelId: feedbacks.channelId, messageId: feedbacks.messageId, original: feedbacks.text,
      guildName: feedbackSettings.guildName,
    }).from(feedbackMessages).innerJoin(feedbacks, eq(feedbacks.id, feedbackMessages.feedbackId))
      .leftJoin(feedbackSettings, eq(feedbackSettings.guildId, feedbacks.guildId))
      .where(and(eq(feedbackMessages.source, "site"), isNull(feedbackMessages.delivered), isNotNull(feedbacks.authorId)))
      .orderBy(asc(feedbackMessages.createdAt)).limit(20);
    const statuses = await db.select({
      id: feedbacks.id, channelId: feedbacks.channelId, messageId: feedbacks.messageId, status: feedbacks.status, changedAt: feedbacks.discordChangedAt,
      groupId: groups.id, groupName: groups.name, game: groups.game,
    }).from(feedbacks).innerJoin(groups, eq(groups.id, feedbacks.groupId))
      .where(and(isNotNull(feedbacks.text), or(isNull(feedbacks.discordSyncedAt), sql`${feedbacks.discordSyncedAt} < date_trunc('milliseconds', ${feedbacks.discordChangedAt})`)))
      .orderBy(asc(feedbacks.discordChangedAt)).limit(20);
    return {
      replies: replies.map(r => ({ ...r, authorId: r.authorId!, responder: r.responder ?? "L'équipe", guildName: r.guildName || "le serveur", original: r.original?.slice(0, 300) ?? null })),
      statuses: statuses.map(s => {
        const site = siteForGame(cfg, s.game);
        return { id: s.id, channelId: s.channelId, messageId: s.messageId, status: s.status, changedAt: s.changedAt.toISOString(),
          track: { groupName: s.groupName, site: site.name, url: feedbackUrl(site.origin, s.groupId, s.id) } };
      }),
    };
  });

  /** Réponse du site envoyée par le bot (ou non remise : MP fermés). */
  app.post("/internal/feedback/replies/:mid", async (req: FastifyRequest) => {
    const { mid } = parse(z.object({ mid: z.coerce.number().int().positive() }), req.params);
    const { delivered } = parse(z.object({ delivered: z.boolean() }), req.body);
    const [m] = await db.update(feedbackMessages).set({ delivered }).where(and(eq(feedbackMessages.id, mid), isNull(feedbackMessages.delivered)))
      .returning({ feedbackId: feedbackMessages.feedbackId });
    if (m) {
      const [f] = await db.select({ g: feedbacks.groupId }).from(feedbacks).where(eq(feedbacks.id, m.feedbackId));
      if (f?.g) bus.group({ t: "feedback", g: f.g });
    }
    return { ok: true };
  });

  /** Statut reporté sur le message de l'avis (ou message introuvable : on n'insiste pas). */
  app.post("/internal/feedback/:id/synced", async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const { changedAt } = parse(z.object({ changedAt: z.iso.datetime({ offset: true }) }), req.body);
    await db.update(feedbacks).set({ discordSyncedAt: new Date(changedAt) }).where(eq(feedbacks.id, id));
    return { ok: true };
  });

}
