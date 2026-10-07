import { ButtonStyle, ComponentType, type APIEmbedField } from "discord.js";
import type { InternalApi, ReportView } from "./api";
import { escapeMd, type MessagePayload, type Row } from "./render";
import type { Logger } from "./sync";

/**
 * Signalements du site (bug, idée, question) dans le salon privé des admins : un message par signalement,
 * mis à jour quand son statut change ou qu'un admin répond. Rendu pur (testé sans Discord) et relève.
 */

export const CAPTURE_NAME = "capture.webp";
const KIND = { bug: "🐞 Bug", idea: "💡 Idée", question: "❓ Question" } as const;
const AREA = { site: "Site", addon: "Addon", bot: "Bot Discord", companion: "Companion" } as const;
const STATUS = { new: "🆕 Nouveau", wip: "🔧 En cours", done: "✅ Fait", refused: "⛔ Refusé" } as const;
const COLOR = { new: 0xe0a030, wip: 0x5865f2, done: 0x3fa45b, refused: 0x80848e } as const;

export function renderReport(r: ReportView, withImage = r.hasImage): MessagePayload {
  const fields: APIEmbedField[] = [
    { name: "De", value: escapeMd(r.author) || "?", inline: true },
    { name: "Concerne", value: `${AREA[r.area]} · ${r.site}`, inline: true },
    { name: "Statut", value: STATUS[r.status], inline: true },
  ];
  if (r.page) fields.push({ name: "Page", value: `\`${r.page.replace(/`/g, "'")}\``, inline: true });
  if (r.browser) fields.push({ name: "Navigateur", value: r.browser, inline: true });
  if (r.addonVersion) fields.push({ name: "Addon", value: escapeMd(r.addonVersion), inline: true });
  if (r.reply) fields.push({ name: `Réponse${r.repliedBy ? ` de ${escapeMd(r.repliedBy)}` : ""}`.slice(0, 256), value: escapeMd(r.reply).slice(0, 1024), inline: false });
  return {
    embeds: [{
      title: `${KIND[r.kind]} · ${r.title}`.slice(0, 256),
      url: r.url,
      description: escapeMd(r.body).slice(0, 4000),
      color: COLOR[r.status],
      fields,
      ...(withImage && { image: { url: `attachment://${CAPTURE_NAME}` } }),
      footer: { text: "Signalement du site · réponds depuis la page admin" },
      timestamp: r.createdAt,
    }],
    components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label: "Voir sur le site", url: r.url }] }] as Row[],
    allowedMentions: { parse: [] },
  };
}

export interface ReportPublisher { upsert(r: ReportView, messageId: string | null): Promise<{ channelId: string; messageId: string }> }

/** Relève des signalements à publier ; un échec (salon supprimé, droits) est retenté une minute plus tard. */
export function createReportSync(api: Pick<InternalApi, "reportsOutbox" | "reportPublished">, pub: ReportPublisher, log: Logger) {
  const failures = new Map<string, number>();
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const { reports } = await api.reportsOutbox();
      for (const r of reports) {
        if ((failures.get(r.id) ?? 0) > Date.now()) continue;
        try {
          const msg = await pub.upsert(r, r.messageId);
          await api.reportPublished(r.id, { ...msg, changedAt: r.changedAt });
          failures.delete(r.id);
        } catch (e) {
          failures.set(r.id, Date.now() + 60e3);
          log.warn(`Signalement non publié (${r.id})`, e instanceof Error ? e.message : e);
        }
      }
    } finally { running = false; }
  }
  return { tick };
}
