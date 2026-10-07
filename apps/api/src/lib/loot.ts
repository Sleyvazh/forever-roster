import { gameName, instanceKey, lootSettings, RETAIL_NO_SOFTRES, srPlusBonus, type Game, type LootMode, type LootSettings } from "@forever/game-data";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { characters, gameItems, groupCharacters, groups, lootCatalog, raidLogs, raids, softReserves, users, type RaidLogLoot } from "../db/schema";
import { badRequest } from "./http";

/** Butin des raids (lot C2) : réglages du groupe, soft reserve (avec SR+) et catalogue appris par les bilans. */

export async function groupLootSettings(db: Db, groupId: string): Promise<LootSettings> {
  const [g] = await db.select({ s: groups.lootSettings }).from(groups).where(eq(groups.id, groupId));
  return lootSettings(g?.s);
}

/**
 * Roster (lot R3b) : pas de soft reserve, le butin est en journal ou distribué par l'addon Roster (conseil).
 * Un raid ou un modèle déjà en soft reserve reste valable : seul un passage à la soft reserve est refusé.
 */
export function checkLootMode(game: Game, mode: LootMode | undefined, current?: LootMode) {
  if (game === "retail" && mode === "softres" && current !== "softres") throw badRequest(RETAIL_NO_SOFTRES);
}

/** Heure de fermeture des réservations (null : raid sans date, jamais fermé). */
export function srClosesAt(scheduledAt: Date | null, s: LootSettings) {
  return scheduledAt ? new Date(scheduledAt.getTime() - s.srCloseMinutes * 60_000) : null;
}

const key = (name: string) => gameName(name).toLowerCase();

/** Objets reçus par prénom en jeu dans le bilan d'un raid. */
function receivedBy(loot: RaidLogLoot[]) {
  const got = new Set<string>();
  for (const l of loot) got.add(`${key(l.name)}:${l.itemId}`);
  return got;
}

/**
 * Bonus SR+ des réservations d'un raid : raids précédents du groupe en soft reserve, même instance (nom du raid),
 * du plus récent au plus ancien ; chaque raid où le perso avait réservé l'objet sans le recevoir ajoute un pas.
 */
export async function srBonuses(db: Db, raid: { id: string; groupId: string; name: string; scheduledAt: Date | null }, reserves: { characterId: string; name: string; itemId: number }[], s: LootSettings) {
  const out = new Map<string, number>();
  if (!s.srPlus || !reserves.length || !raid.scheduledAt) return out;
  const prev = (await db.select({ id: raids.id, name: raids.name }).from(raids)
    .where(and(eq(raids.groupId, raid.groupId), eq(raids.lootMode, "softres"), lt(raids.scheduledAt, raid.scheduledAt)))
    .orderBy(desc(raids.scheduledAt)).limit(30))
    .filter(r => instanceKey(r.name) === instanceKey(raid.name)).slice(0, 10);
  if (!prev.length) return out;
  const ids = prev.map(r => r.id);
  const past = await db.select({ raidId: softReserves.raidId, characterId: softReserves.characterId, itemId: softReserves.itemId }).from(softReserves)
    .where(and(inArray(softReserves.raidId, ids), inArray(softReserves.characterId, reserves.map(r => r.characterId))));
  const reserved = new Set(past.map(p => `${p.raidId}:${p.characterId}:${p.itemId}`));
  const logs = new Map((await db.select({ raidId: raidLogs.raidId, loot: raidLogs.loot }).from(raidLogs).where(inArray(raidLogs.raidId, ids)))
    .map(l => [l.raidId, receivedBy(l.loot)]));
  for (const r of reserves) {
    const history = prev.map(p => ({
      reserved: reserved.has(`${p.id}:${r.characterId}:${r.itemId}`),
      received: logs.get(p.id)?.has(`${key(r.name)}:${r.itemId}`) ?? false,
    }));
    out.set(`${r.characterId}:${r.itemId}`, srPlusBonus(history, s.srPlusStep));
  }
  return out;
}

/** Réservations d'un raid, telles qu'un membre les voit (cachées jusqu'à la fermeture si l'organisateur l'a choisi). */
export async function softReserveView(db: Db, raid: typeof raids.$inferSelect, viewer: { id: string; officer: boolean }) {
  const s = await groupLootSettings(db, raid.groupId);
  const closesAt = srClosesAt(raid.scheduledAt, s);
  const open = !closesAt || closesAt.getTime() > Date.now();
  const rows = await db.select({
    characterId: softReserves.characterId, itemId: softReserves.itemId, userId: softReserves.userId, createdAt: softReserves.createdAt,
    name: characters.name, cls: characters.cls, owner: users.displayName, isMain: groupCharacters.isMain,
  }).from(softReserves)
    .innerJoin(characters, eq(characters.id, softReserves.characterId))
    .innerJoin(users, eq(users.id, softReserves.userId))
    .leftJoin(groupCharacters, and(eq(groupCharacters.characterId, softReserves.characterId), eq(groupCharacters.groupId, raid.groupId)))
    .where(eq(softReserves.raidId, raid.id))
    .orderBy(softReserves.createdAt);
  const hidden = raid.srHidden && open && !viewer.officer;
  const visible = hidden ? rows.filter(r => r.userId === viewer.id) : rows;
  const bonus = await srBonuses(db, raid, visible, s);
  const ids = [...new Set(visible.map(r => r.itemId))];
  const items = ids.length ? await db.select({ id: gameItems.id, name: gameItems.name, quality: gameItems.quality }).from(gameItems).where(inArray(gameItems.id, ids)) : [];
  const itemOf = new Map(items.map(i => [i.id, i]));
  const bossOf = new Map((ids.length ? await db.select({ itemId: lootCatalog.itemId, boss: lootCatalog.boss }).from(lootCatalog)
    .where(and(eq(lootCatalog.instance, instanceKey(raid.name)), inArray(lootCatalog.itemId, ids))) : []).map(b => [b.itemId, b.boss]));
  const byItem = new Map<number, typeof visible>();
  for (const r of visible) byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), r]);
  return {
    settings: { count: s.srCount, srPlus: s.srPlus, step: s.srPlusStep, mainsFirst: s.mainsFirst },
    closesAt, open, hidden, total: rows.length,
    items: [...byItem.entries()].map(([itemId, rs]) => ({
      item: itemOf.get(itemId) ?? { id: itemId, name: `Objet ${itemId}`, quality: 4 },
      boss: bossOf.get(itemId) ?? "",
      reservers: rs.map(r => ({
        characterId: r.characterId, name: r.name, cls: r.cls, owner: r.owner, isMain: !!r.isMain, mine: r.userId === viewer.id,
        bonus: bonus.get(`${r.characterId}:${itemId}`) ?? 0,
      })).sort((a, b) => (s.mainsFirst ? Number(b.isMain) - Number(a.isMain) : 0) || b.bonus - a.bonus),
    })).sort((a, b) => b.reservers.length - a.reservers.length || a.item.name.localeCompare(b.item.name)),
  };
}

/**
 * Apprend le butin d'un bilan : chaque objet vu, par instance et boss. `previous` : objets du bilan remplacé
 * (un nouveau collage du même raid ne compte pas deux fois les mêmes objets).
 */
export async function learnLoot(db: Db, instance: string, loot: RaidLogLoot[], previous: RaidLogLoot[] = []) {
  const inst = instanceKey(instance);
  if (!inst) return;
  const already = new Set(previous.map(l => `${l.boss}:${l.itemId}`));
  const fresh = new Map<string, { boss: string; itemId: number }>();
  for (const l of loot) {
    const k = `${l.boss}:${l.itemId}`;
    if (!already.has(k)) fresh.set(k, { boss: l.boss.slice(0, 60), itemId: l.itemId });
  }
  for (const f of fresh.values()) {
    await db.insert(lootCatalog).values({ instance: inst, boss: f.boss, itemId: f.itemId })
      .onConflictDoUpdate({ target: [lootCatalog.instance, lootCatalog.boss, lootCatalog.itemId], set: { seen: sql`${lootCatalog.seen} + 1`, lastSeenAt: new Date() } });
  }
}
