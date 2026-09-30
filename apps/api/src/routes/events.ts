import type { FastifyInstance } from "fastify";
import { bus, groupsOf, type LiveEvent } from "../lib/events";
import { currentUser, requireAuth } from "../lib/session";

const PING_MS = 25_000;
/** Durée maximale d'une connexion : le navigateur se reconnecte, ce qui revérifie la session. */
const MAX_MS = 15 * 60_000;

export async function eventRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const u = currentUser(req);
    const groups = new Set(await groupsOf(app.ctx.db, u.id));
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");
    const send = (e: LiveEvent) => { res.write(`data: ${JSON.stringify(e)}\n\n`); };
    const remove = bus.add({ userId: u.id, groups, send });
    const ping = setInterval(() => res.write(": ping\n\n"), PING_MS);
    const stop = setTimeout(() => res.end(), MAX_MS);
    req.raw.on("close", () => { clearInterval(ping); clearTimeout(stop); remove(); });
  });
}
