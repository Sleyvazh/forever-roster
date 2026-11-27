import { QUEST_LIMITS, QUEST_TYPES } from "@forever/game-data";
import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "./config";
import type { Db } from "./db/client";
import { discordDeletions, groups, questNotices, quests } from "./db/schema";
import { forbidden, parse } from "./lib/http";
import {
  assertQuestGuild, confirmReceived, createQuest, expireAndRemind, loadQuest, markPaid, mayCreateQuest, questView, questViews, rejectTaker, takeQuest, validateTaker,
} from "./lib/quests";
import { siteForGame } from "./lib/site";

/**
 * API interne du bot pour les quêtes de guilde (Forever, 27/11/2026) : annonces à poser, mettre à jour ou effacer,
 * « Prendre » (bouton de l'annonce), boutons des MP (Valider, Pas encore, C'est remis, Reçu, Pas reçu), /quete, et MP à
 * envoyer (rappels compris). Mêmes règles que le site (lib/quests.ts) ; il faut un compte lié et membre de la guilde.
 */

const snowflake = z.string().regex(/^\d{5,25}$/);
const idParam = z.object({ id: z.uuid() });
const takerParam = idParam.extend({ takerId: z.uuid() });
const by = z.object({ discordUserId: snowflake });

type Helpers = {
  linkedMember(discordUserId: string, groupId: string): Promise<{ user: { id: string; displayName: string } | null; role: "owner" | "officer" | "member" | null }>;
  groupForChannel(guildId: string, channelId: string): Promise<typeof groups.$inferSelect>;
};

export function questRoutes(app: FastifyInstance, db: Db, cfg: Config, h: Helpers) {
  const origin = siteForGame(cfg, "forever").origin;
  const originOf = (game: "forever" | "retail") => siteForGame(cfg, game).origin;
  const view = (id: string) => questView(db, id, originOf);
  const memberOf = async (groupId: string, discordUserId: string) => {
    const { user, role } = await h.linkedMember(discordUserId, groupId);
    if (!user) throw forbidden("Lie d'abord ton compte Discord au site (Compte & sécurité).");
    if (!role) throw forbidden("Tu n'es pas membre de cette guilde.");
    return { user, role };
  };
  const groupOfQuest = async (id: string) => (await loadQuest(db, id)).group;

  /* ----- Annonces ----- */

  /**
   * Annonces à poser ou mettre à jour (quêtes disponibles ou en cours, changées depuis la dernière publication). Une quête
   * finie, close ou annulée perd son message (effacé par le bot), pour garder le salon propre.
   */
  app.get("/internal/discord/quests/outbox", async () => {
    const now = new Date();
    const rows = await db.select({ quest: quests, group: groups }).from(quests).innerJoin(groups, eq(groups.id, quests.groupId))
      .where(and(isNotNull(quests.channelId), or(isNull(quests.discordSyncedAt), sql`${quests.discordSyncedAt} < date_trunc('milliseconds', ${quests.discordChangedAt})`)))
      .orderBy(asc(quests.discordChangedAt)).limit(30);
    const views = await questViews(db, rows, originOf, now);
    const live = views.filter(v => v.state === "open" || v.state === "running");
    const ended = rows.filter(r => !live.some(v => v.id === r.quest.id));
    for (const { quest: q } of ended) {
      if (q.discordChannelId && q.discordMessageId) await db.insert(discordDeletions).values({ channelId: q.discordChannelId, messageId: q.discordMessageId });
      await db.update(quests).set({ discordChannelId: null, discordMessageId: null, discordSyncedAt: q.discordChangedAt }).where(eq(quests.id, q.id));
    }
    return { quests: live.slice(0, 20) };
  });

  app.post("/internal/discord/quests/:id/published", async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ channelId: snowflake, messageId: snowflake, changedAt: z.iso.datetime({ offset: true }) }), req.body);
    await db.update(quests).set({ discordChannelId: body.channelId, discordMessageId: body.messageId, discordSyncedAt: new Date(body.changedAt) }).where(eq(quests.id, id));
    return { ok: true };
  });

  app.get("/internal/discord/quests/:id/view", async (req: FastifyRequest) => view(parse(idParam, req.params).id));

  /* ----- Boutons ----- */

  app.post("/internal/discord/quests/:id/take", async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const { discordUserId } = parse(by, req.body);
    const { user } = await memberOf((await groupOfQuest(id)).id, discordUserId);
    await takeQuest(db, id, user);
    return { view: await view(id) };
  });

  app.post("/internal/discord/quests/:id/takers/:takerId/validate", async (req: FastifyRequest) => {
    const p = parse(takerParam, req.params);
    const { user } = await memberOf((await groupOfQuest(p.id)).id, parse(by, req.body).discordUserId);
    await validateTaker(db, p.id, p.takerId, user);
    return { view: await view(p.id) };
  });

  app.post("/internal/discord/quests/:id/takers/:takerId/reject", async (req: FastifyRequest) => {
    const p = parse(takerParam, req.params);
    const body = parse(by.extend({ note: z.string().max(QUEST_LIMITS.note * 2).default("") }), req.body);
    const { user } = await memberOf((await groupOfQuest(p.id)).id, body.discordUserId);
    await rejectTaker(db, p.id, p.takerId, user, body.note);
    return { view: await view(p.id) };
  });

  app.post("/internal/discord/quests/:id/takers/:takerId/paid", async (req: FastifyRequest) => {
    const p = parse(takerParam, req.params);
    const { user } = await memberOf((await groupOfQuest(p.id)).id, parse(by, req.body).discordUserId);
    await markPaid(db, p.id, p.takerId, user);
    return { view: await view(p.id) };
  });

  app.post("/internal/discord/quests/:id/received", async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const body = parse(by.extend({ ok: z.boolean() }), req.body);
    const { user } = await memberOf((await groupOfQuest(id)).id, body.discordUserId);
    await confirmReceived(db, id, user.id, body.ok);
    return { view: await view(id) };
  });

  /* ----- /quete ----- */

  app.get("/internal/discord/quests/can-create", async (req: FastifyRequest) => {
    const q = parse(z.object({ guildId: snowflake, channelId: snowflake, discordUserId: snowflake }), req.query);
    const g = await h.groupForChannel(q.guildId, q.channelId);
    assertQuestGuild(g);
    const { role } = await memberOf(g.id, q.discordUserId);
    if (!mayCreateQuest(g.questCreators, role)) throw forbidden("Seuls les officiers de la guilde peuvent publier une quête.");
    return { ok: true, group: { id: g.id, name: g.name, lang: g.lang } };
  });

  /** /quete : titre, objectif (phrase), récompense en or et autre chose, places, échéance ; annoncée dans le salon des quêtes. */
  app.post("/internal/discord/quests", async (req: FastifyRequest) => {
    const body = parse(z.object({
      guildId: snowflake, channelId: snowflake, discordUserId: snowflake,
      type: z.enum(QUEST_TYPES).default("other"), title: z.string().max(QUEST_LIMITS.title * 2), objective: z.string().max(QUEST_LIMITS.objective * 2),
      description: z.string().max(QUEST_LIMITS.description * 2).optional(),
      gold: z.int().min(0).max(99_999).default(0), reward: z.string().max(QUEST_LIMITS.rewardText * 2).optional(),
      places: z.int().min(1).max(QUEST_LIMITS.places).default(1), dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
    }), req.body);
    const g = await h.groupForChannel(body.guildId, body.channelId);
    const { user, role } = await memberOf(g.id, body.discordUserId);
    const id = await createQuest(db, req, g, role, user, {
      type: body.type, title: body.title, description: body.description, objectiveText: body.objective,
      rewardCopper: body.gold * 10000, rewardText: body.reward, places: body.places, dueAt: body.dueAt ?? null,
    }, "discord");
    return { view: await view(id) };
  });

  /* ----- MP ----- */

  /** MP à envoyer : échéances et rappels dus d'abord, puis la file ; chaque MP n'est remis qu'une fois au bot. */
  app.post("/internal/discord/quests/notices/claim", async () => {
    const now = new Date();
    await expireAndRemind(db, now);
    const notices = await db.update(questNotices).set({ claimedAt: now })
      .where(inArray(questNotices.id, db.select({ id: questNotices.id }).from(questNotices).where(isNull(questNotices.claimedAt)).orderBy(asc(questNotices.id)).limit(50)))
      .returning({ id: questNotices.id, discordUserId: questNotices.discordUserId, kind: questNotices.kind, payload: questNotices.payload });
    await db.delete(questNotices).where(lte(questNotices.claimedAt, new Date(now.getTime() - 7 * 86400e3)));
    return { notices: notices.sort((a, b) => a.id - b.id).map(n => ({ ...n, payload: { ...n.payload, url: `${origin}${n.payload.url}` } })) };
  });
}
