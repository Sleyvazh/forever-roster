import { roleOf } from "@forever/game-data";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { characters, groupCharacters, groupMembers, groups, raidAsks, raidSignups, users } from "../db/schema";

/**
 * Joindre les joueurs d'un raid (lot D2) : relance des membres sans réponse, et « Demander à X » depuis la compo
 * assistée. Le bot n'écrit qu'aux joueurs qui ont lié leur Discord et gardé les MP du bot (Compte & sécurité).
 */

export const NUDGE_HOURS = [24, 48, 72] as const;
export type NudgeHours = (typeof NUDGE_HOURS)[number];
/** Relance à la main : une par heure au plus et par raid. */
export const MANUAL_NUDGE_MS = 3600e3;
/** Pas de relance automatique pour un raid créé il y a moins de 2 h (le temps que les joueurs voient l'annonce). */
export const NUDGE_GRACE_MS = 2 * 3600e3;
/** Demandes « Demander à X » par raid. */
export const MAX_ASKS_PER_RAID = 40;

export interface NudgeSettings { hours: NudgeHours | null; officers: boolean }

export async function groupNudgeSettings(db: Db, groupId: string): Promise<NudgeSettings> {
  const [g] = await db.select({ hours: groups.nudgeHours, officers: groups.nudgeOfficers }).from(groups).where(eq(groups.id, groupId));
  return { hours: (g?.hours ?? null) as NudgeHours | null, officers: g?.officers ?? true };
}

/** Le bot peut écrire à ce joueur : Discord lié, MP du bot gardés. */
export const canDm = (u: { discordId: string | null; reminders: boolean }) => !!u.discordId && u.reminders;

/** Membres du groupe sans aucune réponse au raid, avec leur main dans le groupe (s'ils en ont un). */
export async function pendingMembers(db: Db, groupId: string, raidId: string) {
  const rows = await db.select({
    userId: users.id, displayName: users.displayName, role: groupMembers.role, discordId: users.discordId, reminders: users.discordReminders,
  }).from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .leftJoin(raidSignups, and(eq(raidSignups.raidId, raidId), eq(raidSignups.userId, groupMembers.userId)))
    .where(and(eq(groupMembers.groupId, groupId), isNull(raidSignups.id)))
    .orderBy(asc(users.displayName));
  if (!rows.length) return [];
  const mains = await db.select({ userId: groupCharacters.userId, name: characters.name, cls: characters.cls, spec1: characters.spec1 })
    .from(groupCharacters).innerJoin(characters, eq(characters.id, groupCharacters.characterId))
    .where(and(eq(groupCharacters.groupId, groupId), eq(groupCharacters.isMain, true), inArray(groupCharacters.userId, rows.map(r => r.userId))));
  const mainOf = new Map(mains.map(m => [m.userId, m]));
  return rows.map(r => ({ ...r, main: mainOf.get(r.userId) ?? null }));
}

export type AskState = "queued" | "sent" | "failed" | "yes" | "no";
export const askState = (a: { sentAt: Date | null; failed: boolean; answer: "yes" | "no" | null }): AskState =>
  a.answer ?? (a.failed ? "failed" : a.sentAt ? "sent" : "queued");

/** Demandes faites pour un raid (vue officiers). */
export async function raidAskList(db: Db, raidId: string) {
  const rows = await db.select({
    id: raidAsks.id, characterId: raidAsks.characterId, userId: raidAsks.userId, spec: raidAsks.spec, askedByName: raidAsks.askedByName,
    createdAt: raidAsks.createdAt, sentAt: raidAsks.sentAt, failed: raidAsks.failed, answer: raidAsks.answer, answeredAt: raidAsks.answeredAt,
    name: characters.name, cls: characters.cls, owner: users.displayName,
  }).from(raidAsks)
    .innerJoin(characters, eq(characters.id, raidAsks.characterId))
    .innerJoin(users, eq(users.id, raidAsks.userId))
    .where(eq(raidAsks.raidId, raidId)).orderBy(asc(raidAsks.createdAt));
  return rows.map(({ sentAt, failed, answer, ...a }) => ({ ...a, role: roleOf(a.spec), state: askState({ sentAt, failed, answer }) }));
}
