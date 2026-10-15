import type { ChannelName, InternalApi, LinkedChannel } from "./api";
import type { Logger } from "./sync";

/**
 * Salons des raids récurrents (un salon à part par raid récurrent, lié par /forever-lier ou /roster-lier) :
 * le bot les renomme avec la date du raid courant (ex. jeudi-15-10) et rapporte au site le nom obtenu ou l'erreur.
 * Il ne renomme que les salons que l'API lui donne (raid récurrent lié, renommage activé sur le site).
 * Ensuite, pour tous les salons liés (groupe, commandes, raids récurrents), il rapporte le nom réel quand il diffère
 * de celui que connaît le site (salon renommé à la main) : le site affiche le nom de chaque salon.
 * Logique pure, testée avec de faux salons ; main.ts fournit l'accès à Discord.
 */

/** Motif du renommage (visible dans le journal d'audit du serveur Discord). */
export const RENAME_REASON = "Roster : date du prochain raid";
/** Discord limite les renommages à 2 par 10 minutes et par salon : un salon en erreur n'est pas retenté avant 1 h. */
export const RETRY_AFTER_ERROR_MS = 3600e3;
/** Exemple de nom, dans les messages. */
export const EXAMPLE_NAME = "jeudi-15-10";

export const ERR_PERMISSION = "Le bot ne peut pas renommer ce salon : donne-lui la permission « Gérer les salons » sur ce salon.";
export const ERR_NOT_FOUND = "Salon introuvable : lie un autre salon.";
export const ERR_ACCESS = "Le bot ne voit pas ce salon : donne-lui « Voir le salon » et « Gérer les salons » sur ce salon.";
export const ERR_OTHER = "Le salon n'a pas pu être renommé (nouvel essai dans une heure).";

/** Codes d'erreur de l'API de Discord. */
const UNKNOWN_CHANNEL = 10003, MISSING_ACCESS = 50001, MISSING_PERMISSIONS = 50013;

/** Salon tel que le bot le voit (un salon textuel de discord.js, ou un faux dans les tests). */
export interface NamedChannel { name: string; guildId: string | null; setName(name: string, reason: string): Promise<unknown> }
/** Accès aux salons : null si le salon n'existe plus (ou n'est pas un salon de serveur). */
export type ChannelFetcher = (channelId: string) => Promise<NamedChannel | null>;

/** Salon supprimé, ou que le bot ne voit pas : rien à rapporter ni à journaliser pour son nom. */
const isGone = (e: unknown) => [UNKNOWN_CHANNEL, MISSING_ACCESS].includes(Number((e as { code?: unknown } | null)?.code));

/** Message (en français, pour les officiers) d'une erreur de Discord. */
export function renameError(e: unknown): string {
  const code = Number((e as { code?: unknown } | null)?.code);
  if (code === MISSING_PERMISSIONS) return ERR_PERMISSION;
  if (code === UNKNOWN_CHANNEL) return ERR_NOT_FOUND;
  if (code === MISSING_ACCESS) return ERR_ACCESS;
  return ERR_OTHER;
}

/** Réponse de /forever-lier (ou /roster-lier) pour le salon d'un raid récurrent. */
export function templateLinkedReply(t: { name: string; rename?: boolean; next?: string | null }, canRename: boolean) {
  const lines = [`✅ Ce salon reçoit maintenant les annonces du raid récurrent « ${t.name} ».`];
  if (t.rename === false) {
    lines[0] += " Son nom ne change pas : le renommage est coupé sur le site.";
    return lines.join("\n");
  }
  lines[0] += ` Il prendra le nom du prochain raid (${t.next ? `ici ${t.next}` : `ex. ${EXAMPLE_NAME}`}).`;
  if (!canRename) lines.push("⚠️ Je ne peux pas encore le renommer : donne-moi la permission « Gérer les salons » sur ce salon (sur ce salon seulement, pas sur tout le serveur).");
  return lines.join("\n");
}

export function createChannelNamer(
  api: Pick<InternalApi, "channelNames" | "channelReport" | "linkedChannels" | "channelName">, fetchChannel: ChannelFetcher, log: Logger, now = () => Date.now(),
) {
  /** Dernier rapport envoyé au site, par raid récurrent : on ne renvoie que ce qui change. */
  const reported = new Map<string, string>();
  /** Salons en erreur (raid récurrent + salon) : pas de nouvel essai avant cette heure. */
  const blocked = new Map<string, number>();
  let running = false;

  async function one(c: ChannelName) {
    const key = `${c.templateId}:${c.channelId}`;
    if ((blocked.get(key) ?? 0) > now()) return;
    let name: string | null = null, error: string | null = null;
    try {
      const ch = await fetchChannel(c.channelId);
      if (!ch || (ch.guildId && ch.guildId !== c.guildId)) error = ERR_NOT_FOUND;
      else {
        name = ch.name;
        if (ch.name !== c.name) {
          await ch.setName(c.name, RENAME_REASON);
          name = c.name;
          log.info(`Salon renommé : #${c.name}`);
        }
      }
    } catch (e) {
      error = renameError(e);
      if (error === ERR_OTHER) log.warn(`Salon ${c.channelId} non renommé`, e instanceof Error ? e.message : e);
    }
    if (error) blocked.set(key, now() + RETRY_AFTER_ERROR_MS);
    else blocked.delete(key);
    const state = JSON.stringify([c.channelId, name, error]);
    if (reported.get(c.templateId) === state) return;
    await api.channelReport(c.templateId, { channelId: c.channelId, name, error });
    reported.set(c.templateId, state);
  }

  /** Nom réel d'un salon lié, rapporté au site seulement s'il diffère du sien (salon introuvable : rien). */
  async function linkedName(c: LinkedChannel) {
    let ch: NamedChannel | null;
    try { ch = await fetchChannel(c.channelId); } catch (e) {
      if (!isGone(e)) log.warn(`Salon ${c.channelId} non relevé`, e instanceof Error ? e.message : e);
      return;
    }
    if (!ch || !ch.name || (c.guildId && ch.guildId !== c.guildId) || ch.name === c.name) return;
    await api.channelName({ kind: c.kind, id: c.id, channelId: c.channelId, name: ch.name });
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const list = await api.channelNames();
      // Raid récurrent délié, renommage coupé puis remis : on repart de zéro (nouvel essai sans attendre l'heure)
      const live = new Set(list.map(c => `${c.templateId}:${c.channelId}`));
      for (const k of blocked.keys()) if (!live.has(k)) blocked.delete(k);
      for (const id of reported.keys()) if (!list.some(c => c.templateId === id)) reported.delete(id);
      for (const c of list) {
        try { await one(c); } catch (e) { log.warn(`Salon du raid récurrent ${c.templateId} non traité`, e instanceof Error ? e.message : e); }
      }
      // Puis tous les salons liés (après les renommages : le site connaît déjà les nouveaux noms)
      for (const c of await api.linkedChannels()) {
        try { await linkedName(c); } catch (e) { log.warn(`Nom du salon ${c.channelId} non rapporté`, e instanceof Error ? e.message : e); }
      }
    } finally { running = false; }
  }

  return { tick };
}
