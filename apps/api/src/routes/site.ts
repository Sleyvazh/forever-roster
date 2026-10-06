import type { FastifyInstance } from "fastify";
import { otherSite, siteOf } from "../lib/site";

/** Site de cette adresse (public) : le front y lit son nom, son jeu et l'autre adresse (un site, deux adresses). */
export async function siteRoutes(app: FastifyInstance) {
  app.get("/", async (req, reply) => {
    const site = siteOf(app.ctx.cfg, req);
    const other = otherSite(app.ctx.cfg, site);
    reply.header("Cache-Control", "no-cache");
    return { game: site.game, name: site.name, open: site.open, origin: site.origin, other: other && { game: other.game, name: other.name, origin: other.origin } };
  });
}
