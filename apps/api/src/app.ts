import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyServerOptions } from "fastify";
import type { Config } from "./config";
import type { Db } from "./db/client";
import { HttpError } from "./lib/http";
import type { Mailer } from "./lib/mailer";
import { registerSession } from "./lib/session";
import { accountRoutes } from "./routes/account";
import { authRoutes } from "./routes/auth";
import { battlenetRoutes } from "./routes/battlenet";
import { characterRoutes } from "./routes/characters";
import { gameDataRoutes } from "./routes/gamedata";
import { groupRoutes } from "./routes/groups";
import { raidRoutes } from "./routes/raids";

export interface AppContext {
  db: Db;
  cfg: Config;
  mailer: Mailer;
  /** Injectable pour les tests (Battle.net, Have I Been Pwned). */
  fetch: typeof fetch;
}

declare module "fastify" {
  interface FastifyInstance { ctx: AppContext }
}

export interface BuildOptions {
  ctx: AppContext;
  logger?: FastifyServerOptions["logger"];
  rateLimit?: boolean;
}

export async function buildApp({ ctx, logger = false, rateLimit: withRateLimit = true }: BuildOptions) {
  const app = Fastify({
    logger,
    trustProxy: ctx.cfg.TRUST_PROXY,
    bodyLimit: 256 * 1024,
  });
  app.decorate("ctx", ctx);

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-origin" },
  });
  await app.register(cookie);
  if (withRateLimit) {
    await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
  }

  registerSession(app);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ error: "Trop de requêtes. Réessaie dans quelques minutes." });
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: "Requête invalide." });
    req.log.error({ err }, "Erreur interne");
    return reply.code(500).send({ error: "Erreur interne. Réessaie plus tard." });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "Introuvable." }));

  app.get("/api/health", async () => ({ ok: true }));

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(battlenetRoutes, { prefix: "/api/auth/battlenet" });
  await app.register(accountRoutes, { prefix: "/api/account" });
  await app.register(characterRoutes, { prefix: "/api/characters" });
  await app.register(gameDataRoutes, { prefix: "/api/gamedata" });
  await app.register(groupRoutes, { prefix: "/api/groups" });
  await app.register(raidRoutes, { prefix: "/api/groups" });

  return app;
}
