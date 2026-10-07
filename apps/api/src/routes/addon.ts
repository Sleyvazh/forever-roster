import { buildRRG, dpsType, groupAddonExport, IMPORT_PARTS, specDef, type Game, type GroupExportBis, type GroupExportPattern } from "@forever/game-data";
import { and, asc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client";
import { characterRecipes, characters, gameRecipes, groupCharacters, groupMembers, groups, raids, raidSignups, softReserves } from "../db/schema";
import { groupLootSettings, srBonuses } from "../lib/loot";
import { groupLootCounts } from "../lib/loot-count";
import { groupNames } from "../lib/prep";
import { membership } from "../lib/groups";
import { notFound, parse } from "../lib/http";
import { currentLines } from "../lib/professions";
import { currentUser, requireAuth } from "../lib/session";
import { otherSite, siteOf } from "../lib/site";
import { importAddonText } from "../lib/addon-import";

/** Raids envoyés à l'addon : à venir (ou commencés depuis moins de 3 h), puis ceux sans date. */
const MAX_RAIDS = 15;
const RECENT_MS = 3 * 3600_000;
const MAX_GROUPS = 10;

/**
 * Données d'un groupe pour l'addon (format FRG v1, docs/addon-format.md) : raids à venir avec mon inscription,
 * patrons recherchés ou connus par les persos du groupe (indexés par l'objet « Patron » des sacs),
 * et objets BiS que ces persos n'ont pas encore.
 */
export async function groupExport(db: Db, groupId: string, userId: string) {
  const [g] = await db.select({ id: groups.id, name: groups.name, game: groups.game }).from(groups).where(eq(groups.id, groupId));
  if (!g) throw notFound("Groupe introuvable.");
  // Roster (WoW Retail) : format RRG de l'addon Roster
  if (g.game === "retail") return rosterGroupExport(db, g, userId);

  const now = Date.now();
  const raidRows = await db.select({ id: raids.id, groupId: raids.groupId, name: raids.name, scheduledAt: raids.scheduledAt, lootMode: raids.lootMode, srHidden: raids.srHidden, prep: raids.prep, council: raids.council }).from(raids)
    .where(and(eq(raids.groupId, groupId), or(gte(raids.scheduledAt, new Date(now - RECENT_MS)), isNull(raids.scheduledAt))))
    .orderBy(asc(raids.scheduledAt), asc(raids.name)).limit(MAX_RAIDS);
  const mine = raidRows.length ? await db.select({ raidId: raidSignups.raidId, status: raidSignups.status, character: characters.name })
    .from(raidSignups).leftJoin(characters, eq(characters.id, raidSignups.characterId))
    .where(and(eq(raidSignups.userId, userId), inArray(raidSignups.raidId, raidRows.map(r => r.id)))) : [];
  const myByRaid = new Map(mine.map(m => [m.raidId, m]));

  const recipeRows = await db.select({
    status: characterRecipes.status, character: characters.name, professions: characters.professions,
    skillLine: gameRecipes.skillLine, recipe: gameRecipes.name, taughtBy: gameRecipes.taughtBy,
  }).from(characterRecipes)
    .innerJoin(characters, eq(characters.id, characterRecipes.characterId))
    .innerJoin(groupMembers, and(eq(groupMembers.userId, characters.userId), eq(groupMembers.groupId, groupId)))
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

  // BiS : objet choisi dans la base, pas encore obtenu ni porté
  // Persos joués dans le groupe (les patrons, eux, comptent tous les persos des membres, comme les Artisans)
  const gearRows = await db.select({ name: characters.name, gear: characters.gear }).from(characters)
    .innerJoin(groupCharacters, and(eq(groupCharacters.characterId, characters.id), eq(groupCharacters.groupId, groupId)));
  const bis = new Map<number, GroupExportBis>();
  for (const c of gearRows) {
    for (const e of Object.values(c.gear ?? {})) {
      if (!e?.bisId || e.got || e.curId === e.bisId) continue;
      let b = bis.get(e.bisId);
      if (!b) { b = { itemId: e.bisId, characters: [] }; bis.set(e.bisId, b); }
      b.characters.push(c.name);
    }
  }

  // Lot C2 : réservations des raids en soft reserve (avec SR+) et persos des officiers (membres du conseil en jeu)
  const settings = await groupLootSettings(db, groupId);
  const [me] = await db.select({ role: groupMembers.role }).from(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  const officer = !!me && me.role !== "member";
  const reservesOf = new Map<string, { itemId: number; by: { name: string; bonus: number }[] }[]>();
  for (const r of raidRows.filter(x => x.lootMode === "softres")) {
    // Réservations cachées : un membre ne reçoit que les siennes (comme sur le site)
    const rows = await db.select({ characterId: softReserves.characterId, itemId: softReserves.itemId, name: characters.name })
      .from(softReserves).innerJoin(characters, eq(characters.id, softReserves.characterId))
      .where(and(eq(softReserves.raidId, r.id), ...(r.srHidden && !officer ? [eq(characters.userId, userId)] : [])));
    const bonus = await srBonuses(db, r, rows, settings);
    const byItem2 = new Map<number, { name: string; bonus: number }[]>();
    for (const x of rows) byItem2.set(x.itemId, [...(byItem2.get(x.itemId) ?? []), { name: x.name, bonus: bonus.get(`${x.characterId}:${x.itemId}`) ?? 0 }]);
    reservesOf.set(r.id, [...byItem2.entries()].map(([itemId, by]) => ({ itemId, by })));
  }
  const council = (await db.select({ name: characters.name }).from(groupCharacters)
    .innerJoin(characters, eq(characters.id, groupCharacters.characterId))
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groupCharacters.groupId), eq(groupMembers.userId, groupCharacters.userId)))
    .where(and(eq(groupCharacters.groupId, groupId), inArray(groupMembers.role, ["owner", "officer"])))).map(c => c.name);

  // Lot G : consommables demandés, fiches de boss (noms en jeu) et conseil choisi pour le raid (persos de ses membres)
  const { byId, byUser } = await groupNames(db, groupId);
  const withCons = raidRows.filter(r => r.prep.consumables.length).map(r => r.id);
  const coming = withCons.length ? await db.select({ raidId: raidSignups.raidId, name: characters.name, cls: raidSignups.cls, spec: raidSignups.spec })
    .from(raidSignups).innerJoin(characters, eq(characters.id, raidSignups.characterId))
    .where(and(inArray(raidSignups.raidId, withCons), inArray(raidSignups.status, ["present", "late", "tentative"]))) : [];
  // Lot I : objets reçus sur la période (colonne du conseil du butin) ; par joueur, ses persos partagent le compte
  const counts = await groupLootCounts(db, groupId, settings);
  const byPlayer = new Map<string, typeof counts.rows>();
  for (const r of counts.rows) byPlayer.set(r.userId, [...(byPlayer.get(r.userId) ?? []), r]);
  const entries = settings.countBy === "player"
    ? [...byPlayer.values()].map(rs => ({ names: rs.sort((a, b) => Number(b.isMain) - Number(a.isMain)).map(r => r.name), n: rs[0]!.player }))
    : counts.rows.map(r => ({ names: [r.name], n: r.own }));
  const text = groupAddonExport(g, Math.floor(now / 1000),
    raidRows.map(r => {
      const m = myByRaid.get(r.id);
      return { id: r.id, name: r.name, at: r.scheduledAt ? Math.floor(r.scheduledAt.getTime() / 1000) : 0, status: m?.status ?? null, character: m?.character ?? null,
        lootMode: r.lootMode, reserves: reservesOf.get(r.id),
        consumables: r.prep.consumables,
        bosses: r.prep.bosses.map(b => ({ ...b, rows: b.rows.map(row => ({ label: row.label, text: row.text, names: row.characterIds.flatMap(id => byId.get(id) ?? []) })) })),
        council: r.lootMode === "council" && r.council ? r.council.flatMap(u => byUser.get(u) ?? []) : null,
        roster: coming.filter(c => c.raidId === r.id).map(c => ({ name: c.name, role: specDef(c.cls, c.spec)?.role ?? null, dps: dpsType(c.cls, c.spec) })) };
    }),
    [...byItem.values()].sort((a, b) => a.recipe.localeCompare(b.recipe)),
    [...bis.values()].sort((a, b) => a.itemId - b.itemId),
    council,
    { short: counts.summary.short, label: counts.summary.label, entries });
  return { text, name: g.name, raids: raidRows.length, patterns: byItem.size, bis: bis.size };
}

/**
 * Données d'un groupe de Roster pour l'addon Roster (format RRG v1, docs/addon-format.md) : raids à venir (mêmes raids
 * que FRG) avec leur difficulté et leur effectif, mon inscription et mon perso (« Prénom-Royaume »).
 */
async function rosterGroupExport(db: Db, g: { id: string; name: string }, userId: string) {
  const now = Date.now();
  const raidRows = await db.select({ id: raids.id, name: raids.name, scheduledAt: raids.scheduledAt, difficulty: raids.difficulty, size: raids.size, lootMode: raids.lootMode }).from(raids)
    .where(and(eq(raids.groupId, g.id), or(gte(raids.scheduledAt, new Date(now - RECENT_MS)), isNull(raids.scheduledAt))))
    .orderBy(asc(raids.scheduledAt), asc(raids.name)).limit(MAX_RAIDS);
  const mine = raidRows.length ? await db.select({ raidId: raidSignups.raidId, status: raidSignups.status, name: characters.name, realm: characters.realm })
    .from(raidSignups).leftJoin(characters, eq(characters.id, raidSignups.characterId))
    .where(and(eq(raidSignups.userId, userId), inArray(raidSignups.raidId, raidRows.map(r => r.id)))) : [];
  const myByRaid = new Map(mine.map(m => [m.raidId, m]));
  const text = buildRRG(g, Math.floor(now / 1000), raidRows.map(r => {
    const m = myByRaid.get(r.id);
    return { id: r.id, name: r.name, at: r.scheduledAt ? Math.floor(r.scheduledAt.getTime() / 1000) : 0, difficulty: r.difficulty, size: r.size,
      status: m?.status ?? null, character: m?.name ? { name: m.name, realm: m.realm } : null, lootMode: r.lootMode };
  }));
  return { text, name: g.name, raids: raidRows.length, patterns: 0, bis: 0 };
}

export async function addonRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  app.get("/groups/:id/addon-export", async (req) => {
    const u = currentUser(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await membership(db, id, u.id);
    const { text, raids: r, patterns, bis } = await groupExport(db, id, u.id);
    return { text, raids: r, patterns, bis };
  });

  /** Tous mes groupes d'un coup (« Copier pour le jeu ») : un bloc FRG par groupe, RRG sur Roster. */
  app.get("/addon/export", async (req) => {
    const u = currentUser(req);
    return allGroupsExport(db, u.id, siteOf(app.ctx.cfg, req).game);
  });

  /**
   * Export de l'addon collé sur le site (Ctrl+V n'importe où, lot K1 : appliqué côté serveur) : persos (FRC) sur la fiche
   * choisie pour chacun, puis bilans de raid (FRB). Les choix de fiche sont retenus (clé du perso) pour les prochaines fois.
   */
  app.post("/addon/import", async (req) => {
    const u = currentUser(req);
    const body = parse(z.object({
      text: z.string().max(250_000),
      parts: z.array(z.enum(IMPORT_PARTS)).max(IMPORT_PARTS.length).optional(),
      targets: z.record(z.string().max(100), z.union([z.uuid(), z.literal("new"), z.literal("skip")])).refine(r => Object.keys(r).length <= 60).optional(),
      skipLogs: z.array(z.uuid()).max(10).optional(),
    }), req.body);
    const site = siteOf(app.ctx.cfg, req);
    return importAddonText(db, u, body.text, {
      game: site.game, parts: body.parts ? new Set(body.parts) : undefined, targets: body.targets,
      skipLogs: new Set(body.skipLogs ?? []), unknown: "create", otherHost: otherSite(app.ctx.cfg, site)?.host,
    });
  });
}

/** Tous les groupes du joueur dans ce jeu, un bloc FRG chacun (RRG pour Roster) : « Copier pour le jeu », Roster Companion. */
export async function allGroupsExport(db: Db, userId: string, game: Game) {
  const mine = await db.select({ id: groupMembers.groupId }).from(groupMembers).innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.userId, userId), eq(groups.game, game))).limit(MAX_GROUPS);
  const parts = [];
  for (const g of mine) parts.push(await groupExport(db, g.id, userId));
  parts.sort((a, b) => a.name.localeCompare(b.name));
  return {
    text: parts.map(p => p.text).join("\n"),
    groups: parts.map(p => ({ name: p.name, raids: p.raids, patterns: p.patterns, bis: p.bis })),
  };
}
