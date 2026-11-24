import {
  BIS_PROFILES, BIS_SOURCE_SEED, itemFaction, SKILL_LINE_NAMES, WEIGHT_KEYS,
  type BisItem, type BisProfile, type BisSource, type ItemDetails, type Weights,
} from "@forever/game-data";
import { and, eq, gte, lte, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { bisWeights, gameHotfixes, gameItems, gameRecipes, itemOverrides, users } from "../db/schema";
import { TABLE_HASH } from "../gamedata/dbcache";
import { audit } from "../lib/audit";
import { membership, requireRole } from "../lib/groups";
import { forbidden, notFound, parse } from "../lib/http";
import { N } from "../lib/i18n";
import { currentUser, requireAuth } from "../lib/session";

/**
 * Module BiS (lot BiS-1, 24/11/2026) : objets candidats d'une spé (avec « vu en jeu », provenance, faction), poids des
 * caractéristiques (défaut, guilde, joueur) et corrections des admins du site sur un objet. Le classement lui-même se
 * fait dans le navigateur avec le moteur partagé (game-data bis.ts), pour suivre le curseur de toucher sans aller-retour.
 */

const profileParam = z.object({ profile: z.string().max(40) });
const weightsSchema = z.object(Object.fromEntries(WEIGHT_KEYS.map(k => [k, z.number().min(-1000).max(1000).optional()])) as Record<(typeof WEIGHT_KEYS)[number], z.ZodOptional<z.ZodNumber>>).strict();
const weightsBody = z.object({ weights: weightsSchema.nullable() });
const text = z.string().trim().min(1).max(80);
const sourceSchema = z.object({
  kind: z.enum(["drop", "quest", "craft", "vendor", "reputation", "pvp", "world", "raid", "other"]),
  where: text.optional(), npc: text.optional(), profession: text.optional(), skill: z.int().min(1).max(450).optional(),
  cost: text.optional(), faction: text.optional(), standing: z.enum(["neutral", "friendly", "honored", "revered", "exalted"]).optional(),
  ref: z.url({ protocol: /^https$/ }).max(300).optional(),
}).strict();
const overrideBody = z.object({
  unobtainable: z.boolean().optional(),
  faction: z.enum(["Alliance", "Horde", "both"]).nullable().optional(),
  source: sourceSchema.nullable().optional(),
}).strict();

const STANDING = ["neutral", "neutral", "neutral", "neutral", "friendly", "honored", "revered", "exalted"] as const;

function profileOf(key: string): BisProfile {
  const p = BIS_PROFILES.find(x => x.key === key);
  if (!p) throw notFound(N("Spé inconnue pour la BiS."));
  return p;
}

/** Provenance tirée des données du jeu (recette, réputation, rang JcJ) : affichée, mais ne rend pas l'objet obtenable. */
function autoSource(d: ItemDetails, recipe: { skillLine: number; reqSkill: number } | null): BisSource | null {
  if (recipe) {
    const profession = SKILL_LINE_NAMES[recipe.skillLine];
    if (profession) return { kind: "craft", profession, skill: recipe.reqSkill || undefined, from: "auto" };
  }
  if (d.rep) return { kind: "reputation", faction: d.rep.name || undefined, standing: STANDING[d.rep.standing] ?? undefined, from: "auto" };
  if (d.pvpRank) return { kind: "pvp", from: "auto" };
  return null;
}

export async function bisRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  /** Objets que la spé peut porter (niveau requis 40 à 60, qualité Inhabituel et plus), prêts pour le moteur. */
  app.get("/:profile/items", async (req, reply) => {
    const p = profileOf(parse(profileParam, req.params).profile);
    const armor = p.armor.length ? sql`(${gameItems.classId} = 4 and ${gameItems.inventoryType} <> 28 and ${gameItems.subclassId} in ${p.armor})` : sql`false`;
    const relic = p.relic !== undefined ? sql`(${gameItems.classId} = 4 and ${gameItems.inventoryType} = 28 and ${gameItems.subclassId} = ${p.relic})` : sql`false`;
    const weapons = p.weapons.length ? sql`(${gameItems.classId} = 2 and ${gameItems.subclassId} in ${p.weapons})` : sql`false`;
    const rows = await db.select({
      id: gameItems.id, name: gameItems.name, quality: gameItems.quality, itemLevel: gameItems.itemLevel, reqLevel: gameItems.reqLevel,
      classId: gameItems.classId, subclassId: gameItems.subclassId, inventoryType: gameItems.inventoryType, details: gameItems.details,
      seen: sql<boolean>`exists (select 1 from ${gameHotfixes} where ${gameHotfixes.tableHash} = ${TABLE_HASH.ItemSparse}
        and ${gameHotfixes.rowId} = ${gameItems.id} and not ${gameHotfixes.removed})`,
      recipe: sql<{ skillLine: number; reqSkill: number } | null>`(select json_build_object('skillLine', ${gameRecipes.skillLine}, 'reqSkill', ${gameRecipes.reqSkill})
        from ${gameRecipes} where ${gameRecipes.createdItemId} = ${gameItems.id} order by ${gameRecipes.reqSkill} limit 1)`,
      unobtainable: itemOverrides.unobtainable, factionOverride: itemOverrides.faction, sourceOverride: itemOverrides.source,
    }).from(gameItems).leftJoin(itemOverrides, eq(itemOverrides.itemId, gameItems.id))
      .where(and(or(armor, relic, weapons), gte(gameItems.reqLevel, 40), lte(gameItems.reqLevel, 60), gte(gameItems.quality, 2)));

    const items: BisItem[] = rows.map(r => {
      const d = r.details ?? {};
      const faction = r.factionOverride === "both" ? null : r.factionOverride ?? itemFaction(r.name, d.races);
      const seed = BIS_SOURCE_SEED[r.id];
      const source = r.sourceOverride ? { ...r.sourceOverride, from: "admin" as const }
        : seed ? { ...seed, from: "seed" as const } : autoSource(d, r.recipe);
      return {
        id: r.id, name: r.name, quality: r.quality, itemLevel: r.itemLevel, reqLevel: r.reqLevel, classId: r.classId, subclassId: r.subclassId,
        inventoryType: r.inventoryType, details: d, faction, pvpRank: d.pvpRank ?? 0, seen: r.seen, source, unobtainable: !!r.unobtainable,
      };
    });
    reply.header("Cache-Control", "private, max-age=300");
    return { profile: p.key, items };
  });

  /** Poids : défaut de la spé, ceux de la guilde (si groupId) et ceux du joueur. */
  app.get("/:profile/weights", async (req) => {
    const u = currentUser(req);
    const p = profileOf(parse(profileParam, req.params).profile);
    const { groupId } = parse(z.object({ groupId: z.uuid().optional() }), req.query);
    let group: Weights | null = null, canEditGroup = false;
    if (groupId) {
      const role = await membership(db, groupId, u.id);
      canEditGroup = role !== "member";
      const [g] = await db.select({ w: bisWeights.weights }).from(bisWeights)
        .where(and(eq(bisWeights.scope, "group"), eq(bisWeights.scopeId, groupId), eq(bisWeights.profile, p.key)));
      group = g?.w ?? null;
    }
    const [m] = await db.select({ w: bisWeights.weights }).from(bisWeights)
      .where(and(eq(bisWeights.scope, "user"), eq(bisWeights.scopeId, u.id), eq(bisWeights.profile, p.key)));
    return { profile: p.key, defaults: p.weights, hitCap: p.hitCap, group, me: m?.w ?? null, canEditGroup };
  });

  async function saveWeights(scope: "group" | "user", scopeId: string, profile: string, weights: Weights | null, by: string) {
    if (!weights || !Object.keys(weights).length) {
      await db.delete(bisWeights).where(and(eq(bisWeights.scope, scope), eq(bisWeights.scopeId, scopeId), eq(bisWeights.profile, profile)));
      return;
    }
    await db.insert(bisWeights).values({ scope, scopeId, profile, weights, updatedBy: by })
      .onConflictDoUpdate({ target: [bisWeights.scope, bisWeights.scopeId, bisWeights.profile], set: { weights, updatedBy: by, updatedAt: new Date() } });
  }

  /** Mes poids (null : revenir à ceux de la guilde ou de la spé). */
  app.put("/:profile/weights/me", async (req) => {
    const u = currentUser(req);
    const p = profileOf(parse(profileParam, req.params).profile);
    const b = parse(weightsBody, req.body);
    await saveWeights("user", u.id, p.key, b.weights, u.id);
    return { ok: true };
  });

  /** Poids de la guilde (officiers). */
  app.put("/:profile/weights/group/:groupId", async (req) => {
    const u = currentUser(req);
    const params = parse(profileParam.extend({ groupId: z.uuid() }), req.params);
    const p = profileOf(params.profile);
    await requireRole(db, params.groupId, u.id, "officer");
    const b = parse(weightsBody, req.body);
    await saveWeights("group", params.groupId, p.key, b.weights, u.id);
    await audit(db, req, "bis_weights_group", { userId: u.id, groupId: params.groupId, meta: { profile: p.key, reset: !b.weights } });
    return { ok: true };
  });

  /** Corrections d'un admin du site sur un objet : non obtenable, faction, provenance. */
  app.put("/items/:id", async (req) => {
    const u = currentUser(req);
    const [me] = await db.select({ admin: users.siteAdmin }).from(users).where(eq(users.id, u.id));
    if (!me?.admin) throw forbidden(N("Réservé aux admins du site."));
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const b = parse(overrideBody, req.body);
    const [item] = await db.select({ id: gameItems.id }).from(gameItems).where(eq(gameItems.id, id));
    if (!item) throw notFound(N("Objet introuvable."));
    const set = {
      ...(b.unobtainable !== undefined ? { unobtainable: b.unobtainable } : {}),
      ...(b.faction !== undefined ? { faction: b.faction } : {}),
      ...(b.source !== undefined ? { source: b.source } : {}),
      updatedBy: u.id, updatedAt: new Date(),
    };
    await db.insert(itemOverrides).values({ itemId: id, ...set }).onConflictDoUpdate({ target: itemOverrides.itemId, set });
    // Plus rien à corriger : la ligne disparaît (l'objet revient au calcul automatique).
    await db.delete(itemOverrides).where(and(eq(itemOverrides.itemId, id), eq(itemOverrides.unobtainable, false),
      sql`${itemOverrides.faction} is null and ${itemOverrides.source} is null`));
    await audit(db, req, "item_override", { userId: u.id, meta: { itemId: id, ...b } });
    return { ok: true };
  });
}
