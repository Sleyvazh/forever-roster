import { parseSlot } from "@forever/game-data";
import {
  ButtonStyle, ComponentType, DiscordAPIError, MessageFlags,
  type ButtonInteraction, type ChatInputCommandInteraction, type Client, type Interaction, type ModalSubmitInteraction, type StringSelectMenuInteraction,
} from "discord.js";
import { ApiError, type InternalApi, type PollView, type RaidView } from "./api";
import { langOf, remember, tr, type Lang } from "./i18n";
import {
  closeConfirm, createdReply, createModal, datesPanel, decodePollId, encodePollId, parseDraft, raidCreatedReply, raidModal, renderPoll, slotError, voteReply, votersReply,
  type PollAction, type PollDraft,
} from "./polls-core";
import type { Row } from "./render";
import type { Logger } from "./sync";

/**
 * Sondages sur Discord : /sondage (choix) et /dispos (disponibilités), boutons, menus et fenêtres, relève des messages
 * (votes du site, clôture à la fin). Les règles sont celles du site ; les textes et le rendu sont dans polls-core.ts.
 */

const UNKNOWN_MESSAGE = 10008;
/** Saisie refusée gardée 15 min pour « Corriger » (en mémoire seulement). */
const DRAFT_MS = 15 * 60e3;

interface Deps {
  client: Client; api: InternalApi; log: Logger; timeZone: string;
  nameOf(i: Interaction): string;
  /** Langue de la réponse : celle de la guilde si connue, sinon celle du Discord du joueur. */
  replyLang(i: { locale: string; channelId: string | null }, ...ids: (string | null | undefined)[]): Lang;
  /** Pose tout de suite l'annonce d'un raid créé depuis un sondage. */
  publishRaid(view: RaidView): void;
}

export function createPolls({ client, api, log, timeZone, nameOf, replyLang, publishRaid }: Deps) {
  const drafts = new Map<string, PollDraft & { at: number; guildId: string; channelId: string }>();

  /* ----- Messages : un seul à la fois par sondage (clic et relève simultanés) ----- */
  const posted = new Map<string, { channelId: string; messageId: string }>();
  const locks = new Map<string, Promise<unknown>>();
  const failures = new Map<string, number>();
  let running = false;
  const serial = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const next = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
    locks.set(key, next);
    void next.catch(() => {}).finally(() => { if (locks.get(key) === next) locks.delete(key); });
    return next;
  };
  async function upsert(v: PollView, messageId: string | null) {
    const ch = await client.channels.fetch(v.channelId!);
    if (!ch || !ch.isSendable()) throw new Error(`Salon ${v.channelId} inaccessible`);
    remember(v.group.lang, v.id, v.channelId);
    const payload = renderPoll(v);
    if (messageId) {
      try { const m = await ch.messages.edit(messageId, payload); return { channelId: ch.id, messageId: m.id }; }
      catch (e) { if (!(e instanceof DiscordAPIError && e.code === UNKNOWN_MESSAGE)) throw e; }
    }
    const m = await ch.send(payload);
    return { channelId: ch.id, messageId: m.id };
  }
  function publish(v: PollView) {
    if (!v.channelId) return Promise.resolve(null);
    return serial(v.id, async () => {
      const known = posted.get(v.id);
      const msg = await upsert(v, v.messageId ?? (known?.channelId === v.channelId ? known.messageId : null));
      posted.set(v.id, msg);
      await api.pollPublished(v.id, { ...msg, changedAt: v.changedAt });
      failures.delete(v.id);
      return msg;
    });
  }
  const publishSoon = (v: PollView) => { publish(v).catch(e => log.warn("Mise à jour du sondage impossible", e?.message)); };
  async function tick() {
    if (running) return;
    running = true;
    try {
      const { polls } = await api.pollsOutbox();
      for (const v of polls) {
        if ((failures.get(v.id) ?? 0) > Date.now()) continue;
        try { await publish(v); } catch (e) {
          failures.set(v.id, Date.now() + 60e3);
          log.warn(`Sondage non publié (${v.id})`, e instanceof Error ? e.message : e);
        }
      }
    } finally { running = false; }
  }

  const fail = (i: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction | ChatInputCommandInteraction, msg: string) =>
    (i.deferred || i.replied ? i.editReply({ content: `⚠️ ${msg}`, components: [] }) : i.reply({ content: `⚠️ ${msg}`, flags: MessageFlags.Ephemeral }));

  /* ----- /sondage, /dispos : vérification, puis fenêtre de saisie ----- */
  async function command(i: ChatInputCommandInteraction) {
    const lang = replyLang(i);
    if (!i.inGuild() || !i.channelId) return i.reply({ content: tr(lang, "Commande à utiliser dans un salon de serveur."), flags: MessageFlags.Ephemeral });
    let ui = lang;
    try {
      const r = await api.withLang(lang).pollCanCreate({ guildId: i.guildId, channelId: i.channelId, discordUserId: i.user.id });
      remember(r.group.lang, i.channelId);
      ui = langOf(r.group, lang);
    } catch (e) {
      if (e instanceof ApiError) return fail(i, e.message);
      throw e;
    }
    const action: Extract<PollAction, { a: "new" }> = i.commandName === "dispos" ? { a: "new", kind: "dates" } : {
      a: "new", kind: "choice", anonymous: i.options.getBoolean("anonyme") ?? true, multi: i.options.getBoolean("plusieurs") ?? false,
      results: i.options.getString("resultats") === "fin" ? "end" : "live",
    };
    return i.showModal(createModal(action, ui));
  }

  async function submitNew(i: ModalSubmitInteraction, action: Extract<PollAction, { a: "new" }>) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const ui = replyLang(i);
    if (!i.inGuild() || !i.channelId) return i.editReply(tr(ui, "Commande à utiliser dans un salon de serveur."));
    const field = (k: string) => { try { return i.fields.getTextInputValue(k); } catch { return ""; } };
    const draft: PollDraft = { action, question: field("question"), options: field("options"), end: field("end"), raidName: field("raid") };
    const parsed = parseDraft(draft, new Date(), timeZone, ui);
    const keep = () => drafts.set(i.user.id, { ...draft, at: Date.now(), guildId: i.guildId!, channelId: i.channelId! });
    if (!parsed.ok) {
      keep();
      return i.editReply({ content: `⚠️ ${parsed.error}`, components: [fixRow(ui)] });
    }
    try {
      const { view } = await api.withLang(ui).createPoll({ ...parsed.body, guildId: i.guildId, channelId: i.channelId, discordUserId: i.user.id });
      drafts.delete(i.user.id);
      await publish(view).catch(e => log.warn("Sondage non publié", e?.message));
      return i.editReply({ content: createdReply(view, ui), components: [] });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      keep();
      return i.editReply({ content: `⚠️ ${e.message}`, components: [fixRow(ui)] });
    }
  }
  const fixRow = (ui: Lang): Row => ({ type: ComponentType.ActionRow, components: [
    { type: ComponentType.Button, style: ButtonStyle.Secondary, custom_id: encodePollId({ a: "fix" }), label: tr(ui, "Corriger ma saisie"), emoji: { name: "✏️" } },
  ] });

  /* ----- Boutons ----- */
  async function button(i: ButtonInteraction) {
    const x = decodePollId(i.customId);
    if (!x) return;
    if (x.a === "fix") {
      const d = drafts.get(i.user.id);
      if (!d || Date.now() - d.at > DRAFT_MS) return fail(i, tr(replyLang(i), "Ta saisie a expiré : relance la commande."));
      return i.showModal(createModal(d.action, replyLang(i, d.channelId), d));
    }
    if (x.a === "new") return;
    const pollId = x.pollId;
    const lang = replyLang(i, pollId);
    const a = api.withLang(lang);
    if (x.a === "raid") {
      // La fenêtre doit être la première réponse : vue d'abord (rapide), puis la fenêtre préremplie
      const v = await a.pollView(pollId);
      if (v.raid) return fail(i, tr(langOf(v.group, lang), "Le raid de ce sondage est déjà créé."));
      return i.showModal(raidModal(v, langOf(v.group, lang)));
    }
    if (x.a === "closeok") {
      await i.deferUpdate();
      const r = await a.pollClose(pollId, i.user.id);
      publishSoon(r.view);
      return i.editReply({ content: r.already ? tr(langOf(r.view.group, lang), "Ce sondage était déjà clos.") : `🔒 ${tr(langOf(r.view.group, lang), "Sondage clos.")}`, components: [] });
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const me = { discordUserId: i.user.id, discordName: nameOf(i) };
    if (x.a === "vote") {
      const r = await a.pollVote(pollId, { ...me, optionId: x.optionId });
      remember(r.view.group.lang, pollId);
      publishSoon(r.view);
      return i.editReply(voteReply(r.view, r.vote.yes, langOf(r.view.group, lang)));
    }
    if (x.a === "me") {
      const r = await a.pollMine(pollId, me);
      remember(r.view.group.lang, pollId);
      const ui = langOf(r.view.group, lang);
      if (r.view.kind === "dates") return i.editReply(datesPanel(r.view, r.vote, r, ui));
      return i.editReply(voteReply(r.view, r.vote?.yes ?? [], ui));
    }
    if (x.a === "who") {
      const r = await a.pollVoters(pollId);
      return i.editReply(votersReply(r.view, r, langOf(r.view.group, lang)));
    }
    if (x.a === "close") {
      const v = await a.pollView(pollId);
      return i.editReply(closeConfirm(v, langOf(v.group, lang)));
    }
  }

  /* ----- Menus « Je viens » / « Si besoin » ----- */
  async function menu(i: StringSelectMenuInteraction) {
    const x = decodePollId(i.customId);
    if (!x || (x.a !== "yes" && x.a !== "maybe")) return;
    await i.deferUpdate();
    const lang = replyLang(i, x.pollId);
    const values = i.values.map(Number).filter(n => Number.isInteger(n) && n > 0);
    const r = await api.withLang(lang).pollDates(x.pollId, { discordUserId: i.user.id, discordName: nameOf(i), ...(x.a === "yes" ? { yes: values } : { maybe: values }) });
    publishSoon(r.view);
    return i.editReply(datesPanel(r.view, r.vote, r, langOf(r.view.group, lang), true));
  }

  /* ----- Fenêtres ----- */
  async function modal(i: ModalSubmitInteraction) {
    const x = decodePollId(i.customId);
    if (!x) return;
    if (x.a === "new") return submitNew(i, x);
    if (x.a !== "raidmodal") return;
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const lang = replyLang(i, x.pollId);
    const slot = parseSlot(i.fields.getTextInputValue("slot"), new Date(), timeZone);
    if (!slot.ok) return i.editReply(`⚠️ ${tr(lang, "Créneau : {why}.", { why: slotError(lang, slot.reason) })}`);
    const r = await api.withLang(lang).pollRaid(x.pollId, { discordUserId: i.user.id, name: i.fields.getTextInputValue("name"), scheduledAt: slot.at.toISOString() });
    publishSoon(r.view);
    if (r.announcement) publishRaid(r.announcement);
    return i.editReply(raidCreatedReply(r, langOf(r.view.group, lang)));
  }

  return { command, button, menu, modal, tick, publish };
}
