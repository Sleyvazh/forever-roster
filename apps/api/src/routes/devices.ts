import { normalizeUserCode, PAIR_POLL_INTERVAL_S, USER_CODE_ALPHABET, USER_CODE_TTL_S } from "@forever/game-data";
import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { devicePairings, devices } from "../db/schema";
import { audit } from "../lib/audit";
import { randomToken, sha256 } from "../lib/crypto";
import { currentDevice, deviceAuth, newDeviceToken } from "../lib/device-auth";
import { notFound, parse } from "../lib/http";
import { currentUser, requireAuth } from "../lib/session";
import { siteOf } from "../lib/site";

/**
 * Appareils reliés (Roster Companion, lot K1), façon « device flow » (RFC 8628) :
 * 1. l'appli demande un code (POST /pair) et l'affiche ; 2. le joueur, connecté sur le site, le valide (page /appairer) ;
 * 3. l'appli, qui attend (POST /pair/poll), reçoit son jeton une seule fois. Aucun mot de passe ne passe par l'appli.
 */
const MAX_DEVICES = 10;
const deviceInfo = z.object({
  name: z.string().trim().min(1).max(60),
  platform: z.string().trim().max(40).default(""),
  appVersion: z.string().trim().max(20).default(""),
});

function userCode() {
  let s = "";
  for (let i = 0; i < 8; i++) s += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export async function deviceRoutes(app: FastifyInstance) {
  const { db, cfg } = app.ctx;
  const device = deviceAuth(app);

  /** 1. L'appli demande un code (sans compte). */
  app.post("/pair", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req) => {
    const info = parse(deviceInfo, req.body);
    // Ménage : demandes de plus d'un jour
    await db.delete(devicePairings).where(lt(devicePairings.expiresAt, new Date(Date.now() - 24 * 3600_000)));
    const pairId = randomToken(32);
    for (let attempt = 0; ; attempt++) {
      const code = userCode();
      try {
        await db.insert(devicePairings).values({
          pairHash: sha256(pairId), userCode: code, ...info, ip: req.ip, expiresAt: new Date(Date.now() + USER_CODE_TTL_S * 1000),
        });
        return { pairId, userCode: code, expiresIn: USER_CODE_TTL_S, interval: PAIR_POLL_INTERVAL_S, verifyUrl: `${siteOf(cfg, req).origin}/appairer?code=${code}` };
      } catch (e) {
        if (attempt >= 4) throw e; // code déjà pris (rarissime) : on en tire un autre
      }
    }
  });

  /** 3. L'appli attend la réponse ; le jeton n'est remis qu'une fois. */
  app.post("/pair/poll", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { pairId } = parse(z.object({ pairId: z.string().min(20).max(100) }), req.body);
    const [p] = await db.select().from(devicePairings).where(eq(devicePairings.pairHash, sha256(pairId)));
    if (!p || p.status === "done") return { status: "expired" as const };
    if (p.status === "denied") return { status: "denied" as const };
    if (p.status === "pending" && p.expiresAt < new Date()) return { status: "expired" as const };
    const now = new Date();
    if (p.lastPollAt && now.getTime() - p.lastPollAt.getTime() < (PAIR_POLL_INTERVAL_S - 1) * 1000) return { status: "slow_down" as const };
    await db.update(devicePairings).set({ lastPollAt: now }).where(eq(devicePairings.id, p.id));
    if (p.status === "pending") return { status: "pending" as const };
    // Validée : une seule réponse crée l'appareil (deux attentes simultanées n'obtiennent pas deux jetons)
    const [won] = await db.update(devicePairings).set({ status: "done" })
      .where(and(eq(devicePairings.id, p.id), eq(devicePairings.status, "approved"))).returning({ userId: devicePairings.userId });
    if (!won?.userId) return { status: "expired" as const };
    const token = newDeviceToken();
    const [d] = await db.insert(devices).values({
      userId: won.userId, name: p.name, platform: p.platform, appVersion: p.appVersion, tokenHash: sha256(token), lastIp: req.ip,
    }).returning({ id: devices.id, name: devices.name });
    return { status: "approved" as const, token, device: d! };
  });

  /** 2. Page /appairer : ce que l'appli a déclaré, pour comparer avant de valider. */
  app.get("/pair/:code", { preHandler: requireAuth }, async (req) => {
    const code = normalizeUserCode(parse(z.object({ code: z.string().max(20) }), req.params).code);
    const [p] = code ? await db.select().from(devicePairings)
      .where(and(eq(devicePairings.userCode, code), eq(devicePairings.status, "pending"), gt(devicePairings.expiresAt, new Date()))) : [];
    if (!p) throw notFound("Code inconnu ou expiré : relance l'appairage dans l'appli.");
    return { pairing: { code: p.userCode, name: p.name, platform: p.platform, appVersion: p.appVersion, ip: p.ip, createdAt: p.createdAt, expiresAt: p.expiresAt } };
  });

  const decide = (approve: boolean) => async (req: import("fastify").FastifyRequest) => {
    const u = currentUser(req);
    const code = normalizeUserCode(parse(z.object({ code: z.string().max(20) }), req.body).code);
    const [p] = code ? await db.update(devicePairings).set({ status: approve ? "approved" : "denied", userId: u.id })
      .where(and(eq(devicePairings.userCode, code), eq(devicePairings.status, "pending"), gt(devicePairings.expiresAt, new Date())))
      .returning({ name: devicePairings.name, platform: devicePairings.platform }) : [];
    if (!p) throw notFound("Code inconnu ou expiré : relance l'appairage dans l'appli.");
    if (approve) {
      // Au-delà de 10 appareils, le plus ancien est délié
      const active = await db.select({ id: devices.id }).from(devices).where(and(eq(devices.userId, u.id), isNull(devices.revokedAt))).orderBy(desc(devices.createdAt));
      for (const old of active.slice(MAX_DEVICES - 1)) await db.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, old.id));
    }
    await audit(db, req, approve ? "device_linked" : "device_pair_denied", { userId: u.id, meta: { name: p.name, platform: p.platform } });
    return { ok: true };
  };
  app.post("/pair/approve", { preHandler: requireAuth }, decide(true));
  app.post("/pair/deny", { preHandler: requireAuth }, decide(false));

  /** Compte & sécurité : appareils reliés. */
  app.get("/", { preHandler: requireAuth }, async (req) => {
    const u = currentUser(req);
    const rows = await db.select({
      id: devices.id, name: devices.name, platform: devices.platform, appVersion: devices.appVersion,
      createdAt: devices.createdAt, lastSeenAt: devices.lastSeenAt, lastSyncAt: devices.lastSyncAt,
    }).from(devices).where(and(eq(devices.userId, u.id), isNull(devices.revokedAt))).orderBy(desc(devices.createdAt));
    return { devices: rows };
  });

  app.delete("/:id", { preHandler: requireAuth }, async (req) => {
    const u = currentUser(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const [d] = await db.update(devices).set({ revokedAt: new Date() })
      .where(and(eq(devices.id, id), eq(devices.userId, u.id), isNull(devices.revokedAt))).returning({ name: devices.name });
    if (!d) throw notFound("Appareil introuvable.");
    await audit(db, req, "device_unlinked", { userId: u.id, meta: { name: d.name, by: "site" } });
    return { ok: true };
  });

  /** L'appli : son appareil et son compte (vérifie que le jeton est toujours valable). */
  app.get("/self", { preHandler: device }, async (req) => {
    const d = currentDevice(req);
    const u = currentUser(req);
    const site = siteOf(cfg, req);
    return { device: { id: d.id, name: d.name, createdAt: d.createdAt }, user: { displayName: u.displayName }, site: { name: site.name, game: site.game, origin: site.origin } };
  });

  /** L'appli se délie elle-même (option « Délier cet appareil »). */
  app.delete("/self", { preHandler: device }, async (req) => {
    const d = currentDevice(req);
    await db.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, d.id));
    await audit(db, req, "device_unlinked", { userId: d.userId, meta: { name: d.name, by: "app" } });
    return { ok: true };
  });
}
