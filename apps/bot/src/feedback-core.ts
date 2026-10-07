import { ButtonStyle, ComponentType, TextInputStyle, type APIButtonComponent, type APIButtonComponentWithCustomId, type APIEmbed, type APIEmbedField, type APIModalInteractionResponseCallbackData } from "discord.js";
import type { FeedbackStatus } from "./api";
import { escapeMd, type Row } from "./render";

/**
 * Avis (feedback) : partie pure, testée sans Discord. Fonction autonome, utilisable par n'importe quel serveur
 * (guilde WoW ou autre jeu) sans le site ni l'addon : aucun vocabulaire de jeu ici.
 * Suivi facultatif par un groupe du site (Track) : statut sur le message de l'équipe, lien vers le site.
 */

/** Groupe du site qui suit les avis du serveur. url : section Avis du groupe (sans l'avis). */
export interface Track { group: string; site: string; url: string }
export const avisUrl = (t: Pick<Track, "url">, id: string) => `${t.url}?avis=${id}`;
export const STATUS_LABEL: Record<FeedbackStatus, string> = { new: "🆕 Nouveau", wip: "🔧 En cours", done: "✅ Fait", refused: "⛔ Refusé" };

export const MAX_TEXT = 1800;
export const MAX_REPLY = 1500;
export const SESSION_MS = 15 * 60e3;
/** Délai entre deux avis, et nombre d'avis par heure, par personne (contre les abus de l'anonymat). */
export const COOLDOWN_MS = 60e3;
export const PER_HOUR = 5;
export const KEEP_DAYS = 30;

const COLOR = 0xc8a04b;
const COLOR_ANON = 0x6b7a99;

/* ---------- Identifiants des boutons et fenêtres ---------- */

/**
 * fb|<action>[|<argument>] — l'argument est l'id du serveur (parcours d'envoi) ou de l'avis (réponses).
 * Tout est revérifié à la réception : un custom_id peut être forgé.
 */
export type FbAction =
  | { a: "open" }                          // bouton du salon dédié
  | { a: "here"; guildId: string }         // MP fermés : écrire dans une fenêtre
  | { a: "write"; guildId: string }        // fenêtre d'écriture envoyée
  | { a: "sign"; guildId: string }         // envoyer signé
  | { a: "anon"; guildId: string }         // envoyer anonyme
  | { a: "cancel"; guildId: string }
  | { a: "reply"; id: string }             // équipe : répondre à l'avis
  | { a: "rmodal"; id: string }
  | { a: "back"; id: string }              // auteur : répondre à l'équipe
  | { a: "bmodal"; id: string };

const SNOWFLAKE = /^\d{5,25}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BY_GUILD = new Set(["here", "write", "sign", "anon", "cancel"]);
const BY_ID = new Set(["reply", "rmodal", "back", "bmodal"]);

export function encodeFb(x: FbAction): string {
  if (x.a === "open") return "fb|open";
  return `fb|${x.a}|${"guildId" in x ? x.guildId : x.id}`;
}

export function decodeFb(id: string): FbAction | null {
  const [p, a, arg, ...rest] = id.split("|");
  if (p !== "fb" || !a || rest.length) return null;
  if (a === "open") return arg === undefined ? { a } : null;
  if (BY_GUILD.has(a) && arg && SNOWFLAKE.test(arg)) return { a, guildId: arg } as FbAction;
  if (BY_ID.has(a) && arg && UUID.test(arg)) return { a, id: arg.toLowerCase() } as FbAction;
  return null;
}

/* ---------- Avis en cours d'écriture (en mémoire seulement) ---------- */

export interface Session {
  guildId: string; guildName: string; allowAnonymous: boolean;
  /** Avis suivis sur le site par un groupe : le joueur en est prévenu dans l'aperçu. */
  track?: Track | null;
  /** Nom affiché si l'avis est signé (pseudo sur le serveur) et avatar. */
  name: string; avatarUrl: string | null;
  text: string | null;
  expiresAt: number;
}

/** Un avis en cours par personne (le dernier serveur demandé l'emporte). Rien n'est écrit sur disque. */
export class Sessions {
  private map = new Map<string, Session>();
  constructor(private readonly now: () => number = Date.now) {}
  start(userId: string, s: Omit<Session, "text" | "expiresAt">) {
    const session = { ...s, text: null, expiresAt: this.now() + SESSION_MS };
    this.map.set(userId, session);
    return session;
  }
  get(userId: string, guildId?: string) {
    const s = this.map.get(userId);
    if (!s || s.expiresAt < this.now()) { this.map.delete(userId); return null; }
    return guildId && s.guildId !== guildId ? null : s;
  }
  setText(userId: string, text: string) {
    const s = this.get(userId);
    if (!s) return null;
    s.text = text;
    s.expiresAt = this.now() + SESSION_MS;
    return s;
  }
  end(userId: string) { this.map.delete(userId); }
  purge() { for (const [k, s] of this.map) if (s.expiresAt < this.now()) this.map.delete(k); }
}

/** Limite d'envoi par personne : 1 avis par minute, 5 par heure. */
export class Cooldown {
  private sent = new Map<string, number[]>();
  constructor(private readonly now: () => number = Date.now) {}
  /** Minutes à attendre (0 : peut envoyer). */
  wait(userId: string) {
    const t = this.now();
    const list = (this.sent.get(userId) ?? []).filter(x => x > t - 3600e3);
    this.sent.set(userId, list);
    const last = list[list.length - 1];
    if (last && t - last < COOLDOWN_MS) return 1;
    if (list.length >= PER_HOUR) return Math.max(1, Math.ceil((list[0]! + 3600e3 - t) / 60e3));
    return 0;
  }
  hit(userId: string) { this.sent.set(userId, [...(this.sent.get(userId) ?? []), this.now()]); }
}

/** Texte d'un avis écrit en MP : vide, trop long, ou fichiers joints (non transmis). */
export function checkText(content: string, attachments = 0): { ok: true; text: string; note: string | null } | { ok: false; error: string } {
  const text = content.trim();
  if (!text) return { ok: false, error: attachments ? "Seul le texte est transmis : écris ton avis en toutes lettres." : "Message vide : écris ton avis." };
  if (text.length > MAX_TEXT) return { ok: false, error: `Message trop long (${text.length}/${MAX_TEXT} caractères) : raccourcis-le, ou garde l'essentiel.` };
  return { ok: true, text, note: attachments ? "Les images et fichiers joints ne sont pas transmis, seulement le texte." : null };
}

/* ---------- Messages ---------- */

type Style = ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success | ButtonStyle.Danger;
const button = (custom_id: string, label: string, style: Style, emoji?: string): APIButtonComponentWithCustomId =>
  ({ type: ComponentType.Button, custom_id, label, style, ...(emoji ? { emoji: { name: emoji } } : {}) });
const row = (...components: APIButtonComponent[]): Row => ({ type: ComponentType.ActionRow, components });
const none = { parse: [] as [] };

/** Message du salon dédié, avec le bouton. */
export function panelMessage(allowAnonymous: boolean) {
  return {
    embeds: [{
      color: COLOR,
      title: "💬 Donne ton avis",
      description: [
        "Une idée, un souci, un merci ? Clique sur le bouton : je t'écris en message privé, tu y écris ton avis.",
        allowAnonymous ? "Tu choisis ensuite de l'envoyer **signé** ou **anonyme**." : "Les avis de ce serveur sont **signés**.",
        "L'équipe peut te répondre par mon intermédiaire" + (allowAnonymous ? ", même si tu restes anonyme." : "."),
        "",
        "-# Ça marche aussi avec la commande /feedback, depuis n'importe quel salon.",
      ].join("\n"),
    }] satisfies APIEmbed[],
    components: [row(button(encodeFb({ a: "open" }), "Donner mon avis", ButtonStyle.Primary, "💬"))],
    allowedMentions: none,
  };
}

/** Premier MP : écrire l'avis en réponse. */
export function promptMessage(s: Pick<Session, "guildId" | "guildName" | "allowAnonymous">) {
  return {
    embeds: [{
      color: COLOR,
      title: `Ton avis pour ${escapeMd(s.guildName)}`,
      description: [
        `Écris ton avis **ici, en un seul message** (${MAX_TEXT} caractères au plus).`,
        s.allowAnonymous ? "Tu verras un aperçu, puis tu choisiras de l'envoyer **signé** ou **anonyme**." : "Tu verras un aperçu avant l'envoi. Sur ce serveur, les avis sont **signés**.",
        "",
        "-# Tu as 15 minutes. Seul le texte est transmis.",
      ].join("\n"),
    }] satisfies APIEmbed[],
    components: [row(button(encodeFb({ a: "cancel", guildId: s.guildId }), "Annuler", ButtonStyle.Secondary))],
    allowedMentions: none,
  };
}

/** Aperçu, avec le choix signé / anonyme. */
export function previewMessage(s: Session & { text: string }, note: string | null = null) {
  const lines = [
    `**Signé** : ton nom (${escapeMd(s.name)}) apparaît avec l'avis.`,
    s.allowAnonymous
      ? `**Anonyme** : ton nom n'apparaît nulle part. L'équipe peut quand même te répondre par mon intermédiaire, sans savoir qui tu es. Je garde ce lien ${KEEP_DAYS} jours, puis je l'efface.`
      : "Ce serveur n'accepte que les avis signés.",
    ...(s.track ? [`Ton avis et les réponses sont aussi visibles du chef et des officiers du groupe « ${escapeMd(s.track.group)} » sur ${s.track.site}${s.allowAnonymous ? " (sans ton nom si tu l'envoies anonyme)" : ""}.`] : []),
    "",
    "-# Pour corriger, envoie simplement un nouveau message : il remplace celui-ci.",
  ];
  if (note) lines.unshift(`⚠️ ${note}`, "");
  return {
    content: "",
    embeds: [
      { color: COLOR, title: `Aperçu · ${escapeMd(s.guildName)}`, description: s.text },
      { color: COLOR_ANON, description: lines.join("\n") },
    ] satisfies APIEmbed[],
    components: [row(
      button(encodeFb({ a: "sign", guildId: s.guildId }), "Envoyer signé", ButtonStyle.Primary, "✍️"),
      ...(s.allowAnonymous ? [button(encodeFb({ a: "anon", guildId: s.guildId }), "Envoyer anonyme", ButtonStyle.Secondary, "🕶️")] : []),
      button(encodeFb({ a: "cancel", guildId: s.guildId }), "Annuler", ButtonStyle.Danger),
    )],
    allowedMentions: none,
  };
}

export function sentMessage(guildName: string, anonymous: boolean, text: string) {
  return {
    content: "",
    embeds: [{
      color: COLOR,
      title: `✅ Avis envoyé ${anonymous ? "anonymement" : "signé"} · ${escapeMd(guildName)}`,
      description: text,
      footer: { text: "Si l'équipe te répond, la réponse arrivera ici." },
    }] satisfies APIEmbed[],
    components: [],
    allowedMentions: none,
  };
}

export interface Author { id: string; name: string; avatarUrl: string | null }

/** Champs « Statut » et « Suivi » d'un avis suivi par un groupe du site. */
function trackFields(status: FeedbackStatus, track: Pick<Track, "group" | "site">): APIEmbedField[] {
  return [
    { name: "Statut", value: STATUS_LABEL[status], inline: true },
    { name: "Suivi", value: `${track.site} · ${escapeMd(track.group)}`.slice(0, 1024), inline: true },
  ];
}
const linkButton = (url: string): APIButtonComponent => ({ type: ComponentType.Button, style: ButtonStyle.Link, label: "Voir sur le site", url });

/** Boutons sous l'avis : « Répondre », et le lien vers le site s'il est suivi. */
export function inboxButtons(id: string, url: string | null) {
  return [row(button(encodeFb({ a: "reply", id }), "Répondre", ButtonStyle.Secondary, "↩️"), ...(url ? [linkButton(url)] : []))];
}

/** Avis publié dans le salon de l'équipe. Anonyme : aucune trace de l'auteur dans le message. */
export function inboxMessage(id: string, text: string, author: Author | null, at = new Date(), track: Track | null = null) {
  const fields: APIEmbedField[] = [
    ...(author ? [{ name: "De", value: `<@${author.id}>`, inline: true }] : []),
    ...(track ? trackFields("new", track) : []),
  ];
  const embed: APIEmbed = {
    color: author ? COLOR : COLOR_ANON,
    author: author ? { name: author.name, ...(author.avatarUrl ? { icon_url: author.avatarUrl } : {}) } : { name: "Anonyme" },
    title: "Nouvel avis",
    description: text,
    ...(fields.length ? { fields } : {}),
    footer: { text: author ? "Répondre : la réponse part en MP à l'auteur." : "Répondre : la réponse part en MP à l'auteur, sans révéler son nom." },
    timestamp: at.toISOString(),
  };
  return { embeds: [embed], components: inboxButtons(id, track ? avisUrl(track, id) : null), allowedMentions: none };
}

/** Message de l'avis avec le statut changé sur le site : le reste (texte, auteur, date) est gardé tel quel. */
export function withStatus(embed: APIEmbed, status: FeedbackStatus, track: Pick<Track, "group" | "site">): APIEmbed {
  const kept = (embed.fields ?? []).filter(f => f.name !== "Statut" && f.name !== "Suivi");
  return { ...embed, fields: [...kept, ...trackFields(status, track)] };
}

/** MP à l'auteur : réponse de l'équipe, avec un bouton pour répondre à son tour. */
export function teamReplyDm(id: string, guildName: string, responder: string, text: string, original: string | null) {
  const excerpt = original && original.length > 300 ? `${original.slice(0, 300)}…` : original;
  return {
    embeds: [{
      color: COLOR,
      title: `Réponse de l'équipe · ${escapeMd(guildName)}`,
      author: { name: responder },
      description: text,
      ...(excerpt ? { fields: [{ name: "Ton avis", value: excerpt }] } : {}),
      footer: { text: `Tu peux répondre pendant ${KEEP_DAYS} jours après ton avis.` },
    }] satisfies APIEmbed[],
    components: [row(button(encodeFb({ a: "back", id }), "Répondre", ButtonStyle.Secondary, "↩️"))],
    allowedMentions: none,
  };
}

/** Trace, sous l'avis, de la réponse envoyée par l'équipe. */
export function replyLog(responder: string, text: string, delivered: boolean) {
  return {
    embeds: [{
      color: delivered ? COLOR : 0xff6b5e,
      author: { name: `↪️ Réponse de ${responder}` },
      description: text,
      footer: { text: delivered ? "Envoyée en MP à l'auteur." : "Non remise : l'auteur n'accepte pas les MP du bot." },
    }] satisfies APIEmbed[],
    allowedMentions: none,
  };
}

/** Réponse de l'auteur, sous l'avis (toujours anonyme si l'avis l'était). */
export function authorReplyInbox(id: string, text: string, author: Author | null) {
  return {
    embeds: [{
      color: author ? COLOR : COLOR_ANON,
      author: { name: author ? `↪️ ${author.name} répond` : "↪️ L'auteur (anonyme) répond" },
      description: text,
    }] satisfies APIEmbed[],
    components: [row(button(encodeFb({ a: "reply", id }), "Répondre", ButtonStyle.Secondary, "↩️"))],
    allowedMentions: none,
  };
}

/** Fenêtre de saisie (MP fermés, ou réponse). */
export function textModal(custom_id: string, title: string, label: string, max: number, placeholder?: string): APIModalInteractionResponseCallbackData {
  return {
    custom_id, title,
    components: [{
      type: ComponentType.ActionRow,
      components: [{ type: ComponentType.TextInput, custom_id: "text", label, style: TextInputStyle.Paragraph, min_length: 2, max_length: max, required: true, ...(placeholder ? { placeholder } : {}) }],
    }],
  };
}

export const writeModal = (guildId: string, guildName: string) =>
  textModal(encodeFb({ a: "write", guildId }), `Ton avis pour ${guildName}`.slice(0, 45), "Ton avis", MAX_TEXT, "Une idée, un souci, un merci…");
export const replyModal = (id: string) => textModal(encodeFb({ a: "rmodal", id }), "Répondre à l'avis", "Ta réponse (envoyée en MP à l'auteur)", MAX_REPLY);
export const backModal = (id: string) => textModal(encodeFb({ a: "bmodal", id }), "Répondre à l'équipe", "Ta réponse", MAX_REPLY);
