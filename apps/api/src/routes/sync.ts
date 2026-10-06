import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { devices } from "../db/schema";
import { ignoredKeys, importAddonText, unignore } from "../lib/addon-import";
import { sha256 } from "../lib/crypto";
import { currentDevice, deviceAuth } from "../lib/device-auth";
import { parse } from "../lib/http";
import { currentUser } from "../lib/session";
import { siteOf } from "../lib/site";
import { allGroupsExport } from "./addon";

/**
 * Synchro de Roster Companion (lot K1), jeton de l'appareil obligatoire. Le jeu suit l'adresse appelée (un site,
 * deux adresses) : l'appli appelle forever-roster.… pour Forever et roster.… pour Retail, avec le même jeton.
 */
const key = z.string().trim().min(3).max(100);

/** Empreinte du FRG sans ses dates de génération : change seulement quand les données changent. */
export const frgEtag = (text: string) => sha256(text.replace(/^(FRG;\d+;[^;\n]*;)\d+;/gm, "$1;")).slice(0, 32);

export async function syncRoutes(app: FastifyInstance) {
  const { db, cfg } = app.ctx;
  app.addHook("preHandler", deviceAuth(app));
  const synced = (id: string) => db.update(devices).set({ lastSyncAt: new Date() }).where(eq(devices.id, id));

  /** Du site vers le jeu : le même texte que « Copier pour le jeu », tous les groupes. 304 si rien n'a changé. */
  app.get("/frg", async (req, reply) => {
    const u = currentUser(req);
    const d = currentDevice(req);
    const out = await allGroupsExport(db, u.id, siteOf(cfg, req).game);
    const etag = `"${frgEtag(out.text)}"`;
    reply.header("Cache-Control", "no-cache").header("ETag", etag);
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    await synced(d.id);
    return { ...out, at: Math.floor(Date.now() / 1000) };
  });

  /**
   * Du jeu vers le site : blocs FRC et FRB lus dans la sauvegarde de l'addon. Un perso inconnu revient « unknown » :
   * l'appli demande, puis renvoie avec create / ignore. Un bilan qui n'est pas celui du chef de raid ne remplace pas le sien.
   */
  app.post("/upload", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const u = currentUser(req);
    const d = currentDevice(req);
    const body = parse(z.object({
      text: z.string().max(250_000),
      create: z.array(key).max(60).default([]),
      ignore: z.array(key).max(60).default([]),
      /** Envoi demandé par le joueur dans l'appli (bilan qui n'est pas celui du chef) : remplace, comme un Ctrl+V. */
      manual: z.boolean().default(false),
    }), req.body);
    const r = await importAddonText(db, u, body.text, {
      game: siteOf(cfg, req).game, unknown: "ask", create: new Set(body.create), ignore: new Set(body.ignore), auto: !body.manual,
    });
    if (r.results.length) await synced(d.id);
    return r;
  });

  /** Persos ignorés (options de l'appli) : liste, et « Ne plus ignorer ». */
  app.get("/ignored", async (req) => ({ ignored: await ignoredKeys(db, currentUser(req).id, siteOf(cfg, req).game) }));
  app.post("/ignored/remove", async (req) => {
    const { keys } = parse(z.object({ keys: z.array(key).min(1).max(60) }), req.body);
    return { removed: await unignore(db, currentUser(req).id, siteOf(cfg, req).game, keys) };
  });
}
