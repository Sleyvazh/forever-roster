import { and, asc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { characterRecipes, characters, craftOrders, discordDeletions, gameItems, gameRecipes, groupMembers, groups, users, type OrderReagent } from "../db/schema";
import { currentLines } from "./professions";

/** Commandes d'artisanat (lot F) : artisans d'une recette, composants, et vue du message Discord. */

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;
export interface Crafter { characterId: string; name: string; owner: string; userId: string }

/** Persos des membres du groupe qui connaissent ces recettes (métier actuel seulement), par recette. */
export async function craftersOf(db: Tx, groupId: string, spellIds: number[]) {
  const out = new Map<number, Crafter[]>();
  if (!spellIds.length) return out;
  const rows = await db.select({
    spellId: characterRecipes.spellId, skillLine: gameRecipes.skillLine, characterId: characters.id, name: characters.name,
    professions: characters.professions, owner: users.displayName, userId: users.id,
  }).from(characterRecipes)
    .innerJoin(characters, eq(characters.id, characterRecipes.characterId))
    .innerJoin(groupMembers, and(eq(groupMembers.userId, characters.userId), eq(groupMembers.groupId, groupId)))
    .innerJoin(users, eq(users.id, characters.userId))
    .innerJoin(gameRecipes, eq(gameRecipes.spellId, characterRecipes.spellId))
    .where(and(inArray(characterRecipes.spellId, spellIds), eq(characterRecipes.status, "known")))
    .orderBy(asc(characters.name));
  for (const r of rows) {
    if (!currentLines(r.professions).has(r.skillLine)) continue;
    out.set(r.spellId, [...(out.get(r.spellId) ?? []), { characterId: r.characterId, name: r.name, owner: r.owner, userId: r.userId }]);
  }
  return out;
}

/** Composants de la recette pour la quantité demandée (noms recopiés : les tables du jeu sont réimportées). */
export async function reagentsFor(db: Tx, reagents: { id: number; n: number }[], quantity: number, provided: number[] = []): Promise<OrderReagent[]> {
  if (!reagents.length) return [];
  const names = new Map((await db.select({ id: gameItems.id, name: gameItems.name }).from(gameItems).where(inArray(gameItems.id, reagents.map(r => r.id)))).map(i => [i.id, i.name]));
  return reagents.map(r => ({ itemId: r.id, name: names.get(r.id) ?? `Objet ${r.id}`, n: r.n * quantity, provided: provided.includes(r.id) }));
}

/** Le message Discord de la commande est à republier. */
export const touchOrder = () => ({ discordChangedAt: new Date() });

/** Ce qu'il faut au bot pour dessiner le message d'une commande. */
export async function orderDiscordView(db: Tx, origin: string, orderId: string) {
  const [r] = await db.select({ o: craftOrders, group: groups, requester: users.displayName, quality: gameItems.quality, character: characters.name })
    .from(craftOrders).innerJoin(groups, eq(groups.id, craftOrders.groupId)).innerJoin(users, eq(users.id, craftOrders.requesterId))
    .leftJoin(gameItems, eq(gameItems.id, craftOrders.itemId)).leftJoin(characters, eq(characters.id, craftOrders.characterId))
    .where(eq(craftOrders.id, orderId));
  if (!r || !r.group.ordersChannelId) return null;
  const { o } = r;
  const [taker] = o.takerId ? await db.select({ name: users.displayName }).from(users).where(eq(users.id, o.takerId)) : [];
  const crafters = (await craftersOf(db, o.groupId, [o.spellId])).get(o.spellId) ?? [];
  return {
    id: o.id, group: { id: r.group.id, name: r.group.name }, channelId: r.group.ordersChannelId,
    messageId: o.discordChannelId === r.group.ordersChannelId ? o.discordMessageId : null, changedAt: o.discordChangedAt,
    url: `${origin}/groups/${o.groupId}/artisans`,
    item: o.itemId ? { id: o.itemId, name: o.itemName ?? o.recipeName, quality: r.quality ?? 1 } : null, recipeName: o.recipeName,
    quantity: o.quantity, requester: r.requester, character: r.character, crafters: crafters.map(c => c.name),
    status: o.status, taker: taker?.name ?? null, reagents: o.reagents.map(x => ({ name: x.name, n: x.n, provided: x.provided })), note: o.note,
  };
}

/** Salon des commandes délié ou changé : les messages restés dans l'ancien salon sont supprimés par le bot. */
export async function retireOrderMessages(db: Tx, groupId: string, keepChannelId?: string) {
  const rows = await db.select({ id: craftOrders.id, channelId: craftOrders.discordChannelId, messageId: craftOrders.discordMessageId }).from(craftOrders)
    .where(and(eq(craftOrders.groupId, groupId), isNotNull(craftOrders.discordMessageId), isNotNull(craftOrders.discordChannelId),
      keepChannelId ? ne(craftOrders.discordChannelId, keepChannelId) : undefined));
  if (!rows.length) return;
  await db.insert(discordDeletions).values(rows.map(r => ({ channelId: r.channelId!, messageId: r.messageId! })));
  await db.update(craftOrders).set({ discordChannelId: null, discordMessageId: null, discordSyncedAt: null, discordChangedAt: new Date() })
    .where(inArray(craftOrders.id, rows.map(r => r.id)));
}
