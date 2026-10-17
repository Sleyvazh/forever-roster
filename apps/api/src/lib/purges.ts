import { and, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditEvents, bnetImports, devices, emailTokens, sessions } from "../db/schema";
import { SESSION_IDLE_MS } from "./session";

/**
 * Purges automatiques des données qui ne servent plus : lancées par server.ts au démarrage, puis toutes les heures.
 * Par lots de PURGE_BATCH lignes, une requête courte par lot pour ne pas bloquer les tables ; au plus MAX_BATCHES lots
 * par table et par passage, le reste attend le passage suivant. Les durées sont celles de la page Confidentialité
 * (apps/web/src/pages/LegalPages.tsx) : à changer avec elle.
 * Jamais purgés ici : raids, inscriptions, bilans de raid, absences, commandes, journal des groupes.
 */
const DAY_MS = 86400e3;
/** Journal de sécurité : 12 mois. */
export const AUDIT_KEEP_MS = 365 * DAY_MS;
/** Sessions finies, appareils déliés, liens d'e-mail utilisés ou expirés : 30 jours. */
export const ENDED_KEEP_MS = 30 * DAY_MS;
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

  return {
    audit, auditStripped, sessions: sessionsGone, devices: devicesGone, emailTokens: emailTokensGone, bnetImports: bnetImportsGone,
  };
}
