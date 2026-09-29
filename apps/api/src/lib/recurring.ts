import { GAME_TIMEZONE, weeklyOccurrences } from "@forever/game-data";
import { and, count, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { raids, raidTemplates } from "../db/schema";

export const MAX_RAIDS_PER_GROUP = 100;
export const MAX_TEMPLATES_PER_GROUP = 10;

/**
 * Crée les occurrences à venir des raids récurrents (tous, ou un seul modèle).
 * Idempotent : l'index unique (modèle, date) et `generatedUntil` empêchent les doublons,
 * et un raid supprimé à la main n'est pas recréé. Renvoie le nombre de raids créés.
 */
export async function ensureRecurringRaids(db: Db, now = new Date(), onlyTemplateId?: string, timeZone = GAME_TIMEZONE) {
  const templates = await db.select().from(raidTemplates)
    .where(onlyTemplateId ? and(eq(raidTemplates.active, true), eq(raidTemplates.id, onlyTemplateId)) : eq(raidTemplates.active, true));
  let created = 0;
  for (const t of templates) {
    const after = t.generatedUntil && t.generatedUntil > now ? t.generatedUntil : now;
    const until = new Date(now.getTime() + t.leadDays * 86400e3);
    const dates = weeklyOccurrences(t.weekday, t.time, after, until, timeZone);
    if (!dates.length) continue;
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(raids).where(eq(raids.groupId, t.groupId));
    const room = Math.max(0, MAX_RAIDS_PER_GROUP - n);
    const todo = dates.slice(0, room);
    if (!todo.length) continue;
    const rows = await db.insert(raids).values(todo.map(scheduledAt => ({
      groupId: t.groupId, name: t.name, description: t.description, scheduledAt, templateId: t.id, createdBy: t.createdBy,
    }))).onConflictDoNothing().returning({ id: raids.id });
    created += rows.length;
    await db.update(raidTemplates).set({ generatedUntil: todo.at(-1)! }).where(eq(raidTemplates.id, t.id));
  }
  return created;
}
