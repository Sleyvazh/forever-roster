import { groupAddonExport, type GroupExportPattern } from "@forever/game-data";
import { and, asc, eq, gte, isNull, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { characterRecipes, characters, gameRecipes, groupMembers, groups, raids, raidSignups } from "../db/schema";
import { membership } from "../lib/groups";
import { notFound, parse } from "../lib/http";
import { currentLines } from "../lib/professions";
import { currentUser, requireAuth } from "../lib/session";

/** Raids envoyés à l'addon : à venir (ou commencés depuis moins de 3 h), puis ceux sans date. */
const MAX_RAIDS = 15;
const RECENT_MS = 3 * 3600_000;

/**
 * Données d'un groupe pour l'addon (format FRG v1, docs/addon-format.md) : raids à venir avec mon inscription,
 * et patrons recherchés ou connus par les persos du groupe, indexés par l'objet « Patron » des sacs.
 */
export async function addonRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  app.get("/:id/addon-export", async (req) => {
    const u = currentUser(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await membership(db, id, u.id);
    const [g] = await db.select({ id: groups.id, name: groups.name }).from(groups).where(eq(groups.id, id));
    if (!g) throw notFound("Groupe introuvable.");

    const now = Date.now();
    const raidRows = await db.select({ id: raids.id, name: raids.name, scheduledAt: raids.scheduledAt }).from(raids)
      .where(and(eq(raids.groupId, id), or(gte(raids.scheduledAt, new Date(now - RECENT_MS)), isNull(raids.scheduledAt))))
      .orderBy(asc(raids.scheduledAt), asc(raids.name)).limit(MAX_RAIDS);
    const mine = await db.select({ raidId: raidSignups.raidId, status: raidSignups.status, character: characters.name })
      .from(raidSignups).leftJoin(characters, eq(characters.id, raidSignups.characterId))
      .where(eq(raidSignups.userId, u.id));
    const myByRaid = new Map(mine.map(m => [m.raidId, m]));

    const recipeRows = await db.select({
      status: characterRecipes.status, character: characters.name, professions: characters.professions,
      skillLine: gameRecipes.skillLine, recipe: gameRecipes.name, taughtBy: gameRecipes.taughtBy,
    }).from(characterRecipes)
      .innerJoin(characters, eq(characters.id, characterRecipes.characterId))
      .innerJoin(groupMembers, and(eq(groupMembers.userId, characters.userId), eq(groupMembers.groupId, id)))
      .innerJoin(gameRecipes, eq(gameRecipes.spellId, characterRecipes.spellId))
      .limit(5000);
    const byItem = new Map<number, GroupExportPattern>();
    for (const r of recipeRows) {
      // Comme l'onglet Artisans : seulement les métiers actuels du perso
      if (!currentLines(r.professions).has(r.skillLine)) continue;
      for (const itemId of r.taughtBy) {
        let p = byItem.get(itemId);
        if (!p) { p = { itemId, recipe: r.recipe, wanted: [], known: [] }; byItem.set(itemId, p); }
        p[r.status].push(r.character);
      }
    }

    const text = groupAddonExport(g, Math.floor(now / 1000),
      raidRows.map(r => {
        const m = myByRaid.get(r.id);
        return { id: r.id, name: r.name, at: r.scheduledAt ? Math.floor(r.scheduledAt.getTime() / 1000) : 0, status: m?.status ?? null, character: m?.character ?? null };
      }),
      [...byItem.values()].sort((a, b) => a.recipe.localeCompare(b.recipe)));
    return { text, raids: raidRows.length, patterns: byItem.size };
  });
}
