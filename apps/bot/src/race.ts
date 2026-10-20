import { afterLaunchText, MAX_LEVEL, ordinalFr } from "@forever/game-data";
import type { InternalApi, LevelAnnounce } from "./api";
import { escapeMd, type MessagePayload } from "./render";
import type { Logger } from "./sync";

/**
 * Course au 60 (Forever) : montées de niveau annoncées dans le salon de la guilde, selon son réglage (le site choisit
 * quoi annoncer et ne remet chaque montée qu'une fois). Le 60 en grand, les autres paliers en une ligne courte.
 */

const GOLD = 0xc8a04b;

export function renderLevelAnnounce(a: LevelAnnounce): MessagePayload {
  const name = escapeMd(a.name);
  if (a.level >= MAX_LEVEL) {
    return {
      embeds: [{
        title: `🏆 ${name} atteint le niveau ${a.level}`.slice(0, 256),
        url: a.url,
        description: `${ordinalFr(a.rank)} de la guilde, ${afterLaunchText(Date.parse(a.at))}.`,
        color: GOLD,
        footer: { text: `Course au 60 · ${a.group.name} · ${a.when}`.slice(0, 2048) },
      }],
      components: [],
      allowedMentions: { parse: [] },
    };
  }
  return { content: `⬆️ **${name}** atteint le niveau ${a.level} · ${ordinalFr(a.rank)} de la guilde.`, embeds: [], components: [], allowedMentions: { parse: [] } };
}

/** Relève des annonces : chacune est remise une seule fois par le site ; un salon inaccessible est noté dans les journaux. */
export function createLevelAnnouncer(api: Pick<InternalApi, "claimLevelAnnounces">, send: (channelId: string, payload: MessagePayload) => Promise<void>, log: Logger) {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const { announces } = await api.claimLevelAnnounces();
      for (const a of announces) {
        try { await send(a.channelId, renderLevelAnnounce(a)); }
        catch (e) { log.warn(`Annonce de niveau non publiée (${a.group.name})`, (e as Error).message); }
      }
    } finally { running = false; }
  }
  return { tick };
}
