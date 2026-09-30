import { CLASS_NAMES, isValidSpec, roleOf, SIGNUP_STATUSES, type SignupStatus } from "@forever/game-data";
import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { characters, discordDeletions, raids, raidSignups } from "../db/schema";
import { badRequest } from "./http";
import { bus } from "./events";

/**
 * Inscriptions aux raids. Toute la logique est ici pour être partagée par le site et, plus tard,
 * par le bot Discord : mêmes règles, mêmes contrôles, quelle que soit l'origine de l'inscription.
 */

/** Signale un changement au bot Discord (l'annonce du raid sera republiée). */
export async function touchRaid(db: Db, raidId: string) {
  const [r] = await db.update(raids).set({ discordChangedAt: new Date() }).where(eq(raids.id, raidId)).returning({ g: raids.groupId });
  // Et aux pages ouvertes du site
  if (r) bus.group({ t: "raid", g: r.g, r: raidId });
}

export const signupInput = z.object({
  status: z.enum(SIGNUP_STATUSES),
  characterId: z.uuid().nullable().optional(),
  spec: z.string().trim().max(20).optional(),
  note: z.string().trim().max(100).optional(),
});
export type SignupInput = z.infer<typeof signupInput>;

/** Inscription (ou mise à jour) d'un joueur du site avec l'un de SES persos. */
export async function signUpSiteUser(db: Db, raidId: string, user: { id: string; displayName: string }, input: SignupInput) {
  let cls = "", spec = "", characterId: string | null = null;
  if (input.characterId) {
    const [ch] = await db.select({ id: characters.id, cls: characters.cls, spec1: characters.spec1 }).from(characters)
      .where(and(eq(characters.id, input.characterId), eq(characters.userId, user.id)));
    if (!ch) throw badRequest("Ce personnage n'est pas à toi.");
    if (!ch.cls) throw badRequest("Choisis d'abord la classe de ce personnage.");
    cls = ch.cls; characterId = ch.id;
    spec = input.spec ?? ch.spec1;
    if (spec && !isValidSpec(cls, spec)) throw badRequest(`La spé « ${spec} » n'existe pas pour ${cls}.`);
  } else if (input.status !== "absent") {
    throw badRequest("Choisis le personnage avec lequel tu t'inscris.");
  }
  const values = { raidId, userId: user.id, displayName: user.displayName, characterId, cls, spec, status: input.status, note: input.note ?? "", updatedAt: new Date() };
  const [row] = await db.insert(raidSignups).values(values)
    .onConflictDoUpdate({ target: [raidSignups.raidId, raidSignups.userId], set: values })
    .returning();
  await touchRaid(db, raidId);
  return row!;
}

/**
 * Inscription libre depuis Discord, sans compte sur le site : on garde l'identifiant Discord,
 * le pseudo affiché, la classe et la spé choisies dans le bot.
 */
export async function signUpDiscordGuest(db: Db, raidId: string, who: { discordUserId: string; displayName: string },
  input: { status: SignupStatus; cls?: string; spec?: string }) {
  const cls = input.cls ?? "", spec = input.spec ?? "";
  if (input.status !== "absent") {
    if (!(CLASS_NAMES as string[]).includes(cls)) throw badRequest("Choisis ta classe.");
    if (!spec || !isValidSpec(cls, spec)) throw badRequest("Choisis une spé de ta classe.");
  }
  const values = {
    raidId, userId: null, discordUserId: who.discordUserId, displayName: who.displayName.slice(0, 64) || "Joueur Discord",
    characterId: null, cls, spec, status: input.status, note: "", updatedAt: new Date(),
  };
  const [row] = await db.insert(raidSignups).values(values)
    .onConflictDoUpdate({ target: [raidSignups.raidId, raidSignups.discordUserId], set: values })
    .returning();
  await touchRaid(db, raidId);
  return row!;
}

export interface SignupView {
  id: string; userId: string | null; discordUserId: string | null; displayName: string; characterId: string | null; characterName: string | null;
  cls: string; spec: string; role: string | null; status: SignupStatus; note: string; createdAt: Date;
}

/** Inscriptions d'un raid, dans l'ordre d'arrivée (comme Raid-Helper). */
export async function listSignups(db: Db, raidId: string): Promise<SignupView[]> {
  const rows = await db.select({
    id: raidSignups.id, userId: raidSignups.userId, discordUserId: raidSignups.discordUserId, displayName: raidSignups.displayName, characterId: raidSignups.characterId,
    characterName: characters.name, cls: raidSignups.cls, spec: raidSignups.spec, status: raidSignups.status, note: raidSignups.note, createdAt: raidSignups.createdAt,
  }).from(raidSignups).leftJoin(characters, eq(characters.id, raidSignups.characterId))
    .where(eq(raidSignups.raidId, raidId)).orderBy(asc(raidSignups.createdAt));
  return rows.map(r => ({ ...r, role: r.spec ? roleOf(r.spec) : null }));
}

/** Nombre d'inscrits par statut pour une liste de raids, et le statut de l'utilisateur courant. */
export async function signupSummary(db: Db, raidIds: string[], userId: string) {
  if (!raidIds.length) return new Map<string, { counts: Partial<Record<SignupStatus, number>>; mine: SignupStatus | null }>();
  const rows = await db.select({ raidId: raidSignups.raidId, status: raidSignups.status, n: sql<number>`count(*)::int`, mine: sql<boolean>`bool_or(${raidSignups.userId} = ${userId})` })
    .from(raidSignups).where(inArray(raidSignups.raidId, raidIds)).groupBy(raidSignups.raidId, raidSignups.status);
  const out = new Map<string, { counts: Partial<Record<SignupStatus, number>>; mine: SignupStatus | null }>();
  for (const r of rows) {
    const e = out.get(r.raidId) ?? { counts: {}, mine: null };
    e.counts[r.status] = r.n;
    if (r.mine) e.mine = r.status;
    out.set(r.raidId, e);
  }
  return out;
}

/** Retire les inscriptions d'un joueur aux raids d'un groupe (il a quitté le groupe ou en a été retiré). */
export async function dropSignupsInGroup(db: Db, groupId: string, userId: string) {
  const groupRaids = db.select({ id: raids.id }).from(raids).where(eq(raids.groupId, groupId));
  await db.delete(raidSignups).where(and(eq(raidSignups.userId, userId), inArray(raidSignups.raidId, groupRaids)));
  await db.update(raids).set({ discordChangedAt: new Date() }).where(eq(raids.groupId, groupId));
  bus.group({ t: "raids", g: groupId });
}

/**
 * Met en file de suppression les annonces Discord déjà publiées pour les raids d'un groupe
 * (salon délié, changé ou groupe supprimé) : le bot les efface, pour ne pas laisser de boutons morts.
 * Avec `keepChannelId`, les annonces déjà dans ce salon sont conservées.
 */
export async function retireAnnouncements(db: Db, groupId: string, keepChannelId?: string) {
  const where = and(eq(raids.groupId, groupId), isNotNull(raids.discordMessageId), isNotNull(raids.discordChannelId),
    keepChannelId ? ne(raids.discordChannelId, keepChannelId) : undefined);
  const rows = await db.select({ id: raids.id, channelId: raids.discordChannelId, messageId: raids.discordMessageId }).from(raids).where(where);
  if (!rows.length) return;
  await db.insert(discordDeletions).values(rows.map(r => ({ channelId: r.channelId!, messageId: r.messageId! })));
  await db.update(raids).set({ discordChannelId: null, discordMessageId: null, discordSyncedAt: null }).where(inArray(raids.id, rows.map(r => r.id)));
}
