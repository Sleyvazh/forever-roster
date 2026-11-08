import { matchFiches, type FicheLevelLock, type FicheMatchBy } from "@forever/game-data";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { characters, gameGuilds, groupCharacters, guildMembers, users } from "../db/schema";

/**
 * Niveau des fiches relevé en jeu (Forever, 7/11 : Necko s'était mis 60 à la main). Une fiche rangée dans une guilde liée
 * au jeu, rapprochée d'un perso de la liste de guilde (game-data matchFiches : GUID de l'addon, nom complet, prénom
 * unique), prend son niveau à chaque relevé et son joueur ne le change plus. Une fiche introuvable peut avoir un niveau
 * fixé par un officier (characters.level_fixed_by). Rien n'est recopié pour le rapprochement : il se recalcule à chaque
 * lecture, à partir de la liste du jeu et des fiches.
 */

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;
type MemberRow = typeof guildMembers.$inferSelect;
export interface GameMatch { member: MemberRow; by: FicheMatchBy }

export interface RangedFiche { id: string; userId: string; name: string; guid: string | null; race: string; isMain: boolean; syncedAt: Date | null }

/**
 * Fiches de la guilde (Forever) rapprochées de la liste du jeu, et l'heure de la liste la plus récente. `fiches` : les fiches
 * rangées dans la guilde (pour le rattachement des persos du jeu à leur compte, lib/guild.ts). `active` : persos actuels de
 * la liste, s'ils sont déjà lus.
 */
export async function guildFicheMatches(db: Tx, groupId: string, active?: readonly MemberRow[]) {
  const [gg] = await db.select({ rosterAt: gameGuilds.rosterAt }).from(gameGuilds).where(eq(gameGuilds.groupId, groupId));
  const matches = new Map<string, GameMatch>();
  const fiches = new Map<string, RangedFiche>();
  if (!gg) return { matches, fiches, rosterAt: null as Date | null };
  const members = active ?? await db.select().from(guildMembers).where(and(eq(guildMembers.groupId, groupId), isNull(guildMembers.leftAt)));
  if (!members.length) return { matches, fiches, rosterAt: gg.rosterAt };
  const rows = await db.select({
    id: characters.id, userId: characters.userId, name: characters.name, guid: characters.guid, race: characters.race, isMain: groupCharacters.isMain, syncedAt: characters.addonSyncedAt,
  }).from(groupCharacters).innerJoin(characters, eq(characters.id, groupCharacters.characterId))
    .where(and(eq(groupCharacters.groupId, groupId), eq(characters.game, "forever")));
  for (const f of rows) fiches.set(f.id, f);
  // GUID déjà pris par l'addon d'une fiche (rangée ici ou non) : le perso est à ce compte
  const claimedRows = await db.select({ guid: characters.guid, userId: characters.userId, at: characters.addonSyncedAt }).from(characters)
    .where(and(eq(characters.game, "forever"), inArray(characters.guid, members.map(m => m.guid))));
  const claimed = new Map<string, string>();
  for (const r of claimedRows.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))) if (r.guid) claimed.set(r.guid, r.userId);
  const byGuid = new Map(members.map(m => [m.guid, m]));
  for (const [id, m] of matchFiches(rows, members, claimed)) matches.set(id, { member: byGuid.get(m.guid)!, by: m.by });
  return { matches, fiches, rosterAt: gg.rosterAt };
}

/**
 * Le jeu reprend la main : chaque fiche rapprochée prend le niveau de la liste (et perd un niveau fixé par un officier),
 * sauf si l'addon de son joueur a lu ce perso (même GUID) après le niveau de la liste (guild_members.level_at), plus haut :
 * c'est le jeu aussi, en plus récent (levelSyncedAt, posé seulement par l'import de l'addon, effacé dès que la fiche prend
 * le niveau de la liste). Rend le nombre de fiches changées. Les fiches sont verrouillées le temps de la mise à jour (une
 * modification de la fiche attend, puis voit le nouveau niveau).
 */
export async function syncFicheLevels(db: Tx, groupId: string) {
  const { matches, rosterAt } = await guildFicheMatches(db, groupId);
  if (!matches.size) return 0;
  const rows = await db.select({ id: characters.id, level: characters.level, syncedAt: characters.levelSyncedAt, fixedBy: characters.levelFixedBy })
    .from(characters).where(inArray(characters.id, [...matches.keys()])).for("update");
  let n = 0;
  for (const r of rows) {
    const m = matches.get(r.id)!, lv = m.member.level;
    // Un niveau posé à la main ou fixé par un officier après l'envoi de l'addon efface levelSyncedAt : ce n'est plus celui du jeu
    const listAt = m.member.levelAt ?? rosterAt;
    const addonNewer = m.by === "addon" && !r.fixedBy && !!r.syncedAt && !!listAt && r.syncedAt.getTime() > listAt.getTime() && r.level > lv;
    const move = !addonNewer && r.level !== lv;
    if (!move && !r.fixedBy) continue;
    // Le niveau vient alors de la liste, plus de l'addon : levelSyncedAt effacé (sinon un niveau plus haut resterait « plus récent »)
    await db.update(characters).set({ ...(move && { level: lv, levelSyncedAt: null }), levelFixedBy: null, levelFixedAt: null, updatedAt: new Date() }).where(eq(characters.id, r.id));
    if (move) n++;
  }
  return n;
}

/**
 * Verrou du niveau de chaque fiche (null : le joueur le change librement). Le jeu passe avant l'officier : une fiche
 * rapprochée suit la liste, même si un officier avait fixé son niveau avant le relevé.
 */
export async function levelLocks(db: Tx, fiches: readonly { id: string; groupId: string | null; levelFixedBy: string | null; levelFixedAt: Date | null }[]) {
  const out = new Map<string, FicheLevelLock>();
  const groupIds = [...new Set(fiches.flatMap(f => (f.groupId ? [f.groupId] : [])))];
  const byGroup = new Map<string, Awaited<ReturnType<typeof guildFicheMatches>>>();
  for (const g of groupIds) byGroup.set(g, await guildFicheMatches(db, g));
  const officerIds = [...new Set(fiches.flatMap(f => (f.levelFixedBy ? [f.levelFixedBy] : [])))];
  const names = officerIds.length
    ? new Map((await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, officerIds))).map(u => [u.id, u.name]))
    : new Map<string, string>();
  for (const f of fiches) {
    const g = f.groupId ? byGroup.get(f.groupId) : undefined;
    const m = g?.matches.get(f.id);
    if (m) out.set(f.id, { by: "game", name: m.member.name, level: m.member.level, at: g!.rosterAt?.toISOString() ?? null });
    // Fixé par un officier de la guilde où la fiche est rangée : ne vaut plus hors de toute guilde
    else if (f.levelFixedBy && f.groupId) out.set(f.id, { by: "officer", name: names.get(f.levelFixedBy) ?? "?", userId: f.levelFixedBy, at: f.levelFixedAt?.toISOString() ?? null });
  }
  return out;
}

/** Verrou d'une seule fiche (sa guilde lue d'abord). */
export async function levelLockOf(db: Tx, c: { id: string; levelFixedBy: string | null; levelFixedAt: Date | null }) {
  const [gc] = await db.select({ groupId: groupCharacters.groupId }).from(groupCharacters).where(eq(groupCharacters.characterId, c.id));
  return (await levelLocks(db, [{ ...c, groupId: gc?.groupId ?? null }])).get(c.id) ?? null;
}
