import { eq, lt } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Db } from "./db/client";
import { feedbacks, feedbackSettings } from "./db/schema";
import { notFound, parse } from "./lib/http";

/**
 * Avis (feedback) envoyés par le bot Discord. Fonction autonome : un serveur Discord l'utilise sans groupe ni compte
 * sur le site, avec n'importe quel jeu. Seuls les réglages du serveur et le lien auteur ↔ avis (30 jours, pour la
 * réponse) sont gardés ; le texte des avis reste dans Discord.
 */

/** Durée pendant laquelle l'équipe peut répondre à un avis ; ensuite l'avis (et donc son auteur) est oublié. */
export const FEEDBACK_KEEP_DAYS = 30;

const snowflake = z.string().regex(/^\d{5,25}$/);
const guildParam = z.object({ guildId: snowflake });

export function feedbackRoutes(app: FastifyInstance, db: Db) {
  const forget = () => db.delete(feedbacks).where(lt(feedbacks.createdAt, new Date(Date.now() - FEEDBACK_KEEP_DAYS * 86400e3)));

  app.get("/internal/feedback/config/:guildId", async (req: FastifyRequest) => {
    const { guildId } = parse(guildParam, req.params);
    const [s] = await db.select().from(feedbackSettings).where(eq(feedbackSettings.guildId, guildId));
    return { config: s ?? null };
  });

  /** Enregistre les réglages ; renvoie aussi les précédents (le bot retire l'ancien message du bouton). */
  app.put("/internal/feedback/config/:guildId", async (req: FastifyRequest) => {
    const { guildId } = parse(guildParam, req.params);
    const body = parse(z.object({
      inboxChannelId: snowflake, panelChannelId: snowflake.nullable(), panelMessageId: snowflake.nullable(),
      allowAnonymous: z.boolean(), updatedBy: snowflake,
    }), req.body);
    const [previous] = await db.select().from(feedbackSettings).where(eq(feedbackSettings.guildId, guildId));
    const values = { ...body, updatedAt: new Date() };
    const [config] = await db.insert(feedbackSettings).values({ guildId, ...values })
      .onConflictDoUpdate({ target: feedbackSettings.guildId, set: values }).returning();
    return { config, previous: previous ?? null };
  });

  app.delete("/internal/feedback/config/:guildId", async (req: FastifyRequest) => {
    const { guildId } = parse(guildParam, req.params);
    const [previous] = await db.delete(feedbackSettings).where(eq(feedbackSettings.guildId, guildId)).returning();
    return { previous: previous ?? null };
  });

  /** Avis publié par le bot dans le salon de l'équipe. */
  app.post("/internal/feedback", async (req: FastifyRequest) => {
    const body = parse(z.object({
      id: z.uuid(), guildId: snowflake, channelId: snowflake, messageId: snowflake, anonymous: z.boolean(), authorId: snowflake,
    }), req.body);
    await forget();
    await db.insert(feedbacks).values(body).onConflictDoNothing();
    return { ok: true };
  });

  /** Destinataire d'une réponse à un avis (connu du bot seul, jamais affiché). */
  app.get("/internal/feedback/:id", async (req: FastifyRequest) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await forget();
    const [f] = await db.select().from(feedbacks).where(eq(feedbacks.id, id));
    if (!f || !f.authorId) throw notFound(`Cet avis a plus de ${FEEDBACK_KEEP_DAYS} jours : il n'est plus possible d'y répondre.`);
    return { feedback: f };
  });
}
