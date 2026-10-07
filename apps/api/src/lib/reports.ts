import type { Game } from "@forever/game-data";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import sharp from "sharp";
import type { Db } from "../db/client";
import { discordDeletions, reports, siteSettings } from "../db/schema";
import { badRequest } from "./http";
import { sniffImage } from "./images";

/**
 * Signalements (bug, idée, question) : vues pour le site et pour le bot, salon Discord des admins, capture d'écran.
 */
export type ReportRow = typeof reports.$inferSelect;

export const REPORT_KINDS = ["bug", "idea", "question"] as const;
export const REPORT_AREAS = ["site", "addon", "bot", "companion"] as const;
export const REPORT_STATUSES = ["new", "wip", "done", "refused"] as const;
export const KIND_LABEL: Record<(typeof REPORT_KINDS)[number], string> = { bug: "Bug", idea: "Idée", question: "Question" };
export const AREA_LABEL: Record<(typeof REPORT_AREAS)[number], string> = { site: "Site", addon: "Addon", bot: "Bot Discord", companion: "Companion" };
export const STATUS_LABEL: Record<(typeof REPORT_STATUSES)[number], string> = { new: "Nouveau", wip: "En cours", done: "Fait", refused: "Refusé" };

/** Côté le plus long d'une capture gardée (assez pour lire une fenêtre de l'addon, sans garder un 4K entier). */
export const SCREENSHOT_MAX = 1600;
/** Une capture se joint dans les 15 minutes qui suivent le signalement, une seule fois. */
export const SCREENSHOT_WINDOW_MS = 15 * 60 * 1000;

/** Capture ré-encodée comme les portraits (décodage complet, WebP, métadonnées supprimées), sans recadrage. */
export async function normalizeScreenshot(buf: Buffer): Promise<Buffer> {
  if (!sniffImage(buf)) throw badRequest("Format d'image non pris en charge : PNG, JPEG ou WebP.");
  try {
    return await sharp(buf, { limitInputPixels: 4096 * 4096, failOn: "error", animated: false })
      .rotate()
      .resize(SCREENSHOT_MAX, SCREENSHOT_MAX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();
  } catch {
    throw badRequest("Image illisible ou trop grande (4096 × 4096 pixels maximum).");
  }
}

/** Navigateur lisible depuis l'en-tête User-Agent (« Firefox 131 · Windows »). */
export function browserOf(ua: string): string {
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  // Dans l'ordre : Edge et Opera se disent aussi « Chrome », Chrome se dit aussi « Safari »
  const found = ([["Edge", /Edg\/(\d+)/], ["Opera", /OPR\/(\d+)/], ["Firefox", /Firefox\/(\d+)/], ["Chrome", /Chrome\/(\d+)/], ["Safari", /Version\/(\d+).*Safari/]] as const)
    .map(([name, re]) => [name, re.exec(ua)?.[1]] as const).find(([, v]) => v);
  return [found && `${found[0]} ${found[1]}`, os].filter(Boolean).join(" · ");
}

/** Ce que voient le joueur (ses signalements) et les admins. */
export function reportView(r: ReportRow) {
  return {
    id: r.id, author: r.author, game: r.game, kind: r.kind, area: r.area, title: r.title, body: r.body,
    page: r.page, browser: browserOf(r.userAgent), addonVersion: r.addonVersion, hasImage: !!r.image,
    status: r.status, reply: r.reply, repliedAt: r.repliedAt, repliedBy: r.repliedBy,
    unseen: !!r.repliedAt && !r.replySeenAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

/* ----- Salon Discord des signalements ----- */

const CHANNEL_KEY = "reports_channel";
export interface ReportsChannel { guildId: string; channelId: string }

export async function reportsChannel(db: Db): Promise<ReportsChannel | null> {
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.key, CHANNEL_KEY));
  const v = row?.value as Partial<ReportsChannel> | undefined;
  return v?.guildId && v.channelId ? { guildId: v.guildId, channelId: v.channelId } : null;
}

/** Lie le salon ; les messages restés dans un autre salon sont supprimés par le bot et republiés dans le nouveau. */
export async function bindReportsChannel(db: Db, ch: ReportsChannel) {
  await db.insert(siteSettings).values({ key: CHANNEL_KEY, value: { ...ch } })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: { ...ch }, updatedAt: new Date() } });
  const old = await db.select({ id: reports.id, channelId: reports.discordChannelId, messageId: reports.discordMessageId }).from(reports)
    .where(and(isNotNull(reports.discordMessageId), isNotNull(reports.discordChannelId), ne(reports.discordChannelId, ch.channelId)));
  if (old.length) await db.insert(discordDeletions).values(old.map(o => ({ channelId: o.channelId!, messageId: o.messageId! })));
  for (const o of old) await db.update(reports).set({ discordChannelId: null, discordMessageId: null, discordSyncedAt: null, discordChangedAt: new Date() }).where(eq(reports.id, o.id));
}

/** Message du bot : titre, texte, auteur, site, addon, statut et lien vers la page admin. */
export function reportDiscordView(r: ReportRow, channelId: string, origin: (g: Game) => string) {
  return {
    id: r.id, channelId, messageId: r.discordChannelId === channelId ? r.discordMessageId : null, changedAt: r.discordChangedAt.toISOString(),
    kind: r.kind, area: r.area, title: r.title, body: r.body.slice(0, 1500), author: r.author,
    site: r.game === "retail" ? "Roster" : "Forever Roster", page: r.page.slice(0, 200), browser: browserOf(r.userAgent),
    addonVersion: r.addonVersion, hasImage: !!r.image,
    status: r.status, reply: r.reply.slice(0, 500), repliedBy: r.repliedBy, createdAt: r.createdAt.toISOString(),
    url: `${origin(r.game)}/admin/signalements?id=${r.id}`,
  };
}
export type ReportDiscordView = ReturnType<typeof reportDiscordView>;
