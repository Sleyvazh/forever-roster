import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { devices } from "../db/schema";
import { ignoredKeys, importAddonText, unignore } from "../lib/addon-import";
import { sha256 } from "../lib/crypto";
import { currentDevice, deviceAuth } from "../lib/device-auth";
import { notFound, parse } from "../lib/http";
import { currentUser } from "../lib/session";
import { otherSite, siteOf } from "../lib/site";
import { syncSigner } from "../lib/sync-signing";
import { allGroupsExport, MAX_ADDON_TEXT, UPLOAD_BODY_LIMIT } from "./addon";

/**
 * Synchro de Roster Companion (lot K1), jeton de l'appareil obligatoire. Le jeu suit l'adresse appelée (un site,
 * deux adresses) : l'appli appelle forever-roster.… pour Forever et roster.… pour Retail, avec le même jeton.
 */
const key = z.string().trim().min(3).max(100);

/**
 * Empreinte du FRG (RRG sur Roster) sans ses dates de génération ni ses signatures (qui portent sur la date) : change
 * seulement quand les données changent, ou la clé qui signe (keyId gardé).
 */
export const frgEtag = (text: string) => sha256(text
  .replace(/^((?:FRG|RRG);\d+;[^;\n]*;)\d+;/gm, "$1;")
  .replace(/^(Z;[^;\n]*);[^\n]*$/gm, "$1")).slice(0, 32);

/**
 * Clé publique du site (partage entre joueurs), sans connexion : vérifier la signature des données des groupes,
 * ou écrire addon/shared/SiteKey.lua (scripts/site-key.mjs). 404 si le serveur n'a pas de clé.
 */
export async function syncKeyRoutes(app: FastifyInstance) {
  app.get("/key", async (_req, reply) => {
    const signer = syncSigner(app.ctx.cfg);
    if (!signer) throw notFound("Pas de clé de signature sur ce serveur (SYNC_SIGNING_KEY).");
    reply.header("Cache-Control", "public, max-age=3600");
    return { keyId: signer.keyId, publicKey: signer.publicKey };
  });
}

export async function syncRoutes(app: FastifyInstance) {
  const { db, cfg } = app.ctx;
  app.addHook("preHandler", deviceAuth(app));
  const synced = (id: string) => db.update(devices).set({ lastSyncAt: new Date() }).where(eq(devices.id, id));

  /** Du site vers le jeu : le même texte que « Copier pour le jeu », tous les groupes. 304 si rien n'a changé. */
  app.get("/frg", async (req, reply) => {
    const u = currentUser(req);
    const d = currentDevice(req);
    const out = await allGroupsExport(db, u.id, siteOf(cfg, req).game, syncSigner(cfg));
    const etag = `"${frgEtag(out.text)}"`;
    reply.header("Cache-Control", "no-cache").header("ETag", etag);
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    await synced(d.id);
    return { ...out, at: Math.floor(Date.now() / 1000) };
  });

  /**
   * Du jeu vers le site : blocs FRC, FRB et FRL (relevé de la guilde, jusqu'à 256 Kio) lus dans la sauvegarde de l'addon. Un perso inconnu revient « unknown » :
   * l'appli demande, puis renvoie avec create / ignore. Un bilan qui n'est pas celui du chef de raid ne remplace pas le sien.
   */
  app.post("/upload", { bodyLimit: UPLOAD_BODY_LIMIT, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const u = currentUser(req);
    const d = currentDevice(req);
    const body = parse(z.object({
      text: z.string().max(MAX_ADDON_TEXT),
      create: z.array(key).max(60).default([]),
      ignore: z.array(key).max(60).default([]),
      /** Envoi demandé par le joueur dans l'appli (bilan qui n'est pas celui du chef) : remplace, comme un Ctrl+V. */
      manual: z.boolean().default(false),
    }), req.body);
    const site = siteOf(cfg, req);
    const r = await importAddonText(db, u, body.text, {
      game: site.game, otherHost: otherSite(cfg, site)?.host, unknown: "ask", create: new Set(body.create), ignore: new Set(body.ignore), auto: !body.manual,
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
