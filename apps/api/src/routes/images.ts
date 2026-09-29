import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { images } from "../db/schema";
import { notFound, parse } from "../lib/http";
import { currentUser, requireAuth } from "../lib/session";
import { canSee } from "../lib/visibility";

export async function imageRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  /** Image d'un compte ou d'un perso : visible par son propriétaire et les membres de ses groupes, 404 sinon. */
  app.get("/:id", async (req, reply) => {
    const u = currentUser(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const [img] = await db.select({ ownerId: images.ownerId, data: images.data }).from(images).where(eq(images.id, id));
    if (!img || !(await canSee(db, u.id, img.ownerId))) throw notFound("Image introuvable.");
    return reply
      .type("image/webp")
      .header("Content-Disposition", "inline")
      // L'identifiant change à chaque nouvel envoi : on peut garder l'image en cache longtemps.
      .header("Cache-Control", "private, max-age=31536000, immutable")
      .send(img.data);
  });
}
