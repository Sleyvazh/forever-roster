import { SITE_INFO, type Game, type SiteInfo } from "@forever/game-data";
import type { FastifyRequest } from "fastify";
import type { Config } from "../config";

/**
 * Un site, deux adresses : APP_ORIGIN (Forever Roster) et RETAIL_ORIGIN (Roster). L'adresse à laquelle la requête
 * arrive donne le site : son jeu, son nom et l'origine des liens (e-mails, invitations, retour de Discord).
 * Une adresse inconnue est traitée comme Forever Roster.
 */
export interface Site extends SiteInfo { origin: string; host: string }

const hostOf = (origin: string) => new URL(origin).host.toLowerCase();

export function sites(cfg: Config): Site[] {
  const out: Site[] = [{ ...SITE_INFO.forever, origin: cfg.APP_ORIGIN, host: hostOf(cfg.APP_ORIGIN) }];
  if (cfg.RETAIL_ORIGIN) out.push({ ...SITE_INFO.retail, origin: cfg.RETAIL_ORIGIN, host: hostOf(cfg.RETAIL_ORIGIN) });
  return out;
}

export function siteForHost(cfg: Config, host: string | undefined): Site {
  const all = sites(cfg);
  const h = (host ?? "").toLowerCase();
  return all.find(s => s.host === h) ?? all[0]!;
}

/** Site d'une requête (en-tête Host, ou X-Forwarded-Host derrière Caddy avec TRUST_PROXY). */
export const siteOf = (cfg: Config, req: FastifyRequest) => siteForHost(cfg, req.host);

/** Site d'un jeu (liens vers un groupe, quel que soit le site d'où part la demande). */
export function siteForGame(cfg: Config, game: Game): Site {
  const all = sites(cfg);
  return all.find(s => s.game === game) ?? all[0]!;
}

/** L'autre site, s'il existe (pour « Déjà un compte sur … ? »). */
export function otherSite(cfg: Config, site: Site): Site | null {
  return sites(cfg).find(s => s.game !== site.game) ?? null;
}
