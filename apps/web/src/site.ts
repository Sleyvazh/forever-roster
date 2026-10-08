import type { Game } from "@forever/game-data";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { get } from "./api";
import { meQuery } from "./me";

/**
 * Un site, deux adresses : Forever Roster et Roster (WoW Retail). L'API dit à quelle adresse on est (/api/site) :
 * nom, jeu, site ouvert ou pas encore, et l'autre adresse. Avant sa réponse, on devine d'après le nom de domaine.
 */
export interface SiteData {
  game: Game;
  name: string;
  open: boolean;
  origin: string;
  other: { game: Game; name: string; origin: string } | null;
  /** Roster encore fermé mais ouvert pour ce compte (accès anticipé). */
  preview?: boolean;
}

const guess = (): SiteData => {
  const retail = typeof location !== "undefined" && location.hostname.split(".")[0] === "roster";
  return retail
    ? { game: "retail", name: "Roster", open: true, origin: location.origin, other: null }
    : { game: "forever", name: "Forever Roster", open: true, origin: typeof location !== "undefined" ? location.origin : "", other: null };
};

export function useSite(): SiteData {
  const q = useQuery({ queryKey: ["site"], queryFn: () => get<SiteData>("/site"), staleTime: Infinity, retry: 1 });
  const me = useQuery(meQuery);
  const site = q.data ?? guess();
  // Accès anticipé (Flo et les officiers) : Roster s'ouvre pour ce compte avant tout le monde
  if (!site.open && site.game === "retail" && me.data?.user?.rosterPreview) return { ...site, open: true, preview: true };
  return site;
}

/** Habillage du site : couleur d'accent (classe site-retail), titre de l'onglet, favicon et icône d'écran d'accueil. */
export function useApplySite(site: SiteData) {
  useEffect(() => {
    document.documentElement.classList.toggle("site-retail", site.game === "retail");
    if (!document.title || document.title === "Forever Roster" || document.title === "Roster") document.title = site.name;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = site.game === "retail" ? "/favicon-roster.svg" : "/favicon.svg";
    const touch = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (touch) touch.href = site.game === "retail" ? "/apple-touch-icon-roster.png" : "/apple-touch-icon.png";
  }, [site.game, site.name]);
}
