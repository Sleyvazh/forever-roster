import { EMPTY_PREP, instanceKey, instanceOf, type RaidPrep } from "@forever/game-data";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { characters, groupCharacters, raids } from "../db/schema";

/**
 * Préparation d'un raid (lot G) : à la création, consommables, fiches de boss et conseil du butin sont repris du
 * dernier raid du groupe qui porte le même nom (« Molten Core » → « Molten Core »). Sinon l'instance est devinée
 * d'après le nom, pour proposer ses boss.
 */

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;

export async function inheritPrep(db: Tx, raidIds: string[]) {
  if (!raidIds.length) return;
  const created = await db.select({ id: raids.id, groupId: raids.groupId, name: raids.name, scheduledAt: raids.scheduledAt }).from(raids).where(inArray(raids.id, raidIds));
  for (const r of created) {
    const key = instanceKey(r.name);
    // Le plus récent avant celui-ci (date prévue, sinon création), parmi les raids du même nom qui ont une préparation
    const candidates = await db.select({ id: raids.id, name: raids.name, prep: raids.prep, council: raids.council }).from(raids)
      .where(and(eq(raids.groupId, r.groupId), ne(raids.id, r.id),
        sql`(jsonb_array_length(${raids.prep}->'consumables') > 0 or jsonb_array_length(${raids.prep}->'bosses') > 0 or ${raids.council} is not null)`))
      .orderBy(desc(sql`coalesce(${raids.scheduledAt}, ${raids.createdAt})`)).limit(200);
    const from = candidates.find(c => instanceKey(c.name) === key);
    const prep: RaidPrep = from ? from.prep : { ...EMPTY_PREP, instance: instanceOf(r.name) };
    await db.update(raids).set({ prep, council: from?.council ?? null }).where(eq(raids.id, r.id));
  }
}

/** Noms en jeu des persos du groupe, par identifiant (fiches de boss) et par compte (conseil). */
export async function groupNames(db: Tx, groupId: string) {
  const rows = await db.select({ id: characters.id, name: characters.name, userId: characters.userId }).from(groupCharacters)
    .innerJoin(characters, eq(characters.id, groupCharacters.characterId)).where(eq(groupCharacters.groupId, groupId));
  return { byId: new Map(rows.map(r => [r.id, r.name])), byUser: rows.reduce((m, r) => m.set(r.userId, [...(m.get(r.userId) ?? []), r.name]), new Map<string, string[]>()) };
}
