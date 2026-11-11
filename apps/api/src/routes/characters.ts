import { bus, charsChanged } from "../lib/events";
import { promoteMain } from "../lib/group-characters";
import { and, asc, eq, max, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { characterRecipes, characters, gameRecipes, groupCharacters, groups, users } from "../db/schema";
import { characterFields, crossCheck } from "../lib/character-schema";
import { levelLockOf, levelLocks, syncFicheLevels } from "../lib/fiche-levels";
import { badRequest, conflict, notFound, parse } from "../lib/http";
import { currentUser, requireAuth } from "../lib/session";
import { canSee } from "../lib/visibility";
import { importKnownRecipes, MAX_RECIPES, recipeImportInput, setWantedPatterns } from "../lib/recipes";
import { deleteImage, normalizeImage, replaceImage } from "../lib/images";
import { siteOf } from "../lib/site";
import { N } from "../lib/i18n";

export const MAX_CHARACTERS = 50;
const idParam = z.object({ id: z.uuid() });

export type CharacterRow = typeof characters.$inferSelect;
export const toApi = (c: CharacterRow) => ({
  id: c.id, userId: c.userId, name: c.name, realm: c.realm, race: c.race, cls: c.cls, spec1: c.spec1, spec2: c.spec2, level: c.level,
  talents: c.talents, talentLink: c.talentLink, talents2: c.talents2, talentLink2: c.talentLink2, professions: c.professions, gear: c.gear, legacy: c.legacy, notes: c.notes,
  portraitId: c.portraitId, sortOrder: c.sortOrder, updatedAt: c.updatedAt, talentNodes: c.talentNodes ?? null, addonSyncedAt: c.addonSyncedAt ?? null, addonKey: c.addonKey ?? null,
  // Lot « Guilde » : GUID du perso en jeu (en-tête FRC de l'addon 1.6.2), pour reconnaître la fiche au Ctrl+V
  guid: c.guid ?? null,
  // Fiche créée par un officier, ou donnée par un autre compte (8/11) : jusqu'à ce que son joueur la modifie ou la synchronise
  origin: c.originKind && c.originAt ? { kind: c.originKind, by: c.originByName ?? "?", at: c.originAt } : null,
  // R2b (Roster) : lu chez Blizzard (import ou « Mettre à jour »)
  realmSlug: c.realmSlug, ilvl: c.ilvl ?? null, activeSpec: c.activeSpec, bnet: c.bnetId !== null, bnetSyncedAt: c.bnetSyncedAt ?? null,
});


export async function characterRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);
  // Toute modification d'un perso (fiche, équipement, métiers, patrons) : les groupes du joueur se mettent à jour en direct
  app.addHook("onResponse", async (req, reply) => {
    if (req.method !== "GET" && reply.statusCode < 400 && req.user) await charsChanged(db, req.user.id).catch(() => {});
  });

  // Mes persos du jeu de cette adresse (un site, deux adresses)
  app.get("/", async (req) => {
    const u = currentUser(req);
    const game = siteOf(app.ctx.cfg, req).game;
    const rows = await db.select({ c: characters, groupId: groupCharacters.groupId, groupName: groups.name, isMain: groupCharacters.isMain }).from(characters)
      .leftJoin(groupCharacters, eq(groupCharacters.characterId, characters.id)).leftJoin(groups, eq(groups.id, groupCharacters.groupId))
      .where(and(eq(characters.userId, u.id), eq(characters.game, game))).orderBy(asc(characters.sortOrder), asc(characters.createdAt));
    // Groupe où le perso est rangé (un seul, lot E) et s'il y est le main du joueur ; niveau verrouillé (relevé en jeu, ou fixé par un officier)
    const locks = await levelLocks(db, rows.map(r => ({ id: r.c.id, groupId: r.groupId, levelFixedBy: r.c.levelFixedBy, levelFixedAt: r.c.levelFixedAt })));
    return { characters: rows.map(r => ({ ...toApi(r.c), group: r.groupId ? { id: r.groupId, name: r.groupName!, isMain: !!r.isMain } : null, levelLock: locks.get(r.c.id) ?? null })) };
  });

  app.post("/", async (req, reply) => {
    const u = currentUser(req);
    const body = parse(characterFields.partial().extend({ name: characterFields.shape.name }), req.body);
    const merged = { race: "", cls: "", spec1: "", spec2: "", talents: "", realm: "", ...body };
    const game = siteOf(app.ctx.cfg, req).game;
    const err = crossCheck(merged, game); if (err) throw badRequest(err.key, err.vars);
    const [{ n, top }] = await db.select({ n: sql<number>`count(*)::int`, top: max(characters.sortOrder) }).from(characters)
      .where(and(eq(characters.userId, u.id), eq(characters.game, game))) as [{ n: number; top: number | null }];
    if (n >= MAX_CHARACTERS) throw badRequest("Limite de {maxCharacters} personnages atteinte.", { maxCharacters: MAX_CHARACTERS });
    const [row] = await db.insert(characters).values({ ...body, userId: u.id, game, sortOrder: (top ?? -1) + 1 }).returning();
    return reply.code(201).send({ character: toApi(row!) });
  });

  app.put("/order", async (req) => {
    const u = currentUser(req);
    const { ids } = parse(z.object({ ids: z.array(z.uuid()).max(MAX_CHARACTERS) }), req.body);
    const own = await db.select({ id: characters.id }).from(characters)
      .where(and(eq(characters.userId, u.id), eq(characters.game, siteOf(app.ctx.cfg, req).game)));
    const ownIds = new Set(own.map(r => r.id));
    if (ids.length !== ownIds.size || !ids.every(id => ownIds.has(id))) throw badRequest("La liste doit contenir exactement tes personnages.");
    await db.transaction(async tx => {
      for (const [i, id] of ids.entries()) await tx.update(characters).set({ sortOrder: i }).where(and(eq(characters.id, id), eq(characters.userId, u.id)));
    });
    return { ok: true };
  });

  app.get("/:id", async (req) => {
    const u = currentUser(req);
    const { id } = parse(idParam, req.params);
    const [row] = await db.select({ c: characters, owner: users.displayName }).from(characters)
      .innerJoin(users, eq(users.id, characters.userId)).where(eq(characters.id, id));
    // 404 aussi quand le perso existe mais n'est pas visible : on ne confirme pas son existence.
    if (!row || !(await canSee(db, u.id, row.c.userId))) throw notFound("Personnage introuvable.");
    return { character: { ...toApi(row.c), levelLock: await levelLockOf(db, row.c) }, owner: row.owner, editable: row.c.userId === u.id };
  });

  app.patch("/:id", async (req) => {
    const u = currentUser(req);
    const { id } = parse(idParam, req.params);
    // addonSynced : la fiche vient d'être mise à jour depuis l'addon (date de dernière synchro)
    // consumables (lot G) : consommables demandés par les raids, comptés en jeu à la synchro
    const { addonSynced, consumables, ...patch } = parse(characterFields.partial().extend({
      addonSynced: z.literal(true).optional(),
      consumables: z.record(z.string().regex(/^\d{1,7}$/), z.int().min(0).max(9999)).refine(r => Object.keys(r).length <= 60, N("Trop de consommables.")).optional(),
    }), req.body);
    // Fiche verrouillée le temps de la modification : un relevé de la guilde en cours (fiche-levels.ts) passe avant ou après
    const after = await db.transaction(async tx => {
      const [existing] = await tx.select().from(characters).where(and(eq(characters.id, id), eq(characters.userId, u.id))).for("update");
      if (!existing) throw notFound("Personnage introuvable.");
      const next = { ...existing, ...patch };
      const err = crossCheck(next, existing.game); if (err) throw badRequest(err.key, err.vars);
      // Niveau verrouillé (fiche-levels.ts) : relevé en jeu, ou fixé par un officier de sa guilde
      if (patch.level !== undefined && patch.level !== existing.level) {
        const lock = await levelLockOf(tx, existing);
        if (lock?.by === "game") throw conflict("Le niveau de {name} suit le jeu : {name2} est niveau {level} dans la liste de guilde.", { name: existing.name, name2: lock.name, level: lock.level });
        if (lock) throw conflict("Le niveau de {name} a été fixé par {name2}, officier de sa guilde.", { name: existing.name, name2: lock.name });
      }
      // Nom ou royaume changé à la main : ce n'est plus le perso lu chez Battle.net
      const moved = (patch.name !== undefined && patch.name !== existing.name) || (patch.realm !== undefined && patch.realm !== existing.realm);
      await tx.update(characters).set({
        ...patch, updatedAt: new Date(), ...(addonSynced && { addonSyncedAt: new Date() }),
        // Le joueur a la main sur sa fiche : « créée par » / « donnée par » ne s'affiche plus
        originKind: null, originBy: null, originByName: null, originAt: null,
        // Niveau changé à la main : ce n'est plus celui que l'addon a lu en jeu (fiche-levels.ts)
        ...(patch.level !== undefined && patch.level !== existing.level && { levelSyncedAt: null }),
        ...(moved && existing.game === "retail" && { bnetId: null, realmSlug: "", ilvl: null, activeSpec: "", bnetSyncedAt: null }), ...(consumables && { consumables, consumablesAt: new Date() }),
      }).where(eq(characters.id, id));
      // Nom changé : la fiche peut maintenant (ou ne plus) correspondre à un perso de la liste du jeu de sa guilde
      if (existing.game === "forever" && patch.name !== undefined && patch.name !== existing.name) {
        const [gc] = await tx.select({ g: groupCharacters.groupId }).from(groupCharacters).where(eq(groupCharacters.characterId, id));
        if (gc) await syncFicheLevels(tx, gc.g);
      }
      const [row] = await tx.select().from(characters).where(eq(characters.id, id));
      return row!;
    });
    return { character: { ...toApi(after), levelLock: await levelLockOf(db, after) } };
  });

  /* ----- Patrons connus / recherchés ----- */

  app.get("/:id/recipes", async (req) => {
    const u = currentUser(req);
    const { id } = parse(idParam, req.params);
    const [row] = await db.select({ userId: characters.userId }).from(characters).where(eq(characters.id, id));
    if (!row || !(await canSee(db, u.id, row.userId))) throw notFound("Personnage introuvable.");
    const recipes = await db.select({ spellId: characterRecipes.spellId, status: characterRecipes.status, skillLine: gameRecipes.skillLine })
      .from(characterRecipes).innerJoin(gameRecipes, eq(gameRecipes.spellId, characterRecipes.spellId))
      .where(eq(characterRecipes.characterId, id));
    return { recipes };
  });

  app.put("/:id/recipes/:spellId", async (req) => {
    const u = currentUser(req);
    const { id, spellId } = parse(idParam.extend({ spellId: z.coerce.number().int().positive() }), req.params);
    const { status } = parse(z.object({ status: z.enum(["known", "wanted"]).nullable() }), req.body);
    const [ch] = await db.select().from(characters).where(and(eq(characters.id, id), eq(characters.userId, u.id)));
    if (!ch) throw notFound("Personnage introuvable.");

    if (status === null) {
      await db.delete(characterRecipes).where(and(eq(characterRecipes.characterId, id), eq(characterRecipes.spellId, spellId)));
      return { ok: true };
    }
    const [recipe] = await db.select({ skillLine: gameRecipes.skillLine }).from(gameRecipes).where(eq(gameRecipes.spellId, spellId));
    if (!recipe) throw badRequest("Recette inconnue.");
    // Pas de contrôle du métier ici : le métier choisi juste avant peut ne pas être encore enregistré
    // (sauvegarde automatique différée). Les patrons d'un métier que le perso n'a plus sont ignorés à la lecture.
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(characterRecipes).where(eq(characterRecipes.characterId, id)) as [{ n: number }];
    if (n >= MAX_RECIPES) throw badRequest("Limite de {maxRecipes} recettes atteinte.", { maxRecipes: MAX_RECIPES });
    await db.insert(characterRecipes).values({ characterId: id, spellId, status })
      .onConflictDoUpdate({ target: [characterRecipes.characterId, characterRecipes.spellId], set: { status, updatedAt: new Date() } });
    return { ok: true };
  });

  /**
   * Patrons connus envoyés par l'addon : identifiants de sort de fabrication, ou d'objet fabriqué (le jeu ne donne
   * parfois que lui). Ajoutés comme « connus » sans rien retirer ; un patron « recherché » devient « connu ».
   */
  app.post("/:id/recipes/import", async (req) => {
    const u = currentUser(req);
    const { id } = parse(idParam, req.params);
    const body = parse(recipeImportInput, req.body);
    const [ch] = await db.select().from(characters).where(and(eq(characters.id, id), eq(characters.userId, u.id)));
    if (!ch) throw notFound("Personnage introuvable.");
    return importKnownRecipes(db, ch, body);
  });

  /**
   * Patrons marqués « recherché » (ou retirés) en jeu : l'addon donne l'objet patron, on retrouve la recette qu'il enseigne.
   * Un patron déjà connu reste connu ; seul un « recherché » est retiré.
   */
  app.post("/:id/recipes/wanted", async (req) => {
    const u = currentUser(req);
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({
      add: z.array(z.int().positive()).max(200).default([]),
      remove: z.array(z.int().positive()).max(200).default([]),
    }), req.body);
    const [ch] = await db.select({ id: characters.id }).from(characters).where(and(eq(characters.id, id), eq(characters.userId, u.id)));
    if (!ch) throw notFound("Personnage introuvable.");
    return setWantedPatterns(db, id, body.add, body.remove);
  });

  /* ----- Portrait ----- */

  const uploadLimit = { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } };

  app.put("/:id/portrait", uploadLimit, async (req) => {
    const u = currentUser(req);
    const { id } = parse(idParam, req.params);
    if (!Buffer.isBuffer(req.body)) throw badRequest("Envoie une image PNG, JPEG ou WebP.");
    const [ch] = await db.select({ portraitId: characters.portraitId }).from(characters).where(and(eq(characters.id, id), eq(characters.userId, u.id)));
    if (!ch) throw notFound("Personnage introuvable.");
    const data = await normalizeImage(req.body);
    const portraitId = await replaceImage(db, u.id, data, ch.portraitId, newId =>
      db.update(characters).set({ portraitId: newId, updatedAt: new Date() }).where(eq(characters.id, id)));
    return { portraitId };
  });

  app.delete("/:id/portrait", async (req) => {
    const u = currentUser(req);
    const { id } = parse(idParam, req.params);
    const [ch] = await db.select({ portraitId: characters.portraitId }).from(characters).where(and(eq(characters.id, id), eq(characters.userId, u.id)));
    if (!ch) throw notFound("Personnage introuvable.");
    await db.update(characters).set({ portraitId: null }).where(eq(characters.id, id));
    await deleteImage(db, ch.portraitId);
    return { ok: true };
  });

  app.delete("/:id", async (req) => {
    const u = currentUser(req);
    const { id } = parse(idParam, req.params);
    const inGroups = await db.select({ groupId: groupCharacters.groupId, isMain: groupCharacters.isMain }).from(groupCharacters)
      .where(and(eq(groupCharacters.characterId, id), eq(groupCharacters.userId, u.id)));
    const [row] = await db.delete(characters).where(and(eq(characters.id, id), eq(characters.userId, u.id))).returning({ id: characters.id, portraitId: characters.portraitId });
    if (!row) throw notFound("Personnage introuvable.");
    await deleteImage(db, row.portraitId);
    // Main supprimé : le perso suivant du joueur devient main dans ces groupes
    for (const g of inGroups) {
      if (g.isMain) await promoteMain(db, g.groupId, u.id);
      bus.group({ t: "chars", g: g.groupId });
    }
    return { ok: true };
  });
}
