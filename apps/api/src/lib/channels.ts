import { channelNameFor, GAME_TIMEZONE } from "@forever/game-data";
import { and, asc, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { discordDeletions, groups, raids, raidTemplates } from "../db/schema";

/**
 * Salons Discord des raids : celui du groupe, ou celui d'un raid récurrent qui a son propre salon
 * (renommé chaque semaine avec la date du raid courant, ex. jeudi-15-10).
 */

/** Les salons qu'un officier peut lier : celui du groupe (raids), celui des commandes d'artisanat, celui d'un raid récurrent. */
export const LINKED_KINDS = ["group", "orders", "template"] as const;
export type LinkedKind = (typeof LINKED_KINDS)[number];

/** Une annonce reste synchronisée (et un raid reste « courant » dans le salon de son raid récurrent) jusqu'à 12 h après l'heure du raid. */
export const KEEP_AFTER_MS = 12 * 3600e3;

/** Jointure gauche d'un raid vers son raid récurrent (à utiliser avec EFFECTIVE_CHANNEL). */
export const TEMPLATE_OF_RAID = eq(raidTemplates.id, raids.templateId);

/**
 * Salon effectif d'un raid : celui de son raid récurrent s'il en a un, sinon celui du groupe (null : aucun).
 * Pour une requête sur `raids` jointe à `groups` et, à gauche, à `raid_templates` (TEMPLATE_OF_RAID).
 */
export const EFFECTIVE_CHANNEL = sql<string | null>`coalesce(${raidTemplates.discordChannelId}, ${groups.discordChannelId})`;

/** Met en file de suppression des annonces publiées (le bot les efface) et vide les champs Discord de leurs raids. */
export async function queueDeletions(db: Db, rows: { id: string; channelId: string | null; messageId: string | null }[]) {
  const done = rows.filter(r => r.channelId && r.messageId);
  if (!done.length) return 0;
  await db.insert(discordDeletions).values(done.map(r => ({ channelId: r.channelId!, messageId: r.messageId! })));
  await db.update(raids).set({ discordChannelId: null, discordMessageId: null, discordSyncedAt: null }).where(inArray(raids.id, done.map(r => r.id)));
  return done.length;
}

/**
 * Dans le salon d'un raid récurrent, l'annonce d'un raid qui n'est plus courant (passé depuis plus de 12 h) est effacée :
 * le salon ne garde que le raid courant et les suivants. Le salon du groupe n'est pas concerné.
 */
export async function retirePastTemplateAnnouncements(db: Db, cutoff: Date) {
  const rows = await db.select({ id: raids.id, channelId: raids.discordChannelId, messageId: raids.discordMessageId }).from(raids)
    .innerJoin(raidTemplates, eq(raidTemplates.id, raids.templateId))
    .where(and(isNotNull(raids.discordMessageId), eq(raids.discordChannelId, raidTemplates.discordChannelId), lte(raids.scheduledAt, cutoff)))
    .limit(50);
  return queueDeletions(db, rows);
}

/**
 * Nom attendu de chaque salon de raid récurrent à renommer (raid récurrent actif, salon lié, renommage activé) :
 * date du raid courant = premier raid de ce raid récurrent dont l'heure est après « maintenant − 12 h ».
 * Sans raid courant, pas d'entrée (le salon garde son nom).
 */
export async function channelNames(db: Db, opts: { now?: Date; templateId?: string; timeZone?: string } = {}) {
  const now = opts.now ?? new Date();
  const rows = await db.selectDistinctOn([raidTemplates.id], {
    templateId: raidTemplates.id, guildId: raidTemplates.discordGuildId, channelId: raidTemplates.discordChannelId, scheduledAt: raids.scheduledAt,
  }).from(raidTemplates).innerJoin(raids, eq(raids.templateId, raidTemplates.id))
    .where(and(eq(raidTemplates.active, true), eq(raidTemplates.discordRename, true), isNotNull(raidTemplates.discordChannelId),
      gt(raids.scheduledAt, new Date(now.getTime() - KEEP_AFTER_MS)), opts.templateId ? eq(raidTemplates.id, opts.templateId) : undefined))
    .orderBy(raidTemplates.id, asc(raids.scheduledAt));
  return rows.map(r => ({ templateId: r.templateId, guildId: r.guildId!, channelId: r.channelId!, name: channelNameFor(r.scheduledAt!, opts.timeZone ?? GAME_TIMEZONE) }));
}
