import type { InternalApi, SiteAlertView } from "./api";
import type { MessagePayload } from "./render";
import type { Logger } from "./sync";

/**
 * Alertes de surveillance du site (bot tombé ou de retour, sauvegarde en retard ou rétablie) dans le salon privé des
 * admins, celui des signalements. Un bot tombé ne peut pas écrire : la coupure est postée à son retour, suivie du retour.
 * Rendu pur (testé sans Discord) et relève.
 */

const RED = 0xed4245;
const GREEN = 0x3ba55d;
/** Silence du bot qui déclenche l'alerte (le même que côté site : l'alerte date de ce moment). */
const BOT_SILENCE_MS = 10 * 60e3;
const FOOTER_SITE = "État du site : page Administration du site";

export function renderSiteAlert(a: SiteAlertView, timeZone: string): MessagePayload {
  const hhmm = (d: Date) => new Intl.DateTimeFormat("fr-FR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const at = new Date(a.at);
  const mailed = `Un e-mail est parti aux admins à ${hhmm(at)}.`;
  const [color, description, footer] = {
    bot_down: [RED, `Dernier signe de vie : ${hhmm(new Date(at.getTime() - BOT_SILENCE_MS))}. ${mailed}`, "Message posté au retour du bot, pas avant"],
    bot_up: [GREEN, "Tout est rentré dans l'ordre.", FOOTER_SITE],
    backup_late: [RED, `La sauvegarde de nuit n'a rien signalé. ${mailed}`, FOOTER_SITE],
    backup_ok: [GREEN, "Tout est rentré dans l'ordre.", FOOTER_SITE],
  }[a.kind] as [number, string, string];
  return {
    embeds: [{ title: a.text.slice(0, 256), description, color, footer: { text: footer }, timestamp: a.at }],
    components: [],
    allowedMentions: { parse: [] },
  };
}

export interface SiteAlertPublisher { post(a: SiteAlertView): Promise<void> }

/**
 * Relève des alertes à poster : dans l'ordre, une à une. Au premier échec (salon supprimé, droits), les suivantes
 * attendent la relève suivante, pour que le retour du bot ne passe jamais avant sa coupure.
 */
export function createSiteAlertSync(api: Pick<InternalApi, "siteAlertsOutbox" | "siteAlertPosted">, pub: SiteAlertPublisher, log: Logger) {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const { alerts } = await api.siteAlertsOutbox();
      for (const a of alerts) {
        try {
          await pub.post(a);
          await api.siteAlertPosted(a.id);
        } catch (e) {
          log.warn(`Alerte du site non postée (${a.id})`, e instanceof Error ? e.message : e);
          break;
        }
      }
    } finally { running = false; }
  }
  return { tick };
}
