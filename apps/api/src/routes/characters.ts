import { charsChanged } from "../lib/events";
import { and, asc, eq, inArray, max, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PROFESSION_SKILL_LINES } from "@forever/game-data";
import { characterRecipes, characters, gameRecipes, users } from "../db/schema";
import { characterFields, crossCheck } from "../lib/character-schema";
import { badRequest, notFound, parse } from "../lib/http";
import { currentUser, requireAuth } from "../lib/session";
import { canSee } from "../lib/visibility";
import { currentLines } from "../lib/professions";
import { deleteImage, normalizeImage, replaceImage } from "../lib/images";

const MAX_CHARACTERS = 50;
const MAX_RECIPES = 2000;
const idParam = z.object({ id: z.uuid() });

export type CharacterRow = typeof characters.$inferSelect;
export const toApi = (c: CharacterRow) => ({
  id: c.id, userId: c.userId, name: c.name, race: c.race, cls: c.cls, spec1: c.spec1, spec2: c.spec2, level: c.level,
  talents: c.talents, talentLink: c.talentLink, talents2: c.talents2, talentLink2: c.talentLink2, professions: c.professions, gear: c.gear, legacy: c.legacy, notes: c.notes,
  portraitId: c.portraitId, sortOrder: c.sortOrder, updatedAt: c.updatedAt, talentNodes: c.talentNodes ?? null,
});


export async function characterRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);
  // Toute modification d'un perso (fiche, équipement, métiers, patrons) : les groupes du joueur se mettent à jour en direct
  app.addHook("onResponse", async (req, reply) => {
    if (req.method !== "GET" && reply.statusCode < 400 && req.user) await charsChanged(db, req.user.id).catch(() => {});
  });

  app.get("/", async (req) => {
    const u = currentUser(req);
    const rows = await db.select().from(characters).where(eq(characters.userId, u.id)).orderBy(asc(characters.sortOrder), asc(characters.createdAt));
    return { characters: rows.map(toApi) };
  });

  app.post("/", async (req, reply) => {
    const u = currentUser(req);
    const body = parse(characterFields.partial().extend({ name: characterFields.shape.name }), req.body);
    const merged = { race: "", cls: "", spec1: "", spec2: "", talents: "", ...body };
    const err = crossCheck(merged); if (err) throw badRequest(err);
    const [{ n, top }] = await db.select({ n: sql<number>`count(*)::int`, top: max(characters.sortOrder) }).from(characters).where(eq(characters.userId, u.id)) as [{ n: number; top: number | null }];
    if (n >= MAX_CHARACTERS) throw badRequest(`Limite de ${MAX_CHARACTERS} personnages atteinte.`);
    const [row] = await db.insert(characters).values({ ...body, userId: u.id, sortOrder: (top ?? -1) + 1 }).returning();
    return reply.code(201).send({ character: toApi(row!) });
  });

  app.put("/order", async (req) => {
    const u = currentUser(req);
    const { ids } = parse(z.object({ ids: z.array(z.uuid()).max(MAX_CHARACTERS) }), req.body);
    const own = await db.select({ id: characters.id }).from(characters).where(eq(characters.userId, u.id));
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
    return { character: toApi(row.c), owner: row.owner, editable: row.c.userId === u.id };
  });

  app.patch("/:id", async (req) => {
    const u = currentUser(req);
    const { id } = parse(idParam, req.params);
    const patch = parse(characterFields.partial(), req.body);
    const [existing] = await db.select().from(characters).where(and(eq(characters.id, id), eq(characters.userId, u.id)));
    if (!existing) throw notFound("Personnage introuvable.");
    const next = { ...existing, ...patch };
    const err = crossCheck(next); if (err) throw badRequest(err);
    const [row] = await db.update(characters).set({ ...patch, updatedAt: new Date() }).where(eq(characters.id, id)).returning();
    return { character: toApi(row!) };
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
    if (n >= MAX_RECIPES) throw badRequest(`Limite de ${MAX_RECIPES} recettes atteinte.`);
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
    const body = parse(z.object({
      spellIds: z.array(z.int().positive()).max(MAX_RECIPES).default([]),
      itemIds: z.array(z.int().positive()).max(MAX_RECIPES).default([]),
      /** Métiers lus en jeu dans le même export (la fiche peut ne pas être encore enregistrée). */
      professions: z.array(z.enum(Object.keys(PROFESSION_SKILL_LINES) as [string, ...string[]])).max(12).default([]),
    }), req.body);
    const [ch] = await db.select().from(characters).where(and(eq(characters.id, id), eq(characters.userId, u.id)));
    if (!ch) throw notFound("Personnage introuvable.");
    const bySpell = body.spellIds.length
      ? await db.select({ spellId: gameRecipes.spellId }).from(gameRecipes).where(inArray(gameRecipes.spellId, body.spellIds)) : [];
    const byItem = body.itemIds.length
      ? await db.select({ spellId: gameRecipes.spellId, skillLine: gameRecipes.skillLine, itemId: gameRecipes.createdItemId })
        .from(gameRecipes).where(inArray(gameRecipes.createdItemId, body.itemIds)) : [];
    // Un objet peut être fabriqué par plusieurs recettes : on garde celles des métiers du perso
    const lines = currentLines(ch.professions);
    for (const p of body.professions) lines.add(PROFESSION_SKILL_LINES[p]);
    const spells = [...new Set([...bySpell.map(r => r.spellId), ...byItem.filter(r => lines.has(r.skillLine)).map(r => r.spellId)])].slice(0, MAX_RECIPES);
    if (spells.length) {
      await db.insert(characterRecipes).values(spells.map(spellId => ({ characterId: id, spellId, status: "known" as const })))
        .onConflictDoUpdate({ target: [characterRecipes.characterId, characterRecipes.spellId], set: { status: "known", updatedAt: new Date() } });
    }
    // Inconnus : identifiants qui ne correspondent à aucune recette de la base (ou d'un autre métier)
    const foundItems = new Set(byItem.filter(r => lines.has(r.skillLine)).map(r => r.itemId));
    const unknown = body.spellIds.length - bySpell.length + body.itemIds.filter(i => !foundItems.has(i)).length;
    return { known: spells.length, unknown };
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
    const [row] = await db.delete(characters).where(and(eq(characters.id, id), eq(characters.userId, u.id))).returning({ id: characters.id, portraitId: characters.portraitId });
    if (!row) throw notFound("Personnage introuvable.");
    await deleteImage(db, row.portraitId);
    return { ok: true };
  });
}
