import { createHash } from "node:crypto";
import { count, desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { gameCacheUploads, gameHotfixes } from "../db/schema";
import { badRequest, forbidden } from "../lib/http";
import { N } from "../lib/i18n";
import { parseDbCache, type CacheRecord, type DbCache } from "./dbcache";
import { HOTFIX_LAYOUTS } from "./hotfix-layouts";

/**
 * Cache du jeu partagé (lot D2) : les contributeurs envoient le DBCache.bin de leur client (page Addon ou Roster
 * Companion) ; le site garde, dans game_hotfixes, le dernier état de chaque ligne des tables que l'import lit, et
 * l'import (de la nuit ou à la main) les applique aux tables du client avec ceux des fichiers de gamedata/.
 * Seuls les admins du site et les contributeurs qu'ils nomment peuvent envoyer : un cache se fabrique à la main, et un
 * objet inventé serait visible dans toutes les guildes (choix de Flo, 17/11/2026).
 */

/** Taille maximale d'un cache envoyé (celui d'un client qui a beaucoup joué fait une dizaine de Mo). */
export const CACHE_MAX_BYTES = 32 * 1024 * 1024;
const RELEVANT = new Set(Object.values(HOTFIX_LAYOUTS).map(d => d.hash));
const chunk = <T>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

export const canSendCache = (u: { siteAdmin: boolean; gameDataContributor: boolean }) => u.siteAdmin || u.gameDataContributor;

/**
 * Ajoute les lignes utiles d'un cache aux correctifs gardés : une ligne inconnue, ou une version plus récente (numéro de
 * diffusion plus grand) d'une ligne connue. Renvoie le nombre de lignes utiles et celles qui étaient nouvelles.
 */
export async function saveHotfixes(db: Db, cache: DbCache, contributorId: string | null, now = new Date()) {
  const row = (r: Omit<CacheRecord, "data">, data: Buffer | null) => ({
    tableHash: r.table, rowId: r.id, push: r.push, removed: data === null, data: data ? Buffer.from(data) : Buffer.alloc(0),
    build: cache.build, contributorId, receivedAt: now,
  });
  const rows = [
    ...cache.records.filter(r => RELEVANT.has(r.table)).map(r => row(r, r.data)),
    ...cache.removed.filter(r => RELEVANT.has(r.table)).map(r => row(r, null)),
  ];
  let newRows = 0;
  for (const part of chunk(rows, 1000)) {
    const done = await db.insert(gameHotfixes).values(part).onConflictDoUpdate({
      target: [gameHotfixes.tableHash, gameHotfixes.rowId],
      set: {
        push: sql`excluded.push`, removed: sql`excluded.removed`, data: sql`excluded.data`, build: sql`excluded.build`,
        contributorId: sql`excluded.contributor_id`, receivedAt: sql`excluded.received_at`,
      },
      setWhere: sql`excluded.push > ${gameHotfixes.push}`,
    }).returning({ rowId: gameHotfixes.rowId });
    newRows += done.length;
  }
  return { rows: rows.length, newRows };
}

/** Correctifs gardés, regroupés par version du client (un DbCache par version), pour collectHotfixes. */
export async function loadHotfixCaches(db: Db): Promise<DbCache[]> {
  const byBuild = new Map<number, DbCache>();
  for (const r of await db.select().from(gameHotfixes)) {
    let c = byBuild.get(r.build);
    if (!c) { c = { version: 9, build: r.build, records: [], removed: [] }; byBuild.set(r.build, c); }
    if (r.removed) c.removed.push({ table: r.tableHash, id: r.rowId, push: r.push });
    else c.records.push({ table: r.tableHash, id: r.rowId, push: r.push, data: r.data });
  }
  return [...byBuild.values()].sort((a, b) => a.build - b.build);
}

/** Correctifs arrivés après une date (l'import de la nuit ne tourne que s'il y en a). */
export async function hotfixesSince(db: Db, since: Date | null) {
  const [r] = await db.select({ n: count() }).from(gameHotfixes).where(since ? gt(gameHotfixes.receivedAt, since) : undefined);
  return r?.n ?? 0;
}

/**
 * Un cache envoyé par un contributeur : vérifié (DBCache.bin version 9), ses lignes utiles ajoutées, l'envoi noté.
 * Le même fichier envoyé deux fois de suite par le même compte n'est pas relu (« déjà reçu »).
 */
export async function receiveCache(db: Db, buf: Buffer, who: { user: { id: string; siteAdmin: boolean; gameDataContributor: boolean }; deviceId?: string | null }, now = new Date()) {
  if (!canSendCache(who.user)) throw forbidden(N("Réservé aux contributeurs des données du jeu : un admin du site peut t'ajouter."));
  if (!buf.length) throw badRequest(N("Fichier vide."));
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const [last] = await db.select().from(gameCacheUploads).where(eq(gameCacheUploads.userId, who.user.id)).orderBy(desc(gameCacheUploads.receivedAt)).limit(1);
  if (last?.sha256 === sha256) return { build: last.build, rows: last.rows, newRows: 0, already: true };
  let cache: DbCache;
  try { cache = parseDbCache(buf); }
  catch { throw badRequest(N("Ce fichier n'est pas un cache du jeu lisible (DBCache.bin, dans Cache\\ADB\\enUS du dossier _forever_).")); }
  const { rows, newRows } = await saveHotfixes(db, cache, who.user.id, now);
  await db.insert(gameCacheUploads).values({ userId: who.user.id, deviceId: who.deviceId ?? null, via: who.deviceId ? "app" : "site", build: cache.build, bytes: buf.length, sha256, rows, newRows, receivedAt: now });
  return { build: cache.build, rows, newRows, already: false };
}

/** Dernier envoi d'un compte (page Addon). */
export async function lastUpload(db: Db, userId: string) {
  const [last] = await db.select({ at: gameCacheUploads.receivedAt, via: gameCacheUploads.via, build: gameCacheUploads.build, rows: gameCacheUploads.rows, newRows: gameCacheUploads.newRows })
    .from(gameCacheUploads).where(eq(gameCacheUploads.userId, userId)).orderBy(desc(gameCacheUploads.receivedAt)).limit(1);
  return last ?? null;
}
