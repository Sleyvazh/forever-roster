import { SIGNUP_LABEL, type SignupStatus } from "@forever/game-data";
import { ButtonStyle, ComponentType } from "discord.js";
import type { Ask, AskAnswer, Nudge, RaidView } from "./api";
import { noEmoji, type EmojiLookup } from "./emojis";
import { encodeId } from "./ids";
import { escapeMd, fitLines, type MessagePayload, type Row } from "./render";

/**
 * Lot D2 : messages privés pour joindre les joueurs (fonctions pures, testées sans Discord).
 *  - relance des membres qui n'ont pas répondu, et la liste envoyée aux officiers ;
 *  - « Demander à X » : un officier demande à un joueur de venir avec un perso précis.
 */

const GOLD = 0xc8a04b, GREEN = 0x3fa45b, GREY = 0x6b6b6b;
const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const when = (iso: string | null) => (iso ? `📅 <t:${unix(iso)}:F> · <t:${unix(iso)}:R>` : null);
const FOOTER = "Relances et demandes désactivables dans Compte & sécurité sur le site.";

/** Relance : « tu viens ? », avec Présent / Peut-être / Absent (mêmes boutons que l'annonce). */
export function renderNudge(v: RaidView): MessagePayload {
  const coming = v.signups.filter(s => s.status === "present" || s.status === "late").length;
  const btn = (st: SignupStatus, style: ButtonStyle) => ({ type: ComponentType.Button as const, style, label: SIGNUP_LABEL[st], custom_id: encodeId({ a: "st", raidId: v.raid.id, status: st }) });
  return {
    embeds: [{
      title: `${v.raid.name} : tu viens ?`.slice(0, 256),
      url: v.raid.url,
      description: [
        when(v.raid.scheduledAt),
        `**${escapeMd(v.group.name)}** attend ta réponse pour ce raid.`,
        coming ? `Déjà ${coming} inscrit${coming > 1 ? "s" : ""}${v.raid.size ? ` pour ${v.raid.size} places` : ""}.` : null,
        "Un clic suffit : tu pourras changer d'avis ensuite.",
      ].filter(Boolean).join("\n"),
      color: GOLD,
      footer: { text: `${v.group.name} · ${FOOTER}`.slice(0, 2048) },
    }],
    components: [{
      type: ComponentType.ActionRow,
      components: [
        btn("present", ButtonStyle.Success), btn("tentative", ButtonStyle.Secondary), btn("absent", ButtonStyle.Danger),
        { type: ComponentType.Button, style: ButtonStyle.Link, label: "Voir sur le site", url: v.raid.url },
      ],
    }] as Row[],
    allowedMentions: { parse: [] },
  };
}

/** Liste des sans-réponse envoyée aux officiers, après la relance automatique. */
export function renderNudgeReport(n: Nudge, sent: string[], closed: string[]): MessagePayload {
  const fields = [];
  if (sent.length) fields.push({ name: `Relancés par MP — ${sent.length}`, value: fitLines(sent.map(escapeMd), 1024, ", "), inline: false });
  if (closed.length) fields.push({ name: `MP fermés — ${closed.length}`, value: fitLines(closed.map(escapeMd), 1024, ", "), inline: false });
  const noDiscord = n.unreachable.filter(u => u.why === "no-discord").map(u => u.name);
  const off = n.unreachable.filter(u => u.why === "dm-off").map(u => u.name);
  if (noDiscord.length) fields.push({ name: `Sans Discord lié — ${noDiscord.length}`, value: fitLines(noDiscord.map(escapeMd), 1024, ", "), inline: false });
  if (off.length) fields.push({ name: `Messages du bot désactivés — ${off.length}`, value: fitLines(off.map(escapeMd), 1024, ", "), inline: false });
  const total = sent.length + closed.length + n.unreachable.length;
  return {
    embeds: [{
      title: `${n.view.raid.name} : ${total} sans réponse`.slice(0, 256),
      url: n.view.raid.url,
      description: [when(n.view.raid.scheduledAt), `Relance automatique pour **${escapeMd(n.view.group.name)}**. Ceux qui ne sont pas joignables sont à prévenir autrement.`]
        .filter(Boolean).join("\n"),
      color: GREY,
      fields,
      footer: { text: `${n.view.group.name} · Réglage dans Administration → Salon Discord`.slice(0, 2048) },
    }],
    components: [],
    allowedMentions: { parse: [] },
  };
}

/** « Demander à X » : le joueur répond Oui (il est inscrit avec ce perso) ou Non. */
export function renderAsk(a: Ask, emoji: EmojiLookup = noEmoji): MessagePayload {
  const icon = emoji(a.character.cls, a.spec);
  const who = `${icon ? `${icon} ` : ""}**${escapeMd(a.character.name)}**`;
  const cur = a.current;
  const now = !cur ? null
    : cur.characterName && cur.characterName !== a.character.name && cur.status !== "absent"
      ? `Tu es inscrit avec **${escapeMd(cur.characterName)}** (${SIGNUP_LABEL[cur.status]}) : répondre Oui t'inscrit avec ${escapeMd(a.character.name)} à la place.`
      : `Ta réponse actuelle : **${SIGNUP_LABEL[cur.status]}**. Répondre Oui te passe en Présent.`;
  return {
    embeds: [{
      title: `${a.raid.name} : on a besoin de toi`.slice(0, 256),
      url: a.raid.url,
      description: [
        when(a.raid.scheduledAt),
        `**${escapeMd(a.askedBy)}** (${escapeMd(a.group.name)}) te demande si tu peux venir avec ${who} en **${escapeMd(a.spec)}**${a.role ? ` : il manque un ${a.role}` : ""}.`,
        now,
      ].filter(Boolean).join("\n"),
      color: GOLD,
      footer: { text: `${a.group.name} · ${FOOTER}`.slice(0, 2048) },
    }],
    components: [{
      type: ComponentType.ActionRow,
      components: [
        { type: ComponentType.Button, style: ButtonStyle.Success, label: `Oui, avec ${a.character.name}`.slice(0, 80), custom_id: encodeId({ a: "ask", askId: a.id, yes: true }) },
        { type: ComponentType.Button, style: ButtonStyle.Secondary, label: "Non, pas cette fois", custom_id: encodeId({ a: "ask", askId: a.id, yes: false }) },
        { type: ComponentType.Button, style: ButtonStyle.Link, label: "Voir sur le site", url: a.raid.url },
      ],
    }] as Row[],
    allowedMentions: { parse: [] },
  };
}

/** Le MP de la demande une fois répondu : les boutons Oui / Non disparaissent. */
export function renderAskAnswered(prev: { title?: string; url?: string; description?: string; footer?: { text: string } } | undefined, r: AskAnswer): MessagePayload {
  const line = r.answer === "yes"
    ? `✅ C'est noté : tu viens avec **${escapeMd(r.character)}** (${escapeMd(r.spec)}). Merci !`
    : "C'est noté, merci d'avoir répondu. L'officier cherchera quelqu'un d'autre.";
  return {
    embeds: [{
      ...(prev?.title && { title: prev.title }), ...(prev?.url && { url: prev.url }),
      description: [prev?.description, "", line].filter(x => x !== undefined).join("\n").slice(0, 4096),
      color: r.answer === "yes" ? GREEN : GREY,
      ...(prev?.footer && { footer: prev.footer }),
    }],
    components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label: "Voir sur le site", url: r.url }] }] as Row[],
    allowedMentions: { parse: [] },
  };
}
