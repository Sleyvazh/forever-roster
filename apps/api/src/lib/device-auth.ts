import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { devices, users } from "../db/schema";
import { randomToken, sha256 } from "./crypto";
import { unauthorized } from "./http";

/**
 * Roster Companion (lot K1) : un appareil relié s'authentifie par un jeton Bearer « rc_… », propre à l'appareil,
 * haché en base comme les sessions. Il ne vaut que pour la synchro (/api/sync) et pour se délier (/api/devices/self) :
 * aucune route à cookie ne l'accepte (requireAuth exige une session).
 */
export type DeviceRow = typeof devices.$inferSelect;

declare module "fastify" {
  interface FastifyRequest { device: DeviceRow | null }
}

const TOKEN = /^rc_[A-Za-z0-9_-]{40,60}$/;
const TOUCH_EVERY_MS = 5 * 60 * 1000;

export const newDeviceToken = () => `rc_${randomToken(32)}`;

/**
 * Routes de Roster Companion sans cookie : jeton Bearer (qu'un navigateur n'envoie jamais tout seul) ou sans compte
 * (demande d'appairage, attente du jeton). Elles échappent à la vérification CSRF des routes à cookie.
 */
const DEVICE_URL = /^\/api\/(sync\/|devices\/(self|pair|pair\/poll)(\?|$))/;
export const isDeviceUrl = (url: string) => DEVICE_URL.test(url);

export function registerDeviceAuth(app: FastifyInstance) {
  app.decorateRequest("device", null);
}

/** preHandler des routes de l'appli : l'appareil (non délié) et son compte, d'après le jeton. */
export function deviceAuth(app: FastifyInstance) {
  const { db } = app.ctx;
  return async (req: FastifyRequest) => {
    const h = req.headers.authorization ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
    if (!TOKEN.test(token)) throw unauthorized("Appareil non relié : relie Roster Companion à ton compte.");
    const [row] = await db.select().from(devices).innerJoin(users, eq(users.id, devices.userId))
      .where(and(eq(devices.tokenHash, sha256(token)), isNull(devices.revokedAt))).limit(1);
    if (!row) throw unauthorized("Appareil délié : relie Roster Companion de nouveau.");
    // Seul le compte de l'appareil compte ici, jamais un éventuel cookie de session
    req.device = row.devices;
    req.user = row.users;
    req.session = null;
    const now = new Date();
    if (now.getTime() - row.devices.lastSeenAt.getTime() > TOUCH_EVERY_MS || row.devices.lastIp !== req.ip) {
      await db.update(devices).set({ lastSeenAt: now, lastIp: req.ip }).where(eq(devices.id, row.devices.id));
    }
  };
}

export function currentDevice(req: FastifyRequest): DeviceRow {
  if (!req.device) throw unauthorized();
  return req.device;
}
