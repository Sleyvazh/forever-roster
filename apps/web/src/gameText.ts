import { classColor, classLabel, resolveGameLang, specLabel, type GameLang, type RaidEffect } from "@forever/game-data";
import { useQuery } from "@tanstack/react-query";
import { meQuery } from "./me";
import { useSite } from "./site";

/**
 * Noms du jeu affichés selon l'adresse : Forever en anglais (données du jeu), Roster en français ou en anglais
 * (choix du compte, sinon langue du navigateur). Les clés stockées (classe, spé) restent en anglais.
 */
export function useGameText() {
  const site = useSite();
  const me = useQuery(meQuery);
  const game = site.game;
  const lang: GameLang = resolveGameLang(me.data?.user?.gameLang, typeof navigator !== "undefined" ? navigator.language : "fr");
  return {
    game, lang,
    cls: (cls: string) => (cls ? classLabel(game, cls, lang) : ""),
    spec: (cls: string, spec: string) => (spec ? specLabel(game, cls, spec, lang) : ""),
    /** Spé sinon classe (cartes de la compo, inscriptions). */
    specOrClass: (cls: string, spec: string | null | undefined) => (spec ? specLabel(game, cls, spec, lang) : classLabel(game, cls, lang)),
    color: (cls: string) => classColor(cls, game),
    effect: (e: RaidEffect & { fr?: string }) => (game === "retail" && lang === "fr" && e.fr ? e.fr : e.name),
  };
}
