import { desc, eq, inArray, max, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { gameCacheUploads, users } from "../db/schema";
import { hotfixesSince } from "../gamedata/cache-store";
import { gameDataStatus } from "../gamedata/store";
import { audit } from "../lib/audit";
import { conflict, forbidden, notFound, parse } from "../lib/http";
import { N } from "../lib/i18n";
import { currentUser, requireAuth } from "../lib/session";
import { siteStatusView } from "../lib/site-status";

/** Administration du site : réservée aux comptes site_admin (page « Administration du site », /admin/signalements). */
export async function adminRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);
  const onlyAdmin = (req: FastifyRequest) => {
    const u = currentUser(req);
    if (!u.siteAdmin) throw forbidden("Réservé aux admins du site.");
    return u;
  };

  /** « État du site » : le bot Discord, la dernière sauvegarde, les 5 dernières alertes (lib/site-status.ts). */
  app.get("/site-status", async req => {
    onlyAdmin(req);
    return siteStatusView(db, app.ctx.now?.() ?? new Date(), app.ctx.cfg);
  });

  /**
   * « Données du jeu » (lot D2) : dernier import, correctifs gardés (et ceux arrivés depuis l'import), contributeurs
   * (admins du site compris : ils peuvent toujours envoyer) et les 10 derniers envois de cache.
   */
  app.get("/gamedata", async req => {
    onlyAdmin(req);
    const status = await gameDataStatus(db);
    const [total, sinceImport] = await Promise.all([hotfixesSince(db, null), hotfixesSince(db, status.hotfixesAt ? new Date(status.hotfixesAt) : null)]);
    const contributors = await db.select({ id: users.id, name: users.displayName, email: users.email, admin: users.siteAdmin })
      .from(users).where(or(eq(users.siteAdmin, true), eq(users.gameDataContributor, true))).orderBy(users.displayName);
    // Dernier envoi de chacun (la liste compte au moins l'admin qui regarde)
    const lastAt = new Map((await db.select({ userId: gameCacheUploads.userId, at: max(gameCacheUploads.receivedAt) }).from(gameCacheUploads)
      .where(inArray(gameCacheUploads.userId, contributors.map(c => c.id))).groupBy(gameCacheUploads.userId))
      .map(r => [r.userId, r.at]));
    const uploads = await db.select({
      at: gameCacheUploads.receivedAt, name: users.displayName, via: gameCacheUploads.via, build: gameCacheUploads.build,
      rows: gameCacheUploads.rows, newRows: gameCacheUploads.newRows,
    }).from(gameCacheUploads).leftJoin(users, eq(users.id, gameCacheUploads.userId)).orderBy(desc(gameCacheUploads.receivedAt)).limit(10);
    return {
      status, hotfixes: { total, sinceImport },
      contributors: contributors.map(c => ({ ...c, lastAt: lastAt.get(c.id)?.toISOString() ?? null })),
      uploads,
    };
  });

  /**
   * Nommer un contributeur : l'adresse e-mail du compte, ou son pseudo s'il est seul à le porter. Noté dans le journal du
   * compte nommé (sans l'IP de l'admin).
   */
  app.post("/gamedata/contributors", async req => {
    const admin = onlyAdmin(req);
    const { who } = parse(z.object({ who: z.string().trim().min(2).max(320) }), req.body);
    const found = await db.select({ id: users.id, name: users.displayName, admin: users.siteAdmin, on: users.gameDataContributor }).from(users)
      .where(who.includes("@") ? eq(users.email, who.toLowerCase()) : sql`lower(${users.displayName}) = lower(${who})`).limit(2);
    if (!found.length) throw notFound(N("Aucun compte avec cette adresse ou ce pseudo."));
    if (found.length > 1) throw conflict(N("Plusieurs comptes portent ce pseudo : donne son adresse e-mail."));
    const target = found[0]!;
    if (!target.on) {
      await db.update(users).set({ gameDataContributor: true, updatedAt: new Date() }).where(eq(users.id, target.id));
      await audit(db, null, "game_contributor_set", { userId: target.id, meta: { by: admin.displayName } });
    }
    return { id: target.id, name: target.name, admin: target.admin };
  });

  /** Retirer un contributeur (un admin du site reste contributeur tant qu'il est admin). */
  app.delete("/gamedata/contributors/:id", async req => {
    const admin = onlyAdmin(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const [target] = await db.update(users).set({ gameDataContributor: false, updatedAt: new Date() })
      .where(eq(users.id, id)).returning({ id: users.id, admin: users.siteAdmin });
    if (!target) throw notFound();
    await audit(db, null, "game_contributor_unset", { userId: id, meta: { by: admin.displayName } });
    return { ok: true, stillAdmin: target.admin };
  });
}
