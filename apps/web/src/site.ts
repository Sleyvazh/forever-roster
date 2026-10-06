import type { Game } from "@forever/game-data";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { get } from "./api";

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
}

const guess = (): SiteData => {
  const retail = typeof location !== "undefined" && location.hostname.split(".")[0] === "roster";
  return retail
    ? { game: "retail", name: "Roster", open: false, origin: location.origin, other: null }
    : { game: "forever", name: "Forever Roster", open: true, origin: typeof location !== "undefined" ? location.origin : "", other: null };
};

export function useSite(): SiteData {
  const q = useQuery({ queryKey: ["site"], queryFn: () => get<SiteData>("/site"), staleTime: Infinity, retry: 1 });
  return q.data ?? guess();
}

/** Habillage du site : couleur d'accent (classe site-retail), titre de l'onglet et favicon. */
export function useApplySite(site: SiteData) {
  useEffect(() => {
    document.documentElement.classList.toggle("site-retail", site.game === "retail");
    if (!document.title || document.title === "Forever Roster" || document.title === "Roster") document.title = site.name;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = site.game === "retail" ? "/favicon-roster.svg" : "/favicon.svg";
  }, [site.game, site.name]);
}
