import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { groupMembers } from "../db/schema";

/** Un joueur voit ses propres données et celles des membres des groupes qu'il partage avec eux. */
export async function canSee(db: Db, viewerId: string, ownerId: string) {
  if (viewerId === ownerId) return true;
  const mine = db.select({ g: groupMembers.groupId }).from(groupMembers).where(eq(groupMembers.userId, viewerId));
  const rows = await db.select({ g: groupMembers.groupId }).from(groupMembers)
    .where(and(eq(groupMembers.userId, ownerId), inArray(groupMembers.groupId, mine))).limit(1);
  return rows.length > 0;
}
