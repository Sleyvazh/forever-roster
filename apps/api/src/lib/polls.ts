import {
  bestSlot, leaders, POLL_KEEP_DAYS, POLL_MAX_DAYS, POLL_MAX_LABEL, POLL_MAX_OPEN, POLL_MAX_QUESTION, POLL_MIN_OPTIONS, pollMaxOptions, roleOf,
  type Game, type PollKind, type PollOption, type PollResults, type Role,
} from "@forever/game-data";
import { and, asc, count, desc, eq, inArray, isNull, lt, lte, notExists, or, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { Db } from "../db/client";
import { characters, discordDeletions, groupCharacters, groups, polls, pollVotes, raids, type Creators } from "../db/schema";
import { formatFor } from "../routes/raids";
import { applyAbsencesToRaid } from "./absences";
import { audit } from "./audit";
import { bus } from "./events";
import { fullNames } from "./guild";
import type { GroupRole } from "./groups";
import { badRequest, forbidden, notFound } from "./http";
import { inheritPrep } from "./prep";
import { MAX_RAIDS_PER_GROUP } from "./recurring";

/**
 * Sondages de la guilde (26/11/2026) : toute la logique est ici, partagée par le site et le bot (mêmes règles quelle que
 * soit l'origine). Voir packages/game-data/src/polls.ts pour les deux sortes (choix, disponibilités) et les limites.
 * Un vote est celui d'un compte du site (« u:<id> » : sur le site, ou depuis Discord quand le Discord est lié et que le
 * joueur est membre) ou, depuis Discord sans compte, d'un identifiant Discord (« d:<id> »).
 */

type GroupRow = typeof groups.$inferSelect;
export type PollRow = typeof polls.$inferSelect;
type VoteRow = typeof pollVotes.$inferSelect;

/** Qui vote : un compte (avec son Discord s'il vient de Discord), ou un joueur Discord sans compte membre. */
export type Voter =
  | { kind: "user"; id: string; displayName: string; discordUserId?: string | null }
  | { kind: "guest"; discordUserId: string; displayName: string };

const MAX_LIFE_MS = POLL_MAX_DAYS * 86400e3;
/** Peut créer un sondage selon le réglage du groupe (officiers par défaut). */
export const mayCreatePoll = (setting: Creators, role: GroupRole | null) => !!role && (setting === "members" || role !== "member");
/** Fin effective : celle choisie, sinon POLL_MAX_DAYS jours après la création. */
export const deadlineOf = (p: Pick<PollRow, "closesAt" | "createdAt">) => p.closesAt ?? new Date(p.createdAt.getTime() + MAX_LIFE_MS);
/** Page des sondages du groupe sur le site (Forever : Guilde › Sondages ; Roster : onglet Sondages). */
export const pollsPath = (g: Pick<GroupRow, "id" | "game">) => `/groups/${g.id}/${g.game === "retail" ? "sondages" : "membres/sondages"}`;

/** Sondage (d'un groupe donné, si précisé) avec son groupe ; sinon 404. */
export async function loadPoll(db: Db, pollId: string, groupId?: string) {
  const [r] = await db.select({ poll: polls, group: groups }).from(polls).innerJoin(groups, eq(groups.id, polls.groupId))
    .where(and(eq(polls.id, pollId), groupId ? eq(polls.groupId, groupId) : undefined));
  if (!r) throw notFound("Ce sondage n'existe plus.");
  return r;
}

/* ---------- Création ---------- */

export interface PollInput {
  kind: PollKind; question: string;
  /** Choix (libellés) ; disponibilités : un créneau par entrée, avec sa date. */
  options: { label: string; at?: string | null }[];
  multi?: boolean; anonymous?: boolean; results?: PollResults;
  /** Fin (ISO) ; null : jusqu'à ce qu'on le close (disponibilités : le premier créneau). */
  closesAt?: string | null;
  raidName?: string;
  /** Salon Discord où le poser (null : site seulement). */
  channelId: string | null;
}

/** Vérifie et range les choix : libellés propres et différents ; créneaux à venir, différents, du plus tôt au plus tard. */
export function cleanOptions(kind: PollKind, list: PollInput["options"], now = new Date()): PollOption[] {
  const max = pollMaxOptions(kind);
  if (list.length < POLL_MIN_OPTIONS) throw badRequest(kind === "dates" ? "Propose au moins {n} créneaux." : "Propose au moins {n} choix.", { n: POLL_MIN_OPTIONS });
  if (list.length > max) throw badRequest(kind === "dates" ? "{n} créneaux au plus." : "{n} choix au plus.", { n: max });
  if (kind === "choice") {
    const labels = list.map(o => o.label.replace(/\s+/g, " ").trim());
    if (labels.some(l => !l)) throw badRequest("Un choix est vide.");
    if (labels.some(l => l.length > POLL_MAX_LABEL)) throw badRequest("Un choix fait plus de {n} caractères.", { n: POLL_MAX_LABEL });
    if (new Set(labels.map(l => l.toLowerCase())).size !== labels.length) throw badRequest("Deux choix sont identiques.");
    return labels.map((label, i) => ({ id: i + 1, label }));
  }
  const slots = list.map(o => {
    const at = o.at ? new Date(o.at) : null;
    if (!at || Number.isNaN(at.getTime())) throw badRequest("Chaque créneau doit avoir une date et une heure.");
    if (at.getTime() < now.getTime() - 60e3) throw badRequest("Un créneau est déjà passé.");
    if (at.getTime() > now.getTime() + 366 * 86400e3) throw badRequest("Créneau trop lointain (un an maximum).");
    return { at, label: o.label.replace(/\s+/g, " ").trim().slice(0, POLL_MAX_LABEL) };
  }).sort((a, b) => a.at.getTime() - b.at.getTime());
  if (new Set(slots.map(s => s.at.getTime())).size !== slots.length) throw badRequest("Deux créneaux sont identiques.");
  return slots.map((s, i) => ({ id: i + 1, label: s.label, at: s.at.toISOString() }));
}

export async function createPoll(db: Db, req: FastifyRequest | null, g: GroupRow, role: GroupRole | null, creator: { id: string; displayName: string }, input: PollInput, via: "discord" | "site", now = new Date()) {
  if (!mayCreatePoll(g.pollCreators, role)) throw forbidden("Seuls les officiers de la guilde peuvent créer un sondage.");
  const question = input.question.replace(/\s+/g, " ").trim();
  if (!question) throw badRequest("Écris la question du sondage.");
  if (question.length > POLL_MAX_QUESTION) throw badRequest("La question fait plus de {n} caractères.", { n: POLL_MAX_QUESTION });
  const options = cleanOptions(input.kind, input.options, now);
  let closesAt = input.closesAt ? new Date(input.closesAt) : null;
  if (closesAt && Number.isNaN(closesAt.getTime())) throw badRequest("Fin illisible.");
  // Disponibilités sans fin : jusqu'au premier créneau (ensuite, la question ne se pose plus)
  if (!closesAt && input.kind === "dates") closesAt = new Date(options[0]!.at!);
  if (closesAt && closesAt.getTime() < now.getTime() + 60e3) throw badRequest("La fin du sondage est déjà passée.");
  if (closesAt && closesAt.getTime() > now.getTime() + MAX_LIFE_MS) throw badRequest("Un sondage dure {n} jours au plus.", { n: POLL_MAX_DAYS });
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(polls).where(and(eq(polls.groupId, g.id), isNull(polls.closedAt)));
  if (n >= POLL_MAX_OPEN) throw badRequest("La guilde a déjà {n} sondages ouverts : closes-en un avant d'en poser un autre.", { n: POLL_MAX_OPEN });
  const [p] = await db.insert(polls).values({
    groupId: g.id, kind: input.kind, question, options,
    multi: input.kind === "dates" ? true : !!input.multi,
    // Disponibilités : toujours publiques (« Qui a répondu ? ») et en direct
    anonymous: input.kind === "dates" ? false : !!input.anonymous,
    results: input.kind === "dates" ? "live" : input.results ?? "live",
    raidName: input.kind === "dates" ? (input.raidName ?? "").trim().slice(0, 60) : "",
    // « Posé par » : son perso main dans la guilde (sinon le nom de son compte)
    closesAt, createdBy: creator.id, creatorName: (await identity(db, g.id, { kind: "user", ...creator })).name, channelId: input.channelId,
  }).returning({ id: polls.id });
  await audit(db, req, "poll_created", { userId: creator.id, groupId: g.id, meta: { pollId: p!.id, question, kind: input.kind, via } });
  bus.group({ t: "polls", g: g.id });
  return p!.id;
}

/* ---------- Votes ---------- */

/** Nom (perso main, nom complet si la guilde du jeu le donne, sinon nom du compte) et rôle (spé du main) d'un votant. */
export async function identity(db: Db, groupId: string, v: Voter): Promise<{ key: string; userId: string | null; discordUserId: string | null; name: string; role: Role | null }> {
  if (v.kind === "guest") return { key: `d:${v.discordUserId}`, userId: null, discordUserId: v.discordUserId, name: v.displayName.slice(0, 64), role: null };
  const [main] = await db.select({ name: characters.name, guid: characters.guid, spec1: characters.spec1 }).from(groupCharacters)
    .innerJoin(characters, eq(characters.id, groupCharacters.characterId))
    .where(and(eq(groupCharacters.groupId, groupId), eq(groupCharacters.userId, v.id), eq(groupCharacters.isMain, true)));
  const full = main ? (await fullNames(db, groupId))(main.name, main.guid) : null;
  return { key: `u:${v.id}`, userId: v.id, discordUserId: v.discordUserId ?? null, name: (full ?? v.displayName).slice(0, 64), role: main ? roleOf(main.spec1) : null };
}

/**
 * Vote actuel d'un votant. Un joueur qui a voté depuis Discord sans compte puis a lié son Discord (et rejoint la guilde)
 * retrouve ce vote : il passe sous son compte au prochain changement.
 */
async function currentVote(db: Db, pollId: string, v: Voter) {
  const keys = v.kind === "user" ? [`u:${v.id}`, ...(v.discordUserId ? [`d:${v.discordUserId}`] : [])] : [`d:${v.discordUserId}`];
  const rows = await db.select().from(pollVotes).where(and(eq(pollVotes.pollId, pollId), inArray(pollVotes.voterKey, keys)));
  return rows.find(r => r.voterKey === keys[0]) ?? rows[0] ?? null;
}

async function saveVote(db: Db, poll: PollRow, v: Voter, prev: VoteRow | null, yes: number[], maybe: number[]) {
  const who = await identity(db, poll.groupId, v);
  if (prev && prev.voterKey !== who.key) await db.delete(pollVotes).where(and(eq(pollVotes.pollId, poll.id), eq(pollVotes.voterKey, prev.voterKey)));
  // Sondage à choix : sans aucun choix, plus de vote ; disponibilités : « Non » partout reste une réponse
  if (poll.kind === "choice" && !yes.length) {
    await db.delete(pollVotes).where(and(eq(pollVotes.pollId, poll.id), eq(pollVotes.voterKey, who.key)));
  } else {
    const row = { name: who.name, role: who.role, yes, maybe, userId: who.userId, discordUserId: who.discordUserId, updatedAt: new Date() };
    await db.insert(pollVotes).values({ pollId: poll.id, voterKey: who.key, ...row })
      .onConflictDoUpdate({ target: [pollVotes.pollId, pollVotes.voterKey], set: row });
  }
  await db.update(polls).set({ discordChangedAt: new Date() }).where(eq(polls.id, poll.id));
  bus.group({ t: "polls", g: poll.groupId });
  return { yes, maybe, name: who.name, role: who.role };
}

function assertOpen(p: PollRow, now = new Date()) {
  if (p.closedAt || deadlineOf(p).getTime() <= now.getTime()) throw badRequest("Ce sondage est clos.");
}
const ids = (p: PollRow) => new Set(p.options.map(o => o.id));

/** Clic sur un choix : un seul choix (le même clic le retire), ou plusieurs (chaque clic coche ou décoche). */
export async function voteChoice(db: Db, pollId: string, v: Voter, optionId: number, groupId?: string) {
  const { poll } = await loadPoll(db, pollId, groupId);
  if (poll.kind !== "choice") throw badRequest("C'est un sondage de disponibilités : réponds créneau par créneau.");
  assertOpen(poll);
  if (!ids(poll).has(optionId)) throw badRequest("Ce choix n'existe pas.");
  const prev = await currentVote(db, poll.id, v);
  const had = prev?.yes ?? [];
  const yes = had.includes(optionId) ? had.filter(x => x !== optionId) : poll.multi ? [...had, optionId].sort((a, b) => a - b) : [optionId];
  return { ...(await saveVote(db, poll, v, prev, yes, [])), poll };
}

/** Vote complet d'un sondage à choix (site) : la liste des choix cochés remplace la précédente. */
export async function setChoices(db: Db, pollId: string, v: Voter, chosen: number[], groupId?: string) {
  const { poll } = await loadPoll(db, pollId, groupId);
  if (poll.kind !== "choice") throw badRequest("C'est un sondage de disponibilités : réponds créneau par créneau.");
  assertOpen(poll);
  const valid = ids(poll);
  const yes = [...new Set(chosen)].filter(x => valid.has(x)).sort((a, b) => a - b);
  if (yes.length !== new Set(chosen).size) throw badRequest("Ce choix n'existe pas.");
  if (!poll.multi && yes.length > 1) throw badRequest("Un seul choix pour ce sondage.");
  return { ...(await saveVote(db, poll, v, await currentVote(db, poll.id, v), yes, [])), poll };
}

/**
 * Disponibilités : « Je viens » (yes) et/ou « Si besoin » (maybe), chacun remplaçant la liste précédente quand il est
 * donné ; un créneau coché « Je viens » sort de « Si besoin ». Les créneaux non cochés comptent « Non ».
 */
export async function setDates(db: Db, pollId: string, v: Voter, input: { yes?: number[]; maybe?: number[] }, groupId?: string) {
  const { poll } = await loadPoll(db, pollId, groupId);
  if (poll.kind !== "dates") throw badRequest("Ce n'est pas un sondage de disponibilités.");
  assertOpen(poll);
  const valid = ids(poll);
  const clean = (l: number[]) => [...new Set(l)].filter(x => valid.has(x)).sort((a, b) => a - b);
  const prev = await currentVote(db, poll.id, v);
  const yes = input.yes ? clean(input.yes) : prev?.yes ?? [];
  const maybe = (input.maybe ? clean(input.maybe) : prev?.maybe ?? []).filter(x => !yes.includes(x));
  return { ...(await saveVote(db, poll, v, prev, yes, maybe)), poll };
}

/** Vote d'un votant (null : pas encore voté), avec le nom et le rôle sous lesquels il compte. */
export async function myVote(db: Db, pollId: string, v: Voter) {
  const { poll } = await loadPoll(db, pollId);
  const cur = await currentVote(db, poll.id, v);
  const who = await identity(db, poll.groupId, v);
  return { poll, vote: cur ? { yes: cur.yes, maybe: cur.maybe } : null, name: who.name, role: who.role };
}

/** Qui a voté quoi (sondage public) : par choix ou créneau ; disponibilités : Oui, Si besoin, et qui a répondu Non partout. */
export async function pollVoters(db: Db, pollId: string, groupId?: string) {
  const { poll } = await loadPoll(db, pollId, groupId);
  if (poll.anonymous) throw forbidden("Ce sondage est anonyme : personne ne voit qui a voté quoi.");
  if (poll.results === "end" && !poll.closedAt) throw forbidden("Les résultats seront visibles à la fin du sondage.");
  const rows = await db.select().from(pollVotes).where(eq(pollVotes.pollId, poll.id)).orderBy(asc(pollVotes.updatedAt));
  const one = (r: VoteRow) => ({ name: r.name, role: r.role, guest: !r.userId });
  return {
    poll,
    options: poll.options.map(o => ({ id: o.id, yes: rows.filter(r => r.yes.includes(o.id)).map(one), maybe: rows.filter(r => r.maybe.includes(o.id)).map(one) })),
    none: poll.kind === "dates" ? rows.filter(r => !r.yes.length && !r.maybe.length).map(one) : [],
  };
}

/* ---------- Clôture, ménage ---------- */

/** Clore à la main : son créateur, ou un officier (chef compris). */
export async function closePoll(db: Db, req: FastifyRequest | null, pollId: string, by: { id: string; role: GroupRole | null }, groupId?: string) {
  const { poll } = await loadPoll(db, pollId, groupId);
  if (poll.createdBy !== by.id && (!by.role || by.role === "member")) throw forbidden("Seuls son créateur et les officiers peuvent clore ce sondage.");
  if (poll.closedAt) return { poll, already: true };
  const now = new Date();
  const [p] = await db.update(polls).set({ closedAt: now, discordChangedAt: now }).where(and(eq(polls.id, poll.id), isNull(polls.closedAt))).returning();
  await audit(db, req, "poll_closed", { userId: by.id, groupId: poll.groupId, meta: { pollId: poll.id, question: poll.question } });
  bus.group({ t: "polls", g: poll.groupId });
  return { poll: p ?? poll, already: false };
}

/** Effacer (site, officiers) : le message Discord est retiré par le bot (discord_deletions). */
export async function deletePoll(db: Db, req: FastifyRequest | null, pollId: string, by: { id: string; role: GroupRole | null }, groupId: string) {
  const { poll } = await loadPoll(db, pollId, groupId);
  if (poll.createdBy !== by.id && (!by.role || by.role === "member")) throw forbidden("Seuls son créateur et les officiers peuvent effacer ce sondage.");
  await db.delete(polls).where(eq(polls.id, poll.id));
  if (poll.discordChannelId && poll.discordMessageId) await queueDeletion(db, poll.discordChannelId, poll.discordMessageId);
  await audit(db, req, "poll_deleted", { userId: by.id, groupId: poll.groupId, meta: { pollId: poll.id, question: poll.question } });
  bus.group({ t: "polls", g: poll.groupId });
}

async function queueDeletion(db: Db, channelId: string, messageId: string) {
  await db.insert(discordDeletions).values({ channelId, messageId });
}

/** Guilde supprimée : les messages Discord de ses sondages sont retirés (les sondages partent avec la guilde). */
export async function retirePollMessages(db: Db, groupId: string) {
  const rows = await db.select({ channelId: polls.discordChannelId, messageId: polls.discordMessageId }).from(polls).where(eq(polls.groupId, groupId));
  for (const m of rows) if (m.channelId && m.messageId) await queueDeletion(db, m.channelId, m.messageId);
}

/** Clôt les sondages arrivés à leur fin, efface ceux clos depuis POLL_KEEP_DAYS jours (et leur message Discord). */
export async function closeDuePolls(db: Db, now = new Date()) {
  const closed = await db.update(polls).set({ closedAt: now, discordChangedAt: now })
    .where(and(isNull(polls.closedAt), or(lte(polls.closesAt, now), and(isNull(polls.closesAt), lte(polls.createdAt, new Date(now.getTime() - MAX_LIFE_MS))))))
    .returning({ g: polls.groupId });
  // Effacés avec leur message Discord (retiré par le bot, comme les annonces)
  const gone = await db.delete(polls).where(lt(polls.closedAt, new Date(now.getTime() - POLL_KEEP_DAYS * 86400e3)))
    .returning({ channelId: polls.discordChannelId, messageId: polls.discordMessageId });
  for (const m of gone) if (m.channelId && m.messageId) await queueDeletion(db, m.channelId, m.messageId);
  for (const g of new Set(closed.map(c => c.g))) bus.group({ t: "polls", g });
  return closed.length;
}

/* ---------- Raid sur un créneau ---------- */

/**
 * « Créer le raid sur ★ » : crée le raid (droits des raids du groupe) au créneau choisi, le relie au sondage et clôt
 * celui-ci. L'annonce part dans le salon des raids du groupe, comme pour /raid.
 */
export async function raidFromPoll(db: Db, req: FastifyRequest | null, pollId: string, by: { id: string; role: GroupRole | null }, input: { name: string; scheduledAt: string }, via: "discord" | "site", groupId?: string) {
  const { poll, group: g } = await loadPoll(db, pollId, groupId);
  if (poll.kind !== "dates") throw badRequest("Seul un sondage de disponibilités crée un raid.");
  if (poll.raidId) throw badRequest("Le raid de ce sondage est déjà créé.");
  if (!by.role) throw forbidden("Tu n'es pas membre de cette guilde.");
  if (!(g.raidCreators === "members" || by.role !== "member")) throw forbidden("Seuls les officiers de la guilde peuvent créer un raid.");
  const name = input.name.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 60) throw badRequest("Le nom du raid fait de 2 à 60 caractères.");
  const at = new Date(input.scheduledAt);
  if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() - 3600e3) throw badRequest("Cette date est déjà passée.");
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(raids).where(eq(raids.groupId, g.id));
  if (n >= MAX_RAIDS_PER_GROUP) throw badRequest("Limite de {v} raids atteinte.", { v: MAX_RAIDS_PER_GROUP });
  const [r] = await db.insert(raids).values({
    groupId: g.id, name, scheduledAt: at, description: "", createdBy: by.id, ...formatFor(g.game, name),
  }).returning({ id: raids.id });
  await audit(db, req, "raid_created", { userId: by.id, groupId: g.id, meta: { raidId: r!.id, name, via, pollId: poll.id } });
  await inheritPrep(db, [r!.id]);
  await applyAbsencesToRaid(db, r!.id);
  const now = new Date();
  await db.update(polls).set({ raidId: r!.id, closedAt: poll.closedAt ?? now, discordChangedAt: now }).where(eq(polls.id, poll.id));
  bus.group({ t: "raids", g: g.id });
  bus.group({ t: "polls", g: g.id });
  return { raidId: r!.id, name, scheduledAt: at, hasChannel: !!g.discordChannelId };
}

/* ---------- Vue (bot et site) ---------- */

export interface PollOptionView {
  id: number; label: string; at: string | null;
  /** null quand les résultats sont cachés jusqu'à la fin. */
  yes: number | null; maybe: number | null; no: number | null;
  /** Disponibilités : « Oui » par rôle (main des votants qui ont un compte). */
  roles: Record<Role, number> | null;
}
export interface PollView {
  id: string; kind: PollKind; question: string; multi: boolean; anonymous: boolean; results: PollResults;
  /** Résultats cachés (« à la fin », sondage encore ouvert). */
  hidden: boolean;
  options: PollOptionView[];
  /** Nombre de votants (ou de réponses). */
  voters: number;
  /** Disponibilités : meilleur créneau ; choix : choix en tête (ex æquo compris). */
  best: number | null; leaders: number[];
  closesAt: string | null; deadline: string; closedAt: string | null; createdAt: string;
  creator: string; createdBy: string | null; raidName: string;
  raid: { id: string; name: string; scheduledAt: string | null; url: string } | null;
  group: { id: string; name: string; game: Game; lang: "fr" | "en" };
  channelId: string | null; messageId: string | null; changedAt: string; url: string;
}

/** Adresse du site de chaque jeu (Forever Roster, Roster). */
export type OriginOf = (game: Game) => string;

export async function pollViews(db: Db, rows: { poll: PollRow; group: GroupRow }[], originOf: OriginOf, now = new Date()): Promise<PollView[]> {
  if (!rows.length) return [];
  const pollIds = rows.map(r => r.poll.id);
  const votes = await db.select({ pollId: pollVotes.pollId, yes: pollVotes.yes, maybe: pollVotes.maybe, role: pollVotes.role }).from(pollVotes).where(inArray(pollVotes.pollId, pollIds));
  const raidIds = rows.flatMap(r => (r.poll.raidId ? [r.poll.raidId] : []));
  const raidRows = raidIds.length ? await db.select({ id: raids.id, name: raids.name, scheduledAt: raids.scheduledAt }).from(raids).where(inArray(raids.id, raidIds)) : [];
  const raidOf = new Map(raidRows.map(r => [r.id, r]));
  const creatorNames = new Map<string, (n: string) => string>();
  for (const g of new Set(rows.map(r => r.group.id))) creatorNames.set(g, await fullNames(db, g));
  return rows.map(({ poll: p, group: g }) => {
    const mine = votes.filter(v => v.pollId === p.id);
    const closed = p.closedAt ?? (deadlineOf(p).getTime() <= now.getTime() ? deadlineOf(p) : null);
    const hidden = p.results === "end" && !closed;
    const counts = p.options.map(o => ({ id: o.id, yes: mine.filter(v => v.yes.includes(o.id)).length, maybe: mine.filter(v => v.maybe.includes(o.id)).length }));
    const raid = p.raidId ? raidOf.get(p.raidId) : undefined;
    const origin = originOf(g.game);
    return {
      id: p.id, kind: p.kind, question: p.question, multi: p.multi, anonymous: p.anonymous, results: p.results, hidden,
      options: p.options.map((o, i) => {
        const c = counts[i]!;
        const roles = p.kind === "dates" ? { Tank: 0, Heal: 0, DPS: 0 } as Record<Role, number> : null;
        if (roles) for (const v of mine) if (v.role && v.yes.includes(o.id)) roles[v.role]++;
        return {
          id: o.id, label: o.label, at: o.at ?? null,
          yes: hidden ? null : c.yes, maybe: hidden ? null : p.kind === "dates" ? c.maybe : 0,
          no: hidden || p.kind !== "dates" ? null : mine.length - c.yes - c.maybe, roles: hidden ? null : roles,
        };
      }),
      voters: mine.length,
      best: hidden || p.kind !== "dates" ? null : bestSlot(counts),
      leaders: hidden || p.kind !== "choice" ? [] : leaders(counts),
      closesAt: p.closesAt?.toISOString() ?? null, deadline: deadlineOf(p).toISOString(), closedAt: closed?.toISOString() ?? null, createdAt: p.createdAt.toISOString(),
      creator: creatorNames.get(g.id)!(p.creatorName), createdBy: p.createdBy, raidName: p.raidName,
      raid: raid ? { id: raid.id, name: raid.name, scheduledAt: raid.scheduledAt?.toISOString() ?? null, url: `${origin}/groups/${g.id}/raids/${raid.id}` } : null,
      group: { id: g.id, name: g.name, game: g.game, lang: g.lang },
      channelId: p.channelId, messageId: p.discordMessageId, changedAt: p.discordChangedAt.toISOString(),
      url: `${origin}${pollsPath(g)}?sondage=${p.id}`,
    };
  });
}

export async function pollView(db: Db, pollId: string, originOf: OriginOf, now = new Date()) {
  const r = await loadPoll(db, pollId);
  return (await pollViews(db, [r], originOf, now))[0]!;
}

/** Sondages d'un groupe : ouverts d'abord (fin la plus proche), puis clos (les plus récents). */
export async function groupPolls(db: Db, groupId: string, originOf: OriginOf, now = new Date()) {
  const rows = await db.select({ poll: polls, group: groups }).from(polls).innerJoin(groups, eq(groups.id, polls.groupId))
    .where(eq(polls.groupId, groupId)).orderBy(desc(polls.createdAt)).limit(200);
  const views = await pollViews(db, rows, originOf, now);
  const open = views.filter(v => !v.closedAt).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const done = views.filter(v => v.closedAt).sort((a, b) => b.closedAt!.localeCompare(a.closedAt!));
  return [...open, ...done];
}

/** Votes d'un compte dans ces sondages (site : « ton vote »). */
export async function votesOf(db: Db, pollIds: string[], userId: string) {
  if (!pollIds.length) return new Map<string, { yes: number[]; maybe: number[] }>();
  const rows = await db.select({ pollId: pollVotes.pollId, yes: pollVotes.yes, maybe: pollVotes.maybe }).from(pollVotes)
    .where(and(inArray(pollVotes.pollId, pollIds), eq(pollVotes.voterKey, `u:${userId}`)));
  return new Map(rows.map(r => [r.pollId, { yes: r.yes, maybe: r.maybe }]));
}

/** Sondages dont le message est à poser ou à mettre à jour (salon connu, changé depuis la dernière publication). */
export const OUTBOX_WHERE = and(
  sql`${polls.channelId} IS NOT NULL`,
  or(isNull(polls.discordSyncedAt), sql`${polls.discordSyncedAt} < date_trunc('milliseconds', ${polls.discordChangedAt})`),
);

/** Sondages ouverts d'un groupe et ceux où ce compte n'a pas encore répondu (pastille de l'onglet). */
export async function pollCounts(db: Db, groupId: string, userId: string) {
  const open = and(eq(polls.groupId, groupId), isNull(polls.closedAt), sql`coalesce(${polls.closesAt}, ${polls.createdAt} + make_interval(days => ${POLL_MAX_DAYS})) > now()`);
  const [{ n: openN } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(polls).where(open);
  const [{ n: todo } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(polls).where(and(open, notExists(
    db.select({ x: sql`1` }).from(pollVotes).where(and(eq(pollVotes.pollId, polls.id), eq(pollVotes.voterKey, sql`'u:' || ${userId}::text`))),
  )));
  return { open: openN, toAnswer: todo };
}
