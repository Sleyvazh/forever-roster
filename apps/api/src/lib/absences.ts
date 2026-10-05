import { zonedParts } from "@forever/game-data";
import { and, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { absences, groupMembers, raids, raidSignups, users } from "../db/schema";
import { touchRaid } from "./signups";

/**
 * Absences déclarées (lot F) : une période (du … au …) ou des jours de la semaine (« jamais le vendredi »).
 * Les raids à venir de ces jours où le joueur n'a pas répondu passent en « Absent », dans tous ses groupes, y compris
 * les raids créés ensuite (raid ajouté, récurrent généré, date changée, groupe rejoint). Une réponse déjà donnée
 * n'est jamais remplacée. Les « Absent » posés ainsi portent une note reconnaissable : retirer l'absence les enlève.
 */

export const ABSENCE_NOTE = "Absence déclarée";
export const MAX_ABSENCES = 20;

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;
export interface AbsenceRule { startDate: string | null; endDate: string | null; weekdays: number[] }

/** Jour (« AAAA-MM-JJ ») et jour de la semaine (1 = lundi) d'un instant, à l'heure de Paris. */
export function parisDay(at: Date) {
  const z = zonedParts(at);
  return { day: `${z.year}-${String(z.month).padStart(2, "0")}-${String(z.day).padStart(2, "0")}`, weekday: z.weekday };
}
export const covers = (a: AbsenceRule, at: Date) => {
  const { day, weekday } = parisDay(at);
  return (!!a.startDate && !!a.endDate && a.startDate <= day && day <= a.endDate) || a.weekdays.includes(weekday);
};

/** « Absent » pour un raid où le joueur n'a pas répondu (une réponse existante n'est jamais touchée). */
async function markAbsent(db: Tx, raidId: string, user: { id: string; displayName: string }) {
  const rows = await db.insert(raidSignups)
    .values({ raidId, userId: user.id, displayName: user.displayName, status: "absent", note: ABSENCE_NOTE, updatedAt: new Date() })
    .onConflictDoNothing().returning({ id: raidSignups.id });
  return rows.length > 0;
}

/** Raids à venir des groupes du joueur. */
async function upcomingRaids(db: Tx, userId: string) {
  return db.select({ id: raids.id, at: raids.scheduledAt }).from(raids)
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, raids.groupId), eq(groupMembers.userId, userId)))
    .where(and(isNotNull(raids.scheduledAt), gt(raids.scheduledAt, new Date())));
}

/** Applique toutes les absences du joueur aux raids à venir de ses groupes. Renvoie le nombre de raids marqués. */
export async function applyUserAbsences(db: Db, userId: string, only?: AbsenceRule) {
  const [u] = await db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, userId));
  if (!u) return 0;
  const rules: AbsenceRule[] = only ? [only] : await db.select({ startDate: absences.startDate, endDate: absences.endDate, weekdays: absences.weekdays })
    .from(absences).where(eq(absences.userId, userId));
  if (!rules.length) return 0;
  let n = 0;
  for (const r of await upcomingRaids(db, userId)) {
    if (!rules.some(a => covers(a, r.at!))) continue;
    if (await markAbsent(db, r.id, u)) { n++; await touchRaid(db, r.id); }
  }
  return n;
}

/** Nouveau raid (ou date changée) : les membres absents ce jour-là, sans réponse, sont inscrits « Absent ». */
export async function applyAbsencesToRaid(db: Db, raidId: string) {
  const [r] = await db.select({ groupId: raids.groupId, at: raids.scheduledAt }).from(raids).where(and(eq(raids.id, raidId), isNotNull(raids.scheduledAt)));
  if (!r?.at || r.at.getTime() < Date.now()) return 0;
  const { day, weekday } = parisDay(r.at);
  const rows = await db.select({ id: users.id, displayName: users.displayName }).from(absences)
    .innerJoin(groupMembers, and(eq(groupMembers.userId, absences.userId), eq(groupMembers.groupId, r.groupId)))
    .innerJoin(users, eq(users.id, absences.userId))
    .where(or(
      and(sql`${absences.startDate} <= ${day}::date`, sql`${absences.endDate} >= ${day}::date`),
      sql`${absences.weekdays} @> ${JSON.stringify([weekday])}::jsonb`,
    ));
  let n = 0;
  for (const u of new Map(rows.map(x => [x.id, x])).values()) if (await markAbsent(db, raidId, u)) n++;
  if (n) await touchRaid(db, raidId);
  return n;
}

export async function applyAbsencesToRaids(db: Db, raidIds: string[]) {
  for (const id of raidIds) await applyAbsencesToRaid(db, id);
}

/** Absence retirée : enlève les « Absent » qu'elle avait posés (sauf si une autre absence couvre encore le raid). */
export async function removeAbsenceSignups(db: Db, userId: string, gone: AbsenceRule) {
  const rows = await db.select({ id: raidSignups.id, raidId: raidSignups.raidId, at: raids.scheduledAt }).from(raidSignups)
    .innerJoin(raids, eq(raids.id, raidSignups.raidId))
    .where(and(eq(raidSignups.userId, userId), eq(raidSignups.status, "absent"), eq(raidSignups.note, ABSENCE_NOTE),
      isNotNull(raids.scheduledAt), gt(raids.scheduledAt, new Date())));
  const left: AbsenceRule[] = await db.select({ startDate: absences.startDate, endDate: absences.endDate, weekdays: absences.weekdays }).from(absences).where(eq(absences.userId, userId));
  const drop = rows.filter(r => covers(gone, r.at!) && !left.some(a => covers(a, r.at!)));
  if (!drop.length) return 0;
  await db.delete(raidSignups).where(inArray(raidSignups.id, drop.map(r => r.id)));
  for (const raidId of new Set(drop.map(r => r.raidId))) await touchRaid(db, raidId);
  return drop.length;
}
