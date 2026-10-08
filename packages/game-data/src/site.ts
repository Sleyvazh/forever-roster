/**
 * Un site, deux adresses (06/10) : Forever Roster (WoW Forever) et Roster (WoW Retail), même code et mêmes comptes.
 * L'adresse de la requête donne le jeu ; groupes et persos appartiennent à un jeu.
 */
export const GAMES = ["forever", "retail"] as const;
export type Game = (typeof GAMES)[number];
export const isGame = (v: unknown): v is Game => v === "forever" || v === "retail";

export interface SiteInfo {
  game: Game;
  name: string;
  /** Pied des e-mails, après le nom. */
  tagline: string;
  /** Le site est ouvert (sinon : accueil et comptes seulement, « bientôt » une fois connecté, sauf accès anticipé). Roster ouvert à tous le 08/10. */
  open: boolean;
}
export const SITE_INFO: Record<Game, SiteInfo> = {
  forever: { game: "forever", name: "Forever Roster", tagline: "gestion de personnages et de raids pour WoW Forever", open: true },
  retail: { game: "retail", name: "Roster", tagline: "raids, compo et conseil du butin pour ta guilde WoW", open: true },
};
