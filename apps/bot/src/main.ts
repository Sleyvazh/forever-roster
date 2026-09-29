import {
  Client, DiscordAPIError, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits,
  type ButtonInteraction, type ChatInputCommandInteraction, type Interaction, type StringSelectMenuInteraction,
} from "discord.js";
import { ApiError, InternalApi, type RaidView } from "./api";
import { COMMANDS } from "./commands";
import { loadConfig } from "./config";
import { parseRaidDate } from "./dates";
import { makeLookup, noEmoji, syncEmojis, type EmojiLookup } from "./emojis";
import { confirmation, onCharPicked, onClassPicked, onStatus, type Step } from "./flow";
import { decodeId, splitValue } from "./ids";
import { renderAnnouncement, renderReminder } from "./render";
import { createSync, type Publisher } from "./sync";

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
  // Intent « Guilds » seulement : le bot ne lit aucun message ni la liste des membres.
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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
  const publishSoon = (view: RaidView) => { sync.publish(view).catch(e => log.warn("Mise à jour de l'annonce impossible", e?.message)); };

  /** Envoie les icônes du serveur comme émojis d'application (au démarrage, puis toutes les 6 h). */
  const refreshEmojis = async () => {
    const app = client.application!;
    const ids = await syncEmojis(cfg.iconsDir, {
      list: async () => [...(await app.emojis.fetch()).values()].map(e => ({ id: e.id, name: e.name })),
      create: (name, data) => app.emojis.create({ attachment: data, name }).then(e => ({ id: e.id, name: e.name })),
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

  client.once(Events.ClientReady, async c => {
    log.info(`Connecté en tant que ${c.user.tag}`);
    await c.application.commands.set(COMMANDS);
    await refreshEmojis().catch(e => log.warn("Émojis non synchronisés", e?.message));
    setInterval(() => { refreshEmojis().catch(e => log.warn("Émojis non synchronisés", e?.message)); }, 6 * 3600e3);
    setInterval(() => { sync.tick().catch(e => log.warn("Relève impossible", e?.message)); }, cfg.pollMs);
    setInterval(() => { sendReminders().catch(e => log.warn("Rappels impossibles", e?.message)); }, 60e3);
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

  async function handle(i: Interaction) {
    if (i.isChatInputCommand()) return command(i);
    if (i.isButton()) return button(i);
    if (i.isStringSelectMenu()) return menu(i);
  }

  async function command(i: ChatInputCommandInteraction) {
    if (!i.inGuild() || !i.channelId) return i.reply({ content: "Commande à utiliser dans un salon de serveur.", flags: MessageFlags.Ephemeral });
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    if (i.commandName === "forever-lier") {
      const need = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
      if (!i.appPermissions.has(need)) {
        return i.editReply("Il me manque des droits dans ce salon : Voir le salon, Envoyer des messages et Intégrer des liens.");
      }
      const { group } = await api.bind({ code: i.options.getString("code", true), guildId: i.guildId, channelId: i.channelId, discordUserId: i.user.id });
      await i.editReply(`✅ Salon lié au groupe **${group.name}**. Les raids à venir y seront publiés dans quelques secondes.`);
      void sync.tick().catch(() => {});
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
    if (id.a === "st") {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      return apply(i, id.raidId, onStatus(id.raidId, id.status, await api.choices(id.raidId, i.user.id)));
    }
    if (id.a === "chg") {
      await i.deferUpdate();
      return apply(i, id.raidId, onStatus(id.raidId, id.status, await api.choices(id.raidId, i.user.id), true));
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
    if (id.a === "char") return apply(i, id.raidId, onCharPicked(id.raidId, id.status, await api.choices(id.raidId, i.user.id), value));
    if (id.a === "cls") return apply(i, id.raidId, onClassPicked(id.raidId, id.status, value));
    const pair = splitValue(value);
    if (!pair) return;
    if (id.a === "pick") {
      // Libellé de l'option choisie : « Perso — Spé » (menu unique) ou « Spé » (menu en deux temps)
      const opt = i.component.options.find(o => o.value === value)?.label ?? pair[1];
      const [name, spec] = opt.includes(" — ") ? opt.split(" — ") : [null, pair[1]];
      return apply(i, id.raidId, { kind: "signup", body: { status: id.status, characterId: pair[0], spec: pair[1] }, label: name ? `${name} (${spec})` : pair[1] });
    }
    if (id.a === "gspec") return apply(i, id.raidId, { kind: "signup", body: { status: id.status, cls: pair[0], spec: pair[1] }, label: `${pair[1]} ${pair[0]}` });
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
