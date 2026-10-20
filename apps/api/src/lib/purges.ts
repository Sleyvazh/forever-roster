import { and, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditEvents, bnetImports, devices, emailTokens, guildEvents, guildLinkProposals, sessions } from "../db/schema";
import { SESSION_IDLE_MS } from "./session";

/**
 * Purges automatiques des données qui ne servent plus : lancées par server.ts au démarrage, puis toutes les heures.
 * Par lots de PURGE_BATCH lignes, une requête courte par lot pour ne pas bloquer les tables ; au plus MAX_BATCHES lots
 * par table et par passage, le reste attend le passage suivant. Les durées sont celles de la page Confidentialité
 * (apps/web/src/pages/LegalPages.tsx) : à changer avec elle.
 * Jamais purgés ici : raids, inscriptions, bilans de raid, absences, commandes, journal des groupes.
 * Guilde du jeu (Forever) : membres partis depuis 90 jours (avec leurs niveaux et leurs rattachements), journal de guilde
 * au bout de 12 mois, guildes du jeu proposées au bout de 30 jours.
 */
const DAY_MS = 86400e3;
/** Journal de sécurité : 12 mois. */
export const AUDIT_KEEP_MS = 365 * DAY_MS;
/** Sessions finies, appareils déliés, liens d'e-mail utilisés ou expirés : 30 jours. */
export const ENDED_KEEP_MS = 30 * DAY_MS;
/** Membre parti de la guilde du jeu : 90 jours. */
export const GUILD_LEFT_KEEP_MS = 90 * DAY_MS;
/** Journal de guilde : 12 mois. */
export const GUILD_EVENTS_KEEP_MS = 365 * DAY_MS;
/** Guilde du jeu proposée (relevé gardé) : 30 jours. */
export const GUILD_PROPOSAL_KEEP_MS = 30 * DAY_MS;
export const PURGE_BATCH = 1000;
const MAX_BATCHES = 20;

/** Rejoue un lot jusqu'à ce qu'il en reste moins d'un lot entier (ou MAX_BATCHES lots) ; renvoie le total traité. */
async function inBatches(batch: () => Promise<{ rowCount: number | null }>) {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const n = (await batch()).rowCount ?? 0;
    total += n;
    if (n < PURGE_BATCH) break;
  }
  return total;
}

/** Un passage de purge ; renvoie le nombre de lignes effacées (ou vidées, pour auditStripped) par table. */
export async function purgeOldData(db: Db, now = new Date()) {
  const auditLimit = new Date(now.getTime() - AUDIT_KEEP_MS);
  const ended = new Date(now.getTime() - ENDED_KEEP_MS);

  // Journal de sécurité de plus de 12 mois : effacé…
  const audit = await inBatches(() => db.delete(auditEvents).where(inArray(auditEvents.id,
    db.select({ id: auditEvents.id }).from(auditEvents)
      .where(and(isNull(auditEvents.groupId), lt(auditEvents.createdAt, auditLimit))).limit(PURGE_BATCH))));
  // … sauf les actions faites dans un groupe, qui restent dans le journal du groupe : seuls l'IP et le navigateur partent
  const auditStripped = await inBatches(() => db.update(auditEvents).set({ ip: null, userAgent: null }).where(inArray(auditEvents.id,
    db.select({ id: auditEvents.id }).from(auditEvents)
      .where(and(isNotNull(auditEvents.groupId), lt(auditEvents.createdAt, auditLimit), or(isNotNull(auditEvents.ip), isNotNull(auditEvents.userAgent))))
      .limit(PURGE_BATCH))));

  // Sessions finies depuis 30 jours : expirées, fermées (déconnexion, révocation) ou abandonnées (7 jours sans activité)
  const sessionsGone = await inBatches(() => db.delete(sessions).where(inArray(sessions.id,
    db.select({ id: sessions.id }).from(sessions).where(or(
      lt(sessions.expiresAt, ended), lt(sessions.revokedAt, ended), lt(sessions.lastSeenAt, new Date(ended.getTime() - SESSION_IDLE_MS)),
    )).limit(PURGE_BATCH))));

  // Appareils Roster Companion déliés depuis 30 jours, avec leur dernière IP
  const devicesGone = await inBatches(() => db.delete(devices).where(inArray(devices.id,
    db.select({ id: devices.id }).from(devices).where(lt(devices.revokedAt, ended)).limit(PURGE_BATCH))));

  // Liens envoyés par e-mail, utilisés (ou annulés) ou expirés depuis 30 jours
  const emailTokensGone = await inBatches(() => db.delete(emailTokens).where(inArray(emailTokens.id,
    db.select({ id: emailTokens.id }).from(emailTokens).where(or(lt(emailTokens.usedAt, ended), lt(emailTokens.expiresAt, ended))).limit(PURGE_BATCH))));

  // Liste de l'import Battle.net : effacée dès qu'elle a expiré (30 minutes)
  const bnetImportsGone = await inBatches(() => db.delete(bnetImports).where(inArray(bnetImports.userId,
    db.select({ userId: bnetImports.userId }).from(bnetImports).where(lt(bnetImports.expiresAt, now)).limit(PURGE_BATCH))));

  // Guilde du jeu : membres partis depuis 90 jours, avec leur historique de niveaux et leurs rattachements…
  const leftLimit = new Date(now.getTime() - GUILD_LEFT_KEEP_MS);
  const guildMembersGone = await inBatches(async () => {
    const r = await db.execute(sql`
      WITH gone AS (
        DELETE FROM guild_members WHERE (group_id, guid) IN (
          SELECT group_id, guid FROM guild_members WHERE left_at < ${leftLimit} LIMIT ${PURGE_BATCH}
        ) RETURNING group_id, guid
      ), levels AS (
        DELETE FROM guild_levels l USING gone WHERE l.group_id = gone.group_id AND l.guid = gone.guid
      ), links AS (
        DELETE FROM guild_links k USING gone WHERE k.group_id = gone.group_id AND k.guid = gone.guid
      )
      SELECT count(*)::int AS n FROM gone`);
    return { rowCount: (r.rows[0] as { n: number } | undefined)?.n ?? 0 };
  });
  // … puis les joueurs sans compte qui n'ont plus aucun perso (ni lien, ni main encore dans la guilde)
  await db.execute(sql`
    DELETE FROM guild_players p WHERE p.user_id IS NULL
      AND EXISTS (SELECT 1 FROM game_guilds g WHERE g.group_id = p.group_id)
      AND NOT EXISTS (SELECT 1 FROM guild_links k WHERE k.player_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM guild_members m WHERE m.group_id = p.group_id AND m.guid = p.main_guid)`);
  // Journal de guilde de plus de 12 mois
  const guildEventsGone = await inBatches(() => db.delete(guildEvents).where(inArray(guildEvents.id,
    db.select({ id: guildEvents.id }).from(guildEvents).where(lt(guildEvents.at, new Date(now.getTime() - GUILD_EVENTS_KEEP_MS))).limit(PURGE_BATCH))));
  // Guildes du jeu proposées depuis 30 jours (avec le relevé gardé)
  const guildProposalsGone = (await db.delete(guildLinkProposals).where(lt(guildLinkProposals.createdAt, new Date(now.getTime() - GUILD_PROPOSAL_KEEP_MS)))).rowCount ?? 0;

  return {
    audit, auditStripped, sessions: sessionsGone, devices: devicesGone, emailTokens: emailTokensGone, bnetImports: bnetImportsGone,
    guildMembers: guildMembersGone, guildEvents: guildEventsGone, guildProposals: guildProposalsGone,
  };
}
