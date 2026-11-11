import { daysSinceLaunch, MAX_LEVEL, ordinalEn, ordinalFr } from "@forever/game-data";
import { langOf, tr, trn, type Lang } from "./i18n";
import type { InternalApi, LevelAnnounce } from "./api";
import { escapeMd, type MessagePayload } from "./render";
import type { Logger } from "./sync";

/**
 * Course au 60 (Forever) : montées de niveau annoncées dans le salon de la guilde, selon son réglage (le site choisit
 * quoi annoncer et ne remet chaque montée qu'une fois). Le 60 en grand, les autres paliers en une ligne courte.
 */

const GOLD = 0xc8a04b;

/** « 9 jours après la sortie », « le jour de la sortie ». */
const afterLaunch = (lang: Lang, at: number) => {
  const d = daysSinceLaunch(at);
  return d === 0 ? tr(lang, "le jour de la sortie") : trn(lang, d, "{n} jour après la sortie", "{n} jours après la sortie");
};

export function renderLevelAnnounce(a: LevelAnnounce): MessagePayload {
  const lang = langOf(a.group);
  const name = escapeMd(a.name);
  const rank = lang === "en" ? ordinalEn(a.rank) : ordinalFr(a.rank);
  if (a.level >= MAX_LEVEL) {
    return {
      embeds: [{
        title: `🏆 ${tr(lang, "{name} atteint le niveau {level}", { name, level: a.level })}`.slice(0, 256),
        url: a.url,
        description: tr(lang, "{rank} de la guilde, {after}.", { rank, after: afterLaunch(lang, Date.parse(a.at)) }),
        color: GOLD,
        footer: { text: `${tr(lang, "Course au 60")} · ${a.group.name} · ${a.when}`.slice(0, 2048) },
      }],
      components: [],
      allowedMentions: { parse: [] },
    };
  }
  return { content: `⬆️ ${tr(lang, "**{name}** atteint le niveau {level} · {rank} de la guilde.", { name, level: a.level, rank })}`, embeds: [], components: [], allowedMentions: { parse: [] } };
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
