import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { groupMembers } from "../db/schema";
import { forbidden, notFound } from "./http";

export type GroupRole = "owner" | "officer" | "member";
const RANK: Record<GroupRole, number> = { member: 0, officer: 1, owner: 2 };

/** Renvoie le rôle du membre ; 404 si l'utilisateur n'en fait pas partie (on ne révèle pas l'existence du groupe). */
export async function membership(db: Db, groupId: string, userId: string): Promise<GroupRole> {
  const [m] = await db.select({ role: groupMembers.role }).from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  if (!m) throw notFound("Groupe introuvable.");
  return m.role;
}

export async function requireRole(db: Db, groupId: string, userId: string, min: GroupRole): Promise<GroupRole> {
  const role = await membership(db, groupId, userId);
  if (RANK[role] < RANK[min]) throw forbidden(min === "owner" ? "Réservé au propriétaire du groupe." : "Réservé aux officiers du groupe.");
  return role;
}

export const outranks = (a: GroupRole, b: GroupRole) => RANK[a] > RANK[b];
