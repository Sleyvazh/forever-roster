import { classesOf, classLabel, roleOf, SIGNUP_HINT, SIGNUP_LABEL, specLabel, specsOf as gameSpecs, type Game, type GameLang, type Role, type SignupStatus } from "@forever/game-data";
import { ButtonStyle, ComponentType, type APISelectMenuOption } from "discord.js";
import type { ChoiceChar, Choices, SignupBody } from "./api";
import { encodeId } from "./ids";
import type { Row } from "./render";

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
const specsOf = (game: Game, cls: string): { name: string; role: Role }[] => gameSpecs(game, cls).map(name => ({ name, role: roleOf(name) ?? "DPS" }));

/** Libellé « Spé Classe » d'une inscription libre (message de confirmation). */
export const guestLabel = (game: Game, lang: GameLang, cls: string, spec: string) => `${specLabel(game, cls, spec, lang)} ${classLabel(game, cls, lang)}`;

const select = (custom_id: string, placeholder: string, options: APISelectMenuOption[]): Row => ({
  type: ComponentType.ActionRow,
  components: [{ type: ComponentType.StringSelect, custom_id, placeholder, options: options.slice(0, MAX_OPTIONS), min_values: 1, max_values: 1 }],
});

const intro = (status: SignupStatus) => `**${SIGNUP_LABEL[status]}** — ${SIGNUP_HINT[status]}`;

/** Clic sur un bouton de statut (ou « changer de perso / spé » avec `force`). */
export function onStatus(raidId: string, status: SignupStatus, c: Choices, force = false, lang: GameLang = "fr"): Step {
  const cur = c.current;
  const game = c.game ?? "forever";
  if (c.mode === "member") {
    const curChar = cur?.characterId ? c.characters.find(ch => ch.id === cur.characterId) : undefined;
    if (!force && curChar) return { kind: "signup", body: { status, characterId: curChar.id, spec: cur!.spec || undefined }, label: charLabel(curChar.name, cur!.spec && specLabel(game, curChar.cls, cur!.spec, lang)) };
    if (status === "absent" && !force) return { kind: "signup", body: { status, characterId: null }, label: "" };
    return memberMenu(raidId, status, c.characters, cur?.characterId ?? null, cur?.spec ?? null, game, lang);
  }
  if (!force && cur?.cls && cur.spec) return { kind: "signup", body: { status, cls: cur.cls, spec: cur.spec }, label: guestLabel(game, lang, cur.cls, cur.spec) };
  if (status === "absent" && !force) return { kind: "signup", body: { status }, label: "" };
  const why = c.linked
    ? "Ton Discord est lié au site, mais tu n'es pas membre de ce groupe : inscription libre."
    : "Inscription libre, sans compte. Lie ton Discord sur le site (Compte & sécurité) pour t'inscrire avec tes persos.";
  return {
    kind: "reply",
    content: `${intro(status)}\n${why}\nChoisis ta classe :`,
    components: [select(encodeId({ a: "cls", raidId, status }), "Ta classe", [...classesOf(game)].sort((a, b) => classLabel(game, a, lang).localeCompare(classLabel(game, b, lang), lang))
      .map(cls => ({ label: classLabel(game, cls, lang), value: cls, default: cur?.cls === cls })))],
  };
}

const charLabel = (name: string, spec: string | null | undefined) => (spec ? `${name} (${spec})` : name);

/** Menu des persos du joueur : un seul menu « perso — spé » si ça tient, sinon perso puis spé. */
function memberMenu(raidId: string, status: SignupStatus, chars: ChoiceChar[], curChar: string | null, curSpec: string | null, game: Game, lang: GameLang): Step {
  if (!chars.length) {
    return { kind: "reply", content: "Tu n'as aucun perso avec une classe sur le site. Ajoute-en un dans « Mes persos », puis reviens cliquer ici.", components: [] };
  }
  const combos = chars.flatMap(ch => ch.specs.map(sp => ({ ch, sp })));
  if (combos.length <= MAX_OPTIONS) {
    return {
      kind: "reply",
      content: `${intro(status)}\nAvec quel perso, et dans quelle spé ?`,
      components: [select(encodeId({ a: "pick", raidId, status }), "Perso et spé", combos.map(({ ch, sp }) => ({
        label: `${ch.name} — ${specLabel(game, ch.cls, sp.name, lang)}`.slice(0, 100),
        description: `${classLabel(game, ch.cls, lang)} · ${sp.role}${sp.name === ch.spec1 ? " · spé principale" : sp.name === ch.spec2 ? " · off-spec" : ""}`.slice(0, 100),
        value: `${ch.id}:${sp.name}`,
        default: ch.id === curChar && sp.name === curSpec,
      })))],
    };
  }
  return {
    kind: "reply",
    content: `${intro(status)}\nAvec quel perso ?`,
    components: [select(encodeId({ a: "char", raidId, status }), "Ton perso", chars.map(ch => ({
      label: ch.name.slice(0, 100), description: [classLabel(game, ch.cls, lang), ch.spec1 && specLabel(game, ch.cls, ch.spec1, lang)].filter(Boolean).join(" · ").slice(0, 100), value: ch.id, default: ch.id === curChar,
    })))],
  };
}

/** Perso choisi (quand il y en a trop pour un seul menu) → choix de la spé. */
export function onCharPicked(raidId: string, status: SignupStatus, c: Choices, charId: string, lang: GameLang = "fr"): Step {
  if (c.mode !== "member") return onStatus(raidId, status, c, true, lang);
  const game = c.game ?? "forever";
  const ch = c.characters.find(x => x.id === charId);
  if (!ch) return { kind: "reply", content: "Ce perso n'existe plus. Reclique sur un statut de l'annonce.", components: [] };
  return {
    kind: "reply",
    content: `${intro(status)}\n**${ch.name}** : dans quelle spé ?`,
    components: [select(encodeId({ a: "pick", raidId, status }), "Spé pour ce raid", ch.specs.map(sp => ({
      label: specLabel(game, ch.cls, sp.name, lang), description: sp.role, value: `${ch.id}:${sp.name}`, default: sp.name === (c.current?.characterId === ch.id ? c.current.spec : ch.spec1),
    })))],
  };
}

/** Inscription libre : classe choisie → choix de la spé. */
export function onClassPicked(raidId: string, status: SignupStatus, cls: string, game: Game = "forever", lang: GameLang = "fr"): Step {
  const specs = specsOf(game, cls);
  if (!specs.length) return { kind: "reply", content: "Classe inconnue.", components: [] };
  return {
    kind: "reply",
    content: `${intro(status)}\n**${classLabel(game, cls, lang)}** : dans quelle spé ?`,
    components: [select(encodeId({ a: "gspec", raidId, status }), "Ta spé", specs.map(sp => ({ label: specLabel(game, cls, sp.name, lang), description: sp.role, value: `${cls}:${sp.name}` })))],
  };
}

/** Message (visible par le joueur seul) après une inscription réussie. */
export function confirmation(raidId: string, status: SignupStatus, label: string, url: string): { content: string; components: Row[] } {
  const buttons: Row["components"] = [];
  if (status !== "absent") buttons.push({ type: ComponentType.Button, style: ButtonStyle.Secondary, label: "Changer de perso / spé", custom_id: encodeId({ a: "chg", raidId, status }) });
  buttons.push({ type: ComponentType.Button, style: ButtonStyle.Link, label: "Voir sur le site", url });
  return {
    content: `✅ C'est noté : **${SIGNUP_LABEL[status]}**${label ? ` avec ${label}` : ""}.`,
    components: [{ type: ComponentType.ActionRow, components: buttons }],
  };
}
