import {
  ACTIVE_TAKER, freePlaces, QUEST_KEEP_DAYS, QUEST_LIMITS, QUEST_REMIND_PAY_MS, QUEST_REMIND_VALIDATE_MS, questStateOf, reliability, rewardText, SEATED_TAKER,
  type Game, type QuestState, type QuestType, type TakerState,
} from "@forever/game-data";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { Db } from "../db/client";
import { discordDeletions, gameItems, groups, questNotices, quests, questTakers, users, type QuestNoticeKind, type QuestNoticePayload, type QuestRewardItem, type Creators } from "../db/schema";
import { audit } from "./audit";
import { bus } from "./events";
import { fullNames } from "./guild";
import type { GroupRole } from "./groups";
import { badRequest, forbidden, notFound } from "./http";
import { identity } from "./polls";
import { canDm } from "./reach";

/**
 * Quêtes de guilde (Forever, 27/11/2026, spec claude/quetes-guilde.md) : toute la logique est ici, partagée par le site
 * et le bot. Un preneur est toujours un compte du site membre de la guilde (« Remis » et « Reçu » demandent une identité).
 * Le site ne garde pas la récompense : il note qui l'a remise (le donneur) et qui l'a reçue (le preneur).
 */

type GroupRow = typeof groups.$inferSelect;
export type QuestRow = typeof quests.$inferSelect;
export type TakerRow = typeof questTakers.$inferSelect;
type Who = { id: string; role: GroupRole | null };

const DAY_MS = 86400e3;
export const mayCreateQuest = (setting: Creators, role: GroupRole | null) => !!role && (setting === "members" || role !== "member");
const isOfficer = (role: GroupRole | null) => role === "owner" || role === "officer";
/** Page des quêtes de la guilde sur le site (Guilde › Quêtes). */
export const questsPath = (g: Pick<GroupRow, "id">) => `/groups/${g.id}/membres/quetes`;
/** Salon où va une quête : celui des quêtes s'il est lié, sinon celui de la guilde (null : site seulement). */
export const questsChannelOf = (g: Pick<GroupRow, "questsChannelId" | "discordChannelId">) => g.questsChannelId ?? g.discordChannelId;

export function assertQuestGuild(g: Pick<GroupRow, "game">) {
  if (g.game !== "forever") throw badRequest("Les quêtes de guilde sont pour WoW Forever.");
}

/** Quête (d'un groupe donné, si précisé) avec son groupe et ses preneurs ; sinon 404. */
export async function loadQuest(db: Db, questId: string, groupId?: string) {
  const [r] = await db.select({ quest: quests, group: groups }).from(quests).innerJoin(groups, eq(groups.id, quests.groupId))
    .where(and(eq(quests.id, questId), groupId ? eq(quests.groupId, groupId) : undefined));
  if (!r) throw notFound("Cette quête n'existe plus.");
  const takers = await db.select().from(questTakers).where(eq(questTakers.questId, questId)).orderBy(asc(questTakers.takenAt));
  return { ...r, takers };
}

/* ---------- Publier, modifier ---------- */

export interface QuestInput {
  type: QuestType; title: string; description?: string;
  objectiveItemId?: number | null; objectiveQty?: number | null; objectiveText?: string;
  rewardCopper?: number; rewardItems?: { itemId: number; qty: number }[]; rewardText?: string;
  places?: number; minLevel?: number | null; profession?: string;
  /** Échéance (ISO) ; null : sans échéance. */
  dueAt?: string | null;
}

const oneLine = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Vérifie une quête : titre, objectif (objet du catalogue ou phrase), récompense (au moins une), places, échéance. */
async function cleanInput(db: Db, input: QuestInput, now: Date) {
  const title = oneLine(input.title);
  if (!title) throw badRequest("Donne un titre à la quête.");
  if (title.length > QUEST_LIMITS.title) throw badRequest("Le titre fait plus de {n} caractères.", { n: QUEST_LIMITS.title });
  const description = (input.description ?? "").trim();
  if (description.length > QUEST_LIMITS.description) throw badRequest("La description fait plus de {n} caractères.", { n: QUEST_LIMITS.description });
  const objectiveText = oneLine(input.objectiveText);
  if (objectiveText.length > QUEST_LIMITS.objective) throw badRequest("L'objectif fait plus de {n} caractères.", { n: QUEST_LIMITS.objective });
  const rewardText = oneLine(input.rewardText);
  if (rewardText.length > QUEST_LIMITS.rewardText) throw badRequest("« Autre chose » fait plus de {n} caractères.", { n: QUEST_LIMITS.rewardText });

  const items = input.rewardItems ?? [];
  if (items.length > QUEST_LIMITS.rewardItems) throw badRequest("{n} objets au plus en récompense.", { n: QUEST_LIMITS.rewardItems });
  const ids = [...new Set([...items.map(i => i.itemId), ...(input.objectiveItemId ? [input.objectiveItemId] : [])])];
  const known = ids.length ? new Map((await db.select({ id: gameItems.id, name: gameItems.name }).from(gameItems).where(inArray(gameItems.id, ids))).map(r => [r.id, r.name])) : new Map<number, string>();
  if (ids.some(id => !known.has(id))) throw badRequest("Cet objet n'est pas dans la base du site.");
  const rewardItems: QuestRewardItem[] = [];
  for (const i of items) {
    if (rewardItems.some(r => r.itemId === i.itemId)) throw badRequest("Un objet est deux fois dans la récompense.");
    rewardItems.push({ itemId: i.itemId, qty: i.qty, name: known.get(i.itemId)! });
  }
  const rewardCopper = Math.floor(input.rewardCopper ?? 0);
  if (rewardCopper < 0 || rewardCopper > QUEST_LIMITS.rewardCopper) throw badRequest("Récompense en or illisible.");
  if (!rewardCopper && !rewardItems.length && !rewardText) throw badRequest("Donne au moins une récompense : de l'or, un objet ou autre chose.");

  const objectiveItemId = input.objectiveItemId ?? null;
  const objectiveQty = objectiveItemId ? input.objectiveQty ?? 1 : null;
  if (!objectiveItemId && !objectiveText) throw badRequest("Donne un objectif : un objet du jeu ou une phrase.");

  const places = input.places ?? 1;
  let dueAt = input.dueAt ? new Date(input.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) throw badRequest("Échéance illisible.");
  if (dueAt && dueAt.getTime() < now.getTime() + 60e3) throw badRequest("L'échéance est déjà passée.");
  if (dueAt && dueAt.getTime() > now.getTime() + 90 * DAY_MS) throw badRequest("L'échéance est à 90 jours au plus.");
  dueAt ??= null;
  return {
    type: input.type, title, description, objectiveItemId, objectiveQty, objectiveText: objectiveItemId ? "" : objectiveText,
    rewardCopper, rewardItems, rewardText, places, minLevel: input.minLevel ?? null, profession: oneLine(input.profession).slice(0, 30), dueAt,
  };
}

/** Quêtes encore « ouvertes » au sens des limites : ni annulées, ni closes, échéance pas passée. */
const COUNTS_AS_OPEN = (now: Date) => and(isNull(quests.cancelledAt), isNull(quests.closedAt), or(isNull(quests.dueAt), sql`${quests.dueAt} > ${now}`));

export async function createQuest(db: Db, req: FastifyRequest | null, g: GroupRow, role: GroupRole | null, creator: { id: string; displayName: string },
  input: QuestInput & { discord?: boolean }, via: "discord" | "site", now = new Date()) {
  assertQuestGuild(g);
  if (!mayCreateQuest(g.questCreators, role)) throw forbidden("Seuls les officiers de la guilde peuvent publier une quête.");
  const v = await cleanInput(db, input, now);
  const [{ mine } = { mine: 0 }] = await db.select({ mine: count() }).from(quests).where(and(eq(quests.groupId, g.id), eq(quests.createdBy, creator.id), COUNTS_AS_OPEN(now)));
  if (mine >= QUEST_LIMITS.openPerPlayer) throw badRequest("Tu as déjà {n} quêtes ouvertes : closes-en une avant d'en publier une autre.", { n: QUEST_LIMITS.openPerPlayer });
  const [{ all } = { all: 0 }] = await db.select({ all: count() }).from(quests).where(and(eq(quests.groupId, g.id), COUNTS_AS_OPEN(now)));
  if (all >= QUEST_LIMITS.openPerGuild) throw badRequest("La guilde a déjà {n} quêtes ouvertes.", { n: QUEST_LIMITS.openPerGuild });
  const who = await identity(db, g.id, { kind: "user", ...creator });
  const [q] = await db.insert(quests).values({
    groupId: g.id, ...v, createdBy: creator.id, creatorName: who.name, channelId: input.discord === false ? null : questsChannelOf(g),
  }).returning({ id: quests.id });
  await audit(db, req, "quest_created", { userId: creator.id, groupId: g.id, meta: { questId: q!.id, title: v.title, via } });
  bus.group({ t: "quests", g: g.id });
  return q!.id;
}

/**
 * Modifier : le donneur ou un officier. Tant que personne ne l'a prise, tout change ; ensuite, seulement la description et
 * l'échéance (un preneur s'est engagé sur l'objectif et la récompense).
 */
export async function updateQuest(db: Db, req: FastifyRequest | null, questId: string, by: Who, input: QuestInput, groupId: string, now = new Date()) {
  const { quest, takers } = await loadQuest(db, questId, groupId);
  if (quest.createdBy !== by.id && !isOfficer(by.role)) throw forbidden("Seuls son donneur et les officiers peuvent modifier cette quête.");
  if (quest.cancelledAt) throw badRequest("Cette quête est annulée.");
  const v = await cleanInput(db, input, now);
  const engaged = takers.some(t => t.state !== "abandoned" && t.state !== "removed");
  const seated = takers.filter(t => SEATED_TAKER.includes(t.state)).length;
  if (v.places < seated) throw badRequest("{n} joueurs ont déjà pris cette quête : garde au moins {n} places.", { n: seated });
  const set = engaged ? { description: v.description, dueAt: v.dueAt, places: v.places } : v;
  await db.update(quests).set({ ...set, updatedAt: now, discordChangedAt: now }).where(eq(quests.id, quest.id));
  await audit(db, req, "quest_updated", { userId: by.id, groupId: quest.groupId, meta: { questId: quest.id, title: quest.title, limited: engaged } });
  bus.group({ t: "quests", g: quest.groupId });
  return { limited: engaged };
}

/** Annuler : le donneur ou un officier ; les preneurs en cours sont prévenus. */
export async function cancelQuest(db: Db, req: FastifyRequest | null, questId: string, by: Who, groupId?: string, now = new Date()) {
  const { quest, group, takers } = await loadQuest(db, questId, groupId);
  if (quest.createdBy !== by.id && !isOfficer(by.role)) throw forbidden("Seuls son donneur et les officiers peuvent annuler cette quête.");
  if (quest.cancelledAt) return { already: true };
  await db.update(quests).set({ cancelledAt: now, updatedAt: now, discordChangedAt: now }).where(eq(quests.id, quest.id));
  for (const t of takers.filter(x => ACTIVE_TAKER.includes(x.state))) await notify(db, t.userId, "cancelled", payloadOf(quest, group, quest.creatorName, t.id));
  await audit(db, req, "quest_cancelled", { userId: by.id, groupId: quest.groupId, meta: { questId: quest.id, title: quest.title } });
  bus.group({ t: "quests", g: quest.groupId });
  return { already: false };
}

/** Clore : plus de nouveau preneur ; ceux en cours vont au bout. Le donneur ou un officier. */
export async function closeQuest(db: Db, req: FastifyRequest | null, questId: string, by: Who, groupId?: string, now = new Date()) {
  const { quest } = await loadQuest(db, questId, groupId);
  if (quest.createdBy !== by.id && !isOfficer(by.role)) throw forbidden("Seuls son donneur et les officiers peuvent clore cette quête.");
  if (quest.closedAt || quest.cancelledAt) return { already: true };
  await db.update(quests).set({ closedAt: now, updatedAt: now, discordChangedAt: now }).where(eq(quests.id, quest.id));
  await audit(db, req, "quest_closed", { userId: by.id, groupId: quest.groupId, meta: { questId: quest.id, title: quest.title } });
  bus.group({ t: "quests", g: quest.groupId });
  return { already: false };
}

/* ---------- Preneurs ---------- */

/**
 * Prendre une quête : membre de la guilde (vérifié par l'appelant), pas la sienne, quête ouverte, place libre. La quête est
 * verrouillée le temps de compter les places : deux joueurs qui prennent la dernière place en même temps, un seul l'a.
 */
export async function takeQuest(db: Db, questId: string, user: { id: string; displayName: string }, groupId?: string, now = new Date()) {
  const { quest, group } = await loadQuest(db, questId, groupId);
  if (quest.createdBy === user.id) throw badRequest("Tu ne peux pas prendre ta propre quête.");
  const who = await identity(db, quest.groupId, { kind: "user", ...user });
  const takerId = await db.transaction(async tx => {
    await tx.execute(sql`select 1 from ${quests} where ${quests.id} = ${quest.id} for update`);
    const [fresh] = await tx.select().from(quests).where(eq(quests.id, quest.id));
    const takers = await tx.select().from(questTakers).where(eq(questTakers.questId, quest.id));
    const mine = takers.find(t => t.userId === user.id);
    if (mine && SEATED_TAKER.includes(mine.state)) throw badRequest("Tu as déjà pris cette quête.");
    if (mine?.state === "removed") throw forbidden("Un officier t'a retiré de cette quête.");
    const state = questStateOf(fresh!, takers, now);
    if (state !== "open") {
      if (state === "running" && !fresh!.closedAt && !(fresh!.dueAt && fresh!.dueAt <= now)) throw badRequest("Plus de place dans cette quête.");
      throw badRequest("Cette quête n'est plus disponible.");
    }
    const row = { name: who.name, state: "taken" as const, note: "", rejectNote: "", takenAt: now, turnedInAt: null, validatedAt: null, paidAt: null, receivedAt: null, disputedAt: null,
      remindedValidateAt: null, remindedPayAt: null, remindedReceiveAt: null };
    const [t] = mine
      ? await tx.update(questTakers).set(row).where(eq(questTakers.id, mine.id)).returning({ id: questTakers.id })
      : await tx.insert(questTakers).values({ questId: quest.id, userId: user.id, ...row }).returning({ id: questTakers.id });
    await tx.update(quests).set({ updatedAt: now, discordChangedAt: now }).where(eq(quests.id, quest.id));
    return t!.id;
  });
  if (quest.createdBy) await notify(db, quest.createdBy, "taken", payloadOf(quest, group, who.name, takerId));
  bus.group({ t: "quests", g: quest.groupId });
  return takerId;
}

/** Ligne du preneur `takerId` de cette quête (ou celle de ce compte) ; 404 sinon. */
async function takerOf(db: Db, questId: string, groupId: string | undefined, pick: { takerId?: string; userId?: string }) {
  const r = await loadQuest(db, questId, groupId);
  const t = r.takers.find(x => (pick.takerId ? x.id === pick.takerId : x.userId === pick.userId));
  if (!t) throw notFound(pick.takerId ? "Ce preneur n'est plus dans la quête." : "Tu n'as pas pris cette quête.");
  return { ...r, taker: t };
}

async function setTaker(db: Db, quest: QuestRow, takerId: string, from: readonly TakerState[], set: Partial<TakerRow>, now: Date) {
  const [t] = await db.update(questTakers).set(set).where(and(eq(questTakers.id, takerId), inArray(questTakers.state, [...from]))).returning();
  if (!t) throw badRequest("Cette étape a déjà changé : recharge la page.");
  await db.update(quests).set({ updatedAt: now, discordChangedAt: now }).where(eq(quests.id, quest.id));
  bus.group({ t: "quests", g: quest.groupId });
  return t;
}

/** Rendre sa place (preneur, pas encore validé). */
export async function abandonQuest(db: Db, questId: string, userId: string, groupId?: string, now = new Date()) {
  const { quest, taker } = await takerOf(db, questId, groupId, { userId });
  return setTaker(db, quest, taker.id, ["taken", "turned_in"], { state: "abandoned" }, now);
}

/** « Je l'ai faite » : le preneur rend la quête (avec un mot facultatif) ; le donneur est prévenu. Pas après l'échéance. */
export async function turnInQuest(db: Db, questId: string, userId: string, note: string, groupId?: string, now = new Date()) {
  const { quest, group, taker } = await takerOf(db, questId, groupId, { userId });
  if (quest.cancelledAt) throw badRequest("Cette quête est annulée.");
  if (taker.state === "taken" && quest.dueAt && quest.dueAt <= now) throw badRequest("L'échéance de cette quête est passée.");
  const clean = oneLine(note);
  if (clean.length > QUEST_LIMITS.note) throw badRequest("Le mot fait plus de {n} caractères.", { n: QUEST_LIMITS.note });
  const t = await setTaker(db, quest, taker.id, ["taken"], { state: "turned_in", turnedInAt: now, note: clean, rejectNote: "" }, now);
  if (quest.createdBy) await notify(db, quest.createdBy, "turned_in", { ...payloadOf(quest, group, t.name, t.id), ...(clean && { note: clean }) });
  return t;
}

/** Annuler son rendu (cliqué trop tôt) : retour à « Prise ». */
export async function undoTurnIn(db: Db, questId: string, userId: string, groupId?: string, now = new Date()) {
  const { quest, taker } = await takerOf(db, questId, groupId, { userId });
  return setTaker(db, quest, taker.id, ["turned_in"], { state: "taken", turnedInAt: null, note: "" }, now);
}

const assertGiver = (quest: QuestRow, by: { id: string }) => {
  if (quest.createdBy !== by.id) throw forbidden("Seul le donneur de la quête peut faire ça.");
};

/** Valider un preneur (donneur) : il a fait la quête ; reste à lui remettre la récompense. Possible aussi sans rendu. */
export async function validateTaker(db: Db, questId: string, takerId: string, by: { id: string }, groupId?: string, now = new Date()) {
  const { quest, group, taker } = await takerOf(db, questId, groupId, { takerId });
  assertGiver(quest, by);
  const t = await setTaker(db, quest, taker.id, ["taken", "turned_in"], { state: "validated", validatedAt: now, turnedInAt: taker.turnedInAt ?? now }, now);
  await notify(db, t.userId, "validated", payloadOf(quest, group, quest.creatorName, t.id));
  return t;
}

/** « Pas encore » (donneur) : la quête n'est pas finie ; le preneur repasse en « Prise » avec le mot du donneur. */
export async function rejectTaker(db: Db, questId: string, takerId: string, by: { id: string }, note: string, groupId?: string, now = new Date()) {
  const { quest, group, taker } = await takerOf(db, questId, groupId, { takerId });
  assertGiver(quest, by);
  const clean = oneLine(note);
  if (clean.length > QUEST_LIMITS.note) throw badRequest("Le mot fait plus de {n} caractères.", { n: QUEST_LIMITS.note });
  const t = await setTaker(db, quest, taker.id, ["turned_in"], { state: "taken", turnedInAt: null, rejectNote: clean, remindedValidateAt: null }, now);
  await notify(db, t.userId, "rejected", { ...payloadOf(quest, group, quest.creatorName, t.id), ...(clean && { note: clean }) });
  return t;
}

/** « C'est remis » (donneur) : la récompense est partie en jeu ; le preneur confirme. Aussi après un « Pas reçu ». */
export async function markPaid(db: Db, questId: string, takerId: string, by: { id: string }, groupId?: string, now = new Date()) {
  const { quest, group, taker } = await takerOf(db, questId, groupId, { takerId });
  assertGiver(quest, by);
  if (taker.state === "paid" && !taker.disputedAt) return taker;
  const t = await setTaker(db, quest, taker.id, ["validated", "paid"], { state: "paid", paidAt: now, disputedAt: null, remindedReceiveAt: null }, now);
  await notify(db, t.userId, "paid", payloadOf(quest, group, quest.creatorName, t.id));
  return t;
}

/** « Reçu » ou « Pas reçu » (preneur). « Reçu » marche aussi si le donneur a oublié « C'est remis ». */
export async function confirmReceived(db: Db, questId: string, userId: string, ok: boolean, groupId?: string, now = new Date()) {
  const { quest, group, taker } = await takerOf(db, questId, groupId, { userId });
  if (ok) {
    const t = await setTaker(db, quest, taker.id, ["validated", "paid"], { state: "received", receivedAt: now, paidAt: taker.paidAt ?? now, disputedAt: null }, now);
    if (quest.createdBy) await notify(db, quest.createdBy, "received", payloadOf(quest, group, t.name, t.id));
    return t;
  }
  const t = await setTaker(db, quest, taker.id, ["paid"], { disputedAt: now }, now);
  if (quest.createdBy) await notify(db, quest.createdBy, "not_received", payloadOf(quest, group, t.name, t.id));
  return t;
}

/** Retirer un preneur : un officier (à tout moment avant la fin), ou le donneur tant que le preneur n'a rien rendu. */
export async function removeTaker(db: Db, req: FastifyRequest | null, questId: string, takerId: string, by: Who, groupId?: string, now = new Date()) {
  const { quest, group, taker } = await takerOf(db, questId, groupId, { takerId });
  const officer = isOfficer(by.role);
  if (!officer && !(quest.createdBy === by.id && taker.state === "taken")) throw forbidden("Seuls les officiers peuvent retirer ce preneur.");
  const t = await setTaker(db, quest, taker.id, ["taken", "turned_in", "validated"], { state: "removed" }, now);
  await notify(db, t.userId, "removed", payloadOf(quest, group, quest.creatorName, t.id));
  await audit(db, req, "quest_taker_removed", { userId: by.id, groupId: quest.groupId, meta: { questId: quest.id, title: quest.title, name: t.name } });
  return t;
}

/**
 * Un membre quitte la guilde (ou en est retiré) : ses places dans les quêtes sont rendues (abandoned) et ses quêtes encore
 * ouvertes ou en cours sont annulées (preneurs prévenus). Les lignes restent pour l'historique.
 */
export async function leaveQuests(db: Db, groupId: string, userId: string, now = new Date()) {
  const mine = await db.select({ id: questTakers.id }).from(questTakers).innerJoin(quests, eq(quests.id, questTakers.questId))
    .where(and(eq(quests.groupId, groupId), eq(questTakers.userId, userId), inArray(questTakers.state, ["taken", "turned_in"])));
  if (mine.length) await db.update(questTakers).set({ state: "abandoned" }).where(inArray(questTakers.id, mine.map(m => m.id)));
  const given = await db.select({ id: quests.id }).from(quests).where(and(eq(quests.groupId, groupId), eq(quests.createdBy, userId), isNull(quests.cancelledAt)));
  for (const q of given) {
    const { quest, takers } = await loadQuest(db, q.id);
    const s = questStateOf(quest, takers, now);
    if (s === "open" || s === "running") await cancelQuest(db, null, q.id, { id: userId, role: "owner" }, groupId, now);
  }
  if (mine.length) {
    await db.update(quests).set({ discordChangedAt: now }).where(inArray(quests.id,
      db.select({ id: questTakers.questId }).from(questTakers).where(inArray(questTakers.id, mine.map(m => m.id)))));
    bus.group({ t: "quests", g: groupId });
  }
}

/* ---------- MP ---------- */

function payloadOf(q: QuestRow, g: GroupRow, other: string, takerId?: string): QuestNoticePayload {
  return {
    questId: q.id, ...(takerId && { takerId }), title: q.title, groupName: g.name, lang: g.lang, other,
    // Adresse relative : l'API interne la complète avec l'adresse du site au moment de remettre le MP au bot
    reward: rewardText(q.rewardCopper, q.rewardItems, q.rewardText, g.lang), url: `${questsPath(g)}?quete=${q.id}`,
  };
}

/** MP au joueur s'il a lié son Discord et accepte les MP du bot (même réglage que les rappels de raid). */
async function notify(db: Db, userId: string, kind: QuestNoticeKind, payload: QuestNoticePayload) {
  const [u] = await db.select({ discordId: users.discordId, reminders: users.discordReminders }).from(users).where(eq(users.id, userId));
  if (!u || !canDm(u)) return;
  await db.insert(questNotices).values({ discordUserId: u.discordId!, kind, payload });
}

/**
 * Échéances et rappels (appelé par le bot avant de prendre les MP) :
 * - échéance passée : les preneurs encore « Prise » passent « Expirée » et sont prévenus (une fois par quête) ;
 * - rendue sans validation depuis 3 jours → rappel au donneur ; validée sans « C'est remis » depuis 48 h → rappel au
 *   donneur ; « C'est remis » sans « Reçu » depuis 48 h → rappel au preneur. Un seul rappel de chaque sorte.
 */
export async function expireAndRemind(db: Db, now = new Date()) {
  const due = await db.select({ quest: quests, group: groups }).from(quests).innerJoin(groups, eq(groups.id, quests.groupId))
    .where(and(isNull(quests.cancelledAt), isNull(quests.expiryNotifiedAt), isNotNull(quests.dueAt), lte(quests.dueAt, now))).limit(50);
  for (const { quest, group } of due) {
    const left = await db.update(questTakers).set({ state: "expired" }).where(and(eq(questTakers.questId, quest.id), eq(questTakers.state, "taken"))).returning();
    for (const t of left) await notify(db, t.userId, "expired", payloadOf(quest, group, quest.creatorName, t.id));
    await db.update(quests).set({ expiryNotifiedAt: now, discordChangedAt: now }).where(eq(quests.id, quest.id));
    bus.group({ t: "quests", g: quest.groupId });
  }
  const remind = async (state: TakerState, since: typeof questTakers.turnedInAt, flag: "remindedValidateAt" | "remindedPayAt" | "remindedReceiveAt", ms: number,
    kind: QuestNoticeKind, toTaker: boolean) => {
    const col = questTakers[flag];
    const rows = await db.select({ taker: questTakers, quest: quests, group: groups }).from(questTakers)
      .innerJoin(quests, eq(quests.id, questTakers.questId)).innerJoin(groups, eq(groups.id, quests.groupId))
      .where(and(eq(questTakers.state, state), isNull(col), lte(since, new Date(now.getTime() - ms)), isNull(quests.cancelledAt),
        ...(state === "paid" ? [isNull(questTakers.disputedAt)] : []))).limit(100);
    for (const r of rows) {
      const [claimed] = await db.update(questTakers).set({ [flag]: now }).where(and(eq(questTakers.id, r.taker.id), isNull(col))).returning({ id: questTakers.id });
      if (!claimed) continue;
      const to = toTaker ? r.taker.userId : r.quest.createdBy;
      if (to) await notify(db, to, kind, payloadOf(r.quest, r.group, toTaker ? r.quest.creatorName : r.taker.name, r.taker.id));
    }
  };
  await remind("turned_in", questTakers.turnedInAt, "remindedValidateAt", QUEST_REMIND_VALIDATE_MS, "remind_validate", false);
  await remind("validated", questTakers.validatedAt, "remindedPayAt", QUEST_REMIND_PAY_MS, "remind_pay", false);
  await remind("paid", questTakers.paidAt, "remindedReceiveAt", QUEST_REMIND_PAY_MS, "remind_receive", true);
  return due.length;
}

/** Purge (lib/purges.ts) : quêtes sans preneur en cours et sans activité depuis 12 mois, avec leur message Discord. */
export async function purgeOldQuests(db: Db, now = new Date()) {
  const limit = new Date(now.getTime() - QUEST_KEEP_DAYS * DAY_MS);
  const gone = await db.delete(quests).where(and(lte(quests.updatedAt, limit), sql`not exists (
    select 1 from ${questTakers} where ${questTakers.questId} = ${quests.id} and ${questTakers.state} in ('taken', 'turned_in', 'validated', 'paid'))`))
    .returning({ channelId: quests.discordChannelId, messageId: quests.discordMessageId });
  for (const m of gone) if (m.channelId && m.messageId) await db.insert(discordDeletions).values({ channelId: m.channelId, messageId: m.messageId });
  // MP remis depuis une semaine
  await db.delete(questNotices).where(lte(questNotices.claimedAt, new Date(now.getTime() - 7 * DAY_MS)));
  return gone.length;
}

/** Guilde supprimée : les messages Discord de ses quêtes sont retirés. */
export async function retireQuestMessages(db: Db, groupId: string) {
  const rows = await db.select({ channelId: quests.discordChannelId, messageId: quests.discordMessageId }).from(quests).where(eq(quests.groupId, groupId));
  for (const m of rows) if (m.channelId && m.messageId) await db.insert(discordDeletions).values({ channelId: m.channelId, messageId: m.messageId });
}

/**
 * Salon des quêtes lié, changé ou délié : les quêtes encore disponibles ou en cours partent dans le nouveau salon (leur
 * ancien message est effacé) ; les autres n'ont plus de message.
 */
export async function moveQuests(db: Db, groupId: string) {
  const [g] = await db.select().from(groups).where(eq(groups.id, groupId));
  if (!g) return 0;
  const target = questsChannelOf(g);
  const rows = await db.select({ id: quests.id, channelId: quests.discordChannelId, messageId: quests.discordMessageId }).from(quests)
    .where(and(eq(quests.groupId, groupId), isNull(quests.cancelledAt), isNotNull(quests.channelId),
      target ? sql`${quests.channelId} is distinct from ${target}` : undefined));
  if (!rows.length) return 0;
  for (const m of rows) if (m.channelId && m.messageId) await db.insert(discordDeletions).values({ channelId: m.channelId, messageId: m.messageId });
  await db.update(quests).set({ channelId: target, discordChannelId: null, discordMessageId: null, discordSyncedAt: null, discordChangedAt: new Date() })
    .where(inArray(quests.id, rows.map(r => r.id)));
  bus.group({ t: "quests", g: groupId });
  return rows.length;
}

/* ---------- Vues (site et bot) ---------- */

export interface QuestItemView { id: number; name: string; quality: number; icon: string | null; qty: number }
export interface TakerView {
  id: string; userId: string; name: string; state: TakerState; note: string; rejectNote: string; disputed: boolean;
  takenAt: string; turnedInAt: string | null; validatedAt: string | null; paidAt: string | null; receivedAt: string | null;
}
export interface QuestView {
  id: string; type: QuestType; title: string; description: string; state: QuestState;
  objective: { item: QuestItemView | null; text: string };
  reward: { copper: number; items: QuestItemView[]; text: string; label: string };
  places: number; free: number; minLevel: number | null; profession: string;
  dueAt: string | null; closedAt: string | null; cancelledAt: string | null; createdAt: string; updatedAt: string;
  creator: string; createdBy: string | null;
  takers: TakerView[];
  group: { id: string; name: string; game: Game; lang: "fr" | "en" };
  channelId: string | null; messageId: string | null; changedAt: string; url: string;
}
export type OriginOf = (game: Game) => string;

export async function questViews(db: Db, rows: { quest: QuestRow; group: GroupRow }[], originOf: OriginOf, now = new Date()): Promise<QuestView[]> {
  if (!rows.length) return [];
  const ids = rows.map(r => r.quest.id);
  const takers = await db.select().from(questTakers).where(inArray(questTakers.questId, ids)).orderBy(asc(questTakers.takenAt));
  const itemIds = rows.flatMap(r => [...(r.quest.objectiveItemId ? [r.quest.objectiveItemId] : []), ...r.quest.rewardItems.map(i => i.itemId)]);
  const items = itemIds.length ? new Map((await db.select({ id: gameItems.id, name: gameItems.name, quality: gameItems.quality, details: gameItems.details })
    .from(gameItems).where(inArray(gameItems.id, [...new Set(itemIds)]))).map(i => [i.id, i])) : new Map();
  const itemView = (id: number, qty: number, fallback = ""): QuestItemView => {
    const it = items.get(id) as { name: string; quality: number; details: { icon?: string } | null } | undefined;
    return { id, qty, name: it?.name ?? fallback, quality: it?.quality ?? 1, icon: it?.details?.icon ?? null };
  };
  const names = new Map<string, (n: string) => string>();
  for (const g of new Set(rows.map(r => r.group.id))) names.set(g, await fullNames(db, g));
  return rows.map(({ quest: q, group: g }) => {
    const mine = takers.filter(t => t.questId === q.id);
    const full = names.get(g.id)!;
    return {
      id: q.id, type: q.type, title: q.title, description: q.description, state: questStateOf(q, mine, now),
      objective: { item: q.objectiveItemId ? itemView(q.objectiveItemId, q.objectiveQty ?? 1) : null, text: q.objectiveText },
      reward: { copper: q.rewardCopper, items: q.rewardItems.map(i => itemView(i.itemId, i.qty, i.name)), text: q.rewardText, label: rewardText(q.rewardCopper, q.rewardItems, q.rewardText, g.lang) },
      places: q.places, free: freePlaces(q.places, mine), minLevel: q.minLevel, profession: q.profession,
      dueAt: q.dueAt?.toISOString() ?? null, closedAt: q.closedAt?.toISOString() ?? null, cancelledAt: q.cancelledAt?.toISOString() ?? null,
      createdAt: q.createdAt.toISOString(), updatedAt: q.updatedAt.toISOString(),
      creator: full(q.creatorName), createdBy: q.createdBy,
      takers: mine.map(t => ({
        id: t.id, userId: t.userId, name: full(t.name), state: t.state, note: t.note, rejectNote: t.rejectNote, disputed: !!t.disputedAt,
        takenAt: t.takenAt.toISOString(), turnedInAt: t.turnedInAt?.toISOString() ?? null, validatedAt: t.validatedAt?.toISOString() ?? null,
        paidAt: t.paidAt?.toISOString() ?? null, receivedAt: t.receivedAt?.toISOString() ?? null,
      })),
      group: { id: g.id, name: g.name, game: g.game, lang: g.lang },
      channelId: q.channelId, messageId: q.discordChannelId === q.channelId ? q.discordMessageId : null, changedAt: q.discordChangedAt.toISOString(),
      url: `${originOf(g.game)}${questsPath(g)}?quete=${q.id}`,
    };
  });
}

export async function questView(db: Db, questId: string, originOf: OriginOf, now = new Date()) {
  const { quest, group } = await loadQuest(db, questId);
  return (await questViews(db, [{ quest, group }], originOf, now))[0]!;
}

const STATE_ORDER: Record<QuestState, number> = { open: 0, running: 1, done: 2, closed: 2, cancelled: 2 };
/** Quêtes d'un groupe : disponibles (les plus récentes d'abord), en cours, puis finies (les plus récentes d'abord). */
export async function groupQuests(db: Db, groupId: string, originOf: OriginOf, now = new Date()) {
  const rows = await db.select({ quest: quests, group: groups }).from(quests).innerJoin(groups, eq(groups.id, quests.groupId))
    .where(eq(quests.groupId, groupId)).orderBy(desc(quests.updatedAt)).limit(300);
  const views = await questViews(db, rows, originOf, now);
  return views.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]
    || (a.state === "open" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt)));
}

/** Fiabilité des membres d'une guilde (fiche du joueur, Mon journal). */
export async function reliabilityOf(db: Db, groupId: string, now = new Date()) {
  const takerRows = await db.select({ userId: questTakers.userId, state: questTakers.state, validatedAt: questTakers.validatedAt, giver: quests.createdBy })
    .from(questTakers).innerJoin(quests, eq(quests.id, questTakers.questId)).where(eq(quests.groupId, groupId));
  const given = await db.select({ userId: quests.createdBy, n: count() }).from(quests)
    .where(and(eq(quests.groupId, groupId), isNull(quests.cancelledAt), isNotNull(quests.createdBy))).groupBy(quests.createdBy);
  const users = new Set([...takerRows.map(r => r.userId), ...takerRows.flatMap(r => (r.giver ? [r.giver] : [])), ...given.map(g => g.userId!)]);
  const out: Record<string, ReturnType<typeof reliability>> = {};
  for (const u of users) {
    out[u] = reliability(takerRows.filter(r => r.userId === u), takerRows.filter(r => r.giver === u), given.find(g => g.userId === u)?.n ?? 0, now);
  }
  return out;
}

/** Pastille de l'onglet Quêtes : ce qui attend ce compte (valider, remettre, confirmer) et les quêtes disponibles. */
export async function questCounts(db: Db, groupId: string, userId: string, now = new Date()) {
  const [{ todo } = { todo: 0 }] = await db.select({ todo: sql<number>`count(*)::int` }).from(questTakers).innerJoin(quests, eq(quests.id, questTakers.questId))
    .where(and(eq(quests.groupId, groupId), isNull(quests.cancelledAt), or(
      and(eq(quests.createdBy, userId), or(eq(questTakers.state, "turned_in"), eq(questTakers.state, "validated"), and(eq(questTakers.state, "paid"), isNotNull(questTakers.disputedAt)))),
      and(eq(questTakers.userId, userId), eq(questTakers.state, "paid"), isNull(questTakers.disputedAt)),
    )));
  const open = await db.select({ quest: quests }).from(quests).where(and(eq(quests.groupId, groupId), COUNTS_AS_OPEN(now)));
  const seats = open.length ? await db.select({ questId: questTakers.questId, userId: questTakers.userId, state: questTakers.state }).from(questTakers)
    .where(and(inArray(questTakers.questId, open.map(o => o.quest.id)), notInArray(questTakers.state, ["abandoned", "removed", "expired"]))) : [];
  const available = open.filter(o => o.quest.createdBy !== userId && questStateOf(o.quest, seats.filter(s => s.questId === o.quest.id), now) === "open"
    && !seats.some(s => s.questId === o.quest.id && s.userId === userId)).length;
  return { todo, open: available };
}
