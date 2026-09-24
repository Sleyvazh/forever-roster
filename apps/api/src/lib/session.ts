import { and, eq, gt, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sessions, users } from "../db/schema";
import { randomToken, safeEqual, sha256 } from "./crypto";
import { forbidden, unauthorized } from "./http";

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // durée absolue
export const SESSION_IDLE_MS = 7 * 24 * 3600 * 1000; // inactivité
const TOUCH_EVERY_MS = 5 * 60 * 1000;

export type UserRow = typeof users.$inferSelect;
export interface SessionInfo { id: string; userId: string; csrfToken: string }

declare module "fastify" {
  interface FastifyRequest {
    session: SessionInfo | null;
    user: UserRow | null;
  }
}

export const cookieName = (secure: boolean) => (secure ? "__Host-fr_sid" : "fr_sid");

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function registerSession(app: FastifyInstance) {
  const { db, cfg } = app.ctx;
  const name = cookieName(cfg.COOKIE_SECURE);

  app.decorateRequest("session", null);
  app.decorateRequest("user", null);

  // 1. Charge la session depuis le cookie
  app.addHook("onRequest", async (req) => {
    const raw = req.cookies[name];
    if (!raw || raw.length > 100) return;
    const now = new Date();
    const rows = await db.select().from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(raw)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
      .limit(1);
    const row = rows[0];
    if (!row) return;
    if (now.getTime() - row.sessions.lastSeenAt.getTime() > SESSION_IDLE_MS) return;
    req.session = { id: row.sessions.id, userId: row.users.id, csrfToken: row.sessions.csrfToken };
    req.user = row.users;
    if (now.getTime() - row.sessions.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessions.id));
    }
  });

  // 2. Protection CSRF : vérification de l'origine + jeton synchronisé pour les requêtes qui modifient des données
  app.addHook("onRequest", async (req) => {
    if (!UNSAFE.has(req.method)) return;
    const origin = req.headers.origin ?? originOf(req.headers.referer);
    if (origin !== cfg.APP_ORIGIN) throw forbidden("Origine de la requête refusée.");
    if (req.session) {
      const sent = req.headers["x-csrf-token"];
      if (typeof sent !== "string" || !safeEqual(sent, req.session.csrfToken)) throw forbidden("Jeton CSRF invalide. Recharge la page.");
    }
  });
}

function originOf(referer: string | undefined) {
  if (!referer) return undefined;
  try { return new URL(referer).origin; } catch { return undefined; }
}

export async function createSession(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply, userId: string) {
  const { db, cfg } = app.ctx;
  // Rotation : l'éventuelle session précédente de ce navigateur est révoquée (anti-fixation).
  if (req.session) await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, req.session.id));
  const token = randomToken();
  const csrfToken = randomToken();
  const [row] = await db.insert(sessions).values({
    userId, tokenHash: sha256(token), csrfToken,
    ip: req.ip, userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  }).returning({ id: sessions.id });
  reply.setCookie(cookieName(cfg.COOKIE_SECURE), token, {
    httpOnly: true, secure: cfg.COOKIE_SECURE, sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS / 1000,
  });
  req.session = { id: row!.id, userId, csrfToken };
  return { csrfToken };
}

export async function destroySession(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply) {
  const { db, cfg } = app.ctx;
  if (req.session) await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, req.session.id));
  reply.clearCookie(cookieName(cfg.COOKIE_SECURE), { path: "/", secure: cfg.COOKIE_SECURE, httpOnly: true, sameSite: "lax" });
  req.session = null; req.user = null;
}

export async function requireAuth(req: FastifyRequest) {
  if (!req.user || !req.session) throw unauthorized();
}

export function currentUser(req: FastifyRequest): UserRow {
  if (!req.user) throw unauthorized();
  return req.user;
}
