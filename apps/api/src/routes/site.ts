import type { FastifyInstance } from "fastify";
import { otherSite, siteOf } from "../lib/site";

/**
 * Site de cette adresse (public) : le front y lit son nom, son jeu et l'autre adresse (un site, deux adresses), et
 * l'adresse de contact des mentions légales et de la confidentialité (CONTACT_EMAIL).
 */
export async function siteRoutes(app: FastifyInstance) {
  app.get("/", async (req, reply) => {
    const site = siteOf(app.ctx.cfg, req);
    const other = otherSite(app.ctx.cfg, site);
    reply.header("Cache-Control", "no-cache");
    return {
      game: site.game, name: site.name, open: site.open, origin: site.origin, contact: app.ctx.cfg.CONTACT_EMAIL,
      other: other && { game: other.game, name: other.name, origin: other.origin },
    };
  });
}
