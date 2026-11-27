import { ButtonStyle, ComponentType, TextInputStyle, type APIButtonComponent, type APIModalInteractionResponseCallbackData } from "discord.js";
import type { QuestNotice, QuestType, QuestView } from "./api";
import { colon, langOf, N, quote, tr, type Lang } from "./i18n";
import { escapeMd, type MessagePayload, type Row } from "./render";

/**
 * Quêtes de guilde (Forever, 27/11/2026) sur Discord : annonce dans le salon des quêtes (ou de la guilde) avec
 * « Prendre », et MP à chaque étape avec leurs boutons (Valider, Pas encore, C'est remis, Reçu, Pas reçu). Fonctions pures,
 * testées sans Discord ; quests.ts s'occupe de Discord. Les règles sont celles du site (le clic est revérifié par lui).
 */

const GOLD = 0xc8a04b;
const TYPE_LABEL: Record<QuestType, string> = { collect: N("Collecte"), craft: N("Artisanat"), dungeon: N("Donjon"), help: N("Coup de main"), other: N("Autre") };
export const typeLabel = (lang: Lang, t: QuestType) => tr(lang, TYPE_LABEL[t]);

/* ---------- Identifiants des boutons (qu|…) ---------- */

export type QuestAction =
  | { a: "take"; questId: string }
  | { a: "validate" | "reject" | "paid"; questId: string; takerId: string }
  | { a: "received"; questId: string; ok: boolean }
  /** Fenêtre « Pas encore » (le mot du donneur). */
  | { a: "rejectModal"; questId: string; takerId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODES = { validate: "v", reject: "r", paid: "p", rejectModal: "rm" } as const;

export function encodeQuestId(x: QuestAction): string {
  if (x.a === "take") return `qu|t|${x.questId}`;
  if (x.a === "received") return `qu|${x.ok ? "ok" : "ko"}|${x.questId}`;
  return `qu|${CODES[x.a]}|${x.questId}|${x.takerId}`;
}
export function decodeQuestId(id: string): QuestAction | null {
  const [p, a, questId, takerId, ...rest] = id.split("|");
  if (p !== "qu" || !a || !questId || !UUID.test(questId) || rest.length) return null;
  if (a === "t" || a === "ok" || a === "ko") {
    if (takerId !== undefined) return null;
    return a === "t" ? { a: "take", questId } : { a: "received", questId, ok: a === "ok" };
  }
  const action = (Object.entries(CODES) as [keyof typeof CODES, string][]).find(([, c]) => c === a)?.[0];
  if (!action || !takerId || !UUID.test(takerId)) return null;
  return { a: action, questId, takerId };
}
export const isQuestId = (customId: string) => customId.startsWith("qu|");

/* ---------- Annonce ---------- */

const dueText = (iso: string, lang: Lang) => new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "fr-FR",
  { timeZone: "Europe/Paris", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const objectiveText = (v: QuestView) => (v.objective.item ? `${v.objective.item.qty > 1 ? `${v.objective.item.qty} × ` : ""}${v.objective.item.name}` : v.objective.text);

export function renderQuest(v: QuestView): MessagePayload {
  const lang = langOf(v.group);
  const seats = v.places - v.free;
  const full = v.state !== "open";
  const lines = [
    `**${tr(lang, "Objectif")}**${colon(lang)}${escapeMd(objectiveText(v))}`,
    `**${tr(lang, "Récompense")}**${colon(lang)}${escapeMd(v.reward.label)}`,
    v.description ? `\n${quote(lang, escapeMd(v.description.slice(0, 600)))}` : null,
  ].filter(Boolean);
  const foot = [
    tr(lang, "Donnée par {name}", { name: v.creator }), typeLabel(lang, v.type),
    v.minLevel ? tr(lang, "Niv. {n}+", { n: v.minLevel }) : null, v.profession || null,
    v.dueAt ? tr(lang, "avant {day}", { day: dueText(v.dueAt, lang) }) : null,
    v.places > 1 ? tr(lang, "{taken}/{n} places prises", { taken: seats, n: v.places }) : null,
  ].filter(Boolean).join(" · ");
  const buttons: APIButtonComponent[] = [
    { type: ComponentType.Button, style: full ? ButtonStyle.Secondary : ButtonStyle.Success, disabled: full, label: full ? tr(lang, "Complète") : tr(lang, "Prendre"), emoji: { name: "❗" },
      custom_id: encodeQuestId({ a: "take", questId: v.id }) },
    { type: ComponentType.Button, style: ButtonStyle.Link, label: tr(lang, "Voir sur le site"), url: v.url },
  ];
  return {
    embeds: [{ title: `❗ ${v.title}${full ? ` · ${tr(lang, "complète")}` : ""}`.slice(0, 256), url: v.url, description: lines.join("\n").slice(0, 4000), color: GOLD, footer: { text: foot.slice(0, 2048) } }],
    components: [{ type: ComponentType.ActionRow, components: buttons }],
    allowedMentions: { parse: [] },
  };
}

/** Réponse (visible du joueur seul) après « Prendre ». */
export const takenReply = (v: QuestView, lang: Lang = langOf(v.group)) =>
  tr(lang, "✅ Quête prise : **{title}**. {name} est prévenu. Quand c'est fait, rends-la sur le site : {url}", { title: escapeMd(v.title), name: escapeMd(v.creator), url: v.url });

/* ---------- MP ---------- */

type ActionStyle = ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success | ButtonStyle.Danger;
const btn = (label: string, custom_id: string, style: ActionStyle = ButtonStyle.Secondary): APIButtonComponent => ({ type: ComponentType.Button, style, label, custom_id });
const link = (lang: Lang, url: string): APIButtonComponent => ({ type: ComponentType.Button, style: ButtonStyle.Link, label: tr(lang, "Voir sur le site"), url });

export function renderQuestNotice(n: QuestNotice): { content: string; components: Row[] } {
  const p = n.payload;
  const lang = langOf(p);
  const title = quote(lang, `**${escapeMd(p.title)}**`);
  const other = `**${escapeMd(p.other)}**`;
  const reward = `**${escapeMd(p.reward)}**`;
  const note = p.note ? `\n> ${escapeMd(p.note)}` : "";
  const q = p.questId, t = p.takerId ?? "";
  const validate = () => [btn(tr(lang, "Valider"), encodeQuestId({ a: "validate", questId: q, takerId: t }), ButtonStyle.Success), btn(tr(lang, "Pas encore"), encodeQuestId({ a: "reject", questId: q, takerId: t }))];
  const receive = () => [btn(tr(lang, "Reçu"), encodeQuestId({ a: "received", questId: q, ok: true }), ButtonStyle.Success), btn(tr(lang, "Pas reçu"), encodeQuestId({ a: "received", questId: q, ok: false }))];
  let content: string;
  let buttons: APIButtonComponent[] = [];
  switch (n.kind) {
    case "taken": content = tr(lang, "{other} a pris ta quête {title}.", { other, title }); break;
    case "turned_in": content = tr(lang, "{other} a rendu ta quête {title} : valide-la quand tu as ce qu'il faut.", { other, title }) + note; buttons = t ? validate() : []; break;
    case "rejected": content = tr(lang, "{other} dit que ta quête {title} n'est pas encore finie.", { other, title }) + note; break;
    case "validated": content = tr(lang, "{other} a validé ta quête {title}. Il va te remettre en jeu : {reward}. Confirme quand tu l'as.", { other, title, reward }); buttons = [receive()[0]!]; break;
    case "paid": content = tr(lang, "{other} dit t'avoir remis {reward} pour {title}. Tu l'as bien reçue ?", { other, title, reward }); buttons = receive(); break;
    case "not_received": content = tr(lang, "{other} dit ne pas avoir reçu la récompense de {title} ({reward}).", { other, title, reward });
      buttons = t ? [btn(tr(lang, "C'est remis (à nouveau)"), encodeQuestId({ a: "paid", questId: q, takerId: t }), ButtonStyle.Primary)] : []; break;
    case "received": content = tr(lang, "{other} a bien reçu la récompense de {title}. Merci pour la guilde !", { other, title }); break;
    case "cancelled": content = tr(lang, "La quête {title} de {other} est annulée.", { other, title }); break;
    case "expired": content = tr(lang, "L'échéance de la quête {title} ({other}) est passée : ta place est libérée.", { other, title }); break;
    case "removed": content = tr(lang, "Un officier t'a retiré de la quête {title}.", { title }); break;
    case "remind_validate": content = tr(lang, "Rappel : {other} attend depuis 3 jours que tu valides ta quête {title}.", { other, title }) + note; buttons = t ? validate() : []; break;
    case "remind_pay": content = tr(lang, "Rappel : tu as validé {title} pour {other}. Pense à lui remettre {reward} en jeu, puis clique « C'est remis ».", { other, title, reward });
      buttons = t ? [btn(tr(lang, "C'est remis"), encodeQuestId({ a: "paid", questId: q, takerId: t }), ButtonStyle.Primary)] : []; break;
    case "remind_receive": content = tr(lang, "Rappel : {other} dit t'avoir remis {reward} pour {title}. Tu l'as bien reçue ?", { other, title, reward }); buttons = receive(); break;
  }
  const done = n.kind === "cancelled" || n.kind === "removed";
  return { content: content!, components: [{ type: ComponentType.ActionRow, components: [...buttons, ...(done ? [] : [link(lang, p.url)])] }].filter(r => r.components.length) as Row[] };
}

/** Texte qui remplace les boutons d'un MP une fois le clic pris en compte. */
export function actionDone(a: QuestAction, v: QuestView, lang: Lang = langOf(v.group)) {
  const title = quote(lang, `**${escapeMd(v.title)}**`);
  if (a.a === "validate") return tr(lang, "✅ Quête {title} validée. Remets la récompense en jeu, puis clique « C'est remis » (sur le site, ou dans le MP de rappel).", { title });
  if (a.a === "paid") return tr(lang, "✅ C'est noté : récompense remise pour {title}. Le preneur va confirmer.", { title });
  if (a.a === "received") return a.ok ? tr(lang, "✅ Merci ! Récompense de {title} reçue.", { title }) : tr(lang, "C'est noté : le donneur de {title} est prévenu.", { title });
  return tr(lang, "C'est noté : {title} repasse « Prise », le preneur a ton mot.", { title });
}

/** Fenêtre « Pas encore » : un mot facultatif pour le preneur. */
export function rejectModal(questId: string, takerId: string, lang: Lang): APIModalInteractionResponseCallbackData {
  return {
    custom_id: encodeQuestId({ a: "rejectModal", questId, takerId }), title: tr(lang, "Pas encore finie"),
    components: [{ type: ComponentType.ActionRow, components: [{
      type: ComponentType.TextInput, custom_id: "note", label: tr(lang, "Un mot pour le preneur (facultatif)"), style: TextInputStyle.Short, required: false, max_length: 200,
      placeholder: tr(lang, "Il en manque 5."),
    }] }],
  };
}
