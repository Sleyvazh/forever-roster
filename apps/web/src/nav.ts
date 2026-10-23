import { useQuery } from "@tanstack/react-query";
import { matchPath, useLocation } from "react-router-dom";
import { get, type GroupSummary } from "./api";
import { useMe } from "./auth";

/**
 * Navigation de Forever Roster (refonte du 23/10) : cinq entrées, Accueil · Sorties · Raids · Guilde · Mes persos.
 * Les quatre premières sont celles de la guilde courante : celle de l'adresse (/groups/:id/…), sinon la dernière
 * ouverte (gardée dans ce navigateur), sinon la première. Sans guilde, elles mènent à /bienvenue.
 */

const LAST = "fr-guild";
export function readLastGuild(): string | null {
  try { return localStorage.getItem(LAST); } catch { return null; }
}
export function rememberGuild(id: string) {
  try { localStorage.setItem(LAST, id); } catch { /* la première guilde sera proposée */ }
}

export function useMyGuilds() {
  const me = useMe();
  return useQuery({ queryKey: ["groups"], queryFn: () => get<{ groups: GroupSummary[] }>("/groups"), enabled: !!me.data?.user, staleTime: 30_000 });
}

/** Guilde de l'adresse (null hors des pages de guilde). */
export function useGuildInUrl(): string | null {
  const loc = useLocation();
  return matchPath("/groups/:groupId/*", loc.pathname)?.params.groupId ?? null;
}

export function useCurrentGuild() {
  const q = useMyGuilds();
  const fromUrl = useGuildInUrl();
  const guilds = q.data?.groups ?? [];
  const last = readLastGuild();
  const id = fromUrl ?? (last && guilds.some(g => g.id === last) ? last : guilds[0]?.id ?? null);
  return { id, guilds, current: guilds.find(g => g.id === id) ?? null, loading: q.isPending };
}

export type NavKey = "home" | "outings" | "raids" | "guild" | "chars" | null;
/** Entrée de la barre allumée pour une adresse. */
export function navKeyOf(pathname: string): NavKey {
  if (pathname.startsWith("/persos")) return "chars";
  const m = matchPath("/groups/:groupId/:tab/*", pathname);
  if (!m) return matchPath("/groups/:groupId", pathname) ? "home" : null;
  const tab = m.params.tab;
  if (tab === "sorties") return "outings";
  if (tab === "raids" || tab === "presence") return "raids";
  if (tab === "membres" || tab === "admin" || tab === "artisans" || tab === "persos") return "guild";
  return tab === "accueil" ? "home" : null;
}

/** Adresses des entrées pour une guilde (sans guilde : la page Bienvenue). */
export function navLinks(g: string | null): Record<Exclude<NavKey, null>, string> {
  const base = g ? `/groups/${g}` : null;
  return {
    home: base ?? "/bienvenue", outings: base ? `${base}/sorties` : "/bienvenue", raids: base ? `${base}/raids` : "/bienvenue",
    guild: base ? `${base}/membres` : "/bienvenue", chars: "/persos",
  };
}
