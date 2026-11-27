import { QUEST_LIMITS, QUEST_TYPES } from "@forever/game-data";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { groups } from "../db/schema";
import { membership } from "../lib/groups";
import { notFound, parse } from "../lib/http";
import {
  abandonQuest, assertQuestGuild, cancelQuest, closeQuest, confirmReceived, createQuest, groupQuests, markPaid, mayCreateQuest, questView, rejectTaker, reliabilityOf,
  removeTaker, takeQuest, turnInQuest, undoTurnIn, updateQuest, validateTaker,
} from "../lib/quests";
import { currentUser, requireAuth } from "../lib/session";
import { siteForGame } from "../lib/site";

/**
 * Quêtes de guilde sur le site (Forever, Guilde › Quêtes ; maquette validée par Flo le 27/11/2026). Mêmes règles que le
 * bot (lib/quests.ts). Chaque réponse qui change une quête renvoie sa vue à jour.
 */

const gid = z.object({ id: z.uuid() });
const qid = gid.extend({ questId: z.uuid() });
const tid = qid.extend({ takerId: z.uuid() });
const iso = z.iso.datetime({ offset: true });
const L = QUEST_LIMITS;
const questBody = z.object({
  type: z.enum(QUEST_TYPES),
  title: z.string().max(L.title * 2),
  description: z.string().max(L.description * 2).optional(),
  objectiveItemId: z.int().positive().nullable().optional(),
  objectiveQty: z.int().min(1).max(L.objectiveQty).nullable().optional(),
  objectiveText: z.string().max(L.objective * 2).optional(),
  rewardCopper: z.int().min(0).max(L.rewardCopper).optional(),
  rewardItems: z.array(z.object({ itemId: z.int().positive(), qty: z.int().min(1).max(L.rewardItemQty) })).max(L.rewardItems).optional(),
  rewardText: z.string().max(L.rewardText * 2).optional(),
  places: z.int().min(1).max(L.places).optional(),
  minLevel: z.int().min(1).max(60).nullable().optional(),
  profession: z.string().max(30).optional(),
  dueAt: iso.nullable().optional(),
});
const note = z.object({ note: z.string().max(L.note * 2).default("") });

export async function questRoutes(app: FastifyInstance) {
  const { db, cfg } = app.ctx;
  app.addHook("preHandler", requireAuth);
  const originOf = (game: "forever" | "retail") => siteForGame(cfg, game).origin;

  /** Membre d'une guilde Forever : son rôle et le groupe. */
  async function forGroup(groupId: string, userId: string) {
    const role = await membership(db, groupId, userId);
    const [g] = await db.select().from(groups).where(eq(groups.id, groupId));
    if (!g) throw notFound("Guilde introuvable.");
    assertQuestGuild(g);
    return { role, g };
  }
  const view = async (questId: string) => ({ quest: await questView(db, questId, originOf) });

  /** Quêtes de la guilde, fiabilité des membres, et de quoi publier. */
  app.get("/:id/quests", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    const { role, g } = await forGroup(id, u.id);
    return {
      quests: await groupQuests(db, id, originOf),
      reliability: await reliabilityOf(db, id),
      canCreate: mayCreateQuest(g.questCreators, role), creators: g.questCreators, officer: role !== "member",
      // Salon où les quêtes sont annoncées (celui des quêtes, sinon celui de la guilde) ; null : site seulement
      discord: g.questsChannelId ? { channel: g.questsChannelName, quests: true } : g.discordChannelId ? { channel: g.discordChannelName, quests: false } : null,
    };
  });

  app.post("/:id/quests", async (req, reply) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    const { role, g } = await forGroup(id, u.id);
    const body = parse(questBody.extend({ discord: z.boolean().default(true) }), req.body);
    const questId = await createQuest(db, req, g, role, u, body, "site");
    return reply.code(201).send(await view(questId));
  });

  app.put("/:id/quests/:questId", async (req) => {
    const u = currentUser(req);
    const p = parse(qid, req.params);
    const { role } = await forGroup(p.id, u.id);
    const r = await updateQuest(db, req, p.questId, { id: u.id, role }, parse(questBody, req.body), p.id);
    return { ...(await view(p.questId)), limited: r.limited };
  });

  /** Annuler (donneur ou officier). */
  app.delete("/:id/quests/:questId", async (req) => {
    const u = currentUser(req);
    const p = parse(qid, req.params);
    const { role } = await forGroup(p.id, u.id);
    await cancelQuest(db, req, p.questId, { id: u.id, role }, p.id);
    return view(p.questId);
  });

  /** Clore : plus de nouveau preneur (donneur ou officier). */
  app.post("/:id/quests/:questId/close", async (req) => {
    const u = currentUser(req);
    const p = parse(qid, req.params);
    const { role } = await forGroup(p.id, u.id);
    await closeQuest(db, req, p.questId, { id: u.id, role }, p.id);
    return view(p.questId);
  });

  /* ----- Preneur ----- */

  app.post("/:id/quests/:questId/take", async (req) => {
    const u = currentUser(req);
    const p = parse(qid, req.params);
    await forGroup(p.id, u.id);
    await takeQuest(db, p.questId, u, p.id);
    return view(p.questId);
  });

  app.post("/:id/quests/:questId/abandon", async (req) => {
    const u = currentUser(req);
    const p = parse(qid, req.params);
    await forGroup(p.id, u.id);
    await abandonQuest(db, p.questId, u.id, p.id);
    return view(p.questId);
  });

  app.post("/:id/quests/:questId/turn-in", async (req) => {
    const u = currentUser(req);
    const p = parse(qid, req.params);
    await forGroup(p.id, u.id);
    await turnInQuest(db, p.questId, u.id, parse(note, req.body ?? {}).note, p.id);
    return view(p.questId);
  });

  app.post("/:id/quests/:questId/undo-turn-in", async (req) => {
    const u = currentUser(req);
    const p = parse(qid, req.params);
    await forGroup(p.id, u.id);
    await undoTurnIn(db, p.questId, u.id, p.id);
    return view(p.questId);
  });

  /** « Reçu » (ok) ou « Pas reçu » : le preneur confirme la récompense. */
  app.post("/:id/quests/:questId/received", async (req) => {
    const u = currentUser(req);
    const p = parse(qid, req.params);
    await forGroup(p.id, u.id);
    const { ok } = parse(z.object({ ok: z.boolean() }), req.body);
    await confirmReceived(db, p.questId, u.id, ok, p.id);
    return view(p.questId);
  });

  /* ----- Donneur (et officiers pour retirer) ----- */

  app.post("/:id/quests/:questId/takers/:takerId/validate", async (req) => {
    const u = currentUser(req);
    const p = parse(tid, req.params);
    await forGroup(p.id, u.id);
    await validateTaker(db, p.questId, p.takerId, u, p.id);
    return view(p.questId);
  });

  app.post("/:id/quests/:questId/takers/:takerId/reject", async (req) => {
    const u = currentUser(req);
    const p = parse(tid, req.params);
    await forGroup(p.id, u.id);
    await rejectTaker(db, p.questId, p.takerId, u, parse(note, req.body ?? {}).note, p.id);
    return view(p.questId);
  });

  app.post("/:id/quests/:questId/takers/:takerId/paid", async (req) => {
    const u = currentUser(req);
    const p = parse(tid, req.params);
    await forGroup(p.id, u.id);
    await markPaid(db, p.questId, p.takerId, u, p.id);
    return view(p.questId);
  });

  app.delete("/:id/quests/:questId/takers/:takerId", async (req) => {
    const u = currentUser(req);
    const p = parse(tid, req.params);
    const { role } = await forGroup(p.id, u.id);
    await removeTaker(db, req, p.questId, p.takerId, { id: u.id, role }, p.id);
    return view(p.questId);
  });
}
