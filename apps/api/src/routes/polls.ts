import { POLL_KINDS, POLL_MAX_LABEL, POLL_MAX_OPTIONS, POLL_MAX_QUESTION, POLL_RESULTS } from "@forever/game-data";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { groups } from "../db/schema";
import { membership } from "../lib/groups";
import { notFound, parse } from "../lib/http";
import {
  closePoll, createPoll, createRunoff, deletePoll, groupPolls, identity, mayCreatePoll, pollsChannelOf, pollView, pollVoters, raidFromPoll, setChoices, setDates,
  votesOf,
  type PollView, type Voter,
} from "../lib/polls";
import { currentUser, requireAuth } from "../lib/session";
import { siteForGame } from "../lib/site";

/**
 * Sondages sur le site (Guilde › Sondages ; Roster : onglet Sondages), maquette B validée par Flo le 27/11 : liste à
 * gauche, sondage choisi à droite ; « + Sondage » dans une fenêtre (maquette C). Mêmes règles que le bot (lib/polls.ts) :
 * un vote sur le site compte sur Discord, et l'inverse.
 */

const gid = z.object({ id: z.uuid() });
const pid = gid.extend({ pollId: z.uuid() });
const optionIds = z.array(z.int().min(1).max(POLL_MAX_OPTIONS)).max(POLL_MAX_OPTIONS);

export async function pollRoutes(app: FastifyInstance) {
  const { db, cfg } = app.ctx;
  app.addHook("preHandler", requireAuth);
  const originOf = (game: "forever" | "retail") => siteForGame(cfg, game).origin;

  /** Membre du groupe : son rôle et le groupe. */
  async function forGroup(groupId: string, userId: string) {
    const role = await membership(db, groupId, userId);
    const [g] = await db.select().from(groups).where(eq(groups.id, groupId));
    if (!g) throw notFound("Guilde introuvable.");
    return { role, g };
  }
  const voterOf = (u: ReturnType<typeof currentUser>): Voter => ({ kind: "user", id: u.id, displayName: u.displayName, discordUserId: u.discordId });
  /** Vue d'un sondage pour ce compte : son vote, et ce qu'il peut faire (clore, effacer, créer le raid). */
  const forMe = (userId: string, role: string, view: PollView, vote: { yes: number[]; maybe: number[] } | null, raidCreators: string) => ({
    ...view,
    mine: vote,
    canClose: !view.closedAt && (view.createdBy === userId || role !== "member"),
    canDelete: view.createdBy === userId || role !== "member",
    canRaid: view.kind === "dates" && !view.raid && (raidCreators === "members" || role !== "member"),
    canRunoff: !!view.closedAt && view.qualifiers.length >= 2 && !view.runoffId && (view.createdBy === userId || role !== "member"),
  });

  /** Sondages du groupe (ouverts d'abord, puis clos), mon vote dans chacun ; de quoi poser un sondage. */
  app.get("/:id/polls", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    const { role, g } = await forGroup(id, u.id);
    const list = await groupPolls(db, id, originOf);
    const mine = await votesOf(db, list.map(p => p.id), u.id);
    const who = await identity(db, id, voterOf(u));
    return {
      polls: list.map(p => forMe(u.id, role, p, mine.get(p.id) ?? null, g.raidCreators)),
      canCreate: mayCreatePoll(g.pollCreators, role), creators: g.pollCreators,
      // Salon où le sondage est aussi posé (celui des sondages, sinon celui des raids) ; null : site seulement
      discord: g.pollsChannelId ? { channel: g.pollsChannelName, polls: true } : g.discordChannelId ? { channel: g.discordChannelName, polls: false } : null,
      // Nom et rôle sous lesquels ce compte répond (son main dans la guilde)
      me: { name: who.name, role: who.role },
    };
  });

  app.post("/:id/polls", async (req, reply) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    const { role, g } = await forGroup(id, u.id);
    const body = parse(z.object({
      kind: z.enum(POLL_KINDS), question: z.string().max(POLL_MAX_QUESTION * 2),
      options: z.array(z.object({ label: z.string().max(POLL_MAX_LABEL * 2), at: z.iso.datetime({ offset: true }).nullable().optional() })).max(POLL_MAX_OPTIONS + 5),
      multi: z.boolean().optional(), maxChoices: z.int().min(2).max(POLL_MAX_OPTIONS).nullable().optional(),
      anonymous: z.boolean().optional(), results: z.enum(POLL_RESULTS).optional(),
      closesAt: z.iso.datetime({ offset: true }).nullable().optional(), raidName: z.string().max(60).optional(),
      /** Aussi sur Discord, dans le salon des sondages de la guilde (sinon celui des raids), s'il y en a un. */
      discord: z.boolean().default(true),
    }), req.body);
    const pollId = await createPoll(db, req, g, role, u, { ...body, channelId: body.discord ? pollsChannelOf(g, g.discordChannelId) : null }, "site");
    return reply.code(201).send({ poll: forMe(u.id, role, await pollView(db, pollId, originOf), null, g.raidCreators) });
  });

  /** Sondage à choix : la liste des choix cochés remplace la précédente (vide : plus de vote). */
  app.put("/:id/polls/:pollId/vote", async (req) => {
    const u = currentUser(req);
    const p = parse(pid, req.params);
    await forGroup(p.id, u.id);
    const { yes } = parse(z.object({ yes: optionIds }), req.body);
    const r = await setChoices(db, p.pollId, voterOf(u), yes, p.id);
    return { mine: { yes: r.yes, maybe: [] } };
  });

  /** Disponibilités : « Oui » et « Si besoin » pour chaque créneau (les autres comptent « Non »). */
  app.put("/:id/polls/:pollId/dates", async (req) => {
    const u = currentUser(req);
    const p = parse(pid, req.params);
    await forGroup(p.id, u.id);
    const body = parse(z.object({ yes: optionIds, maybe: optionIds }), req.body);
    const r = await setDates(db, p.pollId, voterOf(u), body, p.id);
    return { mine: { yes: r.yes, maybe: r.maybe } };
  });

  app.get("/:id/polls/:pollId/voters", async (req) => {
    const u = currentUser(req);
    const p = parse(pid, req.params);
    await forGroup(p.id, u.id);
    const r = await pollVoters(db, p.pollId, p.id);
    return { options: r.options, none: r.none };
  });

  app.post("/:id/polls/:pollId/close", async (req) => {
    const u = currentUser(req);
    const p = parse(pid, req.params);
    const { role } = await forGroup(p.id, u.id);
    const r = await closePoll(db, req, p.pollId, { id: u.id, role }, p.id);
    return { already: r.already };
  });

  app.delete("/:id/polls/:pollId", async (req) => {
    const u = currentUser(req);
    const p = parse(pid, req.params);
    const { role } = await forGroup(p.id, u.id);
    await deletePoll(db, req, p.pollId, { id: u.id, role }, p.id);
    return { ok: true };
  });

  /** « 2e tour avec les 5 premiers » d'un grand sondage clos. */
  app.post("/:id/polls/:pollId/runoff", async (req, reply) => {
    const u = currentUser(req);
    const p = parse(pid, req.params);
    const { role, g } = await forGroup(p.id, u.id);
    const body = parse(z.object({ question: z.string().max(POLL_MAX_QUESTION * 2).optional(), closesAt: z.iso.datetime({ offset: true }).nullable().optional() }), req.body);
    const id = await createRunoff(db, req, p.pollId, { id: u.id, displayName: u.displayName, role }, body, "site", p.id);
    return reply.code(201).send({ poll: forMe(u.id, role, await pollView(db, id, originOf), null, g.raidCreators) });
  });

  /** « Créer le raid sur ★ » : nom et créneau choisis (le meilleur par défaut, côté site). */
  app.post("/:id/polls/:pollId/raid", async (req) => {
    const u = currentUser(req);
    const p = parse(pid, req.params);
    const { role } = await forGroup(p.id, u.id);
    const body = parse(z.object({ name: z.string().max(120), scheduledAt: z.iso.datetime({ offset: true }) }), req.body);
    const r = await raidFromPoll(db, req, p.pollId, { id: u.id, role }, body, "site", p.id);
    return { raid: { id: r.raidId, name: r.name, scheduledAt: r.scheduledAt.toISOString() }, hasChannel: r.hasChannel };
  });
}
