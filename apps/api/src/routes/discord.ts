import { and, eq, gt, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { discordEnabled } from "../config";
import { oauthStates, users } from "../db/schema";
import { audit } from "../lib/audit";
import { randomToken, safeEqual, sha256 } from "../lib/crypto";
import { HttpError, noStore, parse } from "../lib/http";
import { requireAuth } from "../lib/session";

const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_COOKIE = "fr_discord";
const COOKIE_PATH = "/api/auth/discord";

/**
 * Liaison d'un compte Discord à un compte du site (OAuth2, portée « identify » seulement :
 * on lit l'identifiant et le pseudo, jamais l'e-mail ni les serveurs). Même protection que Battle.net :
 * state aléatoire haché en base ET cookie lié au navigateur, flux lancé par un POST protégé par le jeton CSRF.
 */
export async function discordRoutes(app: FastifyInstance) {
  const { db, cfg } = app.ctx;
  const redirectUri = `${cfg.APP_ORIGIN}/api/auth/discord/callback`;
  const ensureEnabled = () => { if (!discordEnabled(cfg)) throw new HttpError(503, "La liaison Discord n'est pas configurée sur ce serveur."); };

  app.post("/link", { preHandler: requireAuth }, async (req, reply) => {
    ensureEnabled();
    noStore(reply);
    await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
    const state = randomToken();
    await db.insert(oauthStates).values({ stateHash: sha256(state), mode: "discord_link", userId: req.user!.id, expiresAt: new Date(Date.now() + STATE_TTL_MS) });
    reply.setCookie(STATE_COOKIE, state, { httpOnly: true, secure: cfg.COOKIE_SECURE, sameSite: "lax", path: COOKIE_PATH, maxAge: STATE_TTL_MS / 1000 });
    const url = new URL("/oauth2/authorize", cfg.DISCORD_HOST);
    url.search = new URLSearchParams({ client_id: cfg.DISCORD_CLIENT_ID, redirect_uri: redirectUri, response_type: "code", scope: "identify", state, prompt: "none" }).toString();
    return { url: url.toString() };
  });

  app.get("/callback", async (req, reply) => {
    const back = (q: string) => { reply.clearCookie(STATE_COOKIE, { path: COOKIE_PATH }); return reply.redirect(`${cfg.APP_ORIGIN}/account?${q}`); };
    ensureEnabled();
    const q = z.object({ code: z.string().max(500).optional(), state: z.string().max(100).optional(), error: z.string().max(100).optional() }).safeParse(req.query);
    if (!q.success || q.data.error || !q.data.code || !q.data.state) return back("error=discord_cancelled");
    const cookieState = req.cookies[STATE_COOKIE];
    if (!cookieState || !safeEqual(cookieState, q.data.state)) return back("error=discord_state");
    const [st] = await db.delete(oauthStates)
      .where(and(eq(oauthStates.stateHash, sha256(q.data.state)), eq(oauthStates.mode, "discord_link"), gt(oauthStates.expiresAt, new Date())))
      .returning();
    if (!st) return back("error=discord_state");
    // Le compte à lier doit être celui qui a lancé le flux, toujours connecté dans ce navigateur.
    if (!req.user || req.user.id !== st.userId) return back("error=discord_session");

    let du: { id: string; username: string };
    try { du = await fetchDiscordUser(app, q.data.code, redirectUri); }
    catch (err) { req.log.warn({ err }, "Échec OAuth Discord"); return back("error=discord_exchange"); }

    const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.discordId, du.id));
    if (owner && owner.id !== req.user.id) return back("error=discord_taken");
    await db.update(users).set({ discordId: du.id, discordUsername: du.username, updatedAt: new Date() }).where(eq(users.id, req.user.id));
    await audit(db, req, "discord_linked", { userId: req.user.id, meta: { username: du.username } });
    return back("discord=linked");
  });
}

async function fetchDiscordUser(app: FastifyInstance, code: string, redirectUri: string) {
  const { cfg, fetch: f } = app.ctx;
  const tokenRes = await f(new URL("/api/oauth2/token", cfg.DISCORD_HOST), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.DISCORD_CLIENT_ID, client_secret: cfg.DISCORD_CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(8000),
  });
  if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}`);
  const { access_token } = parse(z.object({ access_token: z.string().min(1) }), await tokenRes.json());
  const meRes = await f(new URL("/api/users/@me", cfg.DISCORD_HOST), { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(8000) });
  if (!meRes.ok) throw new Error(`users/@me ${meRes.status}`);
  const me = parse(z.object({ id: z.string().regex(/^\d{5,25}$/), username: z.string().min(1).max(64), global_name: z.string().max(64).nullable().optional() }), await meRes.json());
  return { id: me.id, username: me.global_name || me.username };
}
