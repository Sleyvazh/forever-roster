import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditEvents, groupMembers, sessions, users } from "../db/schema";
import { audit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound, parse } from "../lib/http";
import { hashPassword, PASSWORD_MAX, verifyPassword } from "../lib/password";
import { currentUser, destroySession, requireAuth } from "../lib/session";
import { normalizeEmail, publicUser } from "../lib/users";
import { assertStrongPassword, invalidateEmailTokens, issueEmailToken } from "./auth";
import { deleteImage, normalizeImage, replaceImage } from "../lib/images";
import { verifyEmail } from "../lib/email-templates";

export async function accountRoutes(app: FastifyInstance) {
  const { db, mailer } = app.ctx;
  app.addHook("preHandler", requireAuth);

  app.patch("/profile", async (req) => {
    const u = currentUser(req);
    const body = parse(z.object({ displayName: z.string().trim().min(2).max(32) }), req.body);
    const [row] = await db.update(users).set({ displayName: body.displayName, updatedAt: new Date() }).where(eq(users.id, u.id)).returning();
    return { user: publicUser(row!) };
  });

  app.delete("/discord", async (req) => {
    const u = currentUser(req);
    await db.update(users).set({ discordId: null, discordUsername: null, updatedAt: new Date() }).where(eq(users.id, u.id));
    await audit(db, req, "discord_unlinked", { userId: u.id });
    return { ok: true };
  });

  /** Rappels Discord (message privé la veille des raids). */
  app.patch("/discord", async (req) => {
    const u = currentUser(req);
    const { reminders } = parse(z.object({ reminders: z.boolean() }), req.body);
    const [row] = await db.update(users).set({ discordReminders: reminders, updatedAt: new Date() }).where(eq(users.id, u.id)).returning();
    return { user: publicUser(row!) };
  });

  /** Image du compte (recadrée par le navigateur, ré-encodée ici). */
  app.put("/avatar", { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } }, async (req) => {
    const u = currentUser(req);
    if (!Buffer.isBuffer(req.body)) throw badRequest("Envoie une image PNG, JPEG ou WebP.");
    const data = await normalizeImage(req.body);
    const avatarId = await replaceImage(db, u.id, data, u.avatarId, newId =>
      db.update(users).set({ avatarId: newId, updatedAt: new Date() }).where(eq(users.id, u.id)));
    return { avatarId };
  });

  app.delete("/avatar", async (req) => {
    const u = currentUser(req);
    await db.update(users).set({ avatarId: null }).where(eq(users.id, u.id));
    await deleteImage(db, u.avatarId);
    return { ok: true };
  });

  /** Ajout d'une adresse e-mail (comptes créés via Battle.net). */
  app.post("/email", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const u = currentUser(req);
    if (u.email) throw conflict("Ton compte a déjà une adresse e-mail.");
    const body = parse(z.object({ email: z.email().max(254).transform(normalizeEmail) }), req.body);
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email));
    if (taken) throw conflict("Cette adresse ne peut pas être utilisée.");
    await db.update(users).set({ email: body.email, emailVerifiedAt: null, updatedAt: new Date() }).where(eq(users.id, u.id));
    const link = await issueEmailToken(app, u.id, "verify");
    await mailer.send({ to: body.email, ...verifyEmail(link, null, app.ctx.cfg.APP_ORIGIN, false) });
    return reply.code(202).send({ message: "Un e-mail de confirmation a été envoyé." });
  });

  app.post("/password", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req) => {
    const u = currentUser(req);
    const body = parse(z.object({ currentPassword: z.string().max(PASSWORD_MAX).optional(), newPassword: z.string().min(1).max(PASSWORD_MAX) }), req.body);
    if (u.passwordHash) {
      if (!body.currentPassword || !(await verifyPassword(u.passwordHash, body.currentPassword))) throw forbidden("Mot de passe actuel incorrect.");
    } else if (!u.email || !u.emailVerifiedAt) {
      throw badRequest("Ajoute et confirme d'abord une adresse e-mail, elle servira d'identifiant.");
    }
    await assertStrongPassword(app, body.newPassword, u.email);
    await db.update(users).set({ passwordHash: await hashPassword(body.newPassword), updatedAt: new Date() }).where(eq(users.id, u.id));
    // Un lien de réinitialisation demandé avant ce changement ne doit plus pouvoir l'annuler.
    await invalidateEmailTokens(db, u.id, "reset");
    // Les autres appareils sont déconnectés, la session actuelle est conservée.
    await db.update(sessions).set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, u.id), ne(sessions.id, req.session!.id), isNull(sessions.revokedAt)));
    await audit(db, req, "password_changed", { userId: u.id });
    return { ok: true };
  });

  app.get("/sessions", async (req) => {
    const u = currentUser(req);
    const rows = await db.select({
      id: sessions.id, ip: sessions.ip, userAgent: sessions.userAgent, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt,
    }).from(sessions)
      .where(and(eq(sessions.userId, u.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.lastSeenAt));
    return { sessions: rows.map(s => ({ ...s, current: s.id === req.session!.id })) };
  });

  app.delete("/sessions/:id", async (req, reply) => {
    const u = currentUser(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const [row] = await db.update(sessions).set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, id), eq(sessions.userId, u.id), isNull(sessions.revokedAt))).returning({ id: sessions.id });
    if (!row) throw notFound("Session introuvable.");
    await audit(db, req, "session_revoked", { userId: u.id, meta: { sessionId: id } });
    if (id === req.session!.id) await destroySession(app, req, reply);
    return { ok: true };
  });

  app.post("/sessions/revoke-others", async (req) => {
    const u = currentUser(req);
    const rows = await db.update(sessions).set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, u.id), ne(sessions.id, req.session!.id), isNull(sessions.revokedAt))).returning({ id: sessions.id });
    await audit(db, req, "sessions_revoked_all", { userId: u.id, meta: { count: rows.length } });
    return { revoked: rows.length };
  });

  app.get("/audit", async (req) => {
    const u = currentUser(req);
    const rows = await db.select({
      id: auditEvents.id, type: auditEvents.type, ip: auditEvents.ip, userAgent: auditEvents.userAgent, meta: auditEvents.meta, createdAt: auditEvents.createdAt,
    }).from(auditEvents).where(eq(auditEvents.userId, u.id)).orderBy(desc(auditEvents.createdAt)).limit(100);
    return { events: rows };
  });

  /** Droit à l'effacement (RGPD) : supprime le compte, ses persos et ses sessions. */
  app.delete("/", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const u = currentUser(req);
    const body = parse(z.object({ password: z.string().max(PASSWORD_MAX).optional(), confirm: z.string().optional() }), req.body ?? {});
    if (u.passwordHash) {
      if (!body.password || !(await verifyPassword(u.passwordHash, body.password))) throw forbidden("Mot de passe incorrect.");
    } else if (body.confirm !== "SUPPRIMER") {
      throw badRequest("Tape SUPPRIMER pour confirmer.");
    }
    const owned = await db.select({ groupId: groupMembers.groupId }).from(groupMembers)
      .where(and(eq(groupMembers.userId, u.id), eq(groupMembers.role, "owner")));
    if (owned.length) throw conflict("Tu es propriétaire d'au moins un groupe : supprime-le ou transfère-le avant de supprimer ton compte.");
    await destroySession(app, req, reply);
    await db.delete(users).where(eq(users.id, u.id));
    return { ok: true };
  });
}
