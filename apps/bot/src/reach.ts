import { SIGNUP_LABEL, specLabel, type SignupStatus } from "@forever/game-data";
import { ButtonStyle, ComponentType } from "discord.js";
import type { Ask, AskAnswer, Nudge, RaidView } from "./api";
import { noEmoji, type EmojiLookup } from "./emojis";
import { langOf, tr, trn, type Lang } from "./i18n";
import { encodeId } from "./ids";
import { escapeMd, fitLines, statusLabel, type MessagePayload, type Row } from "./render";

/**
 * Lot D2 : messages privés pour joindre les joueurs (fonctions pures, testées sans Discord).
 *  - relance des membres qui n'ont pas répondu, et la liste envoyée aux officiers ;
 *  - « Demander à X » : un officier demande à un joueur de venir avec un perso précis.
 */

const GOLD = 0xc8a04b, GREEN = 0x3fa45b, GREY = 0x6b6b6b;
const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const when = (iso: string | null) => (iso ? `📅 <t:${unix(iso)}:F> · <t:${unix(iso)}:R>` : null);
const footer = (lang: Lang) => tr(lang, "Relances et demandes désactivables dans Compte & sécurité sur le site.");

/** Relance : « tu viens ? », avec Présent / Peut-être / Absent (mêmes boutons que l'annonce). */
export function renderNudge(v: RaidView): MessagePayload {
  const lang = langOf(v.group);
  const coming = v.signups.filter(s => s.status === "present" || s.status === "late").length;
  const btn = (st: SignupStatus, style: ButtonStyle) => ({ type: ComponentType.Button as const, style, label: statusLabel(lang, st), custom_id: encodeId({ a: "st", raidId: v.raid.id, status: st }) });
  return {
    embeds: [{
      title: tr(lang, "{name} : tu viens ?", { name: v.raid.name }).slice(0, 256),
      url: v.raid.url,
      description: [
        when(v.raid.scheduledAt),
        tr(lang, "**{group}** attend ta réponse pour ce raid.", { group: escapeMd(v.group.name) }),
        coming ? (v.raid.size ? trn(lang, coming, "Déjà {n} inscrit pour {size} places.", "Déjà {n} inscrits pour {size} places.", { size: v.raid.size })
          : trn(lang, coming, "Déjà {n} inscrit.", "Déjà {n} inscrits.")) : null,
        tr(lang, "Un clic suffit : tu pourras changer d'avis ensuite."),
      ].filter(Boolean).join("\n"),
      color: GOLD,
      footer: { text: `${v.group.name} · ${footer(lang)}`.slice(0, 2048) },
    }],
    components: [{
      type: ComponentType.ActionRow,
      components: [
        btn("present", ButtonStyle.Success), btn("tentative", ButtonStyle.Secondary), btn("absent", ButtonStyle.Danger),
        { type: ComponentType.Button, style: ButtonStyle.Link, label: tr(lang, "Voir sur le site"), url: v.raid.url },
      ],
    }] as Row[],
    allowedMentions: { parse: [] },
  };
}

/** Liste des sans-réponse envoyée aux officiers, après la relance automatique. */
export function renderNudgeReport(n: Nudge, sent: string[], closed: string[]): MessagePayload {
  const lang = langOf(n.view.group);
  const list = (names: string[]) => fitLines(names.map(escapeMd), 1024, ", ", lang);
  const fields = [];
  if (sent.length) fields.push({ name: tr(lang, "Relancés par MP — {n}", { n: sent.length }), value: list(sent), inline: false });
  if (closed.length) fields.push({ name: tr(lang, "MP fermés — {n}", { n: closed.length }), value: list(closed), inline: false });
  const noDiscord = n.unreachable.filter(u => u.why === "no-discord").map(u => u.name);
  const off = n.unreachable.filter(u => u.why === "dm-off").map(u => u.name);
  if (noDiscord.length) fields.push({ name: tr(lang, "Sans Discord lié — {n}", { n: noDiscord.length }), value: list(noDiscord), inline: false });
  if (off.length) fields.push({ name: tr(lang, "Messages du bot désactivés — {n}", { n: off.length }), value: list(off), inline: false });
  const total = sent.length + closed.length + n.unreachable.length;
  return {
    embeds: [{
      title: tr(lang, "{name} : {n} sans réponse", { name: n.view.raid.name, n: total }).slice(0, 256),
      url: n.view.raid.url,
      description: [when(n.view.raid.scheduledAt), tr(lang, "Relance automatique pour **{group}**. Ceux qui ne sont pas joignables sont à prévenir autrement.", { group: escapeMd(n.view.group.name) })]
        .filter(Boolean).join("\n"),
      color: GREY,
      fields,
      footer: { text: `${n.view.group.name} · ${tr(lang, "Réglage dans Administration → Salon Discord")}`.slice(0, 2048) },
    }],
    components: [],
    allowedMentions: { parse: [] },
  };
}

/** « Demander à X » : le joueur répond Oui (il est inscrit avec ce perso) ou Non. */
export function renderAsk(a: Ask, emoji: EmojiLookup = noEmoji): MessagePayload {
  const lang = langOf(a.group);
  const icon = emoji(a.character.cls, a.spec);
  const who = `${icon ? `${icon} ` : ""}**${escapeMd(a.character.name)}**`;
  const cur = a.current;
  const now = !cur ? null
    : cur.characterName && cur.characterName !== a.character.name && cur.status !== "absent"
      ? tr(lang, "Tu es inscrit avec **{current}** ({status}) : répondre Oui t'inscrit avec {name} à la place.", { current: escapeMd(cur.characterName), status: statusLabel(lang, cur.status), name: escapeMd(a.character.name) })
      : tr(lang, "Ta réponse actuelle : **{status}**. Répondre Oui te passe en Présent.", { status: statusLabel(lang, cur.status) });
  const spec = `**${escapeMd(specLabel(a.group.game ?? "forever", a.character.cls, a.spec, lang))}**`;
  const vars = { by: escapeMd(a.askedBy), group: escapeMd(a.group.name), who, spec, role: a.role ?? "" };
  return {
    embeds: [{
      title: tr(lang, "{name} : on a besoin de toi", { name: a.raid.name }).slice(0, 256),
      url: a.raid.url,
      description: [
        when(a.raid.scheduledAt),
        a.role ? tr(lang, "**{by}** ({group}) te demande si tu peux venir avec {who} en {spec} : il manque un {role}.", vars)
          : tr(lang, "**{by}** ({group}) te demande si tu peux venir avec {who} en {spec}.", vars),
        now,
      ].filter(Boolean).join("\n"),
      color: GOLD,
      footer: { text: `${a.group.name} · ${footer(lang)}`.slice(0, 2048) },
    }],
    components: [{
      type: ComponentType.ActionRow,
      components: [
        { type: ComponentType.Button, style: ButtonStyle.Success, label: tr(lang, "Oui, avec {name}", { name: a.character.name }).slice(0, 80), custom_id: encodeId({ a: "ask", askId: a.id, yes: true }) },
        { type: ComponentType.Button, style: ButtonStyle.Secondary, label: tr(lang, "Non, pas cette fois"), custom_id: encodeId({ a: "ask", askId: a.id, yes: false }) },
        { type: ComponentType.Button, style: ButtonStyle.Link, label: tr(lang, "Voir sur le site"), url: a.raid.url },
      ],
    }] as Row[],
    allowedMentions: { parse: [] },
  };
}

/** Le MP de la demande une fois répondu : les boutons Oui / Non disparaissent. lang : celle de la guilde (vue du raid). */
export function renderAskAnswered(prev: { title?: string; url?: string; description?: string; footer?: { text: string } } | undefined, r: AskAnswer, lang: Lang = langOf(r.view?.group)): MessagePayload {
  const line = r.answer === "yes"
    ? tr(lang, "✅ C'est noté : tu viens avec **{name}** ({spec}). Merci !", { name: escapeMd(r.character), spec: escapeMd(r.spec) })
    : tr(lang, "C'est noté, merci d'avoir répondu. L'officier cherchera quelqu'un d'autre.");
  return {
    embeds: [{
      ...(prev?.title && { title: prev.title }), ...(prev?.url && { url: prev.url }),
      description: [prev?.description, "", line].filter(x => x !== undefined).join("\n").slice(0, 4096),
      color: r.answer === "yes" ? GREEN : GREY,
      ...(prev?.footer && { footer: prev.footer }),
    }],
    components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label: tr(lang, "Voir sur le site"), url: r.url }] }] as Row[],
    allowedMentions: { parse: [] },
  };
}
