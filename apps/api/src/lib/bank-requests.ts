import {
  BANK_REQUEST_DONE_SHOWN, BANK_REQUEST_MAX_OPEN, bankRequestOpen, firstNameOf, MAX_BANK_REQUESTS,
  type BankRequest, type BankRequestAction, type BankRequests, type BankRequestStatus, type ClassName, type GroupExportBank,
} from "@forever/game-data";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { bankRequestNotices, bankRequests, groupMembers, groups, guildBank, guildBankTabs, users } from "../db/schema";
import { itemsById } from "../routes/gamedata";
import { loadGuild, resolveGuild } from "./guild";
import { badRequest, conflict, forbidden, notFound } from "./http";
import type { GroupRole } from "./groups";
import { canDm } from "./reach";

/**
 * Demandes de retrait à la banque de la guilde (Forever, patch du 5/11). Tout membre demande une quantité d'un objet de la
 * banque ; les officiers, le propriétaire et les banquiers (drapeau group_members.banker, nommé par un officier) la préparent
 * (« à récupérer auprès de X »), la remettent ou la refusent ; le demandeur annule tant qu'elle est en attente. Tous les
 * membres voient les demandes. Règles : 5 demandes ouvertes au plus par joueur, une seule ouverte par objet, quantité de 1 au
 * total de la banque (tous onglets), mot de 80 caractères. Préparée ou refusée : un MP du bot au demandeur (file
 * bank_request_notices). Une demande close est effacée 90 jours plus tard (purges) ; une demande ouverte est annulée quand
 * son auteur quitte la guilde, effacée avec la banque quand la guilde du jeu est déliée.
 */

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;
type Row = typeof bankRequests.$inferSelect;
const INT4_MAX = 2147483647;

/* ---------- Qui traite ---------- */

/** Rôle d'un membre de la guilde du site et son drapeau de banquier ; 404 s'il n'en fait pas partie. `handler` : il traite les demandes. */
export async function standing(db: Tx, groupId: string, userId: string): Promise<{ role: GroupRole; banker: boolean; handler: boolean }> {
  const [m] = await db.select({ role: groupMembers.role, banker: groupMembers.banker }).from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  if (!m) throw notFound("Guilde introuvable.");
  return { role: m.role, banker: m.banker, handler: m.role !== "member" || m.banker };
}

/* ---------- Noms ---------- */

interface Main { name: string; cls: ClassName | null }

/** Perso main de ces joueurs dans la guilde du jeu (nom complet et classe), pour ceux qui y ont un perso. */
async function mainsOf(db: Tx, groupId: string, userIds: readonly string[], now: Date): Promise<Map<string, Main>> {
  const out = new Map<string, Main>();
  if (!userIds.length) return out;
  const r = resolveGuild(await loadGuild(db, groupId), { officer: false, now });
  for (const id of new Set(userIds)) {
    const p = r.persons.get(`u:${id}`);
    if (p) out.set(id, { name: p.main.name, cls: (p.main.cls || null) as ClassName | null });
  }
  return out;
}

/** Prénom du perso de celui qui traite (« à récupérer auprès de Kaeldra »), sinon son pseudo du site. */
async function handlerName(db: Tx, groupId: string, user: { id: string; displayName: string }, now: Date) {
  const main = (await mainsOf(db, groupId, [user.id], now)).get(user.id);
  return main ? firstNameOf(main.name) : user.displayName;
}

/* ---------- Lecture ---------- */

/** Les demandes telles que le site les montre : nom du perso de chacun (sinon son pseudo), classe, étape. */
async function viewsOf(db: Tx, groupId: string, rows: readonly Row[], me: string, now: Date): Promise<BankRequest[]> {
  if (!rows.length) return [];
  const ids = [...new Set(rows.map(r => r.userId))];
  const names = new Map((await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, ids))).map(u => [u.id, u.displayName]));
  const mains = await mainsOf(db, groupId, ids, now);
  return rows.map(r => ({
    id: r.id, itemId: r.itemId, quantity: r.quantity, note: r.note, status: r.status,
    who: { userId: r.userId, name: mains.get(r.userId)?.name ?? names.get(r.userId) ?? "", cls: mains.get(r.userId)?.cls ?? null, me: r.userId === me },
    handledBy: r.handledByName || null, reason: r.reason, at: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  }));
}

const OPEN = ["pending", "prepared"] as const satisfies readonly BankRequestStatus[];

/**
 * Demandes d'une guilde : en cours (la plus ancienne d'abord), les 20 dernières remises ou refusées (la plus récente d'abord), mes ouvertes.
 * Une demande annulée n'est pas listée sous « Terminées » (demander puis annuler en boucle y chasserait les vraies) ; elle reste en base
 * jusqu'à la purge des 90 jours.
 */
export async function requestsView(db: Tx, groupId: string, me: { id: string; handler: boolean }, now: Date): Promise<BankRequests> {
  const open = await db.select().from(bankRequests).where(and(eq(bankRequests.groupId, groupId), inArray(bankRequests.status, OPEN)))
    .orderBy(asc(bankRequests.createdAt), asc(bankRequests.id));
  const done = await db.select().from(bankRequests).where(and(eq(bankRequests.groupId, groupId), inArray(bankRequests.status, ["done", "refused"])))
    .orderBy(desc(bankRequests.closedAt), desc(bankRequests.id)).limit(BANK_REQUEST_DONE_SHOWN);
  const views = await viewsOf(db, groupId, [...open, ...done], me.id, now);
  return {
    open: views.slice(0, open.length), done: views.slice(open.length), canHandle: me.handler,
    myOpen: open.filter(r => r.userId === me.id).length,
  };
}

/**
 * Demandes ouvertes et banquiers d'une guilde pour le FRG de l'addon (lignes Q et H, 1.6.4) : les 40 plus anciennes demandes en cours
 * (en attente ou préparées), avec le perso main du demandeur dans la guilde (sinon son pseudo du site) et le prénom de celui qui l'a
 * préparée ; les banquiers par le prénom de leur perso main dans la guilde (un banquier sans perso dans la guilde n'a pas de prénom
 * en jeu : omis). Même contenu pour tous les membres (le bloc est signé et partagé entre joueurs), dans un ordre fixe.
 */
export async function bankExport(db: Tx, groupId: string, now: Date): Promise<GroupExportBank> {
  const open = await db.select().from(bankRequests).where(and(eq(bankRequests.groupId, groupId), inArray(bankRequests.status, OPEN)))
    .orderBy(asc(bankRequests.createdAt), asc(bankRequests.id)).limit(MAX_BANK_REQUESTS);
  const bankerIds = (await db.select({ userId: groupMembers.userId }).from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.banker, true))).orderBy(asc(groupMembers.userId))).map(b => b.userId);
  if (!open.length && !bankerIds.length) return { requests: [], bankers: [] };
  const ids = [...new Set([...open.map(r => r.userId), ...bankerIds])];
  const mains = await mainsOf(db, groupId, ids, now);
  const names = open.length
    ? new Map((await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, [...new Set(open.map(r => r.userId))]))).map(u => [u.id, u.displayName]))
    : new Map<string, string>();
  return {
    requests: open.map(r => ({
      id: r.id, who: mains.get(r.userId)?.name ?? names.get(r.userId) ?? "", itemId: r.itemId, quantity: r.quantity,
      status: r.status === "prepared" ? "prepared" : "pending", by: r.status === "prepared" ? r.handledByName : "",
    })),
    bankers: bankerIds.flatMap(id => { const main = mains.get(id); return main ? [firstNameOf(main.name)] : []; }),
  };
}

/** Demandes en attente (« À traiter » de l'accueil : une préparée est déjà prise en charge). */
export async function pendingCount(db: Tx, groupId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(bankRequests).where(and(eq(bankRequests.groupId, groupId), eq(bankRequests.status, "pending")));
  return r?.n ?? 0;
}

/* ---------- Demander ---------- */

/** Quantité de chaque objet dans la banque, tous onglets ; null : la banque n'a jamais été relevée. */
async function bankTotals(db: Tx, groupId: string): Promise<Map<number, number> | null> {
  const [bank] = await db.select({ groupId: guildBank.groupId }).from(guildBank).where(eq(guildBank.groupId, groupId));
  if (!bank) return null;
  const tabs = await db.select({ slots: guildBankTabs.slots }).from(guildBankTabs).where(eq(guildBankTabs.groupId, groupId));
  const totals = new Map<number, number>();
  for (const t of tabs) for (const s of t.slots) totals.set(s.id, (totals.get(s.id) ?? 0) + s.n);
  return totals;
}

export const openCount = async (db: Tx, groupId: string, userId: string) => (await db.select({ n: sql<number>`count(*)::int` }).from(bankRequests)
  .where(and(eq(bankRequests.groupId, groupId), eq(bankRequests.userId, userId), inArray(bankRequests.status, OPEN))))[0]?.n ?? 0;

/** Crée la demande d'un membre (limites ci-dessus) ; la guilde est verrouillée le temps des vérifications : deux clics simultanés ne dépassent pas 5. */
export async function createRequest(db: Db, groupId: string, user: { id: string }, input: { itemId: number; quantity: number; note: string }, now: Date): Promise<BankRequest> {
  const row = await db.transaction(async tx => {
    await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId)).for("update");
    const totals = await bankTotals(tx, groupId);
    if (!totals) throw badRequest("La banque de la guilde n'a pas encore été relevée.");
    const total = totals.get(input.itemId);
    if (!total) throw badRequest("Cet objet n'est pas dans la banque.");
    if (input.quantity > total) {
      const item = (await itemsById(db, [input.itemId]))[input.itemId];
      throw badRequest("Il n'y a que {total} {v} dans la banque.", { total, v: item?.name ?? `Objet n° ${input.itemId}` });
    }
    const [same] = await tx.select({ id: bankRequests.id }).from(bankRequests).where(and(
      eq(bankRequests.groupId, groupId), eq(bankRequests.userId, user.id), eq(bankRequests.itemId, input.itemId), inArray(bankRequests.status, OPEN))).limit(1);
    if (same) throw badRequest("Tu as déjà une demande ouverte pour cet objet.");
    if (await openCount(tx, groupId, user.id) >= BANK_REQUEST_MAX_OPEN) {
      throw badRequest("Tu as déjà {v} demandes ouvertes : attends qu'elles soient traitées, ou annules-en une.", { v: BANK_REQUEST_MAX_OPEN });
    }
    const [row] = await tx.insert(bankRequests).values({
      groupId, userId: user.id, itemId: input.itemId, quantity: Math.min(input.quantity, INT4_MAX), note: input.note, createdAt: now, updatedAt: now,
    }).returning();
    return row!;
  });
  return (await viewsOf(db, groupId, [row], user.id, now))[0]!;
}

/* ---------- Étapes ---------- */

/** D'où part chaque geste, et où il mène. « Remise » est possible depuis « En attente » ; refuser, depuis « En attente » ou « Préparée ». */
const FROM: Record<BankRequestAction, BankRequestStatus[]> = { prepare: ["pending"], done: ["pending", "prepared"], refuse: ["pending", "prepared"], cancel: ["pending"] };
const TO: Record<BankRequestAction, BankRequestStatus> = { prepare: "prepared", done: "done", refuse: "refused", cancel: "cancelled" };

/**
 * Un geste sur une demande de cette guilde. Ceux qui traitent (officier, propriétaire, banquier, vérifié ici à chaque geste :
 * un drapeau retiré ferme l'accès tout de suite) préparent, remettent, refusent ; le demandeur seul annule. Le changement se
 * fait d'un coup depuis l'étape attendue : deux gestes simultanés, un seul passe (409 pour l'autre).
 */
export async function actOnRequest(
  db: Db, groupId: string, user: { id: string; displayName: string }, requestId: string, action: BankRequestAction, reason: string, now: Date,
): Promise<BankRequest> {
  const me = await standing(db, groupId, user.id);
  const [row] = await db.select().from(bankRequests).where(and(eq(bankRequests.id, requestId), eq(bankRequests.groupId, groupId)));
  if (!row) throw notFound("Demande introuvable.");
  if (action === "cancel") { if (row.userId !== user.id) throw forbidden("Seul le demandeur peut annuler sa demande."); }
  else if (!me.handler) throw forbidden("Réservé aux officiers, au propriétaire et aux banquiers de la guilde.");

  const by = action === "cancel" ? null : { id: user.id, name: await handlerName(db, groupId, user, now) };
  const to = TO[action];
  const updated = await db.transaction(async tx => {
    const [u] = await tx.update(bankRequests).set({
      status: to, updatedAt: now, ...(by && { handledBy: by.id, handledByName: by.name }),
      reason: action === "refuse" ? reason : "", ...(!bankRequestOpen(to) && { closedAt: now }),
    }).where(and(eq(bankRequests.id, requestId), inArray(bankRequests.status, FROM[action]))).returning();
    if (!u) throw conflict("Cette demande a déjà changé d'étape : recharge la page.");
    if (action === "prepare" || action === "refuse") await tx.insert(bankRequestNotices).values({ requestId, kind: action === "prepare" ? "prepared" : "refused", createdAt: now });
    return u;
  });
  return (await viewsOf(db, groupId, [updated], user.id, now))[0]!;
}

/** Le membre quitte la guilde : ses demandes ouvertes sont annulées (personne ne doit préparer ce qu'il ne viendra plus chercher). */
export async function cancelOpenRequests(db: Tx, groupId: string, userId: string, now: Date) {
  await db.update(bankRequests).set({ status: "cancelled", updatedAt: now, closedAt: now })
    .where(and(eq(bankRequests.groupId, groupId), eq(bankRequests.userId, userId), inArray(bankRequests.status, OPEN)));
}

/** La guilde du jeu est déliée (ou remplacée) : la banque s'en va, les demandes qui s'y rapportaient avec elle. */
export async function dropGuildRequests(db: Tx, groupId: string) {
  await db.delete(bankRequests).where(eq(bankRequests.groupId, groupId));
}

/* ---------- MP du bot ---------- */

/** MP à envoyer, tel que le bot le reçoit (le texte est rendu par le bot). */
export interface BankNoticeView {
  id: number; discordUserId: string; kind: "prepared" | "refused";
  /** Nom de l'objet, quantité, prénom de celui qui a traité, motif du refus (vide : aucun). */
  item: string; quantity: number; by: string; reason: string;
  groupName: string; url: string;
  /** Langue du bot pour la guilde (lot E6). */
  lang: "fr" | "en";
}

/**
 * Prend les MP en attente (50 au plus, une seule fois chacun : deux relèves simultanées ne se les partagent pas en double).
 * Ne remet au bot que ceux qu'il peut envoyer : Discord lié et MP du bot gardés (réglage du joueur, lu maintenant), demande
 * encore à l'étape annoncée (« est prête » ne se dit plus d'une demande déjà remise). Les autres sont pris sans être remis.
 */
export async function claimBankNotices(db: Db, origin: string, now: Date): Promise<BankNoticeView[]> {
  const claimed = await db.update(bankRequestNotices).set({ claimedAt: now }).where(and(
    isNull(bankRequestNotices.claimedAt),
    inArray(bankRequestNotices.id, db.select({ id: bankRequestNotices.id }).from(bankRequestNotices).where(isNull(bankRequestNotices.claimedAt)).orderBy(asc(bankRequestNotices.id)).limit(50)),
  )).returning({ id: bankRequestNotices.id, requestId: bankRequestNotices.requestId, kind: bankRequestNotices.kind });
  // Ménage : MP remis depuis plus d'une semaine
  await db.delete(bankRequestNotices).where(lte(bankRequestNotices.claimedAt, new Date(now.getTime() - 7 * 86400e3)));
  if (!claimed.length) return [];
  const rows = await db.select({
    id: bankRequests.id, groupId: bankRequests.groupId, itemId: bankRequests.itemId, quantity: bankRequests.quantity, status: bankRequests.status,
    by: bankRequests.handledByName, reason: bankRequests.reason, groupName: groups.name, lang: groups.lang, discordId: users.discordId, reminders: users.discordReminders,
  }).from(bankRequests).innerJoin(users, eq(users.id, bankRequests.userId)).innerJoin(groups, eq(groups.id, bankRequests.groupId))
    .where(inArray(bankRequests.id, claimed.map(c => c.requestId)));
  const byId = new Map(rows.map(r => [r.id, r]));
  const items = await itemsById(db, rows.map(r => r.itemId));
  return claimed.sort((a, b) => a.id - b.id).flatMap(n => {
    const r = byId.get(n.requestId);
    if (!r || r.status !== (n.kind === "prepared" ? "prepared" : "refused") || !canDm({ discordId: r.discordId, reminders: r.reminders })) return [];
    return [{
      id: n.id, discordUserId: r.discordId!, kind: n.kind, item: items[r.itemId]?.name ?? `${r.lang === "en" ? "Item #" : "Objet n° "}${r.itemId}`, quantity: r.quantity, by: r.by, reason: r.reason,
      groupName: r.groupName, url: `${origin}/groups/${r.groupId}/membres/banque`, lang: r.lang,
    }];
  });
}

/** Le bot a envoyé ce MP. */
export async function markBankNoticeSent(db: Db, id: number, now: Date) {
  await db.update(bankRequestNotices).set({ sentAt: now }).where(and(eq(bankRequestNotices.id, id), isNull(bankRequestNotices.sentAt)));
}
