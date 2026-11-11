import { classesOf, classLabel, roleOf, SIGNUP_HINT, SIGNUP_LABEL, specLabel, specsOf as gameSpecs, type Game, type GameLang, type Role, type SignupStatus } from "@forever/game-data";
import { ButtonStyle, ComponentType, type APISelectMenuOption } from "discord.js";
import type { ChoiceChar, Choices, SignupBody } from "./api";
import { langOf, tr, type Lang } from "./i18n";
import { encodeId } from "./ids";
import { statusLabel, type Row } from "./render";

/**
 * Parcours d'inscription par boutons, comme Raid-Helper :
 *  - clic sur un statut → si le joueur a déjà choisi perso + spé, on change juste le statut ;
 *  - sinon un menu (visible par lui seul) propose ses persos et spés (compte lié)
 *    ou sa classe puis sa spé (inscription libre, sans compte).
 * Fonctions pures : elles décident quoi répondre, `main.ts` s'occupe de Discord.
 * Roster (WoW Retail) : classes et spés de Retail, noms dans la langue de Discord du joueur (français par défaut).
 */

export type Step =
  | { kind: "signup"; body: SignupBody; label: string }
  | { kind: "reply"; content: string; components: Row[] };

const MAX_OPTIONS = 25;
// Jamais d'option présélectionnée (« default ») : Discord ne renvoie rien quand on choisit l'option déjà sélectionnée,
// le joueur ne pourrait pas garder sa spé ou son perso actuel. Le choix actuel est indiqué dans la description.
const specsOf = (game: Game, cls: string): { name: string; role: Role }[] => gameSpecs(game, cls).map(name => ({ name, role: roleOf(name) ?? "DPS" }));

/** Libellé « Spé Classe » d'une inscription libre (message de confirmation). */
export const guestLabel = (game: Game, lang: GameLang, cls: string, spec: string) => `${specLabel(game, cls, spec, lang)} ${classLabel(game, cls, lang)}`;

const select = (custom_id: string, placeholder: string, options: APISelectMenuOption[]): Row => ({
  type: ComponentType.ActionRow,
  components: [{ type: ComponentType.StringSelect, custom_id, placeholder, options: options.slice(0, MAX_OPTIONS), min_values: 1, max_values: 1 }],
});

const intro = (ui: Lang, status: SignupStatus) => `**${statusLabel(ui, status)}** — ${tr(ui, SIGNUP_HINT[status])}`;

/**
 * Clic sur un bouton de statut (ou « changer de perso / spé » avec `force`). lang : langue des noms du jeu (Discord du
 * joueur) ; les phrases sont dans la langue du bot pour la guilde (c.lang).
 */
export function onStatus(raidId: string, status: SignupStatus, c: Choices, force = false, lang: GameLang = "fr"): Step {
  const cur = c.current;
  const game = c.game ?? "forever";
  const ui = langOf(c);
  if (c.mode === "member") {
    const curChar = cur?.characterId ? c.characters.find(ch => ch.id === cur.characterId) : undefined;
    if (!force && curChar) return { kind: "signup", body: { status, characterId: curChar.id, spec: cur!.spec || undefined }, label: charLabel(curChar.name, cur!.spec && specLabel(game, curChar.cls, cur!.spec, lang)) };
    if (status === "absent" && !force) return { kind: "signup", body: { status, characterId: null }, label: "" };
    return memberMenu(raidId, status, c.characters, cur?.characterId ?? null, cur?.spec ?? null, game, lang, ui);
  }
  if (!force && cur?.cls && cur.spec) return { kind: "signup", body: { status, cls: cur.cls, spec: cur.spec }, label: guestLabel(game, lang, cur.cls, cur.spec) };
  if (status === "absent" && !force) return { kind: "signup", body: { status }, label: "" };
  const why = c.linked
    ? tr(ui, "Ton Discord est lié au site, mais tu n'es pas membre de cette guilde : inscription libre.")
    : tr(ui, "Inscription libre, sans compte. Lie ton Discord sur le site (Compte & sécurité) pour t'inscrire avec tes persos.");
  return {
    kind: "reply",
    content: `${intro(ui, status)}\n${why}\n${tr(ui, "Choisis ta classe :")}`,
    components: [select(encodeId({ a: "cls", raidId, status }), tr(ui, "Ta classe"), [...classesOf(game)].sort((a, b) => classLabel(game, a, lang).localeCompare(classLabel(game, b, lang), lang))
      .map(cls => ({ label: classLabel(game, cls, lang), value: cls, ...(cur?.cls === cls && { description: tr(ui, "classe actuelle") }) })))],
  };
}

const charLabel = (name: string, spec: string | null | undefined) => (spec ? `${name} (${spec})` : name);

/** Menu des persos du joueur : un seul menu « perso — spé » si ça tient, sinon perso puis spé. */
function memberMenu(raidId: string, status: SignupStatus, chars: ChoiceChar[], curChar: string | null, curSpec: string | null, game: Game, lang: GameLang, ui: Lang): Step {
  if (!chars.length) {
    return { kind: "reply", content: tr(ui, "Tu n'as aucun perso avec une classe sur le site. Ajoute-en un dans « Mes persos », puis reviens cliquer ici."), components: [] };
  }
  const combos = chars.flatMap(ch => ch.specs.map(sp => ({ ch, sp })));
  if (combos.length <= MAX_OPTIONS) {
    return {
      kind: "reply",
      content: `${intro(ui, status)}\n${tr(ui, "Avec quel perso, et dans quelle spé ?")}`,
      components: [select(encodeId({ a: "pick", raidId, status }), tr(ui, "Perso et spé"), combos.map(({ ch, sp }) => ({
        label: `${ch.name} — ${specLabel(game, ch.cls, sp.name, lang)}`.slice(0, 100),
        description: [classLabel(game, ch.cls, lang), sp.role, sp.name === ch.spec1 ? tr(ui, "spé principale") : sp.name === ch.spec2 ? tr(ui, "off-spec") : null,
          ch.id === curChar && sp.name === curSpec ? tr(ui, "actuel") : null].filter(Boolean).join(" · ").slice(0, 100),
        value: `${ch.id}:${sp.name}`,
      })))],
    };
  }
  return {
    kind: "reply",
    content: `${intro(ui, status)}\n${tr(ui, "Avec quel perso ?")}`,
    components: [select(encodeId({ a: "char", raidId, status }), tr(ui, "Ton perso"), chars.map(ch => ({
      label: ch.name.slice(0, 100), value: ch.id,
      description: [classLabel(game, ch.cls, lang), ch.spec1 && specLabel(game, ch.cls, ch.spec1, lang), ch.id === curChar && tr(ui, "actuel")].filter(Boolean).join(" · ").slice(0, 100),
    })))],
  };
}

/** Perso choisi (quand il y en a trop pour un seul menu) → choix de la spé. */
export function onCharPicked(raidId: string, status: SignupStatus, c: Choices, charId: string, lang: GameLang = "fr"): Step {
  if (c.mode !== "member") return onStatus(raidId, status, c, true, lang);
  const game = c.game ?? "forever";
  const ui = langOf(c);
  const ch = c.characters.find(x => x.id === charId);
  if (!ch) return { kind: "reply", content: tr(ui, "Ce perso n'existe plus. Reclique sur un statut de l'annonce."), components: [] };
  return {
    kind: "reply",
    content: `${intro(ui, status)}\n${tr(ui, "**{name}** : dans quelle spé ?", { name: ch.name })}`,
    components: [select(encodeId({ a: "pick", raidId, status }), tr(ui, "Spé pour ce raid"), ch.specs.map(sp => ({
      label: specLabel(game, ch.cls, sp.name, lang), value: `${ch.id}:${sp.name}`,
      description: [sp.role, sp.name === ch.spec1 ? tr(ui, "spé principale") : sp.name === ch.spec2 ? tr(ui, "off-spec") : null,
        c.current?.characterId === ch.id && c.current.spec === sp.name ? tr(ui, "actuelle") : null].filter(Boolean).join(" · "),
    })))],
  };
}

/** Inscription libre : classe choisie → choix de la spé. ui : langue du bot pour la guilde. */
export function onClassPicked(raidId: string, status: SignupStatus, cls: string, game: Game = "forever", lang: GameLang = "fr", ui: Lang = "fr"): Step {
  const specs = specsOf(game, cls);
  if (!specs.length) return { kind: "reply", content: tr(ui, "Classe inconnue."), components: [] };
  return {
    kind: "reply",
    content: `${intro(ui, status)}\n${tr(ui, "**{name}** : dans quelle spé ?", { name: classLabel(game, cls, lang) })}`,
    components: [select(encodeId({ a: "gspec", raidId, status }), tr(ui, "Ta spé"), specs.map(sp => ({ label: specLabel(game, cls, sp.name, lang), description: sp.role, value: `${cls}:${sp.name}` })))],
  };
}

/** Message (visible par le joueur seul) après une inscription réussie. */
export function confirmation(raidId: string, status: SignupStatus, label: string, url: string, ui: Lang = "fr"): { content: string; components: Row[] } {
  const buttons: Row["components"] = [];
  if (status !== "absent") buttons.push({ type: ComponentType.Button, style: ButtonStyle.Secondary, label: tr(ui, "Changer de perso / spé"), custom_id: encodeId({ a: "chg", raidId, status }) });
  buttons.push({ type: ComponentType.Button, style: ButtonStyle.Link, label: tr(ui, "Voir sur le site"), url });
  const st = `**${statusLabel(ui, status)}**`;
  return {
    content: label ? tr(ui, "✅ C'est noté : {status} avec {who}.", { status: st, who: label }) : tr(ui, "✅ C'est noté : {status}.", { status: st }),
    components: [{ type: ComponentType.ActionRow, components: buttons }],
  };
}
