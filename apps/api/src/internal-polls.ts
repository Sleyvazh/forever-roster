import { POLL_KINDS, POLL_MAX_LABEL, POLL_MAX_OPTIONS, POLL_MAX_QUESTION, POLL_RESULTS } from "@forever/game-data";
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "./config";
import type { Db } from "./db/client";
import { groups, polls } from "./db/schema";
import { forbidden, parse } from "./lib/http";
import {
  closeDuePolls, closePoll, createPoll, createRunoff, loadPoll, mayCreatePoll, myVote, OUTBOX_WHERE, pollsChannelOf, pollView, pollViews, pollVoters, raidFromPoll,
  setChoicesIn,
  setDates, voteChoice,
  type Voter,
} from "./lib/polls";
import { siteForGame } from "./lib/site";

/**
 * API interne du bot pour les sondages (/sondage, /dispos) : création, messages à poser ou mettre à jour (clôture à la
 * fin, ménage), votes par boutons et menus (membre lié ou joueur Discord sans compte), « Qui a voté ? », clôture,
 * « Créer le raid sur ★ ». Mêmes règles que le site (lib/polls.ts).
 */

const snowflake = z.string().regex(/^\d{5,25}$/);
const idParam = z.object({ id: z.uuid() });
const who = { discordUserId: snowflake, discordName: z.string().trim().min(1).max(64) };
const optionIds = z.array(z.int().min(1).max(POLL_MAX_OPTIONS)).max(POLL_MAX_OPTIONS);

type Helpers = {
  linkedMember(discordUserId: string, groupId: string): Promise<{ user: { id: string; displayName: string } | null; role: "owner" | "officer" | "member" | null }>;
  groupForChannel(guildId: string, channelId: string): Promise<typeof groups.$inferSelect>;
  /** Annonce d'un raid (pour la poser tout de suite), ou null si le groupe n'a pas de salon. */
  raidView(raidId: string): Promise<unknown | null>;
};

export function pollRoutes(app: FastifyInstance, db: Db, cfg: Config, h: Helpers) {
  const originOf = (game: "forever" | "retail") => siteForGame(cfg, game).origin;
  const view = (id: string) => pollView(db, id, originOf);

  /** Le votant : son compte s'il a lié son Discord et qu'il est membre de la guilde, sinon son identifiant Discord seul. */
  const voterOf = async (groupId: string, discordUserId: string, discordName: string): Promise<Voter> => {
    const { user, role } = await h.linkedMember(discordUserId, groupId);
    return user && role ? { kind: "user", id: user.id, displayName: user.displayName, discordUserId } : { kind: "guest", discordUserId, displayName: discordName };
  };
  /** Compte lié et membre (créer, clore, créer le raid). */
  const memberOf = async (groupId: string, discordUserId: string) => {
    const { user, role } = await h.linkedMember(discordUserId, groupId);
    if (!user) throw forbidden("Lie d'abord ton compte Discord au site (Compte & sécurité).");
    if (!role) throw forbidden("Tu n'es pas membre de cette guilde.");
    return { user, role };
  };

  /* ----- Création ----- */

  /** Avant d'ouvrir la fenêtre de /sondage ou /dispos : salon lié, compte lié, droit de créer. */
  app.get("/internal/discord/polls/can-create", async (req: FastifyRequest) => {
    const q = parse(z.object({ guildId: snowflake, channelId: snowflake, discordUserId: snowflake }), req.query);
    const g = await h.groupForChannel(q.guildId, q.channelId);
    const { role } = await memberOf(g.id, q.discordUserId);
    if (!mayCreatePoll(g.pollCreators, role)) throw forbidden("Seuls les officiers de la guilde peuvent créer un sondage.");
    return { ok: true, group: { id: g.id, name: g.name, lang: g.lang } };
  });

  app.post("/internal/discord/polls", async (req: FastifyRequest) => {
    const body = parse(z.object({
      guildId: snowflake, channelId: snowflake, discordUserId: snowflake,
      kind: z.enum(POLL_KINDS), question: z.string().max(POLL_MAX_QUESTION * 2),
      options: z.array(z.object({ label: z.string().max(POLL_MAX_LABEL * 2), at: z.iso.datetime({ offset: true }).nullable().optional() })).max(POLL_MAX_OPTIONS + 5),
      multi: z.boolean().optional(), maxChoices: z.int().min(2).max(POLL_MAX_OPTIONS).nullable().optional(),
      anonymous: z.boolean().optional(), results: z.enum(POLL_RESULTS).optional(),
      closesAt: z.iso.datetime({ offset: true }).nullable().optional(), raidName: z.string().max(60).optional(),
    }), req.body);
    const g = await h.groupForChannel(body.guildId, body.channelId);
    const { user, role } = await memberOf(g.id, body.discordUserId);
    // Dans le salon des sondages de la guilde s'il y en a un, sinon dans ce salon
    const id = await createPoll(db, req, g, role, user, { ...body, channelId: pollsChannelOf(g, body.channelId) }, "discord");
    return { view: await view(id) };
  });

  /* ----- Messages ----- */

  /** Messages à poser ou mettre à jour ; les sondages arrivés à leur fin sont d'abord clos (et les très anciens effacés). */
  app.get("/internal/discord/polls/outbox", async () => {
    await closeDuePolls(db);
    const rows = await db.select({ poll: polls, group: groups }).from(polls).innerJoin(groups, eq(groups.id, polls.groupId))
      .where(OUTBOX_WHERE).orderBy(asc(polls.discordChangedAt)).limit(20);
    return { polls: await pollViews(db, rows, originOf) };
  });

  app.post("/internal/discord/polls/:id/published", async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ channelId: snowflake, messageId: snowflake, changedAt: z.iso.datetime({ offset: true }) }), req.body);
    await db.update(polls).set({ discordChannelId: body.channelId, discordMessageId: body.messageId, discordSyncedAt: new Date(body.changedAt) })
      .where(eq(polls.id, id));
    return { ok: true };
  });

  app.get("/internal/discord/polls/:id/view", async (req: FastifyRequest) => view(parse(idParam, req.params).id));

  /* ----- Votes ----- */

  app.post("/internal/discord/polls/:id/vote", async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ ...who, optionId: z.int().min(1).max(POLL_MAX_OPTIONS) }), req.body);
    const { group } = await loadPoll(db, id);
    const v = await voterOf(group.id, body.discordUserId, body.discordName);
    const r = await voteChoice(db, id, v, body.optionId);
    return { vote: { yes: r.yes }, name: r.name, guest: v.kind === "guest", view: await view(id) };
  });

  /** Grand sondage : un menu de « Voter » (ses choix dans `scope`, ceux cochés dans `yes`). */
  app.put("/internal/discord/polls/:id/choices", async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ ...who, scope: optionIds, yes: optionIds }), req.body);
    const { group } = await loadPoll(db, id);
    const v = await voterOf(group.id, body.discordUserId, body.discordName);
    const r = await setChoicesIn(db, id, v, body.scope, body.yes);
    return { vote: { yes: r.yes }, name: r.name, guest: v.kind === "guest", view: await view(id) };
  });

  app.put("/internal/discord/polls/:id/dates", async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ ...who, yes: optionIds.optional(), maybe: optionIds.optional() }), req.body);
    const { group } = await loadPoll(db, id);
    const v = await voterOf(group.id, body.discordUserId, body.discordName);
    const r = await setDates(db, id, v, { yes: body.yes, maybe: body.maybe });
    return { vote: { yes: r.yes, maybe: r.maybe }, name: r.name, role: r.role, guest: v.kind === "guest", view: await view(id) };
  });

  /** « Mon vote » / « Mes disponibilités » : son vote actuel et sous quel nom il compte. */
  app.get("/internal/discord/polls/:id/mine", async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const q = parse(z.object(who), req.query);
    const { group } = await loadPoll(db, id);
    const v = await voterOf(group.id, q.discordUserId, q.discordName);
    const r = await myVote(db, id, v);
    return { vote: r.vote, name: r.name, role: r.role, guest: v.kind === "guest", view: await view(id) };
  });

  app.get("/internal/discord/polls/:id/voters", async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const r = await pollVoters(db, id);
    return { options: r.options, none: r.none, view: await view(id) };
  });

  /* ----- Clôture, raid ----- */

  app.post("/internal/discord/polls/:id/close", async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ discordUserId: snowflake }), req.body);
    const { group } = await loadPoll(db, id);
    const { user, role } = await memberOf(group.id, body.discordUserId);
    const r = await closePoll(db, req, id, { id: user.id, role });
    return { already: r.already, view: await view(id) };
  });

  /** « 2e tour avec les 5 premiers » : le nouveau sondage, posé dans le même salon. */
  app.post("/internal/discord/polls/:id/runoff", async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ discordUserId: snowflake, question: z.string().max(POLL_MAX_QUESTION * 2).optional(), closesAt: z.iso.datetime({ offset: true }).nullable().optional() }), req.body);
    const { group } = await loadPoll(db, id);
    const { user, role } = await memberOf(group.id, body.discordUserId);
    const runoff = await createRunoff(db, req, id, { ...user, role }, { question: body.question, closesAt: body.closesAt }, "discord");
    return { view: await view(runoff), first: await view(id) };
  });

  app.post("/internal/discord/polls/:id/raid", async (req: FastifyRequest) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ discordUserId: snowflake, name: z.string().max(120), scheduledAt: z.iso.datetime({ offset: true }) }), req.body);
    const { group } = await loadPoll(db, id);
    const { user, role } = await memberOf(group.id, body.discordUserId);
    const r = await raidFromPoll(db, req, id, { id: user.id, role }, { name: body.name, scheduledAt: body.scheduledAt }, "discord");
    const pv = await view(id);
    return {
      raid: { id: r.raidId, name: r.name, scheduledAt: r.scheduledAt.toISOString(), url: pv.raid?.url ?? null },
      hasChannel: r.hasChannel, announcement: r.hasChannel ? await h.raidView(r.raidId).catch(() => null) : null, view: pv,
    };
  });
}
