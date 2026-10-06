import { RETAIL_CLASS_IDS, retailSpec, type BnetCharacter } from "@forever/game-data";
import { z } from "zod";
import type { Config } from "../config";

/**
 * API de Blizzard (Roster, WoW Retail, région Europe).
 *  - jeton d'application (client credentials) : profil public d'un perso (niveau, niveau d'objet, spé active) ;
 *  - jeton de l'utilisateur (scope wow.profile, valable 24 h, jamais gardé) : liste des persos de son compte, une fois, à l'import.
 * Les identifiants (BNET_CLIENT_ID / BNET_CLIENT_SECRET) restent sur le serveur.
 */
export interface BlizzardCtx { cfg: Config; fetch: typeof fetch }

const NAMESPACE = "profile-eu";
const TIMEOUT = 8000;

export class BlizzardError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const basicAuth = (cfg: Config) => `Basic ${Buffer.from(`${encodeURIComponent(cfg.BNET_CLIENT_ID)}:${encodeURIComponent(cfg.BNET_CLIENT_SECRET)}`).toString("base64")}`;
const tokenShape = z.object({ access_token: z.string().min(1), expires_in: z.number().optional() });

/** Code OAuth → jeton de l'utilisateur (connexion, liaison ou import). */
export async function exchangeCode(ctx: BlizzardCtx, code: string, redirectUri: string): Promise<string> {
  const res = await ctx.fetch(new URL("/token", ctx.cfg.BNET_OAUTH_HOST), {
    method: "POST",
    headers: { Authorization: basicAuth(ctx.cfg), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new BlizzardError(res.status, `token ${res.status}`);
  return tokenShape.parse(await res.json()).access_token;
}

// Jeton d'application, gardé en mémoire jusqu'à une minute avant son expiration (un par configuration)
const appTokens = new WeakMap<Config, { token: string; until: number }>();
async function appToken(ctx: BlizzardCtx, fresh = false): Promise<string> {
  const c = appTokens.get(ctx.cfg);
  if (!fresh && c && c.until > Date.now()) return c.token;
  const res = await ctx.fetch(new URL("/token", ctx.cfg.BNET_OAUTH_HOST), {
    method: "POST",
    headers: { Authorization: basicAuth(ctx.cfg), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new BlizzardError(res.status, `client_credentials ${res.status}`);
  const t = tokenShape.parse(await res.json());
  appTokens.set(ctx.cfg, { token: t.access_token, until: Date.now() + Math.max(60, (t.expires_in ?? 3600) - 60) * 1000 });
  return t.access_token;
}

const apiUrl = (cfg: Config, path: string, locale: string) => {
  const u = new URL(path, cfg.BNET_API_HOST);
  u.search = new URLSearchParams({ namespace: NAMESPACE, locale }).toString();
  return u;
};

const accountShape = z.object({
  wow_accounts: z.array(z.object({
    characters: z.array(z.object({
      id: z.number(), name: z.string().min(1).max(40), level: z.number(),
      realm: z.object({ name: z.string().max(60), slug: z.string().max(60) }),
      playable_class: z.object({ id: z.number() }),
      faction: z.object({ type: z.string() }).optional(),
    }).loose()).default([]),
  }).loose()).default([]),
}).loose();

/** Persos du compte Battle.net (tous les comptes WoW du compte), du plus haut niveau au plus bas. Noms de royaumes en français. */
export async function accountCharacters(ctx: BlizzardCtx, userToken: string): Promise<BnetCharacter[]> {
  const res = await ctx.fetch(apiUrl(ctx.cfg, "/profile/user/wow", "fr_FR"), {
    headers: { Authorization: `Bearer ${userToken}` }, signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new BlizzardError(res.status, `profile/user/wow ${res.status}`);
  const data = accountShape.parse(await res.json());
  const out: BnetCharacter[] = [];
  for (const a of data.wow_accounts) {
    for (const c of a.characters) {
      const cls = RETAIL_CLASS_IDS[c.playable_class.id];
      if (!cls || out.some(o => o.id === c.id)) continue;
      out.push({ id: c.id, name: c.name, realm: c.realm.name, realmSlug: c.realm.slug, cls, level: Math.max(1, Math.min(90, c.level)), faction: c.faction?.type === "HORDE" ? "Horde" : "Alliance" });
    }
  }
  out.sort((x, y) => y.level - x.level || x.name.localeCompare(y.name, "fr"));
  return out.slice(0, 200);
}

const summaryShape = z.object({
  id: z.number(), level: z.number(),
  character_class: z.object({ id: z.number() }),
  active_spec: z.object({ name: z.string() }).optional(),
  equipped_item_level: z.number().optional(),
  average_item_level: z.number().optional(),
}).loose();

export interface CharacterSummary { bnetId: number; cls: string | null; level: number; ilvl: number | null; activeSpec: string }

/**
 * Profil public d'un perso (jeton d'application) : null si Blizzard ne le connaît pas (nom, royaume) ou s'il est masqué.
 * Noms en anglais : la spé active se compare directement aux clés du site.
 */
export async function characterSummary(ctx: BlizzardCtx, realmSlug: string, name: string): Promise<CharacterSummary | null> {
  const path = `/profile/wow/character/${encodeURIComponent(realmSlug)}/${encodeURIComponent(name.trim().toLowerCase())}`;
  const get = async (fresh: boolean) => ctx.fetch(apiUrl(ctx.cfg, path, "en_US"), {
    headers: { Authorization: `Bearer ${await appToken(ctx, fresh)}` }, signal: AbortSignal.timeout(TIMEOUT),
  });
  let res = await get(false);
  if (res.status === 401) res = await get(true); // jeton d'application expiré plus tôt que prévu
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new BlizzardError(res.status, `character ${res.status}`);
  const s = summaryShape.parse(await res.json());
  const cls = RETAIL_CLASS_IDS[s.character_class.id] ?? null;
  const spec = s.active_spec?.name ?? "";
  return {
    bnetId: s.id, cls, level: Math.max(1, Math.min(90, s.level)),
    ilvl: s.equipped_item_level ?? s.average_item_level ?? null,
    activeSpec: cls && retailSpec(cls, spec) ? spec : "",
  };
}

/** Exécute `fn` sur chaque élément, `n` à la fois (Blizzard : 100 requêtes par seconde au plus). */
export async function eachLimited<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]!); }
  }));
  return out;
}
