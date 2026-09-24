import { and, eq, gt, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { battlenetEnabled } from "../config";
import { emailTokens, sessions, users } from "../db/schema";
import { audit } from "../lib/audit";
import { randomToken, sha256 } from "../lib/crypto";
import { badRequest, forbidden, noStore, parse, unauthorized } from "../lib/http";
import {
  burnPasswordCheck, checkPasswordPolicy, hashPassword, isPwnedPassword, PASSWORD_MAX, verifyPassword,
} from "../lib/password";
import { createSession, destroySession } from "../lib/session";
import { registerAttempt, resetPassword, verifyEmail } from "../lib/email-templates";
import { normalizeEmail, publicUser } from "../lib/users";

export const MAX_FAILED_LOGINS = 10;
export const LOCK_MS = 15 * 60 * 1000;
const VERIFY_TTL_MS = 24 * 3600 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;

const strict = { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } };

const email = z.email().max(254).transform(normalizeEmail);
const password = z.string().min(1).max(PASSWORD_MAX);
const token = z.string().min(20).max(100);

/** Vérifie la politique de mot de passe et, si activé, les fuites connues. */
export async function assertStrongPassword(app: FastifyInstance, pwd: string, mail?: string | null) {
  const policy = checkPasswordPolicy(pwd, mail);
  if (!policy.ok) throw badRequest(policy.reason!);
  if (app.ctx.cfg.HIBP_CHECK && (await isPwnedPassword(pwd, app.ctx.fetch))) {
    throw badRequest("Ce mot de passe apparaît dans des fuites de données connues. Choisis-en un autre.");
  }
}

export async function issueEmailToken(app: FastifyInstance, userId: string, purpose: "verify" | "reset") {
  const raw = randomToken();
  await app.ctx.db.insert(emailTokens).values({
    userId, purpose, tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + (purpose === "verify" ? VERIFY_TTL_MS : RESET_TTL_MS)),
  });
  // Le jeton est dans le fragment (#) : il n'apparaît ni dans les journaux du serveur ni dans l'en-tête Referer.
  return `${app.ctx.cfg.APP_ORIGIN}/${purpose === "verify" ? "verify-email" : "reset-password"}#${raw}`;
}

async function consumeEmailToken(app: FastifyInstance, raw: string, purpose: "verify" | "reset") {
  const { db } = app.ctx;
  const [row] = await db.update(emailTokens).set({ usedAt: new Date() })
    .where(and(eq(emailTokens.tokenHash, sha256(raw)), eq(emailTokens.purpose, purpose),
      isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, new Date())))
    .returning();
  if (!row) throw badRequest("Ce lien n'est plus valide. Demande-en un nouveau.");
  return row;
}

export async function authRoutes(app: FastifyInstance) {
  const { db, mailer } = app.ctx;

  app.get("/me", async (req, reply) => {
    noStore(reply);
    return {
      user: req.user ? publicUser(req.user) : null,
      csrfToken: req.session?.csrfToken ?? null,
      battlenetEnabled: battlenetEnabled(app.ctx.cfg),
    };
  });

  app.post("/register", strict, async (req, reply) => {
    const body = parse(z.object({ email, password, displayName: z.string().trim().min(2).max(32) }), req.body);
    await assertStrongPassword(app, body.password, body.email);

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email));
    if (existing) {
      // Même réponse qu'une inscription réussie : on ne révèle pas quelles adresses ont un compte.
      await mailer.send({ to: body.email, ...registerAttempt(null, app.ctx.cfg.APP_ORIGIN) });
    } else {
      const [u] = await db.insert(users).values({
        email: body.email, displayName: body.displayName, passwordHash: await hashPassword(body.password),
      }).returning({ id: users.id });
      const link = await issueEmailToken(app, u!.id, "verify");
      await mailer.send({ to: body.email, ...verifyEmail(link, null, app.ctx.cfg.APP_ORIGIN) });
      await audit(db, req, "register", { userId: u!.id });
    }
    return reply.code(202).send({ message: "Si cette adresse est disponible, un e-mail de confirmation vient d'être envoyé." });
  });

  app.post("/verify-email", strict, async (req) => {
    const { token: raw } = parse(z.object({ token }), req.body);
    const row = await consumeEmailToken(app, raw, "verify");
    await db.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, row.userId));
    await audit(db, req, "email_verified", { userId: row.userId });
    return { message: "Adresse confirmée. Tu peux te connecter." };
  });

  app.post("/resend-verification", strict, async (req, reply) => {
    const body = parse(z.object({ email }), req.body);
    const [u] = await db.select().from(users).where(eq(users.email, body.email));
    if (u && !u.emailVerifiedAt) {
      const link = await issueEmailToken(app, u.id, "verify");
      await mailer.send({ to: body.email, ...verifyEmail(link, null, app.ctx.cfg.APP_ORIGIN, false) });
    }
    return reply.code(202).send({ message: "Si un compte non confirmé existe pour cette adresse, un nouvel e-mail a été envoyé." });
  });

  app.post("/login", strict, async (req, reply) => {
    const body = parse(z.object({ email, password }), req.body);
    const generic = unauthorized("E-mail ou mot de passe incorrect, ou trop de tentatives récentes.");
    const [u] = await db.select().from(users).where(eq(users.email, body.email));

    if (!u || !u.passwordHash) {
      await burnPasswordCheck(body.password);
      await audit(db, req, "login_failure", { meta: { reason: "unknown_account" } });
      throw generic;
    }
    if (u.lockedUntil && u.lockedUntil > new Date()) {
      await burnPasswordCheck(body.password);
      await audit(db, req, "login_failure", { userId: u.id, meta: { reason: "locked" } });
      throw generic;
    }
    if (!(await verifyPassword(u.passwordHash, body.password))) {
      const failed = u.failedLogins + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await db.update(users).set({
        failedLogins: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : u.lockedUntil,
      }).where(eq(users.id, u.id));
      await audit(db, req, lock ? "login_locked" : "login_failure", { userId: u.id, meta: { reason: "bad_password", failed } });
      throw generic;
    }
    if (!u.emailVerifiedAt) throw forbidden("Confirme d'abord ton adresse e-mail (vérifie tes spams).");

    await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id));
    const { csrfToken } = await createSession(app, req, reply, u.id);
    await audit(db, req, "login_success", { userId: u.id, meta: { method: "password" } });
    noStore(reply);
    return { user: publicUser(u), csrfToken };
  });

  app.post("/logout", async (req: FastifyRequest, reply) => {
    const uid = req.user?.id;
    await destroySession(app, req, reply);
    if (uid) await audit(db, req, "logout", { userId: uid });
    return { ok: true };
  });

  app.post("/forgot-password", strict, async (req, reply) => {
    const body = parse(z.object({ email }), req.body);
    const [u] = await db.select().from(users).where(eq(users.email, body.email));
    if (u) {
      const link = await issueEmailToken(app, u.id, "reset");
      await mailer.send({ to: body.email, ...resetPassword(link, null, app.ctx.cfg.APP_ORIGIN) });
      await audit(db, req, "password_reset_requested", { userId: u.id });
    }
    return reply.code(202).send({ message: "Si un compte existe pour cette adresse, un e-mail vient d'être envoyé." });
  });

  app.post("/reset-password", strict, async (req) => {
    const body = parse(z.object({ token, password }), req.body);
    const [pending] = await db.select({ userId: emailTokens.userId }).from(emailTokens)
      .where(and(eq(emailTokens.tokenHash, sha256(body.token)), eq(emailTokens.purpose, "reset")));
    const [owner] = pending ? await db.select({ email: users.email }).from(users).where(eq(users.id, pending.userId)) : [];
    await assertStrongPassword(app, body.password, owner?.email);
    const row = await consumeEmailToken(app, body.token, "reset");
    const now = new Date();
    await db.update(users).set({
      passwordHash: await hashPassword(body.password), failedLogins: 0, lockedUntil: null,
      emailVerifiedAt: now, updatedAt: now, // le lien reçu par e-mail prouve aussi la possession de l'adresse
    }).where(eq(users.id, row.userId));
    // Toutes les sessions existantes sont fermées : un attaquant éventuellement connecté est expulsé.
    await db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, row.userId), isNull(sessions.revokedAt)));
    await audit(db, req, "password_reset", { userId: row.userId });
    return { message: "Mot de passe modifié. Tu peux te connecter." };
  });
}
