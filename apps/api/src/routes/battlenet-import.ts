import { realmSlug, RETAIL_MAX_LEVEL, retailSpec, type BnetCharacter } from "@forever/game-data";
import { and, eq, gt, max } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { battlenetEnabled } from "../config";
import type { Db } from "../db/client";
import { bnetImports, characters, groupCharacters, groups } from "../db/schema";
import { audit } from "../lib/audit";
import { BlizzardError, characterSummary, eachLimited, type BlizzardCtx } from "../lib/blizzard";
import { charsChanged } from "../lib/events";
import { requireRole } from "../lib/groups";
import { badRequest, HttpError, notFound, parse } from "../lib/http";
import { currentUser, requireAuth } from "../lib/session";
import { siteOf } from "../lib/site";
import { MAX_CHARACTERS, toApi, type CharacterRow } from "./characters";

/**
 * R2b (Roster, WoW Retail) : import des persos du compte Battle.net et mise à jour depuis Blizzard
 * (niveau, niveau d'objet, spé active). Rien d'automatique : chaque lecture part d'un clic (décision de Flo).
 */
const MAX_GROUP_REFRESH = 60;
/** Un perso lu il y a moins de 10 minutes n'est pas relu par « Mettre à jour le groupe ». */
const FRESH_MS = 10 * 60 * 1000;

type Refresh = { ok: true; row: CharacterRow } | { ok: false; reason: string };

/** Relit un perso chez Blizzard. La spé principale choisie sur le site ne change pas ; la spé active est affichée à côté. */
export async function refreshCharacter(db: Db, ctx: BlizzardCtx, c: CharacterRow): Promise<Refresh> {
  const slug = c.realmSlug || realmSlug(c.realm);
  if (!c.name.trim() || !slug) return { ok: false, reason: "nom ou royaume manquant" };
  let s;
  try { s = await characterSummary(ctx, slug, c.name); }
  catch (err) { return { ok: false, reason: err instanceof BlizzardError && err.status === 429 ? "Blizzard demande d'attendre un peu" : "Blizzard n'a pas répondu" }; }
  if (!s) return { ok: false, reason: "introuvable chez Blizzard (nom, royaume, ou profil masqué)" };
  if (s.cls && c.cls && s.cls !== c.cls) return { ok: false, reason: "la classe ne correspond pas à ce perso chez Blizzard" };
  const [row] = await db.update(characters).set({
    level: Math.min(RETAIL_MAX_LEVEL, s.level), ilvl: s.ilvl === null ? null : Math.round(s.ilvl), activeSpec: s.activeSpec,
    bnetId: c.bnetId ?? s.bnetId, realmSlug: slug, bnetSyncedAt: new Date(), updatedAt: new Date(),
    ...(!c.cls && s.cls && { cls: s.cls }),
  }).where(eq(characters.id, c.id)).returning();
  return { ok: true, row: row! };
}

/** Perso déjà sur Roster : même perso Battle.net, ou même nom sur le même royaume. */
function findExisting(mine: CharacterRow[], b: BnetCharacter) {
  return mine.find(c => c.bnetId === b.id)
    ?? mine.find(c => c.name.toLowerCase() === b.name.toLowerCase() && (c.realmSlug || realmSlug(c.realm)) === b.realmSlug);
}

export async function battlenetImportRoutes(app: FastifyInstance) {
  const { db, cfg } = app.ctx;
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", async req => {
    if (!battlenetEnabled(cfg)) throw new HttpError(503, "Battle.net n'est pas configuré sur ce serveur.");
    if (siteOf(cfg, req).game !== "retail") throw badRequest("Battle.net sert aux persos de WoW Retail, sur Roster.");
  });
  const retailChars = (userId: string) => db.select().from(characters).where(and(eq(characters.userId, userId), eq(characters.game, "retail")));

  // Liste lue à l'import (30 min), avec les persos déjà sur Roster
  app.get("/import", async req => {
    const u = currentUser(req);
    const [imp] = await db.select().from(bnetImports).where(and(eq(bnetImports.userId, u.id), gt(bnetImports.expiresAt, new Date())));
    if (!imp) throw notFound("La liste de Battle.net a expiré : relance l'import.");
    const mine = await retailChars(u.id);
    return { characters: imp.characters.map(b => ({ ...b, existing: findExisting(mine, b)?.id ?? null })), expiresAt: imp.expiresAt.toISOString() };
  });

  // Import des persos cochés : création (ou liaison d'une fiche faite à la main), puis lecture chez Blizzard
  app.post("/import", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const u = currentUser(req);
    const { ids } = parse(z.object({ ids: z.array(z.int().positive()).min(1).max(MAX_CHARACTERS) }), req.body);
    const [imp] = await db.select().from(bnetImports).where(and(eq(bnetImports.userId, u.id), gt(bnetImports.expiresAt, new Date())));
    if (!imp) throw notFound("La liste de Battle.net a expiré : relance l'import.");
    const picked = imp.characters.filter(b => ids.includes(b.id));
    if (!picked.length) throw badRequest("Aucun de ces persos n'est dans la liste de Battle.net.");
    const mine = await retailChars(u.id);
    const [{ top } = { top: null }] = await db.select({ top: max(characters.sortOrder) }).from(characters)
      .where(and(eq(characters.userId, u.id), eq(characters.game, "retail")));
    let order = (top ?? -1) + 1, count = mine.length;
    const rows: { row: CharacterRow; created: boolean }[] = [];
    for (const b of picked) {
      const ex = findExisting(mine, b);
      if (ex) {
        const [row] = await db.update(characters).set({ bnetId: b.id, realmSlug: b.realmSlug, realm: ex.realm || b.realm, updatedAt: new Date() })
          .where(eq(characters.id, ex.id)).returning();
        rows.push({ row: row!, created: false });
        continue;
      }
      if (count >= MAX_CHARACTERS) throw badRequest(`Limite de ${MAX_CHARACTERS} personnages atteinte.`);
      const [row] = await db.insert(characters).values({
        userId: u.id, game: "retail", name: b.name, realm: b.realm, realmSlug: b.realmSlug, cls: b.cls, level: b.level, bnetId: b.id, sortOrder: order++,
      }).returning();
      count++;
      rows.push({ row: row!, created: true });
    }
    // Niveau d'objet et spé active ; la spé active devient la spé principale d'un perso qui n'en a pas encore
    const failed: { name: string; reason: string }[] = [];
    const out = await eachLimited(rows, 4, async ({ row }) => {
      const r = await refreshCharacter(db, app.ctx, row);
      if (!r.ok) { failed.push({ name: row.name, reason: r.reason }); return row; }
      if (!r.row.spec1 && r.row.activeSpec && retailSpec(r.row.cls, r.row.activeSpec)) {
        const [withSpec] = await db.update(characters).set({ spec1: r.row.activeSpec }).where(eq(characters.id, r.row.id)).returning();
        return withSpec!;
      }
      return r.row;
    });
    await audit(db, req, "battlenet_import", { userId: u.id, meta: { created: rows.filter(r => r.created).length, linked: rows.filter(r => !r.created).length } });
    await charsChanged(db, u.id).catch(() => {});
    return reply.code(201).send({
      created: rows.filter(r => r.created).length, linked: rows.filter(r => !r.created).length, failed,
      characters: out.map(toApi),
    });
  });

  // « Mettre à jour » sur la fiche d'un de ses persos
  app.post("/characters/:id/refresh", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async req => {
    const u = currentUser(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const [c] = await db.select().from(characters).where(and(eq(characters.id, id), eq(characters.userId, u.id), eq(characters.game, "retail")));
    if (!c) throw notFound("Personnage introuvable.");
    const r = await refreshCharacter(db, app.ctx, c);
    if (!r.ok) throw badRequest(`Mise à jour impossible : ${r.reason}.`);
    await charsChanged(db, u.id).catch(() => {});
    return { character: toApi(r.row) };
  });

  // Officiers : « Mettre à jour le groupe » (persos rangés dans le groupe, pas relus depuis 10 minutes)
  app.post("/groups/:id/refresh", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async req => {
    const u = currentUser(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await requireRole(db, id, u.id, "officer");
    const [g] = await db.select({ game: groups.game }).from(groups).where(eq(groups.id, id));
    if (g?.game !== "retail") throw badRequest("Ce groupe n'est pas un groupe de Roster.");
    const rows = (await db.select({ c: characters }).from(groupCharacters).innerJoin(characters, eq(characters.id, groupCharacters.characterId))
      .where(and(eq(groupCharacters.groupId, id), eq(characters.game, "retail"))).limit(MAX_GROUP_REFRESH)).map(r => r.c);
    const due = rows.filter(c => !c.bnetSyncedAt || Date.now() - c.bnetSyncedAt.getTime() > FRESH_MS);
    const failed: { name: string; reason: string }[] = [];
    let updated = 0;
    await eachLimited(due, 4, async c => {
      const r = await refreshCharacter(db, app.ctx, c);
      if (r.ok) updated++; else failed.push({ name: c.name, reason: r.reason });
    });
    const owners = [...new Set(due.map(c => c.userId))];
    for (const o of owners) await charsChanged(db, o).catch(() => {});
    return { updated, fresh: rows.length - due.length, failed };
  });
}
