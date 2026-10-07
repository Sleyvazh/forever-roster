import { randomUUID } from "node:crypto";
import type { Game } from "@forever/game-data";
import {
  ButtonStyle, ChannelType, ComponentType, DiscordAPIError, MessageFlags, PermissionFlagsBits,
  type AutocompleteInteraction, type ButtonInteraction, type ChatInputCommandInteraction, type Client, type Interaction, type Message, type ModalSubmitInteraction, type TextChannel,
} from "discord.js";
import type { FeedbackConfig, InternalApi } from "./api";
import {
  authorReplyInbox, backModal, checkText, Cooldown, decodeFb, inboxButtons, inboxMessage, panelMessage, previewMessage, promptMessage,
  replyLog, replyModal, sentMessage, Sessions, teamReplyDm, withStatus, writeModal, encodeFb, type Author, type Session, type Track,
} from "./feedback-core";

/**
 * Avis (feedback) par le bot : /feedback ou le bouton d'un salon dédié → MP → aperçu → signé ou anonyme → salon de l'équipe.
 * L'équipe répond avec « Répondre » : la réponse part en MP à l'auteur, qui peut répondre à son tour.
 * Réglages par serveur avec /feedback-config (Gérer le serveur). Ne dépend ni du site ni de l'addon ; en option, un groupe
 * du site lié au serveur suit les avis (Administration → Avis) : statut, conversation, réponses écrites sur le site.
 */

const CANNOT_DM = 50007, UNKNOWN_MESSAGE = 10008, UNKNOWN_CHANNEL = 10003, MISSING_ACCESS = 50001;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toTrack = (c: FeedbackConfig | null): Track | null => (c?.track ? { group: c.track.groupName, site: c.track.site, url: c.track.url } : null);
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
      guildId: i.guildId, guildName: i.guild.name, allowAnonymous: cfg.allowAnonymous, track: toTrack(cfg), name: nameOf(i), avatarUrl: i.user.displayAvatarURL({ size: 64 }),
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
    try { msg = await inbox.send(inboxMessage(id, s.text, author, new Date(), toTrack(cfg))); }
    catch (e) { log.warn("Avis non publié", (e as Error).message); return i.editReply(closed); }
    sessions.end(i.user.id);
    cooldown.hit(i.user.id);
    // Sans cet enregistrement, l'avis est publié mais l'équipe ne pourra pas y répondre (ni le suivre sur le site)
    await api.recordFeedback({ id, guildId, channelId: inbox.id, messageId: msg.id, anonymous, authorId: i.user.id, text: s.text, authorName: anonymous ? null : s.name })
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
    if (f.tracked) await api.feedbackMessage(id, { from: "team", name: responder, text, delivered }).catch(e => log.warn("Réponse non notée sur le site", (e as Error).message));
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
    const text = i.fields.getTextInputValue("text").trim();
    await inbox.send({ ...authorReplyInbox(id, text, author), reply: { messageReference: f.messageId, failIfNotExists: false } });
    if (f.tracked) await api.feedbackMessage(id, { from: "author", name: author?.name ?? null, text }).catch(e => log.warn("Réponse de l'auteur non notée sur le site", (e as Error).message));
    return i.editReply(`✅ Transmis à l'équipe${f.anonymous ? " (toujours anonyme)" : ""}.`);
  }

  /* ---------- Réglages : /feedback-config (Gérer le serveur) ---------- */

  async function configure(i: ChatInputCommandInteraction) {
    if (!i.inCachedGuild()) return i.editReply("À utiliser sur un serveur.");
    if (!i.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return i.editReply("Réservé aux membres qui peuvent gérer le serveur.");
    const me = i.guild.members.me;
    if (!me) return i.editReply("Réessaie dans un instant.");

    if (i.options.getSubcommand() === "retirer") {
      const { previous } = await api.removeFeedbackConfig(i.guildId, { by: i.user.id, byName: nameOf(i) });
      if (previous) await removePanel(previous);
      return i.editReply(previous ? "Avis désactivés : /feedback ne répond plus et le bouton est retiré. Les salons, eux, restent tels quels." : "Les avis n'étaient pas activés ici.");
    }

    const inbox = i.options.getChannel("destination", true, [ChannelType.GuildText]);
    const panel = i.options.getChannel("bouton", false, [ChannelType.GuildText]);
    const allowAnonymous = i.options.getBoolean("anonyme") ?? true;
    // Suivi sur le site : absent = on garde le groupe actuel ; « none » = plus de suivi ; sinon un groupe proposé par la liste
    const site = i.options.getString("site");
    const picked = i.options.getString("groupe");
    if (site && !picked) return i.editReply("Avec l'option **site**, choisis aussi le **groupe** dans la liste proposée.");
    if (picked && picked !== "none" && !UUID.test(picked)) return i.editReply("Choisis le groupe dans la liste proposée (les groupes de ce serveur, liés par /forever-lier ou /roster-lier).");
    const groupId = picked === null ? undefined : picked === "none" ? null : picked.toLowerCase();
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
    let saved: Awaited<ReturnType<typeof api.saveFeedbackConfig>>;
    try {
      saved = await api.saveFeedbackConfig(i.guildId, {
        inboxChannelId: inbox.id, panelChannelId: panel?.id ?? null, panelMessageId, allowAnonymous, updatedBy: i.user.id, updatedByName: nameOf(i),
        guildName: i.guild.name, ...(groupId !== undefined && { groupId }),
      });
    } catch (e) {
      // Groupe refusé : le nouveau bouton ne reste pas
      if (panel && panelMessageId) await panel.messages.delete(panelMessageId).catch(() => {});
      throw e;
    }
    const { config, previous } = saved;
    if (previous) await removePanel(previous);
    const track = config.track;
    return i.editReply([
      "✅ Avis activés.",
      `• Arrivée des avis : ${inbox} (bouton « Répondre » sous chaque avis).`,
      panel ? `• Bouton « Donner mon avis » : ${panel}.` : "• Pas de salon dédié : les membres utilisent /feedback.",
      `• Anonymat : ${allowAnonymous ? "au choix de chacun" : "refusé, avis signés seulement"}.`,
      ...(track ? [`• Suivi sur ${track.site} : groupe « ${track.groupName} », Administration → Avis (chef et officiers).${groupId === undefined ? " Pour l'arrêter : option groupe « Aucun »." : ""}`]
        : previous?.groupId && groupId === null ? ["• Suivi sur le site arrêté : les avis restent dans Discord."] : []),
      ...notes,
    ].join("\n"));
  }

  async function removePanel(c: FeedbackConfig) {
    if (!c.panelChannelId || !c.panelMessageId) return;
    try { await (await textChannel(c.panelChannelId))?.messages.delete(c.panelMessageId); } catch { /* déjà supprimé */ }
  }

  /* ---------- Option « groupe » : groupes du site liés à ce serveur ---------- */

  async function autocomplete(i: AutocompleteInteraction) {
    if (!i.inCachedGuild() || !i.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return i.respond([]);
    const focused = i.options.getFocused(true);
    if (focused.name !== "groupe") return i.respond([]);
    const q = String(focused.value ?? "").trim();
    const game = (i.options.getString("site") ?? undefined) as Game | undefined;
    const { groups } = await api.feedbackGroups(i.guildId, q, game);
    const channel = (id: string | null) => (id ? i.guild.channels.cache.get(id)?.name : undefined);
    const choices = groups.map(g => {
      const where = [channel(g.raidsChannelId) && `raids #${channel(g.raidsChannelId)}`, channel(g.ordersChannelId) && `commandes #${channel(g.ordersChannelId)}`].filter(Boolean).join(", ");
      return { name: `${g.name} · ${g.site}${where ? ` (${where})` : ""}`.slice(0, 100), value: g.id };
    });
    const none = { name: "Aucun : avis seulement dans Discord", value: "none" };
    return i.respond([...(!q || "aucun".startsWith(q.toLowerCase()) ? [none] : []), ...choices].slice(0, 25));
  }

  /* ---------- Relève : réponses écrites sur le site, statuts changés sur le site ---------- */

  const retryAt = new Map<string, number>();
  let ticking = false;
  const gone = (e: unknown) => e instanceof DiscordAPIError && [UNKNOWN_MESSAGE, UNKNOWN_CHANNEL, MISSING_ACCESS].includes(Number(e.code));

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const { replies, statuses } = await api.feedbackOutbox();
      for (const r of replies) {
        const key = `r${r.id}`;
        if ((retryAt.get(key) ?? 0) > Date.now()) continue;
        try {
          const delivered = await dm(r.authorId, teamReplyDm(r.feedbackId, r.guildName, r.responder, r.text, r.original));
          const inbox = await textChannel(r.channelId);
          await inbox?.send({ ...replyLog(r.responder, r.text, delivered), reply: { messageReference: r.messageId, failIfNotExists: false } })
            .catch(e => log.warn("Trace de la réponse non publiée", (e as Error).message));
          await api.feedbackReplyDone(r.id, delivered);
          retryAt.delete(key);
        } catch (e) {
          retryAt.set(key, Date.now() + 60e3);
          log.warn(`Réponse du site non envoyée (${r.feedbackId})`, (e as Error).message);
        }
      }
      for (const st of statuses) {
        const key = `s${st.id}`;
        if ((retryAt.get(key) ?? 0) > Date.now()) continue;
        try {
          const ch = await client.channels.fetch(st.channelId);
          if (ch && ch.isTextBased()) {
            const m = await ch.messages.fetch(st.messageId);
            const embed = m.embeds[0]?.toJSON();
            if (embed) await m.edit({ embeds: [withStatus(embed, st.status, { group: st.track.groupName, site: st.track.site }), ...m.embeds.slice(1).map(x => x.toJSON())], components: inboxButtons(st.id, st.track.url) });
          }
          await api.feedbackSynced(st.id, st.changedAt);
          retryAt.delete(key);
        } catch (e) {
          // Message ou salon supprimé, accès retiré : on n'insiste pas
          if (gone(e)) { await api.feedbackSynced(st.id, st.changedAt).catch(() => {}); continue; }
          retryAt.set(key, Date.now() + 60e3);
          log.warn(`Statut de l'avis non reporté (${st.id})`, (e as Error).message);
        }
      }
    } finally { ticking = false; }
  }

  /* ---------- Entrées ---------- */

  return {
    autocomplete,
    tick,
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
          sessions.start(i.user.id, { guildId: x.guildId, guildName: i.guild.name, allowAnonymous: cfg.allowAnonymous, track: toTrack(cfg), name: nameOf(i), avatarUrl: i.user.displayAvatarURL({ size: 64 }) });
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
