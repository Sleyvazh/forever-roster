import { and, asc, eq, gt, inArray, isNull, max, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { characters, groupCharacters, groups, outings, outingSignups, raidAsks, raids, raidSignups, softReserves, users } from "../db/schema";
import { promoteMain } from "./group-characters";
import { membership, type GroupRole } from "./groups";
import { foreverGroup } from "./guild";
import { MAX_FICHES } from "./guild-links";
import { badRequest, conflict, forbidden, notFound } from "./http";
import { removeSignup, touchOuting } from "./outings";
import { touchRaid } from "./signups";

/**
 * « Donner la fiche à… » (8/11) : une fiche rangée dans une guilde de Forever passe sur le compte d'un autre membre de cette
 * guilde, par son joueur ou par un officier (pas les fiches du propriétaire de la guilde, sauf par lui). Tout la suit :
 * équipement, talents, métiers, BiS, portrait, et ses inscriptions à venir (raids, sorties, soft reserves, « Demander à ») ;
 * si le receveur est déjà inscrit à ce raid ou à cette sortie, la sienne est gardée et celle de la fiche retirée. Le passé
 * (présence, butin) reste sur la fiche. Le lien avec l'addon du donneur est oublié (addon_key) ; le GUID reste : l'addon du
 * receveur la retrouvera. Le donneur garde un main s'il lui reste un perso dans la guilde (promoteMain).
 */

type Actor = { id: string; displayName: string };
export interface UpcomingSignup { kind: "raid" | "outing"; id: string; name: string; at: string | null }

/** La fiche, rangée dans cette guilde, et le droit de la donner. */
async function giveable(db: Db, groupId: string, characterId: string, actor: Actor) {
  const myRole = await membership(db, groupId, actor.id);
  const g = await foreverGroup(db, groupId);
  const [row] = await db.select({ c: characters, isMain: groupCharacters.isMain, owner: users.displayName }).from(characters)
    .innerJoin(groupCharacters, and(eq(groupCharacters.characterId, characters.id), eq(groupCharacters.groupId, groupId)))
    .innerJoin(users, eq(users.id, characters.userId))
    .where(eq(characters.id, characterId));
  if (!row) throw notFound("Personnage introuvable.");
  if (row.c.userId !== actor.id) {
    const theirs: GroupRole | null = await membership(db, groupId, row.c.userId).catch(() => null);
    if (!theirs) throw notFound("Personnage introuvable.");
    if (myRole === "member") throw forbidden("Seuls les officiers donnent les fiches des autres membres.");
    if (theirs === "owner" && myRole !== "owner") throw forbidden("Tu ne peux pas donner les fiches du propriétaire de la guilde.");
  }
  return { ...row, g };
}

/** Inscriptions à venir faites avec cette fiche : raids pas encore commencés (ou sans date), sorties pas encore passées. */
async function upcoming(db: Pick<Db, "select">, characterId: string, now: Date) {
  const r = await db.select({ signupId: raidSignups.id, id: raids.id, name: raids.name, at: raids.scheduledAt }).from(raidSignups)
    .innerJoin(raids, eq(raids.id, raidSignups.raidId))
    .where(and(eq(raidSignups.characterId, characterId), or(isNull(raids.scheduledAt), gt(raids.scheduledAt, now))))
    .orderBy(asc(raids.scheduledAt));
  const o = await db.select({ signupId: outingSignups.id, outing: outings }).from(outingSignups)
    .innerJoin(outings, eq(outings.id, outingSignups.outingId))
    .where(and(eq(outingSignups.characterId, characterId), gt(outings.expiresAt, now)))
    .orderBy(asc(outings.day), asc(outings.scheduledAt));
  return { raids: r, outings: o };
}

/** Ce que le dialogue annonce avant de donner : les inscriptions à venir qui suivront la fiche. */
export async function givePreview(db: Db, groupId: string, characterId: string, actor: Actor, now = new Date()) {
  await giveable(db, groupId, characterId, actor);
  const u = await upcoming(db, characterId, now);
  const list: UpcomingSignup[] = [
    ...u.raids.map(r => ({ kind: "raid" as const, id: r.id, name: r.name, at: r.at?.toISOString() ?? null })),
    ...u.outings.map(o => ({ kind: "outing" as const, id: o.outing.id, name: o.outing.title, at: (o.outing.scheduledAt ?? new Date(`${o.outing.day}T12:00:00Z`)).toISOString() })),
  ];
  return { upcoming: list };
}

export async function giveFiche(db: Db, groupId: string, characterId: string, toUserId: string, actor: Actor, opts: { now?: Date; origin: string }) {
  const now = opts.now ?? new Date();
  const { c, owner } = await giveable(db, groupId, characterId, actor);
  if (toUserId === c.userId) throw badRequest(`${c.name} est déjà sur le compte de ${owner}.`);
  const theirs = await membership(db, groupId, toUserId).catch(() => null);
  if (!theirs) throw notFound("Ce joueur n'est pas membre de la guilde.");
  const [to] = await db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, toUserId));
  if (!to) throw notFound("Ce joueur n'est pas membre de la guilde.");
  if (c.guid) {
    const [same] = await db.select({ name: characters.name }).from(characters)
      .where(and(eq(characters.userId, toUserId), eq(characters.game, "forever"), eq(characters.guid, c.guid)));
    if (same) throw conflict(`${to.displayName} a déjà une fiche de ce perso (« ${same.name} »).`);
  }
  const [{ n, top }] = await db.select({ n: sql<number>`count(*)::int`, top: max(characters.sortOrder) }).from(characters)
    .where(and(eq(characters.userId, toUserId), eq(characters.game, "forever"))) as [{ n: number; top: number | null }];
  if (n >= MAX_FICHES) throw badRequest(`${to.displayName} a déjà ${MAX_FICHES} persos : la limite est atteinte.`);
  // Le perso d'une sortie que le donneur a créée : il reste dans sa sortie (le créateur ne s'en retire pas)
  const pre = await upcoming(db, c.id, now);
  const own = pre.outings.find(o => o.outing.createdBy === c.userId);
  if (own) throw conflict(`${c.name} est le perso de la sortie « ${own.outing.title} » créée par ${owner} : elle doit être annulée, ou passée, avant de donner la fiche.`);

  const from = c.userId;
  const result = await db.transaction(async tx => {
    // Fiche verrouillée, et relue : un autre don (ou un retrait de la guilde) passé entre-temps l'emporte
    const [cur] = await tx.select({ userId: characters.userId }).from(characters).where(eq(characters.id, c.id)).for("update");
    const [gc] = await tx.select({ isMain: groupCharacters.isMain }).from(groupCharacters)
      .where(and(eq(groupCharacters.groupId, groupId), eq(groupCharacters.characterId, c.id)));
    if (!cur || cur.userId !== from || !gc) throw conflict(`${c.name} vient de changer de compte ou de guilde : recharge la page.`);
    const isMain = gc.isMain;
    const [hasMain] = await tx.select({ id: groupCharacters.characterId }).from(groupCharacters)
      .where(and(eq(groupCharacters.groupId, groupId), eq(groupCharacters.userId, toUserId), eq(groupCharacters.isMain, true)));
    await tx.update(characters).set({
      userId: toUserId, addonKey: null, sortOrder: (top ?? -1) + 1, updatedAt: now,
      originKind: "given", originBy: actor.id, originByName: actor.displayName, originAt: now,
    }).where(eq(characters.id, c.id));
    await tx.update(groupCharacters).set({ userId: toUserId, isMain: !hasMain })
      .where(and(eq(groupCharacters.groupId, groupId), eq(groupCharacters.characterId, c.id)));
    if (isMain) await promoteMain(tx, groupId, from);

    // Inscriptions à venir : elles suivent la fiche, sauf là où le receveur est déjà inscrit
    const u = await upcoming(tx, c.id, now);
    const moved: string[] = [], dropped: string[] = [], touched: string[] = [];
    for (const r of u.raids) {
      const [mine] = await tx.select({ id: raidSignups.id }).from(raidSignups).where(and(eq(raidSignups.raidId, r.id), eq(raidSignups.userId, toUserId)));
      if (mine) {
        await tx.delete(raidSignups).where(eq(raidSignups.id, r.signupId));
        await tx.delete(softReserves).where(and(eq(softReserves.raidId, r.id), eq(softReserves.characterId, c.id)));
        dropped.push(r.name);
      } else {
        await tx.update(raidSignups).set({ userId: toUserId, displayName: to.displayName, updatedAt: now }).where(eq(raidSignups.id, r.signupId));
        await tx.update(softReserves).set({ userId: toUserId }).where(and(eq(softReserves.raidId, r.id), eq(softReserves.characterId, c.id)));
        moved.push(r.name);
      }
      touched.push(r.id);
    }
    // « Demander à X » pour ce perso, sur un raid à venir : au receveur
    const futureRaids = tx.select({ id: raids.id }).from(raids).where(and(eq(raids.groupId, groupId), or(isNull(raids.scheduledAt), gt(raids.scheduledAt, now))));
    await tx.update(raidAsks).set({ userId: toUserId }).where(and(eq(raidAsks.characterId, c.id), inArray(raidAsks.raidId, futureRaids)));
    const conflicts: typeof u.outings = [];
    for (const o of u.outings) {
      const [mine] = await tx.select({ id: outingSignups.id }).from(outingSignups).where(and(eq(outingSignups.outingId, o.outing.id), eq(outingSignups.userId, toUserId)));
      if (mine) { conflicts.push(o); dropped.push(o.outing.title); }
      else {
        await tx.update(outingSignups).set({ userId: toUserId, displayName: to.displayName }).where(eq(outingSignups.id, o.signupId));
        moved.push(o.outing.title);
      }
    }
    return { moved, dropped, touched, conflicts, movedOutings: u.outings.filter(o => !conflicts.includes(o)) };
  });

  // Après coup : places libérées des sorties (liste d'attente), annonces Discord à refaire
  const [g] = await db.select().from(groups).where(eq(groups.id, groupId));
  for (const o of result.conflicts) await removeSignup(db, o.outing, g!, o.signupId, opts.origin);
  for (const o of result.movedOutings) await touchOuting(db, o.outing);
  for (const id of result.touched) await touchRaid(db, id);
  return { character: c, from, fromName: owner, to, moved: result.moved, dropped: result.dropped };
}
