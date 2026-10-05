import { randomUUID } from "node:crypto";
import {
  ButtonStyle, ChannelType, ComponentType, DiscordAPIError, MessageFlags, PermissionFlagsBits,
  type ButtonInteraction, type ChatInputCommandInteraction, type Client, type Interaction, type Message, type ModalSubmitInteraction, type TextChannel,
} from "discord.js";
import type { FeedbackConfig, InternalApi } from "./api";
import {
  authorReplyInbox, backModal, checkText, Cooldown, decodeFb, inboxMessage, panelMessage, previewMessage, promptMessage,
  replyLog, replyModal, sentMessage, Sessions, teamReplyDm, writeModal, encodeFb, type Author, type Session,
} from "./feedback-core";

/**
 * Avis (feedback) par le bot : /feedback ou le bouton d'un salon dédié → MP → aperçu → signé ou anonyme → salon de l'équipe.
 * L'équipe répond avec « Répondre » : la réponse part en MP à l'auteur, qui peut répondre à son tour.
 * Réglages par serveur avec /feedback-config (Gérer le serveur). Ne dépend ni du site ni de l'addon.
 */

const CANNOT_DM = 50007;
const INBOX_NEEDS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
const PANEL_NEEDS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
/** Salon du bouton réservé à cette interaction : personne d'autre que le bot n'y écrit. */
const LOCKED = { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false, CreatePrivateThreads: false, AddReactions: false };

type Log = { info: (m: string, x?: unknown) => void; warn: (m: string, x?: unknown) => void };
type Named = (i: Interaction) => string;

export function createFeedback(client: Client, api: InternalApi, log: Log, nameOf: Named) {
  const sessions = new Sessions();
  const cooldown = new Cooldown();
  setInterval(() => sessions.purge(), 5 * 60e3).unref();

  const config = async (guildId: string) => (await api.feedbackConfig(guildId)).config;
  const notReady = "Les avis ne sont pas activés sur ce serveur. Un admin peut le faire avec `/feedback-config regler`.";

  async function textChannel(id: string): Promise<TextChannel | null> {
    try {
      const ch = await client.channels.fetch(id);
      return ch && ch.type === ChannelType.GuildText ? ch : null;
    } catch { return null; }
  }
  async function dm(userId: string, payload: Parameters<TextChannel["send"]>[0]) {
    try { await client.users.send(userId, payload); return true; }
    catch (e) { if (e instanceof DiscordAPIError && e.code === CANNOT_DM) return false; throw e; }
  }

  /* ---------- Début : /feedback ou bouton du salon dédié (réponse éphémère déjà différée) ---------- */

  async function begin(i: ChatInputCommandInteraction | ButtonInteraction) {
    if (!i.inGuild() || !i.guild) return i.editReply("À utiliser sur un serveur.");
    const cfg = await config(i.guildId);
    if (!cfg) return i.editReply(notReady);
    const wait = cooldown.wait(i.user.id);
    if (wait) return i.editReply(`Tu as envoyé plusieurs avis récemment : réessaie dans ${wait} min.`);
    const s = sessions.start(i.user.id, {
      guildId: i.guildId, guildName: i.guild.name, allowAnonymous: cfg.allowAnonymous, name: nameOf(i), avatarUrl: i.user.displayAvatarURL({ size: 64 }),
    });
    if (await dm(i.user.id, promptMessage(s))) return i.editReply("📬 Je t'ai écrit en message privé : réponds-y avec ton avis.");
    // MP fermés : la même chose dans une fenêtre, sur le serveur
    return i.editReply({
      content: "Je n'arrive pas à t'écrire en message privé (MP fermés pour ce serveur). Tu peux écrire ton avis ici :",
      components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Primary, label: "Écrire mon avis", custom_id: encodeFb({ a: "here", guildId: i.guildId }) }] }],
    });
  }

  /** Avis écrit (MP ou fenêtre) : aperçu avec le choix signé / anonyme. */
  function preview(userId: string, text: string, note: string | null) {
    const s = sessions.setText(userId, text);
    return s ? previewMessage(s as Session & { text: string }, note) : null;
  }

  /** Publie l'avis dans le salon de l'équipe. */
  const sending = new Set<string>();
  async function send(i: ButtonInteraction, guildId: string, anonymous: boolean) {
    // Double clic : un seul envoi
    if (sending.has(i.user.id)) return i.deferUpdate();
    sending.add(i.user.id);
    try { await i.deferUpdate(); await publish(i, guildId, anonymous); }
    finally { sending.delete(i.user.id); }
  }
  async function publish(i: ButtonInteraction, guildId: string, anonymous: boolean) {
    const s = sessions.get(i.user.id, guildId);
    const expired = { content: "Cette demande a expiré (15 min) ou a déjà été envoyée. Recommence avec /feedback.", embeds: [], components: [] };
    if (!s || !s.text) return i.editReply(expired);
    const cfg = await config(guildId);
    if (!cfg) { sessions.end(i.user.id); return i.editReply({ ...expired, content: "Les avis ont été désactivés sur ce serveur entre-temps." }); }
    if (anonymous && !cfg.allowAnonymous) return i.editReply({ ...previewMessage({ ...s, allowAnonymous: false } as Session & { text: string }), content: "Ce serveur n'accepte plus que les avis signés." });
    const wait = cooldown.wait(i.user.id);
    if (wait) return i.editReply({ ...previewMessage(s as Session & { text: string }), content: `Tu as envoyé plusieurs avis récemment : réessaie dans ${wait} min.` });
    const closed = { ...previewMessage(s as Session & { text: string }), content: "⚠️ Le salon des avis de ce serveur est introuvable ou m'est fermé : préviens un admin, puis réessaie." };
    const inbox = await textChannel(cfg.inboxChannelId);
    if (!inbox) return i.editReply(closed);

    const id = randomUUID();
    const author: Author | null = anonymous ? null : { id: i.user.id, name: s.name, avatarUrl: s.avatarUrl };
    let msg: Message;
    try { msg = await inbox.send(inboxMessage(id, s.text, author)); }
    catch (e) { log.warn("Avis non publié", (e as Error).message); return i.editReply(closed); }
    sessions.end(i.user.id);
    cooldown.hit(i.user.id);
    // Sans cet enregistrement, l'avis est publié mais l'équipe ne pourra pas y répondre
    await api.recordFeedback({ id, guildId, channelId: inbox.id, messageId: msg.id, anonymous, authorId: i.user.id })
      .catch(e => log.warn("Avis publié mais non enregistré (réponse impossible)", (e as Error).message));
    return i.editReply(sentMessage(s.guildName, anonymous, s.text));
  }

  /* ---------- Réponses ---------- */

  /** L'équipe répond (fenêtre envoyée depuis le salon des avis). */
  async function teamReply(i: ModalSubmitInteraction, id: string) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const { feedback: f } = await api.feedback(id);
    if (!i.inGuild() || i.guildId !== f.guildId || i.channelId !== f.channelId) return i.editReply("Cet avis n'appartient pas à ce salon.");
    const text = i.fields.getTextInputValue("text").trim();
    const responder = nameOf(i);
    const inbox = await textChannel(f.channelId);
    let original: string | null = null;
    try { original = (await inbox?.messages.fetch(f.messageId))?.embeds[0]?.description ?? null; } catch { /* avis supprimé */ }
    const delivered = await dm(f.authorId, teamReplyDm(id, i.guild?.name ?? "ce serveur", responder, text, original));
    await inbox?.send({ ...replyLog(responder, text, delivered), reply: { messageReference: f.messageId, failIfNotExists: false } })
      .catch(e => log.warn("Trace de la réponse non publiée", (e as Error).message));
    return i.editReply(delivered ? "✅ Réponse envoyée en MP à l'auteur." : "⚠️ Non remise : l'auteur n'accepte pas les MP du bot. Ta réponse est notée sous l'avis.");
  }

  /** L'auteur répond à l'équipe (fenêtre envoyée depuis son MP). */
  async function authorReply(i: ModalSubmitInteraction, id: string) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const { feedback: f } = await api.feedback(id);
    if (i.user.id !== f.authorId) return i.editReply("Ce message ne t'est pas destiné.");
    const inbox = await textChannel(f.channelId);
    if (!inbox) return i.editReply("Le salon des avis de ce serveur n'existe plus.");
    const author: Author | null = f.anonymous ? null : { id: i.user.id, name: i.user.globalName ?? i.user.username, avatarUrl: null };
    await inbox.send({ ...authorReplyInbox(id, i.fields.getTextInputValue("text").trim(), author), reply: { messageReference: f.messageId, failIfNotExists: false } });
    return i.editReply(`✅ Transmis à l'équipe${f.anonymous ? " (toujours anonyme)" : ""}.`);
  }

  /* ---------- Réglages : /feedback-config (Gérer le serveur) ---------- */

  async function configure(i: ChatInputCommandInteraction) {
    if (!i.inCachedGuild()) return i.editReply("À utiliser sur un serveur.");
    if (!i.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return i.editReply("Réservé aux membres qui peuvent gérer le serveur.");
    const me = i.guild.members.me;
    if (!me) return i.editReply("Réessaie dans un instant.");

    if (i.options.getSubcommand() === "retirer") {
      const { previous } = await api.removeFeedbackConfig(i.guildId);
      if (previous) await removePanel(previous);
      return i.editReply(previous ? "Avis désactivés : /feedback ne répond plus et le bouton est retiré. Les salons, eux, restent tels quels." : "Les avis n'étaient pas activés ici.");
    }

    const inbox = i.options.getChannel("destination", true, [ChannelType.GuildText]);
    const panel = i.options.getChannel("bouton", false, [ChannelType.GuildText]);
    const allowAnonymous = i.options.getBoolean("anonyme") ?? true;
    if (panel && panel.id === inbox.id) return i.editReply("Le salon du bouton doit être différent du salon où arrivent les avis (celui-ci est réservé à l'équipe).");
    if (!inbox.permissionsFor(me).has(INBOX_NEEDS)) return i.editReply(`Il me manque des droits dans ${inbox} : Voir le salon, Envoyer des messages, Intégrer des liens et Voir les anciens messages.`);

    const notes: string[] = [];
    if (inbox.permissionsFor(i.guild.roles.everyone).has(PermissionFlagsBits.ViewChannel)) {
      notes.push(`⚠️ ${inbox} est visible par tout le monde : les avis y seraient publics. Réserve-le à l'équipe.`);
    }
    let panelMessageId: string | null = null;
    if (panel) {
      // Salon réservé au bouton : on retire l'écriture à @everyone (le bot garde la sienne)
      try {
        await panel.permissionOverwrites.edit(me.id, { ViewChannel: true, SendMessages: true, EmbedLinks: true }, { reason: "Salon des avis : le bot y publie le bouton" });
        await panel.permissionOverwrites.edit(i.guild.roles.everyone, LOCKED, { reason: "Salon des avis : réservé au bouton du bot" });
        notes.push(`🔒 ${panel} est verrouillé : personne n'y écrit, seul le bouton y reste.`);
      } catch {
        notes.push(`⚠️ Je n'ai pas pu verrouiller ${panel} (droit « Gérer les permissions » manquant). Retire « Envoyer des messages » à @everyone dans ce salon pour le réserver au bouton.`);
      }
      if (!panel.permissionsFor(me).has(PANEL_NEEDS)) return i.editReply(`Il me manque des droits dans ${panel} : Voir le salon, Envoyer des messages et Intégrer des liens.`);
      panelMessageId = (await panel.send(panelMessage(allowAnonymous))).id;
    }
    const { previous } = await api.saveFeedbackConfig(i.guildId, {
      inboxChannelId: inbox.id, panelChannelId: panel?.id ?? null, panelMessageId, allowAnonymous, updatedBy: i.user.id,
    });
    if (previous) await removePanel(previous);
    return i.editReply([
      "✅ Avis activés.",
      `• Arrivée des avis : ${inbox} (bouton « Répondre » sous chaque avis).`,
      panel ? `• Bouton « Donner mon avis » : ${panel}.` : "• Pas de salon dédié : les membres utilisent /feedback.",
      `• Anonymat : ${allowAnonymous ? "au choix de chacun" : "refusé, avis signés seulement"}.`,
      ...notes,
    ].join("\n"));
  }

  async function removePanel(c: FeedbackConfig) {
    if (!c.panelChannelId || !c.panelMessageId) return;
    try { await (await textChannel(c.panelChannelId))?.messages.delete(c.panelMessageId); } catch { /* déjà supprimé */ }
  }

  /* ---------- Entrées ---------- */

  return {
    /** Commandes /feedback et /feedback-config (réponse éphémère déjà différée). */
    async command(i: ChatInputCommandInteraction) {
      return i.commandName === "feedback" ? begin(i) : configure(i);
    },

    async button(i: ButtonInteraction) {
      const x = decodeFb(i.customId);
      if (!x) return;
      if (x.a === "open") { await i.deferReply({ flags: MessageFlags.Ephemeral }); return begin(i); }
      if (x.a === "here") {
        const s = sessions.get(i.user.id, x.guildId);
        return i.showModal(writeModal(x.guildId, s?.guildName ?? i.guild?.name ?? "le serveur"));
      }
      if (x.a === "sign" || x.a === "anon") return send(i, x.guildId, x.a === "anon");
      if (x.a === "cancel") {
        sessions.end(i.user.id);
        return i.update({ content: "Avis annulé. Tu peux recommencer quand tu veux avec /feedback.", embeds: [], components: [] });
      }
      if (x.a === "reply") return i.showModal(replyModal(x.id));
      if (x.a === "back") return i.showModal(backModal(x.id));
    },

    async modal(i: ModalSubmitInteraction) {
      const x = decodeFb(i.customId);
      if (!x) return;
      if (x.a === "rmodal") return teamReply(i, x.id);
      if (x.a === "bmodal") return authorReply(i, x.id);
      if (x.a === "write") {
        // MP fermés : avis écrit dans la fenêtre ; la session est recréée si elle a expiré
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        if (!sessions.get(i.user.id, x.guildId)) {
          const cfg = i.guildId === x.guildId ? await config(x.guildId) : null;
          if (!cfg || !i.guild) return i.editReply(notReady);
          sessions.start(i.user.id, { guildId: x.guildId, guildName: i.guild.name, allowAnonymous: cfg.allowAnonymous, name: nameOf(i), avatarUrl: i.user.displayAvatarURL({ size: 64 }) });
        }
        const c = checkText(i.fields.getTextInputValue("text"));
        if (!c.ok) return i.editReply(c.error);
        return i.editReply(preview(i.user.id, c.text, c.note)!);
      }
    },

    /** Message privé reçu : c'est l'avis en cours d'écriture (sinon, une aide). Rien n'est gardé après l'envoi. */
    async dm(m: Message) {
      if (m.author.bot || m.inGuild()) return;
      if (!sessions.get(m.author.id)) {
        await m.reply({ content: "Pour donner ton avis à un serveur, utilise **/feedback** sur ce serveur (ou son bouton « Donner mon avis »). Pour répondre à l'équipe, clique sur « Répondre » sous sa réponse.", allowedMentions: { parse: [], repliedUser: false } });
        return;
      }
      const c = checkText(m.content, m.attachments.size);
      if (!c.ok) { await m.reply({ content: `⚠️ ${c.error}`, allowedMentions: { parse: [], repliedUser: false } }); return; }
      await m.reply({ ...preview(m.author.id, c.text, c.note)!, allowedMentions: { parse: [], repliedUser: false } });
    },
  };
}

export const isFeedbackId = (customId: string) => customId.startsWith("fb|");
