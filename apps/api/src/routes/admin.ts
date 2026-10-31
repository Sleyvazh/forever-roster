import type { FastifyInstance } from "fastify";
import { forbidden } from "../lib/http";
import { currentUser, requireAuth } from "../lib/session";
import { siteStatusView } from "../lib/site-status";

/** Administration du site : réservée aux comptes site_admin (page « Administration du site », /admin/signalements). */
export async function adminRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  /** « État du site » : le bot Discord, la dernière sauvegarde, les 5 dernières alertes (lib/site-status.ts). */
  app.get("/site-status", async req => {
    if (!currentUser(req).siteAdmin) throw forbidden("Réservé aux admins du site.");
    return siteStatusView(db, app.ctx.now?.() ?? new Date());
  });
}
