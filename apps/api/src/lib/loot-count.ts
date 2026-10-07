import { gameName, LOOT_COUNT_DAYS, lootCountLabel, lootCountShort, lootSkipReason, zonedParts, zonedTime, type LootSettings } from "@forever/game-data";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { characters, groupCharacters, lootCorrections, lootExclusions, raidLogs, raids, raidSignups, users, type RaidLogLoot } from "../db/schema";
import { groupLootSettings } from "./loot";
import { groupGame, nameIndex } from "./log-names";

/**
 * Compte des objets reçus (lot I), montré au conseil du butin (addon) et dans l'onglet Présence.
 * Période choisie par les officiers : saison (depuis une date), 30 derniers jours ou X derniers raids relevés.
 * Comptent les objets de spé principale (lootSkipReason), sauf ceux que les officiers ont exclus,
 * plus les corrections manuelles datées dans la période. Total par perso, et par joueur (ses persos du groupe).
 */

const key = (name: string) => gameName(name).toLowerCase();
export const exclusionKey = (raidId: string, itemId: number, recipient: string, at: number) => `${raidId}:${itemId}:${key(recipient)}:${at}`;

/** Minuit (heure de Paris) du jour AAAA-MM-JJ. */
export function seasonStartDate(day: string | null): Date | null {
  const m = day?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return zonedTime(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0);
}
/** Aujourd'hui (heure de Paris), au format AAAA-MM-JJ. */
export function todayParis(now = new Date()) {
  const p = zonedParts(now);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export interface LootCountRow {
  characterId: string; userId: string; name: string; cls: string; owner: string; isMain: boolean;
  /** Royaume de la fiche (Roster : noms « Prénom-Royaume » de la ligne N du texte pour l'addon). */
  realm: string;
  /** Objets de ce perso (corrections comprises), et de tous les persos du joueur dans le groupe. */
  own: number; player: number;
  /** Le compte retenu par le groupe (par joueur ou par perso). */
  count: number;
}
export interface LootCountSummary {
  mode: LootSettings["countMode"]; by: LootSettings["countBy"];
  /** « depuis le 05/11/2026 », « sur les 30 derniers jours »… et version courte (« saison », « 30 j », « 5 raids »). */
  label: string; short: string;
  /** Début de la période (null : tout l'historique). */
  since: Date | null;
  /** Raids relevés pris en compte. */
  raids: number;
}

/** Bilans du groupe dans la période (du plus récent au plus ancien) et début effectif de la période. */
async function windowLogs(db: Db, groupId: string, s: LootSettings, now: Date) {
  const when = sql<Date>`coalesce(${raids.scheduledAt}, ${raidLogs.startedAt})`;
  let since: Date | null = s.countMode === "days" ? new Date(now.getTime() - LOOT_COUNT_DAYS * 86400_000)
    : s.countMode === "season" ? seasonStartDate(s.seasonStart) : null;
  const logs = await db.select({ raidId: raidLogs.raidId, loot: raidLogs.loot, when: when.mapWith(v => new Date(v as unknown as string)) })
    .from(raidLogs).innerJoin(raids, eq(raids.id, raidLogs.raidId))
    .where(and(eq(raids.groupId, groupId), ...(since ? [gte(when, since)] : [])))
    .orderBy(desc(when)).limit(s.countMode === "raids" ? s.countRaids : 500);
  // X derniers raids : la période commence au plus ancien d'entre eux (pour les corrections)
  if (s.countMode === "raids" && logs.length >= s.countRaids) since = logs.at(-1)!.when;
  return { logs, since };
}

export async function groupLootCounts(db: Db, groupId: string, settings?: LootSettings, now = new Date()) {
  const s = settings ?? await groupLootSettings(db, groupId);
  const { logs, since } = await windowLogs(db, groupId, s, now);
  const chars = await db.select({ id: characters.id, name: characters.name, realm: characters.realm, cls: characters.cls, userId: characters.userId, owner: users.displayName, isMain: groupCharacters.isMain })
    .from(characters).innerJoin(groupCharacters, and(eq(groupCharacters.characterId, characters.id), eq(groupCharacters.groupId, groupId)))
    .innerJoin(users, eq(users.id, characters.userId));
  // Noms relevés : prénom (Forever) ou « Prénom-Royaume » (Roster)
  const find = nameIndex(await groupGame(db, groupId), chars);

  const ids = logs.map(l => l.raidId);
  const excluded = new Set(ids.length ? (await db.select().from(lootExclusions).where(inArray(lootExclusions.raidId, ids)))
    .map(e => exclusionKey(e.raidId, e.itemId, e.recipient, e.at)) : []);
  const signed = new Set(ids.length ? (await db.select({ raidId: raidSignups.raidId, characterId: raidSignups.characterId }).from(raidSignups).where(inArray(raidSignups.raidId, ids)))
    .flatMap(x => (x.characterId ? [`${x.raidId}:${x.characterId}`] : [])) : []);

  const own = new Map<string, number>();
  const add = (id: string, n: number) => own.set(id, (own.get(id) ?? 0) + n);
  for (const l of logs) {
    for (const x of l.loot) {
      if (!countsHere(l.raidId, x, excluded)) continue;
      const list = find(x.name);
      // Même prénom pour deux persos du groupe : celui inscrit au raid
      const c = list.find(c => signed.has(`${l.raidId}:${c.id}`)) ?? list[0];
      if (c) add(c.id, 1);
    }
  }
  const corrections = await db.select({ characterId: lootCorrections.characterId, delta: lootCorrections.delta }).from(lootCorrections)
    .where(and(eq(lootCorrections.groupId, groupId), ...(since ? [gte(lootCorrections.createdAt, since)] : [])));
  for (const c of corrections) add(c.characterId, c.delta);

  const perUser = new Map<string, number>();
  for (const c of chars) perUser.set(c.userId, (perUser.get(c.userId) ?? 0) + (own.get(c.id) ?? 0));
  const rows: LootCountRow[] = chars.map(c => {
    const o = own.get(c.id) ?? 0, p = perUser.get(c.userId) ?? 0;
    return { characterId: c.id, userId: c.userId, name: c.name, realm: c.realm, cls: c.cls, owner: c.owner, isMain: c.isMain, own: o, player: p, count: s.countBy === "player" ? p : o };
  });
  const summary: LootCountSummary = { mode: s.countMode, by: s.countBy, label: lootCountLabel(s), short: lootCountShort(s), since, raids: logs.length };
  return { summary, rows };
}

/** L'objet compte-t-il (spé principale, pas exclu par un officier) ? */
export function countsHere(raidId: string, l: RaidLogLoot, excluded: Set<string>) {
  return lootSkipReason(l) === null && !excluded.has(exclusionKey(raidId, l.itemId, l.name, l.at));
}

/** Objets exclus d'un raid (clés exclusionKey). */
export async function raidExclusions(db: Db, raidId: string) {
  return new Set((await db.select().from(lootExclusions).where(eq(lootExclusions.raidId, raidId)))
    .map(e => exclusionKey(e.raidId, e.itemId, e.recipient, e.at)));
}
