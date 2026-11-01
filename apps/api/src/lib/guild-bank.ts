import { nameKey, type GuildBankExport, type GuildBankLogResponse, type GuildBankMove, type GuildBankMoneyMove, type GuildBankResponse, type GuildBankTab } from "@forever/game-data";
import { and, desc, eq, gte, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { guildBank, guildBankLog, guildBankTabs } from "../db/schema";
import { itemsById } from "../routes/gamedata";
import { requestsView } from "./bank-requests";
import { GAME_LOG_TOLERANCE, gameLogDate, matchGameLog } from "./game-log";

/**
 * Banque de la guilde du jeu (lignes B, T, I, X, O du relevé FRL, lot « Banque »), appliquée dans la transaction du relevé
 * de guilde (guild-import.ts). Règles (spec du 31/10) :
 * - tout membre peut envoyer le relevé ; le plus récent (heure de la ligne B) l'emporte pour les noms d'onglets, et pour l'or
 *   quand il le donne ;
 * - le nombre d'onglets ne baisse jamais (le jeu n'en retire pas, et l'addon peut en voir 0 si la banque n'est pas encore ouverte) :
 *   aucun onglet n'est effacé par un relevé, seul « Délier » efface tout ;
 * - chaque onglet garde son dernier relevé lu : un onglet que l'envoyeur ne voit pas (0;0) ou pas encore lu (1;0) garde
 *   le contenu d'avant, et un relevé plus ancien apporte un onglet que le site n'avait jamais lu ;
 * - journaux dédoublonnés comme le journal de guilde (game-log.ts : « il y a N heures », marge de 2 h), gardés 12 mois (purges) ;
 * - le relevé ne borne pas les nombres : ici, une date impossible ou d'avant 2000 saute la ligne, un entier trop grand pour
 *   la base saute la case ou la ligne (objet) ou n'est pas gardé (quantité, montant, or).
 */

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;
type LogRow = typeof guildBankLog.$inferInsert;
type KeyRow = Pick<typeof guildBankLog.$inferSelect, "kind" | "tab" | "type" | "who" | "itemId" | "count" | "tab1" | "tab2" | "amount">;

/**
 * Ce que le relevé a changé. `bank` : "applied" (relevé plus récent, ou qui apporte un onglet ou l'or), "older" (plus ancien que
 * celui du site et rien apporté), null (même relevé relu : l'addon joint son dernier relevé de banque à chaque relevé de guilde).
 * `tabs` : onglets dont les cases sont enregistrées ; `money` : l'or a changé de valeur.
 */
export interface BankApplySummary { bank: "applied" | "older" | null; tabs: number; money: boolean; moves: number }

/** Plus grand entier d'une colonne integer. */
const INT4_MAX = 2147483647;
/** Montant ou or : un entier que JavaScript garde exactement, sinon rien. */
const safe = (n: number | null) => (n !== null && Number.isSafeInteger(n) ? n : null);
/** Quantité : un entier de la colonne integer, sinon rien. */
const int4 = (n: number | null) => (n !== null && Number.isSafeInteger(n) && n <= INT4_MAX ? n : null);

/** Clé d'une ligne de journal : deux lectures de la même ligne ont la même clé (objets : onglet, objet, quantité, onglets ; or : montant). */
const logKey = (r: KeyRow) => (r.kind === "item"
  ? ["item", r.tab, r.type, nameKey(r.who), r.itemId, r.count, r.tab1, r.tab2]
  : ["money", r.type, nameKey(r.who), r.amount]).map(v => v ?? "").join("|");

/** Applique la banque d'un relevé (dans la transaction du relevé de guilde). */
export async function applyBank(tx: Tx, groupId: string, b: GuildBankExport, o: { when: (unix: number) => Date; sentBy: string | null }): Promise<BankApplySummary> {
  const at = o.when(b.at);
  const sum: BankApplySummary = { bank: null, tabs: 0, money: false, moves: 0 };
  const [row] = await tx.select().from(guildBank).where(eq(guildBank.groupId, groupId));
  const stored = new Map((await tx.select().from(guildBankTabs).where(eq(guildBankTabs.groupId, groupId))).map(t => [t.tab, t]));

  // Relevé le plus récent : les noms d'onglets le suivent ; le nombre d'onglets ne fait que monter
  const newest = !row || at.getTime() > row.at.getTime();
  const ntabs = Math.max(row?.tabs ?? 0, b.ntabs);
  const grew = !!row && ntabs > row.tabs;

  // Onglets : le contenu d'un onglet lu remplace le sien s'il est plus récent que son dernier relevé
  const slotsOf = new Map<number, { slot: number; id: number; n: number }[]>();
  for (const i of b.items) {
    if (i.id > INT4_MAX || i.n > INT4_MAX) continue;
    slotsOf.set(i.tab, [...(slotsOf.get(i.tab) ?? []), { slot: i.slot, id: i.id, n: i.n }]);
  }
  for (const t of b.tabs) {
    if (t.tab > ntabs) continue;
    const e = stored.get(t.tab);
    const read = t.read && (!e?.readAt || e.readAt.getTime() < at.getTime());
    const name = newest ? t.name || e?.name || "" : e?.name || t.name;
    if (read) {
      const slots = (slotsOf.get(t.tab) ?? []).sort((x, y) => x.slot - y.slot);
      await tx.insert(guildBankTabs).values({ groupId, tab: t.tab, name, readAt: at, readBy: b.by, sentBy: o.sentBy, slots }).onConflictDoUpdate({
        target: [guildBankTabs.groupId, guildBankTabs.tab], set: { name, readAt: at, readBy: b.by, sentBy: o.sentBy, slots },
      });
      sum.tabs++;
    } else if (!e) await tx.insert(guildBankTabs).values({ groupId, tab: t.tab, name });
    else if (name !== e.name) await tx.update(guildBankTabs).set({ name }).where(and(eq(guildBankTabs.groupId, groupId), eq(guildBankTabs.tab, t.tab)));
  }

  // Or : le relevé le plus récent qui le donne
  const money = safe(b.money);
  const moneyNew = money !== null && (!row?.moneyAt || at.getTime() > row.moneyAt.getTime());
  if (!row) await tx.insert(guildBank).values({ groupId, at, by: b.by, money: moneyNew ? money : null, moneyAt: moneyNew ? at : null, tabs: ntabs, sentBy: o.sentBy });
  else if (newest || moneyNew || grew) {
    await tx.update(guildBank).set({
      ...(newest && { at, by: b.by, sentBy: o.sentBy }), ...(grew && { tabs: ntabs }), ...(moneyNew && { money, moneyAt: at }), updatedAt: sql`now()`,
    }).where(eq(guildBank.groupId, groupId));
  }
  sum.money = moneyNew && money !== row?.money;
  // Ni plus récent ni rien d'apporté : le même relevé relu (null), ou un plus ancien que celui du site
  sum.bank = newest || grew || sum.tabs > 0 || moneyNew ? "applied" : at.getTime() < row!.at.getTime() ? "older" : null;

  // Journaux des objets et de l'or
  const incoming: (LogRow & { key: string })[] = [];
  const add = (r: KeyRow, hoursAgo: number) => {
    const date = gameLogDate(at.getTime(), hoursAgo);
    if (!date) return;
    incoming.push({ ...r, groupId, at: date, sentBy: o.sentBy, key: logKey(r) });
  };
  for (const l of b.log) {
    if (l.itemId !== null && l.itemId > INT4_MAX) continue;
    add({ kind: "item", tab: l.tab, type: l.type, who: l.who, itemId: l.itemId, count: int4(l.n), tab1: l.tab1, tab2: l.tab2, amount: null }, l.hoursAgo);
  }
  for (const l of b.moneyLog) add({ kind: "money", tab: null, type: l.type, who: l.who, itemId: null, count: null, tab1: null, tab2: null, amount: safe(l.amount) }, l.hoursAgo);
  if (incoming.length) {
    const times = incoming.map(l => l.at.getTime());
    const known = await tx.select().from(guildBankLog).where(and(
      eq(guildBankLog.groupId, groupId), gte(guildBankLog.at, new Date(Math.min(...times) - GAME_LOG_TOLERANCE)), lte(guildBankLog.at, new Date(Math.max(...times) + GAME_LOG_TOLERANCE)),
    ));
    const { fresh, earlier } = matchGameLog(incoming, known.map(s => ({ id: s.id, key: logKey(s), at: s.at })));
    for (const e of earlier) await tx.update(guildBankLog).set({ at: e.at }).where(eq(guildBankLog.id, e.id));
    if (fresh.length) await tx.insert(guildBankLog).values(fresh.map(({ key: _, ...r }) => r));
    sum.moves = fresh.length;
  }
  return sum;
}

/* ---------- Lecture ---------- */

const moneyMove = (r: typeof guildBankLog.$inferSelect): GuildBankMoneyMove => ({ id: r.id, type: r.type, who: r.who, amount: r.amount, at: r.at.toISOString() });
const itemMove = (r: typeof guildBankLog.$inferSelect): GuildBankMove => ({
  id: r.id, tab: r.tab ?? 0, type: r.type, who: r.who, itemId: r.itemId, n: r.count, tab1: r.tab1, tab2: r.tab2, at: r.at.toISOString(),
});

/**
 * Banque de la guilde : onglets de 1 à `tabs` (un onglet sans ligne est « jamais relevé »), objets du catalogue (ceux des cases
 * et ceux des demandes de retrait), deux derniers mouvements d'or, demandes de retrait (lot « Demandes de retrait » : me = le lecteur,
 * handler : il les traite).
 */
export async function bankView(db: Db, groupId: string, linked: boolean, me: { id: string; handler: boolean }, now: Date): Promise<GuildBankResponse> {
  const none: GuildBankResponse = { linked, bank: null, objects: {}, lastMoney: [], requests: { open: [], done: [], canHandle: me.handler, myOpen: 0 } };
  if (!linked) return none;
  const [row] = await db.select().from(guildBank).where(eq(guildBank.groupId, groupId));
  if (!row) return none;
  const stored = new Map((await db.select().from(guildBankTabs).where(eq(guildBankTabs.groupId, groupId))).map(t => [t.tab, t]));
  const tabs: GuildBankTab[] = Array.from({ length: row.tabs }, (_, i) => {
    const t = stored.get(i + 1);
    return { tab: i + 1, name: t?.name ?? "", at: t?.readAt?.toISOString() ?? null, by: t?.readBy ?? "", slots: t?.slots ?? [] };
  });
  const lastMoney = await db.select().from(guildBankLog).where(and(eq(guildBankLog.groupId, groupId), eq(guildBankLog.kind, "money")))
    .orderBy(desc(guildBankLog.at), desc(guildBankLog.id)).limit(2);
  const requests = await requestsView(db, groupId, me, now);
  return {
    linked: true,
    bank: { at: row.at.toISOString(), by: row.by, money: row.money, moneyAt: row.moneyAt?.toISOString() ?? null, tabs },
    objects: await itemsById(db, [...tabs.flatMap(t => t.slots.map(s => s.id)), ...requests.open.map(r => r.itemId), ...requests.done.map(r => r.itemId)]),
    lastMoney: lastMoney.map(moneyMove),
    requests,
  };
}

/**
 * Journal des objets ou de l'or, le plus récent d'abord, par pages de `limit` lignes exactement. Le journal du jeu n'est daté
 * qu'à l'heure près, beaucoup de lignes ont la même date : la page suivante reprend après la dernière ligne reçue, repérée par
 * sa date et son identifiant (`before`, `beforeId`) ; sans `beforeId`, `before` est exclusif.
 */
export async function bankLog(db: Db, groupId: string, q: { kind: "items" | "money"; before?: Date; beforeId?: number; limit: number }): Promise<GuildBankLogResponse> {
  const base = and(eq(guildBankLog.groupId, groupId), eq(guildBankLog.kind, q.kind === "items" ? "item" : "money"));
  const after = !q.before ? undefined
    : q.beforeId === undefined ? lt(guildBankLog.at, q.before)
      : or(lt(guildBankLog.at, q.before), and(eq(guildBankLog.at, q.before), lt(guildBankLog.id, q.beforeId)));
  const rows = await db.select().from(guildBankLog).where(after ? and(base, after) : base)
    .orderBy(desc(guildBankLog.at), desc(guildBankLog.id)).limit(q.limit + 1);
  const page = rows.slice(0, q.limit), more = rows.length > q.limit;
  return q.kind === "items"
    ? { moves: page.map(itemMove), money: [], objects: await itemsById(db, page.flatMap(r => (r.itemId ? [r.itemId] : []))), more }
    : { moves: [], money: page.map(moneyMove), objects: {}, more };
}
