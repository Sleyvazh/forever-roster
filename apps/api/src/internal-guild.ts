import { announcedLevels, LAUNCH_AT, RACE_START, raceDateText, type LevelAnnounce } from "@forever/game-data";
import { and, asc, countDistinct, eq, gte, inArray, isNotNull, isNull, lt, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "./app";
import { gameGuilds, groups, guildLevels, guildMembers } from "./db/schema";
import { siteForGame } from "./lib/site";

/**
 * API interne du bot pour la Course au 60 (Forever) : montées de niveau à annoncer dans le salon de la guilde, selon le
 * réglage de la guilde (rien, les 60 seulement par défaut, tous les 10 niveaux de 20 à 60). Une seule fois par perso et
 * par palier (announced_at), jamais avant la sortie (5/11 00:00, heure de Paris). Seulement les vraies montées (date
 * exacte de l'addon ou vue entre deux listes), pas le niveau d'un perso au premier relevé, et seulement les récentes
 * (3 jours) : changer le réglage ne publie pas d'anciennes montées.
 */

/** Une montée récente seulement. */
export const ANNOUNCE_WINDOW_MS = 3 * 86400e3;

export interface LevelAnnounceView {
  id: string; channelId: string; group: { id: string; name: string }; url: string;
  /** Nom complet du perso (liste de guilde). */
  name: string; cls: string; level: number;
  /** Rang dans la guilde pour ce palier (« 1re de la guilde ») et date (exacte ou « vers le »). */
  rank: number; at: string; exact: boolean; when: string;
}

export function guildAnnounceRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, cfg } = ctx;

  app.post("/internal/discord/guild/levels/claim", async () => {
    const now = ctx.now?.() ?? new Date();
    if (now.getTime() < LAUNCH_AT) return { announces: [] };
    const since = new Date(Math.max(RACE_START, now.getTime() - ANNOUNCE_WINDOW_MS));
    const gs = await db.select({ id: groups.id, name: groups.name, channelId: groups.discordChannelId, setting: groups.levelAnnounces })
      .from(groups).innerJoin(gameGuilds, eq(gameGuilds.groupId, groups.id))
      .where(and(eq(groups.game, "forever"), isNotNull(groups.discordChannelId), ne(groups.levelAnnounces, "none")));
    const announces: LevelAnnounceView[] = [];
    for (const g of gs) {
      const levels = announcedLevels(g.setting as LevelAnnounce);
      const due = await db.select({ guid: guildLevels.guid, level: guildLevels.level }).from(guildLevels)
        .where(and(eq(guildLevels.groupId, g.id), isNull(guildLevels.announcedAt), inArray(guildLevels.source, ["exact", "roster"]),
          inArray(guildLevels.level, levels), gte(guildLevels.reachedAt, since)))
        .orderBy(asc(guildLevels.reachedAt), asc(guildLevels.level), asc(guildLevels.guid)).limit(20);
      for (const d of due) {
        // Réservé une seule fois (deux relèves du bot en même temps n'annoncent pas deux fois)
        const [c] = await db.update(guildLevels).set({ announcedAt: now })
          .where(and(eq(guildLevels.groupId, g.id), eq(guildLevels.guid, d.guid), eq(guildLevels.level, d.level), isNull(guildLevels.announcedAt)))
          .returning({ reachedAt: guildLevels.reachedAt, source: guildLevels.source });
        if (!c) continue;
        const [m] = await db.select({ name: guildMembers.name, cls: guildMembers.cls }).from(guildMembers)
          .where(and(eq(guildMembers.groupId, g.id), eq(guildMembers.guid, d.guid)));
        if (!m) continue;
        // Rang : persos de la guilde arrivés à ce niveau (ou plus haut) avant lui depuis la sortie, plus un (ex æquo : même rang)
        const [before] = await db.select({ n: countDistinct(guildLevels.guid) }).from(guildLevels)
          .where(and(eq(guildLevels.groupId, g.id), gte(guildLevels.level, d.level), gte(guildLevels.reachedAt, new Date(RACE_START)), lt(guildLevels.reachedAt, c.reachedAt), ne(guildLevels.guid, d.guid)));
        const exact = c.source === "exact";
        announces.push({
          id: `${g.id}:${d.guid}:${d.level}`, channelId: g.channelId!, group: { id: g.id, name: g.name }, url: `${siteForGame(cfg, "forever").origin}/groups/${g.id}/membres/course`,
          name: m.name, cls: m.cls, level: d.level, rank: (before?.n ?? 0) + 1, at: c.reachedAt.toISOString(), exact, when: raceDateText(c.reachedAt.getTime(), exact),
        });
      }
    }
    return { announces: announces.sort((a, b) => a.at.localeCompare(b.at)) };
  });
}
