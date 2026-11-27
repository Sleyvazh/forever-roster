import {
  isBigPoll, parseEnd, parseSlot, pollEndText, POLL_BUTTONS_MAX, POLL_MAX_LABEL, POLL_MAX_OPTIONS, POLL_MAX_QUESTION, POLL_MAX_SLOTS, POLL_MENU_SIZE, POLL_MIN_OPTIONS,
  ranking, RUNOFF_SIZE, slotText, textBar, type SlotError,
} from "@forever/game-data";
import {
  ButtonStyle, ComponentType, TextInputStyle,
  type APIActionRowComponent, type APIButtonComponent, type APIModalInteractionResponseCallbackData, type APISelectMenuOption, type APITextInputComponent,
} from "discord.js";
import type { PollNewBody, PollRole, PollView, PollVoter } from "./api";
import { langOf, N, quote, tr, trn, type Lang } from "./i18n";
import { escapeMd, type MessagePayload, type Row } from "./render";

/** Lignes jointes sous `max` caractères ; ce qui dépasse est remplacé par `more(n)`. */
function fitText(lines: string[], max: number, more: (n: number) => string) {
  const all = lines.join("\n");
  if (all.length <= max) return all;
  const out: string[] = [];
  let len = 0;
  for (const [i, l] of lines.entries()) {
    const tail = more(lines.length - i);
    if (len + l.length + 1 + tail.length + 1 > max) { out.push(tail); break; }
    out.push(l); len += l.length + 1;
  }
  return out.join("\n");
}

/**
 * Sondages sur Discord (26/11/2026, maquettes A et B validées par Flo) : rendu des messages (barres en texte, Discord ne
 * dessine ni barre ni tableau), boutons et menus, fenêtres de saisie de /sondage et /dispos et leur lecture.
 * Fonctions pures, testées sans Discord ; polls.ts s'occupe de Discord.
 */

const GOLD = 0xc8a04b;
const GREY = 0x80848e;
export const NUMBERS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
const ROLE_WORDS: Record<PollRole, [string, string]> = { Tank: [N("{n} tank"), N("{n} tanks")], Heal: [N("{n} heal"), N("{n} heals")], DPS: [N("{n} DPS"), N("{n} DPS")] };

/* ---------- Identifiants des boutons, menus et fenêtres ---------- */

/**
 * pl|v|<sondage>|<choix> (voter), pl|me|… (mon vote / mes disponibilités), pl|who|… (qui a voté), pl|cl|… (clore : demande
 * confirmation), pl|clok|… (clore pour de bon), pl|rd|… (créer le raid : fenêtre), pl|rdm|… (fenêtre du raid),
 * pl|dy|… et pl|dm|… (menus Je viens / Si besoin) ; création : pl|new|c|<a0|a1><m0|m1><rl|re> (fenêtre de /sondage),
 * pl|new|d (fenêtre de /dispos), pl|fix (rouvrir la fenêtre avec la saisie refusée). Grand sondage (plus de 10 choix) :
 * pl|vo|… (« Voter » : les menus), pl|pk|<sondage>|<n° du menu> (un menu de 25 choix), pl|clr|… (effacer mes choix),
 * pl|r2|… (« 2e tour avec les 5 premiers » : fenêtre), pl|r2m|… (sa fenêtre) ; pl|new|c|…x5 : 5 choix au plus.
 * Relus et validés à chaque clic ; le site revérifie tout.
 */
export type PollAction =
  | { a: "vote"; pollId: string; optionId: number }
  | { a: "pick"; pollId: string; menu: number }
  | { a: "me" | "who" | "close" | "closeok" | "raid" | "raidmodal" | "yes" | "maybe" | "ballot" | "clear" | "runoff" | "runoffmodal"; pollId: string }
  | { a: "new"; kind: "choice"; anonymous: boolean; multi: boolean; results: "live" | "end"; max?: number }
  | { a: "new"; kind: "dates" }
  | { a: "fix" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = {
  me: "me", who: "who", close: "cl", closeok: "clok", raid: "rd", raidmodal: "rdm", yes: "dy", maybe: "dm", ballot: "vo", clear: "clr", runoff: "r2", runoffmodal: "r2m",
} as const;
const BY_CODE = Object.fromEntries(Object.entries(CODE).map(([k, v]) => [v, k])) as Record<string, Exclude<PollAction["a"], "vote" | "pick" | "new" | "fix">>;

export function encodePollId(x: PollAction): string {
  if (x.a === "vote") return `pl|v|${x.pollId}|${x.optionId}`;
  if (x.a === "pick") return `pl|pk|${x.pollId}|${x.menu}`;
  if (x.a === "new") return x.kind === "dates" ? "pl|new|d" : `pl|new|c|a${x.anonymous ? 1 : 0}m${x.multi ? 1 : 0}r${x.results === "end" ? "e" : "l"}${x.max ? `x${x.max}` : ""}`;
  if (x.a === "fix") return "pl|fix";
  return `pl|${CODE[x.a]}|${x.pollId}`;
}

export function decodePollId(id: string): PollAction | null {
  const [p, a, arg, extra, ...rest] = id.split("|");
  if (p !== "pl" || !a || rest.length) return null;
  if (a === "fix") return arg === undefined ? { a: "fix" } : null;
  if (a === "new") {
    if (arg === "d" && extra === undefined) return { a: "new", kind: "dates" };
    const f = arg === "c" && extra ? /^a([01])m([01])r([le])(?:x(\d{1,3}))?$/.exec(extra) : null;
    if (!f) return null;
    const max = f[4] ? Number(f[4]) : undefined;
    if (max !== undefined && (max < 2 || max > POLL_MAX_OPTIONS)) return null;
    return { a: "new", kind: "choice", anonymous: f[1] === "1", multi: f[2] === "1", results: f[3] === "e" ? "end" : "live", ...(max ? { max } : {}) };
  }
  if (!arg || !UUID.test(arg)) return null;
  if (a === "v") {
    const n = Number(extra);
    return extra && /^\d{1,2}$/.test(extra) && n >= 1 && n <= POLL_BUTTONS_MAX ? { a: "vote", pollId: arg.toLowerCase(), optionId: n } : null;
  }
  if (a === "pk") {
    const n = Number(extra);
    return extra && /^\d$/.test(extra) && n * POLL_MENU_SIZE < POLL_MAX_OPTIONS ? { a: "pick", pollId: arg.toLowerCase(), menu: n } : null;
  }
  const act = BY_CODE[a];
  return act && extra === undefined ? { a: act, pollId: arg.toLowerCase() } : null;
}

export const isPollId = (customId: string) => customId.startsWith("pl|");

/* ---------- Textes ---------- */

const optionText = (v: Pick<PollView, "kind" | "group">, o: { label: string; at: string | null }, lang: Lang = langOf(v.group)) =>
  (v.kind === "dates" && o.at ? slotText(new Date(o.at), lang) : o.label);
const isClosed = (v: PollView) => !!v.closedAt;
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);
const roleText = (lang: Lang, roles: Record<PollRole, number> | null) => {
  if (!roles) return "";
  const bits = (["Tank", "Heal"] as const).filter(r => roles[r]).map(r => trn(lang, roles[r], ...ROLE_WORDS[r]));
  return bits.length ? ` · ${bits.join(", ")}` : "";
};

/** « Posé par Sleyvazh · vote anonyme · un seul choix · se termine jeudi 26/11 à 18:00 ». */
function subtitle(v: PollView, lang: Lang) {
  const end = isClosed(v)
    ? tr(lang, "clos le {when}", { when: pollEndText(new Date(v.closedAt!), lang) })
    : v.closesAt ? tr(lang, "se termine {when}", { when: pollEndText(new Date(v.closesAt), lang) }) : tr(lang, "jusqu'à ce qu'il soit clos");
  const bits = v.kind === "dates"
    ? [tr(lang, "Posé par {name}", { name: escapeMd(v.creator) }), tr(lang, "coche tous les soirs où tu peux venir"), end]
    : [tr(lang, "Posé par {name}", { name: escapeMd(v.creator) }), v.anonymous ? tr(lang, "vote anonyme") : tr(lang, "vote public"),
      v.maxChoices ? tr(lang, "jusqu'à {n} choix", { n: v.maxChoices }) : v.multi ? tr(lang, "plusieurs choix") : tr(lang, "un seul choix"),
      ...(v.hidden ? [tr(lang, "résultats à la fin")] : []), end];
  return `*${bits.join(" · ")}*`;
}

export function renderPoll(v: PollView): MessagePayload {
  const lang = langOf(v.group);
  const closed = isClosed(v);
  let lines: string[];
  let foot: string;
  if (isBigPoll(v)) {
    // Grand sondage (maquettes D1 bis, D2 bis) : la liste complète, par ordre alphabétique tant que les résultats sont
    // cachés ; sinon le classement complet (✅ : qualifiés pour le 2e tour, une fois clos)
    const voters = trn(lang, v.voters, "{n} votant", "{n} votants");
    if (v.options.some(o => o.yes === null)) {
      lines = [tr(lang, "**{n} choix**, par ordre alphabétique :", { n: v.options.length }), ...v.options.map(o => escapeMd(o.label))];
    } else {
      lines = ranking(v.options.map(o => ({ ...o, yes: o.yes ?? 0 }))).map((o, i) =>
        `${i + 1}. **${escapeMd(o.label)}**${v.qualifiers.includes(o.id) ? " ✅" : ""} \`${textBar(o.yes, v.voters)}\` ${o.yes}`);
    }
    const how = v.maxChoices ? tr(lang, "coche jusqu'à {n} choix, change d'avis jusqu'à la fin", { n: v.maxChoices })
      : v.multi ? tr(lang, "tes choix se changent jusqu'à la fin") : tr(lang, "ton vote se change jusqu'à la fin");
    foot = closed
      ? [voters, v.qualifiers.length ? tr(lang, "✅ qualifiés pour le 2e tour") : null, tr(lang, "ex æquo rangés par ordre alphabétique")].filter(Boolean).join(" · ")
      : `${voters} · ${how}`;
  } else if (v.kind === "choice") {
    const total = v.options.reduce((n, o) => n + (o.yes ?? 0), 0);
    lines = v.options.map((o, i) => {
      const head = `${NUMBERS[i] ?? "▫️"} **${escapeMd(o.label)}**${v.leaders.includes(o.id) && (closed || v.voters >= 2) ? " 🏆" : ""}`;
      if (o.yes === null) return head;
      return `${head}\n\`${textBar(o.yes, total)}\` ${o.yes} · ${pct(o.yes, total)} %`;
    });
    const votes = trn(lang, v.voters, "{n} vote", "{n} votes");
    foot = closed ? votes
      : v.hidden ? `${votes} · ${tr(lang, "résultats visibles à la fin du sondage")}`
        : `${votes} · ${v.multi ? tr(lang, "tes choix se changent jusqu'à la fin") : tr(lang, "ton vote se change jusqu'à la fin")}`;
  } else {
    lines = v.options.map(o => {
      const star = o.id === v.best;
      const counts = `✅ ${o.yes ?? 0} · 🤔 ${o.maybe ?? 0} · ❌ ${o.no ?? 0}`;
      return `${star ? "★ " : ""}**${optionText(v, o, lang)}**  ${counts}${star ? roleText(lang, o.roles) : ""}`;
    });
    if (v.raid) {
      const when = v.raid.scheduledAt ? ` · ${slotText(new Date(v.raid.scheduledAt), lang)}` : "";
      lines.push("", `🗓️ ${tr(lang, "Raid créé : [{name}{when}]({url})", { name: escapeMd(v.raid.name), when, url: v.raid.url })}`);
    }
    const answers = trn(lang, v.voters, "{n} réponse", "{n} réponses");
    foot = `${answers}${v.best ? ` · ${tr(lang, "★ meilleur créneau (le plus de « Oui », puis de « Si besoin »)")}` : ""}`;
  }
  const icon = v.kind === "dates" ? "📅" : "📊";
  return {
    embeds: [{
      title: `${closed ? "🔒 " : ""}${icon} ${v.question}`.slice(0, 256), url: v.url, color: closed ? GREY : GOLD,
      description: fitText([subtitle(v, lang), "", ...lines], 4000, n => tr(lang, "… et {n} autres : la liste complète est sur le site.", { n })),
      footer: { text: foot.slice(0, 2048) },
    }],
    components: pollButtons(v),
    allowedMentions: { parse: [] },
  };
}

type ActionStyle = ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success | ButtonStyle.Danger;
const btn = (custom_id: string, label: string, style: ActionStyle, emoji?: string, disabled = false): APIButtonComponent =>
  ({ type: ComponentType.Button, custom_id, label: label.slice(0, 80), style, ...(emoji ? { emoji: { name: emoji } } : {}), ...(disabled ? { disabled } : {}) });
const link = (url: string, label: string): APIButtonComponent => ({ type: ComponentType.Button, style: ButtonStyle.Link, url, label });
const rows = (buttons: APIButtonComponent[]): Row[] => {
  const out: Row[] = [];
  for (let i = 0; i < buttons.length; i += 5) out.push({ type: ComponentType.ActionRow, components: buttons.slice(i, i + 5) });
  return out;
};

/** Ouvert : un bouton par choix, « Mon vote », « Qui a voté ? » (public), « Clore » ; disponibilités : « Mes disponibilités »… */
export function pollButtons(v: PollView): Row[] {
  const lang = langOf(v.group);
  const closed = isClosed(v);
  const site = link(v.url, tr(lang, "Sur le site"));
  const who = !v.anonymous && !v.hidden;
  if (isBigPoll(v)) {
    // Plus un bouton par choix : « Voter » ouvre les menus ; clos, « 2e tour avec les 5 premiers »
    return [{ type: ComponentType.ActionRow, components: [
      ...(closed ? [] : [btn(encodePollId({ a: "ballot", pollId: v.id }), tr(lang, "Voter"), ButtonStyle.Primary, "🗳️"),
        btn(encodePollId({ a: "me", pollId: v.id }), tr(lang, "Mes choix"), ButtonStyle.Secondary, "👁️")]),
      ...(closed && v.qualifiers.length >= 2 && !v.runoffId
        ? [btn(encodePollId({ a: "runoff", pollId: v.id }), tr(lang, "2e tour avec les {n} premiers", { n: RUNOFF_SIZE }), ButtonStyle.Success)] : []),
      ...(who ? [btn(encodePollId({ a: "who", pollId: v.id }), tr(lang, "Qui a voté ?"), ButtonStyle.Secondary)] : []),
      ...(closed ? [] : [btn(encodePollId({ a: "close", pollId: v.id }), tr(lang, "Clore le sondage"), ButtonStyle.Secondary, "🔒")]),
      site,
    ] }];
  }
  if (v.kind === "choice") {
    const choices = closed ? [] : v.options.map((o, i) => btn(encodePollId({ a: "vote", pollId: v.id, optionId: o.id }), o.label, ButtonStyle.Secondary, NUMBERS[i]));
    const tools = [
      ...(closed ? [] : [btn(encodePollId({ a: "me", pollId: v.id }), tr(lang, "Mon vote"), ButtonStyle.Secondary, "👁️")]),
      ...(who ? [btn(encodePollId({ a: "who", pollId: v.id }), tr(lang, "Qui a voté ?"), ButtonStyle.Secondary)] : []),
      ...(closed ? [] : [btn(encodePollId({ a: "close", pollId: v.id }), tr(lang, "Clore le sondage"), ButtonStyle.Secondary, "🔒")]),
      site,
    ];
    return [...rows(choices), { type: ComponentType.ActionRow, components: tools }];
  }
  const raid = v.raid
    ? [link(v.raid.url, tr(lang, "Voir le raid"))]
    : [btn(encodePollId({ a: "raid", pollId: v.id }), tr(lang, "Créer le raid sur ★"), ButtonStyle.Success, undefined, !v.best)];
  return [{ type: ComponentType.ActionRow, components: [
    ...(closed ? [] : [btn(encodePollId({ a: "me", pollId: v.id }), tr(lang, "Mes disponibilités"), ButtonStyle.Primary, "📅")]),
    btn(encodePollId({ a: "who", pollId: v.id }), tr(lang, "Qui a répondu ?"), ButtonStyle.Secondary),
    ...raid,
    ...(closed ? [] : [btn(encodePollId({ a: "close", pollId: v.id }), tr(lang, "Clore"), ButtonStyle.Secondary, "🔒")]),
    site,
  ] }];
}

/* ---------- Réponses visibles par le joueur seul ---------- */

const names = (list: PollVoter[]) => list.map(p => `${escapeMd(p.name)}${p.guest ? " ✱" : ""}`).join(", ");

/** Après un clic sur un choix, ou « Mon vote ». */
export function voteReply(v: PollView, yes: number[], ui: Lang = langOf(v.group)) {
  const chosen = v.options.filter(o => yes.includes(o.id)).map(o => `**${escapeMd(o.label)}**`);
  if (isBigPoll(v)) {
    if (!chosen.length) return tr(ui, "Tu n'as pas (ou plus) de vote : « Voter » ouvre la liste.");
    return `✅ ${tr(ui, "Tes choix : {list}. « Voter » pour les changer.", { list: chosen.join(", ") })}`;
  }
  if (!chosen.length) return tr(ui, "Tu n'as pas (ou plus) de vote : clique un choix du sondage.");
  if (v.multi) return `✅ ${tr(ui, "Tes choix : {list}. Chaque clic sur un choix le coche ou le décoche.", { list: chosen.join(", ") })}`;
  return `✅ ${tr(ui, "Ton vote : {choice}. Clique un autre choix pour changer d'avis, ou le même pour le retirer.", { choice: chosen[0]! })}`;
}

/**
 * « Voter » d'un grand sondage : des menus de 25 choix qui se suivent dans l'ordre alphabétique, cochés comme le vote,
 * et « Effacer mes choix ». Un seul choix : 1 par menu (le dernier coché l'emporte, côté site).
 */
export function ballotPanel(v: PollView, yes: number[], ui: Lang = langOf(v.group), saved = false) {
  const chosen = v.options.filter(o => yes.includes(o.id)).map(o => escapeMd(o.label));
  const count = v.maxChoices ? tr(ui, "{n} sur {max}", { n: yes.length, max: v.maxChoices }) : String(yes.length);
  const menus: Row[] = [];
  for (let i = 0; i * POLL_MENU_SIZE < v.options.length; i++) {
    const part = v.options.slice(i * POLL_MENU_SIZE, (i + 1) * POLL_MENU_SIZE);
    const max = v.multi ? Math.min(part.length, v.maxChoices ?? part.length) : 1;
    menus.push({ type: ComponentType.ActionRow, components: [{
      type: ComponentType.StringSelect, custom_id: encodePollId({ a: "pick", pollId: v.id, menu: i }), min_values: 0, max_values: max,
      placeholder: tr(ui, "Choix {from} à {to} · {first} → {last}", { from: i * POLL_MENU_SIZE + 1, to: i * POLL_MENU_SIZE + part.length, first: part[0]!.label, last: part[part.length - 1]!.label }).slice(0, 150),
      options: part.map(o => ({ label: o.label.slice(0, 100), value: String(o.id), default: yes.includes(o.id) })),
    }] });
  }
  const head = v.multi ? tr(ui, "**Tes choix : {count}**", { count }) : tr(ui, "**Ton choix**");
  return {
    content: [
      `${head}${chosen.length ? ` · ${chosen.join(", ")}` : ` · ${tr(ui, "aucun pour l'instant")}`}`,
      `-# ${saved ? `${tr(ui, "Enregistré.")} ` : ""}${v.multi && v.maxChoices ? tr(ui, "Coche jusqu'à {n} choix dans les menus (par ordre alphabétique).", { n: v.maxChoices })
        : v.multi ? tr(ui, "Coche tes choix dans les menus (par ordre alphabétique).") : tr(ui, "Choisis dans un des menus (par ordre alphabétique) : ton choix remplace le précédent.")}`,
    ].join("\n"),
    components: [...menus.slice(0, 4), { type: ComponentType.ActionRow, components: [btn(encodePollId({ a: "clear", pollId: v.id }), tr(ui, "Effacer mes choix"), ButtonStyle.Secondary)] }] as Row[],
  };
}

/** Fenêtre de « 2e tour avec les 5 premiers » : sa question (préremplie) et sa fin. */
export function runoffModal(v: PollView, ui: Lang = langOf(v.group)): APIModalInteractionResponseCallbackData {
  const base = v.question.replace(/\s*[·:-]?\s*(1er|premier) tour\s*$/i, "").trim();
  return {
    custom_id: encodePollId({ a: "runoffmodal", pollId: v.id }), title: tr(ui, "2e tour").slice(0, 45),
    components: [
      input("question", tr(ui, "Question"), TextInputStyle.Short, { max: POLL_MAX_QUESTION, value: `${base} · ${tr(ui, "2e tour")}`.slice(0, POLL_MAX_QUESTION) }),
      input("end", tr(ui, "Fin (facultatif)"), TextInputStyle.Short, { required: false, max: 40, placeholder: tr(ui, "Vide : jusqu'à ce que tu le closes. Ex. dimanche 23:59, 24h") }),
    ],
  };
}

/** « Mes disponibilités » : deux menus (Je viens, Si besoin), cochés comme son vote actuel. */
export function datesPanel(v: PollView, vote: { yes: number[]; maybe: number[] } | null, who: { name: string; role: PollRole | null; guest: boolean }, ui: Lang = langOf(v.group), saved = false) {
  const yes = vote?.yes ?? [], maybe = vote?.maybe ?? [];
  const opts = (sel: number[]): APISelectMenuOption[] => v.options.map(o => ({
    label: optionText(v, o, ui).slice(0, 100), value: String(o.id), default: sel.includes(o.id),
    description: tr(ui, "{yes} oui · {maybe} si besoin", { yes: o.yes ?? 0, maybe: o.maybe ?? 0 }).slice(0, 100),
  }));
  const menu = (custom_id: string, placeholder: string, sel: number[]): Row => ({
    type: ComponentType.ActionRow,
    components: [{ type: ComponentType.StringSelect, custom_id, placeholder, options: opts(sel), min_values: 0, max_values: v.options.length }],
  });
  const as = who.guest ? tr(ui, " (sans compte : sous ton pseudo Discord)") : tr(ui, " · avec {name}", { name: `**${escapeMd(who.name)}**` });
  const list = (ids: number[]) => v.options.filter(o => ids.includes(o.id)).map(o => optionText(v, o, ui)).join(", ");
  return {
    content: [
      `**${tr(ui, "Tes disponibilités")}**${as}`,
      `✅ ${tr(ui, "Je viens")}${yes.length ? ` : ${list(yes)}` : ` : —`}`,
      `🤔 ${tr(ui, "Si besoin")}${maybe.length ? ` : ${list(maybe)}` : ` : —`}`,
      `-# ${saved ? `${tr(ui, "Enregistré.")} ` : ""}${tr(ui, "Les créneaux non cochés comptent « Non ».")}`,
    ].join("\n"),
    components: [
      menu(encodePollId({ a: "yes", pollId: v.id }), tr(ui, "✅ Je viens…"), yes),
      menu(encodePollId({ a: "maybe", pollId: v.id }), tr(ui, "🤔 Si besoin…"), maybe),
    ],
  };
}

/** « Qui a voté ? » / « Qui a répondu ? ». */
export function votersReply(v: PollView, r: { options: { id: number; yes: PollVoter[]; maybe: PollVoter[] }[]; none: PollVoter[] }, ui: Lang = langOf(v.group)) {
  const lines = v.options.map((o, i) => {
    const x = r.options.find(y => y.id === o.id) ?? { yes: [], maybe: [] };
    if (v.kind === "choice") return `${NUMBERS[i]} **${escapeMd(o.label)}** (${x.yes.length})${x.yes.length ? ` : ${names(x.yes)}` : ""}`;
    return `**${optionText(v, o, ui)}**\n✅ ${x.yes.length ? names(x.yes) : "—"}${x.maybe.length ? `\n🤔 ${names(x.maybe)}` : ""}`;
  });
  if (v.kind === "dates" && r.none.length) lines.push(`❌ ${tr(ui, "Aucun créneau")} : ${names(r.none)}`);
  const guests = [...r.options.flatMap(o => [...o.yes, ...o.maybe]), ...r.none].some(p => p.guest);
  const text = [`**${escapeMd(v.question)}**`, "", ...lines, ...(guests ? ["", `-# ✱ ${tr(ui, "a répondu depuis Discord, sans compte du site")}`] : [])].join("\n");
  return text.length > 1900 ? `${text.slice(0, 1900)}…\n${tr(ui, "La liste complète est sur le site.")}` : text;
}

/** Confirmation avant de clore. */
export function closeConfirm(v: PollView, ui: Lang = langOf(v.group)) {
  return {
    content: tr(ui, "Clore le sondage {q} ? Les votes s'arrêtent et les résultats restent affichés.", { q: quote(ui, escapeMd(v.question)) }),
    components: [{ type: ComponentType.ActionRow, components: [btn(encodePollId({ a: "closeok", pollId: v.id }), tr(ui, "Clore le sondage"), ButtonStyle.Danger, "🔒")] }] as Row[],
  };
}

/* ---------- Fenêtres de saisie ---------- */

export interface PollDraft { action: Extract<PollAction, { a: "new" }>; question: string; options: string; end: string; raidName: string }

const input = (custom_id: string, label: string, style: TextInputStyle, opts: { required?: boolean; max: number; placeholder?: string; value?: string; min?: number }): APIActionRowComponent<APITextInputComponent> => ({
  type: ComponentType.ActionRow,
  components: [{
    type: ComponentType.TextInput, custom_id, label: label.slice(0, 45), style, required: opts.required ?? true, max_length: opts.max,
    ...(opts.min ? { min_length: opts.min } : {}), ...(opts.placeholder ? { placeholder: opts.placeholder.slice(0, 100) } : {}), ...(opts.value ? { value: opts.value.slice(0, opts.max) } : {}),
  }],
});

/** Fenêtre de /sondage (question, choix un par ligne, fin) ou de /dispos (question, créneaux, nom du raid, fin). */
export function createModal(action: Extract<PollAction, { a: "new" }>, ui: Lang, draft?: PollDraft | null): APIModalInteractionResponseCallbackData {
  const d = draft ?? null;
  if (action.kind === "dates") {
    return {
      custom_id: encodePollId(action), title: tr(ui, "Disponibilités pour un raid").slice(0, 45),
      components: [
        input("question", tr(ui, "Question"), TextInputStyle.Short, { max: POLL_MAX_QUESTION, placeholder: tr(ui, "Quel soir pour Onyxia la semaine prochaine ?"), value: d?.question }),
        input("options", tr(ui, "Créneaux (un par ligne, {min} à {max})", { min: POLL_MIN_OPTIONS, max: POLL_MAX_SLOTS }), TextInputStyle.Paragraph,
          { max: 600, placeholder: tr(ui, "mardi 01/12 21:00\nmercredi 21h\n06/12 20:30"), value: d?.options }),
        input("raid", tr(ui, "Nom du raid (facultatif)"), TextInputStyle.Short, { required: false, max: 60, placeholder: tr(ui, "Pour « Créer le raid sur ★ » (ex. Onyxia)"), value: d?.raidName }),
        input("end", tr(ui, "Fin (facultatif)"), TextInputStyle.Short, { required: false, max: 40, placeholder: tr(ui, "Vide : au premier créneau. Ex. 2j, dimanche 20:00"), value: d?.end }),
      ],
    };
  }
  return {
    custom_id: encodePollId(action), title: tr(ui, "Nouveau sondage").slice(0, 45),
    components: [
      input("question", tr(ui, "Question"), TextInputStyle.Short, { max: POLL_MAX_QUESTION, placeholder: tr(ui, "Quel donjon jeudi soir ?"), value: d?.question }),
      input("options", tr(ui, "Choix (un par ligne, {min} à {max})", { min: POLL_MIN_OPTIONS, max: POLL_MAX_OPTIONS }), TextInputStyle.Paragraph,
        { max: 4000, placeholder: tr(ui, "Scholomance\nStratholme\nPic Rochenoire"), value: d?.options }),
      input("end", tr(ui, "Fin (facultatif)"), TextInputStyle.Short, { required: false, max: 40, placeholder: tr(ui, "Vide : jusqu'à ce que tu le closes. Ex. 2j, 48h, jeudi 18:00"), value: d?.end }),
    ],
  };
}

/** Fenêtre de « Créer le raid sur ★ » : nom (celui du sondage) et créneau (le meilleur), modifiables. */
export function raidModal(v: PollView, ui: Lang = langOf(v.group)): APIModalInteractionResponseCallbackData {
  const best = v.options.find(o => o.id === v.best) ?? v.options[0];
  return {
    custom_id: encodePollId({ a: "raidmodal", pollId: v.id }), title: tr(ui, "Créer le raid").slice(0, 45),
    components: [
      input("name", tr(ui, "Nom du raid"), TextInputStyle.Short, { max: 60, min: 2, placeholder: tr(ui, "Ex. Onyxia"), value: v.raidName || undefined }),
      input("slot", tr(ui, "Créneau (heure de Paris)"), TextInputStyle.Short, { max: 40, value: best?.at ? slotText(new Date(best.at), ui) : undefined, placeholder: tr(ui, "Ex. mercredi 02/12 21:00") }),
    ],
  };
}

const SLOT_ERRORS: Record<SlotError, string> = {
  unreadable: N("date ou heure illisible (ex. mardi 01/12 21:00, mercredi 21h)"),
  invalid: N("cette date ou cette heure n'existe pas"),
  past: N("déjà passé"),
  far: N("trop lointain (un an maximum)"),
};
export const slotError = (ui: Lang, r: SlotError) => tr(ui, SLOT_ERRORS[r]);

const linesOf = (text: string) => text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

export type ParsedDraft = { ok: true; body: Omit<PollNewBody, "guildId" | "channelId" | "discordUserId"> } | { ok: false; error: string };

/** Lit la saisie de la fenêtre ; les erreurs disent quelle ligne corriger. */
export function parseDraft(d: PollDraft, now: Date, timeZone: string, ui: Lang): ParsedDraft {
  const question = d.question.replace(/\s+/g, " ").trim();
  if (!question) return { ok: false, error: tr(ui, "Écris la question du sondage.") };
  const a = d.action;
  const lines = linesOf(d.options);
  const max = a.kind === "dates" ? POLL_MAX_SLOTS : POLL_MAX_OPTIONS;
  if (lines.length < POLL_MIN_OPTIONS) return { ok: false, error: a.kind === "dates" ? tr(ui, "Propose au moins {n} créneaux, un par ligne.", { n: POLL_MIN_OPTIONS }) : tr(ui, "Propose au moins {n} choix, un par ligne.", { n: POLL_MIN_OPTIONS }) };
  if (lines.length > max) return { ok: false, error: a.kind === "dates" ? tr(ui, "{n} créneaux au plus.", { n: max }) : tr(ui, "{n} choix au plus.", { n: max }) };
  const end = parseEnd(d.end, now, timeZone);
  if (!end.ok) return { ok: false, error: tr(ui, "Fin {text} : {why}.", { text: quote(ui, d.end.trim()), why: slotError(ui, end.reason) }) };
  if (a.kind === "choice") {
    const long = lines.findIndex(l => l.length > POLL_MAX_LABEL);
    if (long >= 0) return { ok: false, error: tr(ui, "Ligne {n} : {max} caractères au plus par choix.", { n: long + 1, max: POLL_MAX_LABEL }) };
    const seen = new Set<string>();
    for (const [i, l] of lines.entries()) {
      if (seen.has(l.toLowerCase())) return { ok: false, error: tr(ui, "Ligne {n} : ce choix est déjà dans la liste.", { n: i + 1 }) };
      seen.add(l.toLowerCase());
    }
    return { ok: true, body: {
      kind: "choice", question, options: lines.map(label => ({ label })), multi: a.multi || !!a.max, maxChoices: a.max ?? null, anonymous: a.anonymous, results: a.results,
      closesAt: end.at?.toISOString() ?? null,
    } };
  }
  const slots: { label: string; at: string }[] = [];
  for (const [i, l] of lines.entries()) {
    const r = parseSlot(l, now, timeZone);
    if (!r.ok) return { ok: false, error: tr(ui, "Ligne {n} {text} : {why}.", { n: i + 1, text: quote(ui, l), why: slotError(ui, r.reason) }) };
    if (slots.some(s => s.at === r.at.toISOString())) return { ok: false, error: tr(ui, "Ligne {n} : ce créneau est déjà dans la liste.", { n: i + 1 }) };
    slots.push({ label: l.slice(0, POLL_MAX_LABEL), at: r.at.toISOString() });
  }
  if (end.at && end.at.getTime() > Math.max(...slots.map(s => Date.parse(s.at)))) {
    return { ok: false, error: tr(ui, "La fin du sondage tombe après le dernier créneau.") };
  }
  return { ok: true, body: { kind: "dates", question, options: slots, closesAt: end.at?.toISOString() ?? null, raidName: d.raidName.trim().slice(0, 60) } };
}

/** Réponse après la création : « Sondage posé » (ou « Disponibilités posées »), avec le lien du site. */
/** Sondage posé dans le salon des sondages de la guilde, pas dans celui où l'on a cliqué ou tapé la commande : on le dit. */
export const elsewhere = (v: PollView, ui: Lang, here?: string | null) =>
  here && v.channelId && v.channelId !== here ? ` ${tr(ui, "Il est dans le salon des sondages : {channel}.", { channel: `<#${v.channelId}>` })}` : "";

export function createdReply(v: PollView, ui: Lang = langOf(v.group), here?: string | null) {
  const where = elsewhere(v, ui, here);
  return v.kind === "dates"
    ? `✅ ${tr(ui, "Sondage de disponibilités posé : {n} créneaux. Le meilleur créneau s'affiche avec une ★ ; « Créer le raid sur ★ » crée le raid.", { n: v.options.length })}${where} [${tr(ui, "Voir sur le site")}](<${v.url}>)`
    : `✅ ${tr(ui, "Sondage posé. Tu peux le clore avec « Clore le sondage » (les officiers aussi).")}${where} [${tr(ui, "Voir sur le site")}](<${v.url}>)`;
}

/** Réponse après « Créer le raid sur ★ ». */
export function raidCreatedReply(r: { raid: { name: string; scheduledAt: string; url: string | null }; hasChannel: boolean }, ui: Lang) {
  const when = slotText(new Date(r.raid.scheduledAt), ui);
  const head = tr(ui, "Raid {name} créé : {when}.", { name: `**${escapeMd(r.raid.name)}**`, when });
  const tail = r.hasChannel ? tr(ui, "Son annonce arrive dans le salon des raids ; le sondage est clos.") : tr(ui, "La guilde n'a pas de salon pour ses annonces de raid : il est sur le site seulement. Le sondage est clos.");
  return `✅ ${head} ${tail}${r.raid.url ? ` [${tr(ui, "Voir sur le site")}](<${r.raid.url}>)` : ""}`;
}
