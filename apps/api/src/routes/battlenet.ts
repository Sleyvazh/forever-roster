import { and, eq, gt, lt } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { battlenetEnabled } from "../config";
import { bnetImports, oauthStates, users } from "../db/schema";
import { audit } from "../lib/audit";
import { accountCharacters, exchangeCode } from "../lib/blizzard";
import { randomToken, safeEqual, sha256 } from "../lib/crypto";
import { HttpError, badRequest, conflict, noStore, parse } from "../lib/http";
import { createSession, requireAuth } from "../lib/session";
import { siteOf } from "../lib/site";

const STATE_TTL_MS = 10 * 60 * 1000;
/** Liste des persos Battle.net gardée le temps de choisir ceux à importer. */
export const IMPORT_TTL_MS = 30 * 60 * 1000;
const STATE_COOKIE = "fr_oauth";
const COOKIE_PATH = "/api/auth/battlenet";

interface BnetUser { id: string; battletag: string }

export async function battlenetRoutes(app: FastifyInstance) {
  const { db, cfg } = app.ctx;
  const redirectUri = (req: FastifyRequest) => `${siteOf(cfg, req).origin}/api/auth/battlenet/callback`;

  const ensureEnabled = () => {
    if (!battlenetEnabled(cfg)) throw new HttpError(503, "La connexion Battle.net n'est pas configurée sur ce serveur.");
  };

  /** Crée un state aléatoire, stocké haché en base ET lié au navigateur par un cookie (double vérification). */
  async function authorizeUrl(req: FastifyRequest, reply: FastifyReply, mode: "login" | "link" | "bnet_import", userId: string | null) {
    await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
    const state = randomToken();
    await db.insert(oauthStates).values({ stateHash: sha256(state), mode, userId, expiresAt: new Date(Date.now() + STATE_TTL_MS) });
    reply.setCookie(STATE_COOKIE, state, {
      httpOnly: true, secure: cfg.COOKIE_SECURE, sameSite: "lax", path: COOKIE_PATH, maxAge: STATE_TTL_MS / 1000,
    });
    const url = new URL("/authorize", cfg.BNET_OAUTH_HOST);
    url.search = new URLSearchParams({
      // Import (Roster) : en plus, la liste des persos WoW du compte (wow.profile) ; jamais demandé pour la connexion
      client_id: cfg.BNET_CLIENT_ID, redirect_uri: redirectUri(req), response_type: "code", scope: mode === "bnet_import" ? "openid wow.profile" : "openid", state,
    }).toString();
    return url.toString();
  }

  // Connexion : simple navigation vers Battle.net.
  app.get("/start", async (req, reply) => {
    ensureEnabled();
    if (req.user) return reply.redirect(`${siteOf(cfg, req).origin}/`);
    return reply.redirect(await authorizeUrl(req, reply, "login", null));
  });

  // Liaison à un compte existant : POST protégé par le jeton CSRF, le front suit ensuite l'URL renvoyée.
  app.post("/link", { preHandler: requireAuth }, async (req, reply) => {
    ensureEnabled();
    noStore(reply);
    return { url: await authorizeUrl(req, reply, "link", req.user!.id) };
  });

  // Import des persos (Roster, WoW Retail) : Battle.net demande l'accord pour la liste des persos, le site la garde 30 min.
  app.post("/import", { preHandler: requireAuth }, async (req, reply) => {
    ensureEnabled();
    if (siteOf(cfg, req).game !== "retail") throw badRequest("L'import Battle.net sert aux persos de WoW Retail, sur Roster.");
    noStore(reply);
    return { url: await authorizeUrl(req, reply, "bnet_import", req.user!.id) };
  });

  app.get("/callback", async (req, reply) => {
    const fail = (code: string) => {
      reply.clearCookie(STATE_COOKIE, { path: COOKIE_PATH });
      return reply.redirect(`${siteOf(cfg, req).origin}/login?error=${encodeURIComponent(code)}`);
    };
    ensureEnabled();
    const q = z.object({ code: z.string().max(500).optional(), state: z.string().max(100).optional(), error: z.string().max(100).optional() }).safeParse(req.query);
    if (!q.success || q.data.error || !q.data.code || !q.data.state) return fail("bnet_cancelled");

    const cookieState = req.cookies[STATE_COOKIE];
    if (!cookieState || !safeEqual(cookieState, q.data.state)) return fail("bnet_state");
    const [st] = await db.delete(oauthStates)
      .where(and(eq(oauthStates.stateHash, sha256(q.data.state)), gt(oauthStates.expiresAt, new Date())))
      .returning();
    if (!st) return fail("bnet_state");
    reply.clearCookie(STATE_COOKIE, { path: COOKIE_PATH });

    if (st.mode === "bnet_import") {
      const back = (code: string) => reply.redirect(`${siteOf(cfg, req).origin}/persos?bnet=${code}`);
      if (!req.user || req.user.id !== st.userId) return back("session");
      try {
        const token = await exchangeCode(app.ctx, q.data.code, redirectUri(req));
        const list = await accountCharacters(app.ctx, token);
        const expiresAt = new Date(Date.now() + IMPORT_TTL_MS);
        await db.insert(bnetImports).values({ userId: req.user.id, characters: list, expiresAt })
          .onConflictDoUpdate({ target: bnetImports.userId, set: { characters: list, expiresAt } });
        await audit(db, req, "battlenet_import_list", { userId: req.user.id, meta: { count: list.length } });
        return back("import");
      } catch (err) { req.log.warn({ err }, "Import Battle.net : liste des persos illisible"); return back("error"); }
    }

    let bnet: BnetUser;
    try { bnet = await fetchBnetUser(app, q.data.code, redirectUri(req)); }
    catch (err) { req.log.warn({ err }, "Échec OAuth Battle.net"); return fail("bnet_exchange"); }

    const [owner] = await db.select().from(users).where(eq(users.battlenetId, bnet.id));

    if (st.mode === "link") {
      // Le compte à lier doit être celui qui a lancé le flux, et toujours connecté dans ce navigateur.
      if (!req.user || req.user.id !== st.userId) return fail("bnet_session");
      if (owner && owner.id !== req.user.id) return fail("bnet_taken");
      await db.update(users).set({ battlenetId: bnet.id, battletag: bnet.battletag, updatedAt: new Date() }).where(eq(users.id, req.user.id));
      await audit(db, req, "battlenet_linked", { userId: req.user.id, meta: { battletag: bnet.battletag } });
      return reply.redirect(`${siteOf(cfg, req).origin}/account?bnet=linked`);
    }

    let userId = owner?.id;
    if (owner) {
      await db.update(users).set({ battletag: bnet.battletag }).where(eq(users.id, owner.id));
      await audit(db, req, "battlenet_login", { userId: owner.id });
    } else {
      const [created] = await db.insert(users).values({
        displayName: bnet.battletag.split("#")[0] || "Aventurier", battlenetId: bnet.id, battletag: bnet.battletag,
      }).returning({ id: users.id });
      userId = created!.id;
      await audit(db, req, "account_created_battlenet", { userId });
    }
    await createSession(app, req, reply, userId!);
    await audit(db, req, "login_success", { userId, meta: { method: "battlenet" } });
    return reply.redirect(`${siteOf(cfg, req).origin}/`);
  });

  app.delete("/", { preHandler: requireAuth }, async (req: FastifyRequest) => {
    const u = req.user!;
    if (!u.passwordHash) throw conflict("Ajoute d'abord un mot de passe : sans lui, tu ne pourrais plus te connecter.");
    await db.update(users).set({ battlenetId: null, battletag: null, updatedAt: new Date() }).where(eq(users.id, u.id));
    await audit(db, req, "battlenet_unlinked", { userId: u.id });
    return { ok: true };
  });
}

/** Échange le code contre un jeton puis lit l'identité Battle.net (endpoint OpenID userinfo). */
async function fetchBnetUser(app: FastifyInstance, code: string, redirectUri: string): Promise<BnetUser> {
  const { cfg, fetch: f } = app.ctx;
  const access_token = await exchangeCode(app.ctx, code, redirectUri);

  const infoRes = await f(new URL("/userinfo", cfg.BNET_OAUTH_HOST), {
    headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(8000),
  });
  if (!infoRes.ok) throw new Error(`userinfo ${infoRes.status}`);
  const info = parse(z.object({ id: z.union([z.number(), z.string()]), battletag: z.string().min(1).max(64) }), await infoRes.json());
  return { id: String(info.id), battletag: info.battletag };
}
