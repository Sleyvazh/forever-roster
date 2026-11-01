import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppContext } from "./app";
import { claimBankNotices, markBankNoticeSent } from "./lib/bank-requests";
import { parse } from "./lib/http";
import { siteForGame } from "./lib/site";

/**
 * API interne du bot pour les demandes de retrait à la banque (Forever) : les MP « ta demande est prête » et « ta demande a été
 * refusée » (file bank_request_notices, lib/bank-requests.ts). Chaque MP n'est remis qu'une fois au bot ; il confirme l'envoi.
 * Le bot n'écrit qu'aux joueurs qui ont lié leur Discord et gardé les « Messages privés du bot » (comme les sorties et les rappels).
 */
export function bankNoticeRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, cfg } = ctx;
  const now = () => ctx.now?.() ?? new Date();

  app.post("/internal/discord/bank/notices/claim", async () => ({ notices: await claimBankNotices(db, siteForGame(cfg, "forever").origin, now()) }));

  app.post("/internal/discord/bank/notices/:id/sent", async (req: FastifyRequest) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    await markBankNoticeSent(db, id, now());
    return { ok: true };
  });
}
