import { nameKey, type GuildBankExport, type GuildBankLogResponse, type GuildBankMove, type GuildBankMoneyMove, type GuildBankResponse, type GuildBankTab } from "@forever/game-data";
import { and, desc, eq, gt, gte, lt, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { guildBank, guildBankLog, guildBankTabs } from "../db/schema";
import { itemsById } from "../routes/gamedata";

/**
 * Banque de la guilde du jeu (lignes B, T, I, X, O du relevé FRL, lot « Banque »), appliquée dans la transaction du relevé
 * de guilde (guild-import.ts). Règles (spec du 31/10) :
 * - tout membre peut envoyer le relevé ; le plus récent (heure de la ligne B) l'emporte pour l'or et les noms d'onglets ;
 * - chaque onglet garde son dernier relevé lu : un onglet que l'envoyeur ne voit pas (0;0) ou pas encore lu (1;0) garde
 *   le contenu d'avant, et un relevé plus ancien apporte un onglet que le site n'avait jamais lu ;
 * - journaux dédoublonnés comme le journal de guilde (« il y a N heures », marge de 2 h), gardés 12 mois (purges) ;
 * - le relevé ne borne pas les nombres : ici, une date impossible ou d'avant 2000 saute la ligne, un entier trop grand pour
 *   la base saute la case ou la ligne (objet) ou n'est pas gardé (quantité, montant, or).
 */

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;
type LogRow = typeof guildBankLog.$inferInsert;
type KeyRow = Pick<typeof guildBankLog.$inferSelect, "kind" | "tab" | "type" | "who" | "itemId" | "count" | "tab1" | "tab2" | "amount">;

export interface BankApplySummary { bank: "applied" | "older" | null; tabs: number; moves: number }

const HOUR = 3600e3;
/** Deux lectures de la même ligne de journal (« il y a N heures ») diffèrent de moins d'une heure ; marge de 2 h. */
const LOG_TOLERANCE = 2 * HOUR;
/** Plus grand entier d'une colonne integer. */
const INT4_MAX = 2147483647;
/** Une ligne de journal plus ancienne que ça vient d'un « il y a » démesuré : sautée. */
const EARLIEST_LOG = Date.UTC(2000, 0, 1);
/** Montant ou or : un entier que JavaScript garde exactement, sinon rien. */
const safe = (n: number | null) => (n !== null && Number.isSafeInteger(n) ? n : null);
/** Quantité : un entier de la colonne integer, sinon rien. */
const int4 = (n: number | null) => (n !== null && Number.isSafeInteger(n) && n <= INT4_MAX ? n : null);

/** Clé d'une ligne de journal : deux lectures de la même ligne ont la même clé (objets : onglet, objet, quantité, onglets ; or : montant). */
const logKey = (r: KeyRow) => (r.kind === "item"
  ? ["item", r.tab, r.type, nameKey(r.who), r.itemId, r.count, r.tab1, r.tab2]
  : ["money", r.type, nameKey(r.who), r.amount]).map(v => v ?? "").join("|");

/**
 * Lignes reçues rapprochées des lignes déjà gardées (même clé, à 2 h près, la plus proche, chacune ne sert qu'une fois) :
 * `fresh` les lignes à ajouter, `earlier` les lignes gardées à reculer (la lecture la plus proche de l'événement est la plus
 * ancienne : « il y a » est arrondi en dessous). Même règle que le journal de guilde (guild-import.ts, étape 2).
 */
export function matchBankLog<I extends { key: string; at: Date }>(incoming: readonly I[], stored: readonly { id: number; key: string; at: Date }[]) {
  const byKey = new Map<string, { id: number; at: Date }[]>();
  for (const s of stored) byKey.set(s.key, [...(byKey.get(s.key) ?? []), s]);
  const used = new Set<number>();
  const fresh: I[] = [], earlier: { id: number; at: Date }[] = [];
  for (const e of [...incoming].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    let best: { id: number; at: Date } | null = null;
    for (const s of byKey.get(e.key) ?? []) {
      if (used.has(s.id)) continue;
      const d = Math.abs(s.at.getTime() - e.at.getTime());
      if (d <= LOG_TOLERANCE && (!best || d < Math.abs(best.at.getTime() - e.at.getTime()))) best = s;
    }
    if (!best) { fresh.push(e); continue; }
    used.add(best.id);
    if (e.at.getTime() < best.at.getTime()) earlier.push({ id: best.id, at: e.at });
  }
  return { fresh, earlier };
}

/** Applique la banque d'un relevé (dans la transaction du relevé de guilde). */
export async function applyBank(tx: Tx, groupId: string, b: GuildBankExport, o: { when: (unix: number) => Date; sentBy: string | null }): Promise<BankApplySummary> {
  const at = o.when(b.at);
  const sum: BankApplySummary = { bank: null, tabs: 0, moves: 0 };
  const [row] = await tx.select().from(guildBank).where(eq(guildBank.groupId, groupId));
  const stored = new Map((await tx.select().from(guildBankTabs).where(eq(guildBankTabs.groupId, groupId))).map(t => [t.tab, t]));

  // Relevé le plus récent : le nombre d'onglets et leurs noms le suivent
  const newest = !row || at.getTime() > row.at.getTime();
  const ntabs = newest ? b.ntabs : row!.tabs;

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
  if (newest && [...stored.keys()].some(t => t > ntabs)) await tx.delete(guildBankTabs).where(and(eq(guildBankTabs.groupId, groupId), gt(guildBankTabs.tab, ntabs)));

  // Or : le relevé le plus récent qui le donne
  const money = safe(b.money);
  const moneyNew = money !== null && (!row?.moneyAt || at.getTime() > row.moneyAt.getTime());
  if (!row) await tx.insert(guildBank).values({ groupId, at, by: b.by, money: moneyNew ? money : null, moneyAt: moneyNew ? at : null, tabs: ntabs, sentBy: o.sentBy });
  else if (newest || moneyNew) {
    await tx.update(guildBank).set({
      ...(newest && { at, by: b.by, tabs: ntabs, sentBy: o.sentBy }), ...(moneyNew && { money, moneyAt: at }), updatedAt: sql`now()`,
    }).where(eq(guildBank.groupId, groupId));
  }
  sum.bank = newest || sum.tabs > 0 || moneyNew ? "applied" : "older";

  // Journaux des objets et de l'or
  const incoming: (LogRow & { key: string })[] = [];
  const add = (r: KeyRow, hoursAgo: number) => {
    const date = new Date(at.getTime() - hoursAgo * HOUR);
    if (!(date.getTime() >= EARLIEST_LOG)) return; // date impossible (NaN) ou d'avant 2000
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
      eq(guildBankLog.groupId, groupId), gte(guildBankLog.at, new Date(Math.min(...times) - LOG_TOLERANCE)), lte(guildBankLog.at, new Date(Math.max(...times) + LOG_TOLERANCE)),
    ));
    const { fresh, earlier } = matchBankLog(incoming, known.map(s => ({ id: s.id, key: logKey(s), at: s.at })));
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

/** Banque de la guilde : onglets de 1 à `tabs` (un onglet sans ligne est « jamais relevé »), objets du catalogue, deux derniers mouvements d'or. */
export async function bankView(db: Db, groupId: string, linked: boolean): Promise<GuildBankResponse> {
  const none: GuildBankResponse = { linked, bank: null, objects: {}, lastMoney: [] };
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
  return {
    linked: true,
    bank: { at: row.at.toISOString(), by: row.by, money: row.money, moneyAt: row.moneyAt?.toISOString() ?? null, tabs },
    objects: await itemsById(db, tabs.flatMap(t => t.slots.map(s => s.id))),
    lastMoney: lastMoney.map(moneyMove),
  };
}

/**
 * Journal des objets ou de l'or, le plus récent d'abord. `before` est exclusif et le journal du jeu n'est daté qu'à l'heure
 * près : une page qui s'arrêterait au milieu d'une heure perdrait le reste de l'heure, elle la finit (plus de `limit` lignes).
 */
export async function bankLog(db: Db, groupId: string, q: { kind: "items" | "money"; before?: Date; limit: number }): Promise<GuildBankLogResponse> {
  const base = and(eq(guildBankLog.groupId, groupId), eq(guildBankLog.kind, q.kind === "items" ? "item" : "money"));
  const rows = await db.select().from(guildBankLog).where(q.before ? and(base, lt(guildBankLog.at, q.before)) : base)
    .orderBy(desc(guildBankLog.at), desc(guildBankLog.id)).limit(q.limit + 1);
  let page = rows.slice(0, q.limit), more = rows.length > q.limit;
  const last = page.at(-1);
  if (more && last && rows[q.limit]!.at.getTime() === last.at.getTime()) {
    const rest = await db.select().from(guildBankLog).where(and(base, eq(guildBankLog.at, last.at), lt(guildBankLog.id, last.id))).orderBy(desc(guildBankLog.id));
    page = [...page, ...rest];
    more = (await db.select({ id: guildBankLog.id }).from(guildBankLog).where(and(base, lt(guildBankLog.at, last.at))).limit(1)).length > 0;
  }
  return q.kind === "items"
    ? { moves: page.map(itemMove), money: [], objects: await itemsById(db, page.flatMap(r => (r.itemId ? [r.itemId] : []))), more }
    : { moves: [], money: page.map(moneyMove), objects: {}, more };
}
