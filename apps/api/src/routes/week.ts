import { roleOf, type SignupStatus } from "@forever/game-data";
import { and, asc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { characters, groupCharacters, groupMembers, groups, raids, raidSignups } from "../db/schema";
import { currentUser, requireAuth } from "../lib/session";
import { siteOf } from "../lib/site";

/** Fenêtre de « Cette semaine » : raids commencés depuis moins de 3 h, jusqu'à 7 jours. */
const RECENT_MS = 3 * 3600_000;
const WEEK_MS = 7 * 86400_000;
/** Une fiche synchronisée par l'addon est « à resynchroniser » au-delà d'une semaine. */
const STALE_MS = 7 * 86400_000;
const MAX_RAIDS = 20;

const COMING: SignupStatus[] = ["present", "late"];

/**
 * « Cette semaine » (bandeau en haut de Mes persos) : raids à venir de mes groupes avec mon inscription,
 * choses à faire (raid sans réponse, fiche à resynchroniser, perso sans classe ou spé) et étapes de démarrage.
 */
export async function weekRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  app.get("/", async (req) => {
    const u = currentUser(req);
    const now = Date.now();
    const game = siteOf(app.ctx.cfg, req).game; // groupes et persos du jeu de cette adresse

    const myGroups = await db.select({ id: groups.id, name: groups.name })
      .from(groupMembers).innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(and(eq(groupMembers.userId, u.id), eq(groups.game, game))).orderBy(asc(groups.name));
    const groupName = new Map(myGroups.map(g => [g.id, g.name]));

    const raidRows = myGroups.length ? await db.select({ id: raids.id, groupId: raids.groupId, name: raids.name, scheduledAt: raids.scheduledAt })
      .from(raids)
      .where(and(inArray(raids.groupId, myGroups.map(g => g.id)), isNotNull(raids.scheduledAt),
        gte(raids.scheduledAt, new Date(now - RECENT_MS)), lte(raids.scheduledAt, new Date(now + WEEK_MS))))
      .orderBy(asc(raids.scheduledAt), asc(raids.name)).limit(MAX_RAIDS) : [];
    const ids = raidRows.map(r => r.id);

    const signupRows = ids.length ? await db.select({
      raidId: raidSignups.raidId, userId: raidSignups.userId, status: raidSignups.status, spec: raidSignups.spec,
      characterId: raidSignups.characterId, characterName: characters.name,
    }).from(raidSignups).leftJoin(characters, eq(characters.id, raidSignups.characterId))
      .where(inArray(raidSignups.raidId, ids)) : [];

    // Mes persos dans chaque groupe : le main sert de choix par défaut pour s'inscrire
    const mineHere = myGroups.length ? await db.select({ groupId: groupCharacters.groupId, characterId: groupCharacters.characterId, isMain: groupCharacters.isMain })
      .from(groupCharacters).where(eq(groupCharacters.userId, u.id)) : [];
    const mainOf = new Map(mineHere.filter(x => x.isMain).map(x => [x.groupId, x.characterId]));

    const weekRaids = raidRows.map(r => {
      const rows = signupRows.filter(s => s.raidId === r.id);
      const coming = rows.filter(s => COMING.includes(s.status));
      const role = (x: string) => coming.filter(s => roleOf(s.spec) === x).length;
      const mine = rows.find(s => s.userId === u.id);
      return {
        id: r.id, groupId: r.groupId, groupName: groupName.get(r.groupId) ?? "", name: r.name, scheduledAt: r.scheduledAt,
        counts: { coming: coming.length, tank: role("Tank"), heal: role("Heal"), dps: coming.filter(s => !s.spec || roleOf(s.spec) === "DPS").length,
          tentative: rows.filter(s => s.status === "tentative").length },
        mine: mine ? { status: mine.status, characterId: mine.characterId, characterName: mine.characterName } : null,
        mainId: mainOf.get(r.groupId) ?? null,
      };
    });

    const chars = await db.select({ id: characters.id, name: characters.name, cls: characters.cls, spec1: characters.spec1, addonSyncedAt: characters.addonSyncedAt })
      .from(characters).where(and(eq(characters.userId, u.id), eq(characters.game, game))).orderBy(asc(characters.sortOrder), asc(characters.createdAt));

    type Todo =
      | { kind: "signup"; raidId: string; groupId: string; name: string; groupName: string; scheduledAt: Date | null }
      | { kind: "sync"; characterId: string; name: string; days: number }
      | { kind: "incomplete"; characterId: string; name: string; missing: "classe" | "spé" }
      | { kind: "assign"; groupId: string; groupName: string };
    const todo: Todo[] = [];
    for (const r of weekRaids) {
      if (!r.mine && r.scheduledAt && r.scheduledAt.getTime() > now) todo.push({ kind: "signup", raidId: r.id, groupId: r.groupId, name: r.name, groupName: r.groupName, scheduledAt: r.scheduledAt });
    }
    // Groupe où je ne joue encore aucun perso (seulement si j'en ai un)
    if (chars.length) {
      for (const g of myGroups) if (!mineHere.some(x => x.groupId === g.id)) todo.push({ kind: "assign", groupId: g.id, groupName: g.name });
    }
    for (const c of chars) {
      if (!c.cls || !c.spec1) todo.push({ kind: "incomplete", characterId: c.id, name: c.name, missing: c.cls ? "spé" : "classe" });
      // Seulement les fiches déjà synchronisées une fois : sans addon, on ne réclame rien
      else if (c.addonSyncedAt && now - c.addonSyncedAt.getTime() > STALE_MS) {
        todo.push({ kind: "sync", characterId: c.id, name: c.name, days: Math.floor((now - c.addonSyncedAt.getTime()) / 86400_000) });
      }
    }

    return {
      raids: weekRaids,
      todo,
      steps: { character: chars.length > 0, group: myGroups.length > 0, addon: chars.some(c => !!c.addonSyncedAt) },
    };
  });
}
