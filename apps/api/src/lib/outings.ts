import {
  addDays, CLASS_SPECS, classRoles, dayKeyOf, dungeonByKey, FOREVER_DUNGEONS, hasDungeonLevel, isValidSpec, levelsText, MAX_OPEN_OUTINGS_PER_PLAYER, MAX_OUTINGS_PER_GROUP,
  OTHER_DUNGEON, OUTING_NOTE_MAX, OUTING_ROLES, outingDays, outingExpiry, placesOf, specDef, specForRole, validPlaces, type OutingPlaces, type Role,
} from "@forever/game-data";
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  characters, discordDeletions, groups, outingNotices, outings, outingSignups, users,
  type Creators, type OutingNoticeKind, type OutingNoticePayload,
} from "../db/schema";
import { bus } from "./events";
import { fullNames } from "./guild";
import { ensureInGroup } from "./group-characters";
import type { GroupRole } from "./groups";
import { badRequest, conflict, forbidden, notFound } from "./http";
import { canDm } from "./reach";

/**
 * Sorties donjon (Forever, cahier des charges §3) : toute la logique est ici, partagée par le site et le bot (mêmes
 * règles quelle que soit l'origine). Une sortie a 5 places par rôle (1/1/3 par défaut), premier arrivé premier servi ;
 * complète, on passe en liste d'attente, et la place libérée va au premier en attente pour ce rôle (MP).
 * Une sortie disparaît à `expires_at` (2 h après son heure, ou fin de son jour) : toutes les lectures filtrent dessus.
 */

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;
export type OutingRow = typeof outings.$inferSelect;
type SignupRow = typeof outingSignups.$inferSelect;
type GroupRow = typeof groups.$inferSelect;

export const ROLE_FR: Record<Role, string> = { Tank: "tank", Heal: "heal", DPS: "DPS" };
export const placesOfRow = (o: Pick<OutingRow, "tanks" | "heals" | "dps">): OutingPlaces => ({ tank: o.tanks, heal: o.heals, dps: o.dps });
const live = (now = new Date()) => gt(outings.expiresAt, now);

/** Peut créer (raids ou sorties) selon le réglage du groupe : officiers (et chef) seulement, ou tous les membres. */
export const mayCreate = (setting: Creators, role: GroupRole | null) => !!role && (setting === "members" || role !== "member");

/** Les sorties sont propres à Forever (masquées sur Roster). */
export function assertForever(g: Pick<GroupRow, "game">) {
  if (g.game !== "forever") throw badRequest("Les sorties donjon sont pour WoW Forever.");
}

/** Sortie encore en vie (d'un groupe donné, si précisé) avec son groupe ; sinon 404. */
export async function loadOuting(db: Tx, outingId: string, groupId?: string) {
  const [r] = await db.select({ outing: outings, group: groups }).from(outings).innerJoin(groups, eq(groups.id, outings.groupId))
    .where(and(eq(outings.id, outingId), live(), groupId ? eq(outings.groupId, groupId) : undefined));
  if (!r) throw notFound("Cette sortie n'existe plus (annulée, ou passée depuis plus de 2 h).");
  return r;
}

/** Inscrits (dans l'ordre d'arrivée) et liste d'attente (dans son ordre). */
export async function signupsOf(db: Tx, outingIds: string[]) {
  if (!outingIds.length) return new Map<string, { placed: SignupRow[]; waiting: SignupRow[] }>();
  const rows = await db.select().from(outingSignups).where(inArray(outingSignups.outingId, outingIds))
    .orderBy(asc(outingSignups.createdAt), asc(outingSignups.id));
  const out = new Map<string, { placed: SignupRow[]; waiting: SignupRow[] }>();
  for (const id of outingIds) out.set(id, { placed: [], waiting: [] });
  for (const r of rows) (r.waitingSince ? out.get(r.outingId)!.waiting : out.get(r.outingId)!.placed).push(r);
  for (const e of out.values()) e.waiting.sort((a, b) => a.waitingSince!.getTime() - b.waitingSince!.getTime() || a.id.localeCompare(b.id));
  return out;
}

const isFull = (o: OutingRow, placed: SignupRow[]) => placed.length >= o.tanks + o.heals + o.dps;
/** Nom affiché d'un inscrit : son perso, ou son pseudo Discord (sans compte). */
export const signupName = (s: Pick<SignupRow, "characterName" | "displayName">) => s.characterName || s.displayName;

/* ---------- Validation des entrées ---------- */

export interface OutingWhen { day: string; at: Date | null }
/**
 * Jour et heure d'une sortie : aujourd'hui ou demain (heure de Paris), rien au-delà de demain 23:59, et pas une heure
 * déjà passée. `at` doit tomber le jour annoncé.
 */
export function checkWhen(day: string, atIso: string | null, now = new Date()): OutingWhen {
  const { today, tomorrow } = outingDays(now);
  if (day !== today && day !== tomorrow) throw badRequest("Une sortie, c'est pour aujourd'hui ou demain.");
  if (!atIso) return { day, at: null };
  const at = new Date(atIso);
  if (Number.isNaN(at.getTime())) throw badRequest("Heure invalide.");
  if (dayKeyOf(at) !== day) throw badRequest(day === today ? "Cette heure n'est pas aujourd'hui." : "Cette heure n'est pas demain.");
  if (at.getTime() < now.getTime() - 60e3) throw badRequest("Cette heure est déjà passée : choisis une heure à venir, ou demain.");
  return { day, at };
}

/** Donjon (clé de FOREVER_DUNGEONS) ou « Autre » avec un titre libre. */
export function checkDungeon(key: string, title?: string | null) {
  if (key === OTHER_DUNGEON) {
    const t = (title ?? "").replace(/[;|\r\n]/g, " ").replace(/\s+/g, " ").trim();
    if (t.length < 2) throw badRequest("Donne un titre à la sortie (ex. « Élite de la Vallée »).");
    if (t.length > 40) throw badRequest("Titre trop long (40 caractères au plus).");
    return { dungeon: OTHER_DUNGEON, title: t, minLevel: null, maxLevel: null };
  }
  const d = dungeonByKey(key);
  if (!d) throw badRequest("Donjon inconnu.");
  return { dungeon: d.key, title: d.name, minLevel: d.min, maxLevel: d.max };
}

const cleanNote = (note: string | undefined) => {
  const n = (note ?? "").replace(/[\r\n]+/g, " ").trim();
  if (n.length > OUTING_NOTE_MAX) throw badRequest(`Note trop longue (${OUTING_NOTE_MAX} caractères au plus).`);
  return n;
};

const range = (o: { minLevel: number | null; maxLevel: number | null }) => (o.minLevel && o.maxLevel ? { min: o.minLevel, max: o.maxLevel } : null);

/**
 * Perso d'un joueur pour une sortie : le sien, de Forever, avec une classe, au niveau du donjon, et qui peut tenir le
 * rôle (sa classe a une spé de ce rôle). Rangé dans ce groupe (ou y entre s'il n'en a aucun, comme pour les raids).
 */
async function pickCharacter(db: Tx, groupId: string, userId: string, characterId: string, role: Role, o: { minLevel: number | null; maxLevel: number | null; title: string }, spec?: string) {
  const [c] = await db.select({ id: characters.id, name: characters.name, cls: characters.cls, spec1: characters.spec1, spec2: characters.spec2, level: characters.level, game: characters.game })
    .from(characters).where(and(eq(characters.id, characterId), eq(characters.userId, userId)));
  if (!c) throw badRequest("Ce personnage n'est pas à toi.");
  if (c.game !== "forever") throw badRequest("Ce perso n'est pas de WoW Forever.");
  if (!c.cls) throw badRequest("Choisis d'abord la classe de ce personnage.");
  const r = range(o);
  if (r && !hasDungeonLevel(r, c.level)) throw badRequest(`${c.name} (niveau ${c.level}) n'a pas le niveau de ${o.title} (${levelsText(r.min, r.max)}).`);
  if (!classRoles(c.cls).includes(role)) throw badRequest(`${c.name} ne peut pas jouer ${ROLE_FR[role]}.`);
  const sp = spec && specDef(c.cls, spec)?.role === role ? spec : specForRole(c, role);
  if (await ensureInGroup(db, groupId, c.id, userId)) bus.group({ t: "chars", g: groupId });
  return { id: c.id, name: c.name, cls: c.cls, spec: sp };
}

/* ---------- Avis en MP (file lue par le bot) ---------- */

/** Discord à qui écrire pour chaque inscrit : son compte (Discord lié, MP gardés), ou son Discord (sans compte). */
async function reachable(db: Tx, entries: SignupRow[]) {
  const ids = [...new Set(entries.flatMap(e => (e.userId ? [e.userId] : [])))];
  const us = ids.length ? await db.select({ id: users.id, discordId: users.discordId, reminders: users.discordReminders }).from(users).where(inArray(users.id, ids)) : [];
  const byUser = new Map(us.map(u => [u.id, u]));
  return (e: SignupRow) => {
    if (!e.userId) return e.discordUserId;
    const u = byUser.get(e.userId);
    return u && canDm(u) ? u.discordId : null;
  };
}

export function noticePayload(o: OutingRow, g: GroupRow, origin: string): OutingNoticePayload {
  return {
    outingId: o.id, groupName: g.name, title: o.title, levels: levelsText(o.minLevel, o.maxLevel), day: o.day, at: o.scheduledAt?.toISOString() ?? null,
    url: `${origin}/groups/${g.id}/sorties`, creator: o.creatorName,
  };
}

async function notify(db: Tx, kind: OutingNoticeKind, entries: SignupRow[], payload: (e: SignupRow) => OutingNoticePayload) {
  const to = await reachable(db, entries);
  const rows = entries.flatMap(e => { const d = to(e); return d ? [{ discordUserId: d, kind, payload: payload(e) }] : []; });
  if (rows.length) await db.insert(outingNotices).values(rows);
  return rows.length;
}

/** MP au créateur quand la sortie devient complète (une fois par sortie). */
async function notifyFull(db: Tx, o: OutingRow, g: GroupRow, origin: string, actorUserId: string | null) {
  if (o.fullNotifiedAt) return;
  const { placed, waiting } = (await signupsOf(db, [o.id])).get(o.id)!;
  if (!isFull(o, placed)) return;
  const [claimed] = await db.update(outings).set({ fullNotifiedAt: new Date() }).where(and(eq(outings.id, o.id), isNull(outings.fullNotifiedAt))).returning({ id: outings.id });
  if (!claimed || !o.createdBy || o.createdBy === actorUserId) return;
  const creator = placed.find(s => s.userId === o.createdBy);
  const [u] = await db.select({ discordId: users.discordId, reminders: users.discordReminders }).from(users).where(eq(users.id, o.createdBy));
  if (!u || !canDm(u)) return;
  await db.insert(outingNotices).values({ discordUserId: u.discordId!, kind: "full", payload: { ...noticePayload(o, g, origin), isCreator: true, count: placed.length, waiting: waiting.length, role: creator?.role } });
}

/* ---------- Liste d'attente ---------- */

/** Places libres d'un rôle → premiers en attente pour ce rôle (MP « une place s'est libérée »). */
async function promote(db: Tx, o: OutingRow, g: GroupRow, origin: string) {
  const { placed, waiting } = (await signupsOf(db, [o.id])).get(o.id)!;
  const promoted: SignupRow[] = [];
  for (const role of OUTING_ROLES) {
    let free = placesOf(placesOfRow(o), role) - placed.filter(s => s.role === role).length;
    for (const w of waiting.filter(x => x.role === role)) {
      if (free <= 0) break;
      await db.update(outingSignups).set({ waitingSince: null }).where(eq(outingSignups.id, w.id));
      promoted.push(w); free--;
    }
  }
  if (promoted.length) {
    const base = noticePayload(o, g, origin);
    await notify(db, "promoted", promoted, e => ({ ...base, role: e.role, character: signupName(e) }));
  }
  return promoted;
}

/** Verrou de la sortie le temps d'une opération (deux clics simultanés ne se marchent pas dessus). */
const lockOuting = (tx: Tx, id: string) => tx.select({ id: outings.id }).from(outings).where(eq(outings.id, id)).for("update");

/** L'annonce Discord est à republier, et les pages ouvertes à recharger. */
export async function touchOuting(db: Tx, o: Pick<OutingRow, "id" | "groupId">) {
  await db.update(outings).set({ discordChangedAt: new Date(), updatedAt: new Date() }).where(eq(outings.id, o.id));
  bus.group({ t: "outings", g: o.groupId });
}

/* ---------- Inscription ---------- */

export type Who =
  | { kind: "user"; id: string; displayName: string }
  | { kind: "guest"; discordUserId: string; displayName: string };
export interface JoinInput { role: Role; characterId?: string | null; cls?: string; spec?: string; wait?: boolean }
export interface JoinResult { state: "in" | "waiting"; role: Role; name: string; position: number | null }

const whoIs = (w: Who) => (w.kind === "user" ? eq(outingSignups.userId, w.id) : and(eq(outingSignups.discordUserId, w.discordUserId), isNull(outingSignups.userId)));

/**
 * S'inscrire (ou changer de rôle / de perso) : une place libre dans le rôle, sinon la liste d'attente si `wait`.
 * La sortie est verrouillée le temps de l'opération : deux clics simultanés ne prennent jamais la même dernière place.
 */
export async function joinOuting(db: Db, outingId: string, who: Who, input: JoinInput, origin: string): Promise<JoinResult> {
  const res = await db.transaction(async tx => {
    const [o] = await tx.select().from(outings).where(and(eq(outings.id, outingId), live())).for("update");
    if (!o) throw notFound("Cette sortie n'existe plus (annulée, ou passée depuis plus de 2 h).");
    const [g] = await tx.select().from(groups).where(eq(groups.id, o.groupId));
    const role = input.role;
    let ch: { id: string | null; name: string; cls: string; spec: string };
    if (who.kind === "user") {
      if (!input.characterId) throw badRequest("Choisis le perso avec lequel tu viens.");
      ch = await pickCharacter(tx, o.groupId, who.id, input.characterId, role, o, input.spec);
    } else {
      const cls = input.cls ?? "", spec = input.spec ?? "";
      if (!(cls in CLASS_SPECS)) throw badRequest("Choisis ta classe.");
      if (!spec || !isValidSpec(cls, spec)) throw badRequest("Choisis une spé de ta classe.");
      if (specDef(cls, spec)?.role !== role) throw badRequest(`Cette spé ne joue pas ${ROLE_FR[role]}.`);
      ch = { id: null, name: "", cls, spec };
    }
    if (placesOf(placesOfRow(o), role) < 1) throw badRequest(`Cette sortie n'a pas de place en ${ROLE_FR[role]}.`);
    const { placed, waiting } = (await signupsOf(tx, [o.id])).get(o.id)!;
    const mine = [...placed, ...waiting].find(s => (who.kind === "user" ? s.userId === who.id : s.discordUserId === who.discordUserId && !s.userId));
    const taken = placed.filter(s => s.role === role && s.id !== mine?.id).length;
    const free = taken < placesOf(placesOfRow(o), role);
    if (!free && !input.wait) throw conflict(`Plus de place en ${ROLE_FR[role]} : mets-toi en attente.`);
    // Le créateur garde toujours une place dans sa sortie
    if (!free && who.kind === "user" && o.createdBy === who.id) throw conflict(`Plus de place en ${ROLE_FR[role]}.`);
    // En attente : on garde sa place dans la file s'il y était déjà pour ce rôle
    const waitingSince = free ? null : mine?.waitingSince && mine.role === role ? mine.waitingSince : new Date();
    const values = {
      outingId: o.id, userId: who.kind === "user" ? who.id : null, discordUserId: who.kind === "guest" ? who.discordUserId : null,
      displayName: who.displayName.slice(0, 64) || "Joueur Discord", characterId: ch.id, characterName: ch.name, cls: ch.cls, spec: ch.spec, role, waitingSince,
    };
    if (mine) await tx.update(outingSignups).set(values).where(eq(outingSignups.id, mine.id));
    else await tx.insert(outingSignups).values(values);
    // Il quitte une place (autre rôle, ou passe en attente) : elle va au premier en attente
    if (mine && !mine.waitingSince && (mine.role !== role || waitingSince)) await promote(tx, o, g!, origin);
    if (!waitingSince) await notifyFull(tx, o, g!, origin, who.kind === "user" ? who.id : null);
    const after = (await signupsOf(tx, [o.id])).get(o.id)!;
    const me = [...after.placed, ...after.waiting].find(s => (who.kind === "user" ? s.userId === who.id : s.discordUserId === who.discordUserId && !s.userId))!;
    await tx.update(outings).set({ discordChangedAt: new Date(), updatedAt: new Date() }).where(eq(outings.id, o.id));
    return {
      groupId: o.groupId,
      result: { state: me.waitingSince ? "waiting" as const : "in" as const, role, name: signupName(me), position: me.waitingSince ? after.waiting.findIndex(s => s.id === me.id) + 1 : null },
    };
  });
  bus.group({ t: "outings", g: res.groupId });
  return res.result;
}

/** Se retirer (inscrit ou en attente) ; le créateur ne se retire pas de sa sortie : il l'annule. */
export async function leaveOuting(db: Db, outingId: string, who: Who, origin: string) {
  const groupId = await db.transaction(async tx => {
    const [o] = await tx.select().from(outings).where(and(eq(outings.id, outingId), live())).for("update");
    if (!o) throw notFound("Cette sortie n'existe plus (annulée, ou passée depuis plus de 2 h).");
    if (who.kind === "user" && o.createdBy === who.id) throw badRequest("Tu as créé cette sortie : annule-la plutôt (sur le site).");
    const [gone] = await tx.delete(outingSignups).where(and(eq(outingSignups.outingId, o.id), whoIs(who))).returning();
    if (!gone) return null;
    const [g] = await tx.select().from(groups).where(eq(groups.id, o.groupId));
    if (!gone.waitingSince) await promote(tx, o, g!, origin);
    await tx.update(outings).set({ discordChangedAt: new Date(), updatedAt: new Date() }).where(eq(outings.id, o.id));
    return o.groupId;
  });
  if (groupId) bus.group({ t: "outings", g: groupId });
  return !!groupId;
}

/** Créateur ou officier : retirer un inscrit (ou quelqu'un de la liste d'attente). */
export async function removeSignup(db: Db, o: OutingRow, g: GroupRow, signupId: string, origin: string) {
  await db.transaction(async tx => {
    await lockOuting(tx, o.id);
    const [cur] = await tx.select().from(outingSignups).where(and(eq(outingSignups.id, signupId), eq(outingSignups.outingId, o.id)));
    if (!cur) throw notFound("Inscription introuvable.");
    if (cur.userId && cur.userId === o.createdBy) throw badRequest("Le créateur reste dans sa sortie : annule-la plutôt.");
    await tx.delete(outingSignups).where(eq(outingSignups.id, cur.id));
    if (!cur.waitingSince) await promote(tx, o, g, origin);
  });
  await touchOuting(db, o);
}

/** Le joueur quitte le groupe (ou en est retiré) : ses inscriptions aux sorties du groupe partent, sauf dans les siennes. */
export async function dropOutingSignups(db: Db, groupId: string, userId: string, origin: string) {
  const rows = await db.select({ outing: outings, signupId: outingSignups.id }).from(outingSignups).innerJoin(outings, eq(outings.id, outingSignups.outingId))
    .where(and(eq(outings.groupId, groupId), eq(outingSignups.userId, userId), live(), or(isNull(outings.createdBy), ne(outings.createdBy, userId))));
  if (!rows.length) return;
  const [g] = await db.select().from(groups).where(eq(groups.id, groupId));
  for (const r of rows) await removeSignup(db, r.outing, g!, r.signupId, origin);
}

/* ---------- Création et gestion ---------- */

export interface CreateInput {
  dungeon: string; title?: string | null; day: string; at: string | null; note?: string;
  places?: OutingPlaces; characterId: string; role: Role;
}

/** Sorties ouvertes d'un joueur (créées par lui) dans le groupe, et du groupe. */
export async function openCounts(db: Tx, groupId: string, userId: string) {
  const [mine] = await db.select({ n: count() }).from(outings).where(and(eq(outings.groupId, groupId), eq(outings.createdBy, userId), live()));
  const [all] = await db.select({ n: count() }).from(outings).where(and(eq(outings.groupId, groupId), live()));
  return { mine: mine?.n ?? 0, group: all?.n ?? 0 };
}

export async function createOuting(db: Db, g: GroupRow, role: GroupRole | null, user: { id: string; displayName: string }, input: CreateInput) {
  assertForever(g);
  if (!mayCreate(g.outingCreators, role)) throw forbidden("Seuls les officiers du groupe peuvent créer une sortie.");
  const when = checkWhen(input.day, input.at);
  const d = checkDungeon(input.dungeon, input.title);
  const places = input.places ?? { tank: 1, heal: 1, dps: 3 };
  if (!validPlaces(places)) throw badRequest("Places invalides : 5 en tout.");
  if (placesOf(places, input.role) < 1) throw badRequest(`Garde au moins une place en ${ROLE_FR[input.role]} : c'est la tienne.`);
  const note = cleanNote(input.note);
  const id = await db.transaction(async tx => {
    // Verrou du groupe : deux créations simultanées ne dépassent pas les limites
    await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, g.id)).for("update");
    const n = await openCounts(tx, g.id, user.id);
    if (n.mine >= MAX_OPEN_OUTINGS_PER_PLAYER) throw badRequest(`Tu as déjà ${MAX_OPEN_OUTINGS_PER_PLAYER} sorties ouvertes : attends qu'elles soient passées, ou annules-en une.`);
    if (n.group >= MAX_OUTINGS_PER_GROUP) throw badRequest(`Le groupe a déjà ${MAX_OUTINGS_PER_GROUP} sorties ouvertes.`);
    const ch = await pickCharacter(tx, g.id, user.id, input.characterId, input.role, d);
    const [o] = await tx.insert(outings).values({
      groupId: g.id, ...d, day: when.day, scheduledAt: when.at, expiresAt: outingExpiry(when.at, when.day),
      tanks: places.tank, heals: places.heal, dps: places.dps, note, createdBy: user.id, creatorName: ch.name,
    }).returning();
    await tx.insert(outingSignups).values({
      outingId: o!.id, userId: user.id, displayName: user.displayName, characterId: ch.id, characterName: ch.name, cls: ch.cls, spec: ch.spec, role: input.role,
    });
    return o!.id;
  });
  bus.group({ t: "outings", g: g.id });
  return id;
}

/** Modifier ou annuler : le créateur et les officiers. */
export const canManage = (o: Pick<OutingRow, "createdBy">, userId: string, role: GroupRole | null) => o.createdBy === userId || (!!role && role !== "member");

/** Places (le DPS se déduit) et note. Un rôle ne descend pas sous ses inscrits ; une place en plus va au premier en attente. */
export async function updateOuting(db: Db, o: OutingRow, g: GroupRow, input: { places?: OutingPlaces; note?: string }, origin: string, actorUserId: string) {
  const places = input.places ?? placesOfRow(o);
  if (!validPlaces(places)) throw badRequest("Places invalides : 5 en tout.");
  const { placed } = (await signupsOf(db, [o.id])).get(o.id)!;
  for (const role of OUTING_ROLES) {
    const n = placed.filter(s => s.role === role).length;
    if (n > placesOf(places, role)) throw badRequest(`Il y a ${n} inscrit${n > 1 ? "s" : ""} en ${ROLE_FR[role]} : retire-en avant de passer à ${placesOf(places, role)} place${placesOf(places, role) > 1 ? "s" : ""}.`);
  }
  const note = input.note === undefined ? o.note : cleanNote(input.note);
  await db.transaction(async tx => {
    await lockOuting(tx, o.id);
    const [next] = await tx.update(outings).set({ tanks: places.tank, heals: places.heal, dps: places.dps, note, discordChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(outings.id, o.id)).returning();
    await promote(tx, next!, g, origin);
    await notifyFull(tx, next!, g, origin, actorUserId);
  });
  bus.group({ t: "outings", g: o.groupId });
}

/** Changer l'heure : les inscrits restent et sont prévenus (ancienne et nouvelle heure) ; le rappel de 15 min repart. */
export async function moveOuting(db: Db, o: OutingRow, g: GroupRow, input: { day: string; at: string | null }, origin: string, actor: Who) {
  const when = checkWhen(input.day, input.at);
  if (when.day === o.day && (when.at?.getTime() ?? null) === (o.scheduledAt?.getTime() ?? null)) return;
  await db.transaction(async tx => {
    await lockOuting(tx, o.id);
    const [next] = await tx.update(outings).set({
      day: when.day, scheduledAt: when.at, expiresAt: outingExpiry(when.at, when.day), soonNotifiedAt: null, discordChangedAt: new Date(), updatedAt: new Date(),
    }).where(eq(outings.id, o.id)).returning();
    const { placed, waiting } = (await signupsOf(tx, [o.id])).get(o.id)!;
    const base = { ...noticePayload(next!, g, origin), oldDay: o.day, oldAt: o.scheduledAt?.toISOString() ?? null };
    await notify(tx, "moved", [...placed, ...waiting].filter(s => !sameWho(s, actor)), e => ({ ...base, role: e.role, isCreator: !!e.userId && e.userId === o.createdBy }));
  });
  bus.group({ t: "outings", g: o.groupId });
}

const sameWho = (s: SignupRow, w: Who) => (w.kind === "user" ? s.userId === w.id : !s.userId && s.discordUserId === w.discordUserId);

/** Annuler : inscrits et liste d'attente prévenus en MP, message Discord effacé, sortie supprimée. */
export async function cancelOuting(db: Db, o: OutingRow, g: GroupRow, origin: string, actor: Who) {
  await db.transaction(async tx => {
    await lockOuting(tx, o.id);
    const { placed, waiting } = (await signupsOf(tx, [o.id])).get(o.id)!;
    const base = noticePayload(o, g, origin);
    await notify(tx, "cancelled", [...placed, ...waiting].filter(s => !sameWho(s, actor)), e => ({ ...base, role: e.role }));
    if (o.discordChannelId && o.discordMessageId) await tx.insert(discordDeletions).values({ channelId: o.discordChannelId, messageId: o.discordMessageId });
    await tx.delete(outings).where(eq(outings.id, o.id));
  });
  bus.group({ t: "outings", g: o.groupId });
}

/* ---------- Discord : salon effectif, messages à effacer ---------- */

/** Salon où vont les sorties du groupe : le salon des sorties, sinon celui du groupe (null : aucun). */
export const outingsChannelOf = (g: Pick<GroupRow, "outingsChannelId" | "discordChannelId">) => g.outingsChannelId ?? g.discordChannelId;
export const OUTINGS_CHANNEL = sql<string | null>`coalesce(${groups.outingsChannelId}, ${groups.discordChannelId})`;

/**
 * Messages de sorties à effacer : ceux qui ne sont plus dans le salon effectif du groupe (salon changé ou délié), ou tous
 * (groupe supprimé). Ils seront republiés au bon endroit. À appeler après avoir changé un salon.
 */
export async function retireOutingMessages(db: Tx, groupId: string, opts: { all?: boolean } = {}) {
  const rows = await db.select({ id: outings.id, channelId: outings.discordChannelId, messageId: outings.discordMessageId }).from(outings)
    .innerJoin(groups, eq(groups.id, outings.groupId))
    .where(and(eq(outings.groupId, groupId), isNotNull(outings.discordMessageId), isNotNull(outings.discordChannelId),
      opts.all ? undefined : sql`${outings.discordChannelId} IS DISTINCT FROM ${OUTINGS_CHANNEL}`));
  if (!rows.length) return;
  await db.insert(discordDeletions).values(rows.map(r => ({ channelId: r.channelId!, messageId: r.messageId! })));
  await db.update(outings).set({ discordChannelId: null, discordMessageId: null, discordSyncedAt: null, discordChangedAt: new Date() })
    .where(inArray(outings.id, rows.map(r => r.id)));
}

/** Sorties passées (fin de vie atteinte) : leur message Discord est effacé, puis elles sont supprimées. */
export async function purgeExpired(db: Tx, now = new Date()) {
  const rows = await db.select({ id: outings.id, groupId: outings.groupId, channelId: outings.discordChannelId, messageId: outings.discordMessageId }).from(outings)
    .where(sql`${outings.expiresAt} <= ${now}`).limit(100);
  if (!rows.length) return 0;
  const msgs = rows.filter(r => r.channelId && r.messageId);
  if (msgs.length) await db.insert(discordDeletions).values(msgs.map(r => ({ channelId: r.channelId!, messageId: r.messageId! })));
  await db.delete(outings).where(inArray(outings.id, rows.map(r => r.id)));
  for (const g of new Set(rows.map(r => r.groupId))) bus.group({ t: "outings", g });
  return rows.length;
}

/* ---------- Vues ---------- */

/** Sorties en vie d'un groupe (aujourd'hui et demain) : par jour, « dès que complet » d'abord, puis à l'heure. */
export async function groupOutings(db: Tx, groupId: string, now = new Date()) {
  const { today, tomorrow } = outingDays(now);
  return db.select().from(outings)
    .where(and(eq(outings.groupId, groupId), live(now), inArray(outings.day, [addDays(today, -1), today, tomorrow])))
    .orderBy(asc(outings.day), sql`${outings.scheduledAt} asc nulls first`, asc(outings.createdAt));
}

/** Vue d'une sortie pour le bot : de quoi dessiner l'annonce compacte. */
export async function outingDiscordView(db: Tx, outingId: string, origin: string, now = new Date()) {
  const [r] = await db.select({ o: outings, g: groups }).from(outings).innerJoin(groups, eq(groups.id, outings.groupId)).where(eq(outings.id, outingId));
  if (!r) return null;
  const channelId = outingsChannelOf(r.g);
  const { placed, waiting } = (await signupsOf(db, [outingId])).get(outingId)!;
  // Nom complet des persos quand la liste de guilde le donne
  const full = await fullNames(db, r.g.id);
  const one = (s: SignupRow) => ({ role: s.role, name: s.userId ? full(signupName(s)) : signupName(s), cls: s.cls, spec: s.spec, guest: !s.userId });
  return {
    id: r.o.id, group: { id: r.g.id, name: r.g.name }, channelId, messageId: r.o.discordChannelId === channelId ? r.o.discordMessageId : null,
    changedAt: r.o.discordChangedAt.toISOString(), today: dayKeyOf(now), url: `${origin}/groups/${r.g.id}/sorties`,
    dungeon: r.o.dungeon, title: r.o.title, levels: levelsText(r.o.minLevel, r.o.maxLevel), day: r.o.day, at: r.o.scheduledAt?.toISOString() ?? null,
    note: r.o.note, creator: full(r.o.creatorName), places: placesOfRow(r.o),
    signups: placed.map(one), waiting: waiting.map(one),
  };
}
export type OutingDiscordView = NonNullable<Awaited<ReturnType<typeof outingDiscordView>>>;

/** Zone du donjon (game-data) ; « » pour « Autre ». */
export const zoneOf = (dungeon: string) => FOREVER_DUNGEONS.find(d => d.key === dungeon)?.zone ?? "";
