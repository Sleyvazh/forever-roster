import {
  Client, DiscordAPIError, Events, GatewayIntentBits, MessageFlags, Partials, PermissionFlagsBits,
  type ButtonInteraction, type ChatInputCommandInteraction, type Interaction, type StringSelectMenuInteraction,
} from "discord.js";
import { ApiError, InternalApi, type RaidView } from "./api";
import { COMMANDS } from "./commands";
import { loadConfig } from "./config";
import { parseRaidDate } from "./dates";
import { makeLookup, noEmoji, syncEmojis, type EmojiLookup } from "./emojis";
import { createFeedback, isFeedbackId } from "./feedback";
import { confirmation, guestLabel, onCharPicked, onClassPicked, onStatus, type Step } from "./flow";
import { decodeId, splitValue } from "./ids";
import { createOrderSync, renderOrder } from "./orders";
import { renderAsk, renderAskAnswered, renderNudge, renderNudgeReport } from "./reach";
import { renderAnnouncement, renderReminder } from "./render";
import { CAPTURE_NAME, createReportSync, renderReport } from "./reports";
import { resolveGameLang } from "@forever/game-data";
import { createSync, type Publisher } from "./sync";

/** Langue des noms du jeu dans les menus : celle du Discord du joueur (français ou anglais). */
const langOf = (i: { locale: string }) => resolveGameLang(null, i.locale);

const log = {
  info: (msg: string, extra?: unknown) => console.log(new Date().toISOString(), msg, extra ?? ""),
  warn: (msg: string, extra?: unknown) => console.warn(new Date().toISOString(), msg, extra ?? ""),
};

const cfg = loadConfig();
if (!cfg.token) {
  // Pas de jeton : le service reste en veille plutôt que de redémarrer en boucle.
  log.info("DISCORD_BOT_TOKEN absent : bot Discord inactif.");
  setInterval(() => {}, 2 ** 30);
} else {
  await start();
}

async function start() {
  const api = new InternalApi(cfg.apiUrl, cfg.apiSecret);
  // Intents « Guilds » et « Direct Messages » : le bot ne lit aucun message des salons ni la liste des membres.
  // Il ne lit que les MP qu'on lui écrit (l'avis en cours d'écriture), sans les garder.
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages], partials: [Partials.Channel] });

  const UNKNOWN_MESSAGE = 10008, UNKNOWN_CHANNEL = 10003, CANNOT_DM = 50007;
  /** Émojis de classe / spé (vide tant que les icônes ne sont pas envoyées à Discord). */
  let emoji: EmojiLookup = noEmoji;
  const publisher: Publisher = {
    async upsert(view, messageId) {
      const ch = await client.channels.fetch(view.channelId);
      if (!ch || !ch.isSendable()) throw new Error(`Salon ${view.channelId} inaccessible`);
      const payload = renderAnnouncement(view, emoji);
      if (messageId) {
        try {
          const m = await ch.messages.edit(messageId, payload);
          return { channelId: ch.id, messageId: m.id };
        } catch (e) {
          if (!(e instanceof DiscordAPIError && e.code === UNKNOWN_MESSAGE)) throw e;
          // Message supprimé à la main : on republie
        }
      }
      const m = await ch.send(payload);
      return { channelId: ch.id, messageId: m.id };
    },
    async remove(channelId, messageId) {
      try {
        const ch = await client.channels.fetch(channelId);
        if (ch?.isTextBased()) await ch.messages.delete(messageId);
      } catch (e) {
        if (e instanceof DiscordAPIError && [UNKNOWN_MESSAGE, UNKNOWN_CHANNEL].includes(Number(e.code))) return;
        throw e;
      }
    },
  };
  const sync = createSync(api, publisher, log);
  // Commandes d'artisanat (lot F) : même principe que les annonces, dans le salon des commandes
  const orders = createOrderSync(api, {
    async upsert(o, messageId) {
      const ch = await client.channels.fetch(o.channelId);
      if (!ch || !ch.isSendable()) throw new Error(`Salon ${o.channelId} inaccessible`);
      const payload = renderOrder(o);
      if (messageId) {
        try { const m = await ch.messages.edit(messageId, payload); return { channelId: ch.id, messageId: m.id }; }
        catch (e) { if (!(e instanceof DiscordAPIError && e.code === UNKNOWN_MESSAGE)) throw e; }
      }
      const m = await ch.send(payload);
      return { channelId: ch.id, messageId: m.id };
    },
  }, log);
  // Signalements du site : salon privé des admins (/signalements-lier). La capture est jointe au message
  // (renvoyée à chaque modification, rare : statut ou réponse) ; si elle n'est plus lisible, le message part sans.
  const reports = createReportSync(api, {
    async upsert(r, messageId) {
      const ch = await client.channels.fetch(r.channelId);
      if (!ch || !ch.isSendable()) throw new Error(`Salon ${r.channelId} inaccessible`);
      // Sans le droit « Joindre des fichiers », le message part sans la capture (elle reste sur le site)
      const canAttach = !("permissionsFor" in ch) || !!ch.permissionsFor(client.user!)?.has(PermissionFlagsBits.AttachFiles);
      const image = r.hasImage && canAttach ? await api.reportImage(r.id) : null;
      const payload = { ...renderReport(r, !!image), files: image ? [{ attachment: image, name: CAPTURE_NAME }] : [], attachments: [] };
      if (messageId) {
        try { const m = await ch.messages.edit(messageId, payload); return { channelId: ch.id, messageId: m.id }; }
        catch (e) { if (!(e instanceof DiscordAPIError && e.code === UNKNOWN_MESSAGE)) throw e; }
      }
      const { attachments: _, ...first } = payload;
      const m = await ch.send(first);
      return { channelId: ch.id, messageId: m.id };
    },
  }, log);
  const publishSoon = (view: RaidView) => { sync.publish(view).catch(e => log.warn("Mise à jour de l'annonce impossible", e?.message)); };

  /** Envoie les icônes du serveur comme émojis d'application, remplace celles qui ont changé (au démarrage, puis toutes les 6 h). */
  const refreshEmojis = async () => {
    const app = client.application!;
    const ids = await syncEmojis(cfg.iconsDir, {
      list: async () => [...(await app.emojis.fetch()).values()].map(e => ({ id: e.id, name: e.name })),
      create: (name, data) => app.emojis.create({ attachment: data, name }).then(e => ({ id: e.id, name: e.name })),
      remove: async id => { await app.emojis.delete(id); },
    }, msg => log.info(msg));
    emoji = ids.size ? makeLookup(ids) : noEmoji;
  };

  /** Rappels de la veille, en message privé ; un joueur qui refuse les MP est simplement ignoré. */
  const sendReminders = async () => {
    const { reminders } = await api.claimReminders();
    for (const { view, recipients } of reminders) {
      let sent = 0;
      for (const r of recipients) {
        try {
          await client.users.send(r.discordUserId, renderReminder(view, r, emoji));
          sent++;
        } catch (e) {
          if (!(e instanceof DiscordAPIError && e.code === CANNOT_DM)) log.warn(`Rappel non envoyé (${view.raid.name})`, (e as Error).message);
        }
        await new Promise(res => setTimeout(res, 300));
      }
      log.info(`Rappel « ${view.raid.name} » : ${sent}/${recipients.length} message(s) privé(s).`);
    }
  };

  /** MP à un joueur ; false si ses MP sont fermés (ou plus de serveur en commun), sans bruit dans les journaux. */
  const dm = async (userId: string, payload: Parameters<typeof client.users.send>[1], what: string) => {
    try {
      await client.users.send(userId, payload);
      return true;
    } catch (e) {
      if (!(e instanceof DiscordAPIError && e.code === CANNOT_DM)) log.warn(`${what} non envoyé`, (e as Error).message);
      return false;
    } finally {
      await new Promise(res => setTimeout(res, 300));
    }
  };

  /** Relance des sans-réponse (lot D2), puis la liste aux officiers pour la relance automatique. */
  const sendNudges = async () => {
    const { nudges } = await api.claimNudges();
    for (const n of nudges) {
      const sent: string[] = [], closed: string[] = [];
      for (const r of n.recipients) (await dm(r.discordUserId, renderNudge(n.view), "Relance") ? sent : closed).push(r.name);
      for (const o of n.officers) await dm(o, renderNudgeReport(n, sent, closed), "Liste des sans-réponse");
      log.info(`Relance « ${n.view.raid.name} »${n.auto ? "" : " (à la main)"} : ${sent.length}/${n.recipients.length} MP, ${n.officers.length} officier(s) prévenu(s).`);
    }
  };

  /** « Demander à X » (lot D2) : un MP par demande ; si le MP est impossible, l'officier le voit sur le site. */
  const sendAsks = async () => {
    const { asks } = await api.claimAsks();
    for (const a of asks) {
      if (!(await dm(a.discordUserId, renderAsk(a, emoji), "Demande"))) await api.askFailed(a.id).catch(() => {});
    }
  };

  client.once(Events.ClientReady, async c => {
    log.info(`Connecté en tant que ${c.user.tag}`);
    await c.application.commands.set(COMMANDS);
    await refreshEmojis().catch(e => log.warn("Émojis non synchronisés", e?.message));
    setInterval(() => { refreshEmojis().catch(e => log.warn("Émojis non synchronisés", e?.message)); }, 6 * 3600e3);
    setInterval(() => { sync.tick().catch(e => log.warn("Relève impossible", e?.message)); }, cfg.pollMs);
    setInterval(() => { orders.tick().catch(e => log.warn("Relève des commandes impossible", e?.message)); }, cfg.pollMs);
    setInterval(() => { reports.tick().catch(e => log.warn("Relève des signalements impossible", e?.message)); }, cfg.pollMs);
    setInterval(() => { feedback.tick().catch(e => log.warn("Relève des avis impossible", e?.message)); }, cfg.pollMs);
    setInterval(() => { sendReminders().catch(e => log.warn("Rappels impossibles", e?.message)); }, 60e3);
    setInterval(() => { sendNudges().catch(e => log.warn("Relances impossibles", e?.message)); }, 60e3);
    setInterval(() => { sendAsks().catch(e => log.warn("Demandes impossibles", e?.message)); }, 15e3);
  });

  client.on(Events.InteractionCreate, (i: Interaction) => {
    handle(i).catch(async e => {
      const msg = e instanceof ApiError ? e.message : "Une erreur est survenue, réessaie dans un instant.";
      if (!(e instanceof ApiError)) log.warn("Erreur d'interaction", e);
      if (!i.isRepliable()) return;
      try {
        if (i.deferred || i.replied) await i.editReply({ content: `⚠️ ${msg}`, components: [] });
        else await i.reply({ content: `⚠️ ${msg}`, flags: MessageFlags.Ephemeral });
      } catch { /* interaction expirée */ }
    });
  });

  const nameOf = (i: Interaction) => {
    const m = i.member as { displayName?: string; nick?: string | null } | null;
    return (m?.displayName ?? m?.nick ?? i.user.globalName ?? i.user.username).slice(0, 64);
  };

  const feedback = createFeedback(client, api, log, nameOf);
  client.on(Events.MessageCreate, m => { feedback.dm(m).catch(e => log.warn("MP d'avis non traité", (e as Error).message)); });

  async function handle(i: Interaction) {
    if (i.isAutocomplete()) return i.commandName === "feedback-config" ? feedback.autocomplete(i).catch(() => i.respond([]).catch(() => {})) : undefined;
    if (i.isChatInputCommand()) return command(i);
    if (i.isButton()) return isFeedbackId(i.customId) ? feedback.button(i) : button(i);
    if (i.isModalSubmit()) return feedback.modal(i);
    if (i.isStringSelectMenu()) return menu(i);
  }

  async function command(i: ChatInputCommandInteraction) {
    if (!i.inGuild() || !i.channelId) return i.reply({ content: "Commande à utiliser dans un salon de serveur.", flags: MessageFlags.Ephemeral });
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    if (i.commandName === "feedback" || i.commandName === "feedback-config") return feedback.command(i);

    if (i.commandName === "forever-lier" || i.commandName === "roster-lier") {
      const need = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
      if (!i.appPermissions.has(need)) {
        return i.editReply("Il me manque des droits dans ce salon : Voir le salon, Envoyer des messages et Intégrer des liens.");
      }
      const { group, kind } = await api.bind({ code: i.options.getString("code", true), guildId: i.guildId, channelId: i.channelId, discordUserId: i.user.id });
      if (kind === "orders") {
        await i.editReply(`✅ Salon lié aux commandes d'artisanat de **${group.name}**. Chaque commande y sera postée avec un bouton « Je m'en charge ».`);
        void orders.tick().catch(() => {});
        return;
      }
      await i.editReply(`✅ Salon lié au groupe **${group.name}**. Les raids à venir y seront publiés dans quelques secondes.`);
      void sync.tick().catch(() => {});
      return;
    }

    if (i.commandName === "signalements-lier") {
      const need = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
      if (!i.appPermissions.has(need)) {
        return i.editReply("Il me manque des droits dans ce salon : Voir le salon, Envoyer des messages et Intégrer des liens.");
      }
      await api.bindReports({ guildId: i.guildId, channelId: i.channelId, discordUserId: i.user.id });
      const ch = i.guild?.channels.cache.get(i.channelId);
      const open = ch && "permissionsFor" in ch && i.guild ? ch.permissionsFor(i.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel) : false;
      await i.editReply([
        "✅ Les signalements du site (bugs, idées, questions) arriveront ici, avec leur capture d'écran. Les réponses se font sur la page admin du site.",
        ...(open ? ["⚠️ Ce salon est visible par tout le monde : réserve-le aux admins (les signalements peuvent contenir des captures personnelles)."] : []),
        ...(i.appPermissions.has(PermissionFlagsBits.AttachFiles) ? [] : ["ℹ️ Sans le droit « Joindre des fichiers » dans ce salon, les captures restent sur le site (lien sous chaque signalement)."]),
      ].join("\n"));
      void reports.tick().catch(() => {});
      return;
    }

    if (i.commandName === "raid") {
      const when = parseRaidDate(i.options.getString("date", true), new Date(), cfg.timeZone);
      if (!when.ok) return i.editReply(`⚠️ ${when.error}`);
      const view = await api.createRaid({
        guildId: i.guildId, channelId: i.channelId, discordUserId: i.user.id,
        name: i.options.getString("nom", true), scheduledAt: when.date.toISOString(), description: i.options.getString("description") ?? undefined,
      });
      await sync.publish(view);
      return i.editReply(`✅ Raid **${view.raid.name}** créé. Composition et détails : ${view.raid.url}`);
    }
  }

  /** Applique une étape du parcours : inscription, ou menu à afficher. */
  async function apply(i: ButtonInteraction | StringSelectMenuInteraction, raidId: string, step: Step) {
    if (step.kind === "reply") return i.editReply({ content: step.content, components: step.components });
    const view = await api.signup(raidId, { ...step.body, discordUserId: i.user.id, discordName: nameOf(i) });
    publishSoon(view);
    return i.editReply(confirmation(raidId, step.body.status, step.label, view.raid.url));
  }

  async function button(i: ButtonInteraction) {
    const id = decodeId(i.customId);
    if (!id) return;
    if (id.a === "otake") {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const { view } = await api.takeOrder(id.orderId, i.user.id);
      if (view) void orders.publish(view).catch(e => log.warn("Commande non mise à jour", e?.message));
      return i.editReply(`✅ C'est noté : tu t'en charges. Marque-la « Faite » sur le site une fois l'objet remis${view ? ` : ${view.url}` : "."}`);
    }
    if (id.a === "ask") {
      await i.deferUpdate();
      const r = await api.answerAsk(id.askId, i.user.id, id.yes);
      if (r.view) publishSoon(r.view);
      const prev = i.message.embeds[0]?.toJSON();
      return i.editReply(renderAskAnswered(prev && { title: prev.title, url: prev.url, description: prev.description, footer: prev.footer }, r));
    }
    if (id.a === "st") {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      return apply(i, id.raidId, onStatus(id.raidId, id.status, await api.choices(id.raidId, i.user.id), false, langOf(i)));
    }
    if (id.a === "chg") {
      await i.deferUpdate();
      return apply(i, id.raidId, onStatus(id.raidId, id.status, await api.choices(id.raidId, i.user.id), true, langOf(i)));
    }
    if (id.a === "off") {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const view = await api.unsign(id.raidId, i.user.id);
      publishSoon(view);
      return i.editReply("Tu es désinscrit de ce raid.");
    }
  }

  async function menu(i: StringSelectMenuInteraction) {
    const id = decodeId(i.customId);
    const value = i.values[0];
    if (!id || !value || !("status" in id)) return;
    await i.deferUpdate();
    if (id.a === "char") return apply(i, id.raidId, onCharPicked(id.raidId, id.status, await api.choices(id.raidId, i.user.id), value, langOf(i)));
    // Classes et spés du jeu du groupe (Roster : WoW Retail)
    if (id.a === "cls") return apply(i, id.raidId, onClassPicked(id.raidId, id.status, value, (await api.choices(id.raidId, i.user.id)).game, langOf(i)));
    const pair = splitValue(value);
    if (!pair) return;
    if (id.a === "pick") {
      // Libellé de l'option choisie : « Perso — Spé » (menu unique) ou « Spé » (menu en deux temps)
      const opt = i.component.options.find(o => o.value === value)?.label ?? pair[1];
      const [name, spec] = opt.includes(" — ") ? opt.split(" — ") : [null, opt];
      return apply(i, id.raidId, { kind: "signup", body: { status: id.status, characterId: pair[0], spec: pair[1] }, label: name ? `${name} (${spec})` : spec! });
    }
    if (id.a === "gspec") {
      const game = (await api.choices(id.raidId, i.user.id)).game ?? "forever";
      return apply(i, id.raidId, { kind: "signup", body: { status: id.status, cls: pair[0], spec: pair[1] }, label: guestLabel(game, langOf(i), pair[0], pair[1]) });
    }
  }

  const stop = () => { client.destroy().finally(() => process.exit(0)); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    await client.login(cfg.token);
  } catch (e) {
    // Jeton refusé ou Discord injoignable : on attend avant de quitter, pour ne pas redémarrer en boucle serrée.
    log.warn("Connexion à Discord impossible (jeton du bot invalide ?). Nouvel essai dans 60 s.", (e as Error).message);
    await new Promise(r => setTimeout(r, 60_000));
    process.exit(1);
  }
}
