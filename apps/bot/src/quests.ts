import { parseEnd } from "@forever/game-data";
import { DiscordAPIError, MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction, type Client, type ModalSubmitInteraction } from "discord.js";
import { ApiError, type InternalApi, type QuestType, type QuestView } from "./api";
import { langOf, remember, tr, type Lang } from "./i18n";
import { actionDone, decodeQuestId, rejectModal, renderQuest, renderQuestNotice, takenReply } from "./quests-core";
import type { Logger } from "./sync";

/**
 * Quêtes de guilde sur Discord (Forever, 27/11/2026) : relève des annonces (posées, mises à jour sur place ; le site
 * demande d'effacer celles des quêtes finies), « Prendre », boutons des MP, /quete. Rendu et textes : quests-core.ts.
 */

const UNKNOWN_MESSAGE = 10008;

interface Deps {
  client: Client; api: InternalApi; log: Logger; timeZone: string;
  replyLang(i: { locale: string; channelId: string | null }, ...ids: (string | null | undefined)[]): Lang;
  /** MP au joueur ; false s'il les refuse. */
  dm(userId: string, payload: ReturnType<typeof renderQuestNotice>, what: string): Promise<boolean>;
}

export function createQuests({ client, api, log, timeZone, replyLang, dm }: Deps) {
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
  async function upsert(v: QuestView, messageId: string | null) {
    const ch = await client.channels.fetch(v.channelId!);
    if (!ch || !ch.isSendable()) throw new Error(`Salon ${v.channelId} inaccessible`);
    remember(v.group.lang, v.id, v.channelId);
    const payload = renderQuest(v);
    if (messageId) {
      try { const m = await ch.messages.edit(messageId, payload); return { channelId: ch.id, messageId: m.id }; }
      catch (e) { if (!(e instanceof DiscordAPIError && e.code === UNKNOWN_MESSAGE)) throw e; }
    }
    const m = await ch.send(payload);
    return { channelId: ch.id, messageId: m.id };
  }
  function publish(v: QuestView) {
    // Quête finie : le site retire le message à la prochaine relève (il n'est plus dans l'outbox)
    if (!v.channelId || (v.state !== "open" && v.state !== "running")) return Promise.resolve(null);
    return serial(v.id, async () => {
      const known = posted.get(v.id);
      const msg = await upsert(v, v.messageId ?? (known?.channelId === v.channelId ? known.messageId : null));
      posted.set(v.id, msg);
      await api.questPublished(v.id, { ...msg, changedAt: v.changedAt });
      failures.delete(v.id);
      return msg;
    });
  }
  const publishSoon = (v: QuestView) => { publish(v).catch(e => log.warn("Mise à jour de la quête impossible", e?.message)); };

  async function tick() {
    if (running) return;
    running = true;
    try {
      const { quests } = await api.questsOutbox();
      for (const v of quests) {
        if ((failures.get(v.id) ?? 0) > Date.now()) continue;
        try { await publish(v); } catch (e) {
          failures.set(v.id, Date.now() + 60e3);
          log.warn(`Quête non publiée (${v.id})`, e instanceof Error ? e.message : e);
        }
      }
    } finally { running = false; }
  }

  /** MP des quêtes (étapes et rappels) ; MP fermés : ignoré. */
  async function sendNotices() {
    const { notices } = await api.claimQuestNotices();
    for (const n of notices) {
      remember(n.payload.lang, n.payload.questId);
      await dm(n.discordUserId, renderQuestNotice(n), "MP de quête");
    }
  }

  const fail = (i: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction, msg: string) =>
    (i.deferred || i.replied ? i.editReply({ content: `⚠️ ${msg}`, components: [] }) : i.reply({ content: `⚠️ ${msg}`, flags: MessageFlags.Ephemeral }));

  async function button(i: ButtonInteraction) {
    const x = decodeQuestId(i.customId);
    if (!x) return;
    const lang = replyLang(i, x.questId);
    // « Pas encore » : la fenêtre du mot, sans attendre le site
    if (x.a === "reject") return i.showModal(rejectModal(x.questId, x.takerId, lang));
    const inDm = !i.inGuild();
    try {
      if (x.a === "take") {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const { view } = await api.withLang(lang).questTake(x.questId, i.user.id);
        publishSoon(view);
        return i.editReply(takenReply(view));
      }
      if (inDm) await i.deferUpdate(); else await i.deferReply({ flags: MessageFlags.Ephemeral });
      const a = api.withLang(lang);
      const { view } = x.a === "received" ? await a.questReceived(x.questId, { discordUserId: i.user.id, ok: x.ok })
        : await a.questTaker(x.questId, (x as { takerId: string }).takerId, x.a as "validate" | "paid", i.user.id);
      publishSoon(view);
      return i.editReply({ content: `${inDm ? `${i.message.content}\n\n` : ""}${actionDone(x, view)}`.slice(0, 2000), components: [] });
    } catch (e) {
      if (e instanceof ApiError) return fail(i, e.message);
      throw e;
    }
  }

  async function modal(i: ModalSubmitInteraction) {
    const x = decodeQuestId(i.customId);
    if (!x || x.a !== "rejectModal") return;
    const lang = replyLang(i, x.questId);
    if (i.isFromMessage()) await i.deferUpdate(); else await i.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const note = (() => { try { return i.fields.getTextInputValue("note"); } catch { return ""; } })();
      const { view } = await api.withLang(lang).questReject(x.questId, x.takerId, { discordUserId: i.user.id, note });
      publishSoon(view);
      const prev = i.isFromMessage() ? `${i.message?.content ?? ""}\n\n` : "";
      return i.editReply({ content: `${prev}${actionDone({ a: "reject", questId: x.questId, takerId: x.takerId }, view)}`.slice(0, 2000), components: [] });
    } catch (e) {
      if (e instanceof ApiError) return fail(i, e.message);
      throw e;
    }
  }

  /** /quete : publie une quête (titre, objectif, récompense en or et autre chose, places, échéance). */
  async function command(i: ChatInputCommandInteraction) {
    const lang = replyLang(i);
    if (!i.inGuild() || !i.channelId) return i.reply({ content: tr(lang, "Commande à utiliser dans un salon de serveur."), flags: MessageFlags.Ephemeral });
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const end = parseEnd(i.options.getString("echeance") ?? "", new Date(), timeZone);
    if (!end.ok) return i.editReply(`⚠️ ${tr(lang, "Échéance illisible : écris par exemple « 3j », « 48h » ou « jeudi 21:00 ».")}`);
    try {
      const { view } = await api.withLang(lang).createQuest({
        guildId: i.guildId, channelId: i.channelId, discordUserId: i.user.id,
        type: (i.options.getString("type") as QuestType | null) ?? "other", title: i.options.getString("titre", true), objective: i.options.getString("objectif", true),
        description: i.options.getString("description") ?? undefined, gold: i.options.getInteger("or") ?? 0, reward: i.options.getString("autre") ?? undefined,
        places: i.options.getInteger("places") ?? 1, dueAt: end.at?.toISOString() ?? null,
      });
      await publish(view).catch(e => log.warn("Quête non publiée", e?.message));
      const g = langOf(view.group, lang);
      const where = view.channelId && view.channelId !== i.channelId ? ` ${tr(g, "Elle est annoncée dans <#{channel}>.", { channel: view.channelId })}` : "";
      return i.editReply(`${tr(g, "❗ Quête publiée : **{title}**.", { title: view.title })}${where} [${tr(g, "Voir sur le site")}](<${view.url}>)`);
    } catch (e) {
      if (e instanceof ApiError) return fail(i, e.message);
      throw e;
    }
  }

  return { tick, publish, sendNotices, button, modal, command };
}
