import { guildKeyOf, parseGuildBlocks } from "@forever/game-data";
import { and, eq, isNull, ne, notExists, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { gameGuilds, guildLinkProposals, guildLinks, guildPlayers } from "../db/schema";
import { applyGuildExport, linkGameGuild } from "./guild-import";
import { loadGuild, resolveGuild, type Resolved } from "./guild";
import { badRequest, conflict, forbidden, notFound } from "./http";

/**
 * Mains et alts de la guilde du jeu : rattacher (officiers), détacher, accepter une suggestion de note, déclarer son perso,
 * répondre à « Est-ce ton perso ? », choisir le main ; lier une guilde du jeu proposée. Règles dans lib/guild.ts.
 */

type Actor = { id: string; displayName: string };
type PlayerRow = typeof guildPlayers.$inferSelect;

async function resolved(db: Db, groupId: string) {
  return resolveGuild(await loadGuild(db, groupId), { officer: true, now: new Date() });
}
function activeMember(r: Resolved, guid: string) {
  const m = r.data.members.find(x => x.guid === guid && !x.leftAt);
  if (!m) throw notFound("Ce perso n'est pas (ou plus) dans la guilde.");
  return m;
}

/**
 * Joueur enregistré d'une clé, créé au besoin : « u:<compte> » (membre de la guilde du site), « p:<id> » (joueur sans
 * compte), « m:<guid> » (perso seul : il devient le main d'un nouveau joueur sans compte).
 */
async function storedPlayer(db: Db, groupId: string, r: Resolved, key: string, actor: Actor): Promise<PlayerRow> {
  const [kind, id] = [key.slice(0, 2), key.slice(2)];
  if (kind === "u:") {
    if (!r.memberUser.has(id)) throw notFound("Ce joueur n'est pas membre de la guilde du site.");
    const own = r.data.players.find(p => p.userId === id);
    if (own) return own;
    const [row] = await db.insert(guildPlayers).values({ groupId, userId: id, createdBy: actor.id }).onConflictDoNothing().returning();
    return row ?? (await db.select().from(guildPlayers).where(and(eq(guildPlayers.groupId, groupId), eq(guildPlayers.userId, id))))[0]!;
  }
  if (kind === "p:") {
    const p = r.data.players.find(x => x.id === id);
    if (!p) throw notFound("Joueur introuvable.");
    return p;
  }
  if (kind === "m:") {
    activeMember(r, id);
    const p = r.data.players.find(x => !x.userId && x.mainGuid === id);
    if (p) return p;
    const [row] = await db.insert(guildPlayers).values({ groupId, mainGuid: id, createdBy: actor.id }).returning();
    return row!;
  }
  throw badRequest("Joueur invalide.");
}

/** Joueurs sans compte qui n'ont plus rien (ni lien, ni main) : effacés. */
async function dropEmptyPlayers(db: Db, groupId: string) {
  await db.delete(guildPlayers).where(and(eq(guildPlayers.groupId, groupId), isNull(guildPlayers.userId), isNull(guildPlayers.mainGuid),
    notExists(db.select({ x: sql`1` }).from(guildLinks).where(eq(guildLinks.playerId, guildPlayers.id)))));
}

/**
 * « Rattacher à… » (officier) ou suggestion acceptée : le perso va au joueur `to` (clé d'un joueur, ou d'un perso seul),
 * ou devient son propre joueur (« new » : « X est son main », même s'il est sur le compte de quelqu'un). Si le joueur a un
 * compte (autre que celui de l'officier), il verra « Est-ce ton perso ? ».
 */
export async function attachMember(db: Db, groupId: string, guid: string, to: string, actor: Actor, source: "officer" | "note" = "officer") {
  const r = await resolved(db, groupId);
  const m = activeMember(r, guid);
  if (to === "new") {
    const ev = r.evidence.get(guid);
    // Main d'un nouveau joueur sans compte ; sur un compte, le lien d'officier le sépare de ce compte
    await db.delete(guildLinks).where(and(eq(guildLinks.groupId, groupId), eq(guildLinks.guid, guid)));
    await db.update(guildPlayers).set({ mainGuid: null }).where(and(eq(guildPlayers.groupId, groupId), eq(guildPlayers.mainGuid, guid)));
    const [p] = await db.insert(guildPlayers).values({ groupId, mainGuid: guid, createdBy: actor.id }).returning();
    if (ev) await db.insert(guildLinks).values({ groupId, guid, playerId: p!.id, source: "officer", confirmed: true, byId: actor.id, byName: actor.displayName });
    await dropEmptyPlayers(db, groupId);
    return { player: `p:${p!.id}`, name: m.name };
  }
  if (to === `m:${guid}`) throw badRequest("Un perso ne se rattache pas à lui-même : choisis « Nouveau joueur ».");
  if (r.personOf.get(guid) === to) return { player: to, name: m.name };
  // Un perso choisi comme cible : son joueur s'il en a un
  const target = (to.startsWith("m:") && r.personOf.get(to.slice(2))) || to;
  const p = await storedPlayer(db, groupId, r, target, actor);
  // Mon propre compte : pas de question à me poser
  const self = target === `u:${actor.id}`;
  await db.insert(guildLinks).values({ groupId, guid, playerId: p.id, source, confirmed: self ? true : null, byId: actor.id, byName: actor.displayName })
    .onConflictDoUpdate({ target: [guildLinks.groupId, guildLinks.guid], set: { playerId: p.id, source, confirmed: self ? true : null, byId: actor.id, byName: actor.displayName, createdAt: new Date() } });
  // Il n'est plus le main d'un autre joueur
  await db.update(guildPlayers).set({ mainGuid: null }).where(and(eq(guildPlayers.groupId, groupId), eq(guildPlayers.mainGuid, guid), ne(guildPlayers.id, p.id)));
  await dropEmptyPlayers(db, groupId);
  return { player: target, name: m.name };
}

/** Détacher : officier (tout lien), ou le joueur pour un perso qu'il a déclaré. Un perso du compte d'un joueur se sépare par « Nouveau joueur ». */
export async function detachMember(db: Db, groupId: string, guid: string, actor: Actor, officer: boolean) {
  const r = await resolved(db, groupId);
  const m = activeMember(r, guid);
  const o = r.owner(m);
  if (!o) throw badRequest("Ce perso n'est rattaché à personne.");
  if (!o.link && o.source === "account") {
    const who = r.memberUser.get(r.evidence.get(guid)!.userId)?.displayName ?? "un joueur";
    throw badRequest(`${m.name} est sur le compte de ${who} (fiche synchronisée par l'addon) : choisis « Nouveau joueur » pour l'en séparer.`);
  }
  if (!officer && !(o.link?.source === "declared" && o.key === `u:${actor.id}`)) throw forbidden("Seuls les officiers détachent les persos des autres.");
  await db.delete(guildLinks).where(and(eq(guildLinks.groupId, groupId), eq(guildLinks.guid, guid)));
  await db.update(guildPlayers).set({ mainGuid: null }).where(and(eq(guildPlayers.groupId, groupId), eq(guildPlayers.mainGuid, guid)));
  await dropEmptyPlayers(db, groupId);
  return { name: m.name };
}

/** Accepter la suggestion d'une note (officier) ; `choice` : le candidat retenu quand le prénom est ambigu. */
export async function acceptSuggestion(db: Db, groupId: string, guid: string, actor: Actor, choice?: string) {
  const r = await resolved(db, groupId);
  activeMember(r, guid);
  const s = r.band.get(guid)?.suggestion;
  if (!s) throw badRequest("Pas de suggestion à accepter pour ce perso.");
  const target = choice ? s.candidates.find(c => c.guid === choice)?.guid : s.target?.guid;
  if (!target) throw badRequest(s.candidates.length ? "Choisis le bon joueur parmi les candidats." : "Pas de suggestion à accepter pour ce perso.");
  return attachMember(db, groupId, guid, r.personOf.get(target) ?? `m:${target}`, actor, "note");
}

/** « C'est mon perso » : un perso de la guilde qui n'est à personne (ou le main d'un joueur sans compte) rejoint mon compte. */
export async function claimMember(db: Db, groupId: string, guid: string, actor: Actor) {
  const r = await resolved(db, groupId);
  const m = activeMember(r, guid);
  const o = r.owner(m);
  if (o?.key === `u:${actor.id}`) return { name: m.name };
  const orphanMain = o && !o.link && o.key.startsWith("p:") ? r.data.players.find(p => `p:${p.id}` === o.key) : undefined;
  if (o && !orphanMain) throw conflict(`${m.name} est déjà rattaché à un joueur : demande à un officier.`);
  const mine = r.data.players.find(p => p.userId === actor.id);
  if (orphanMain) {
    // Le joueur sans compte devient le mien (ses alts compris)
    if (!mine) await db.update(guildPlayers).set({ userId: actor.id }).where(eq(guildPlayers.id, orphanMain.id));
    else {
      await db.update(guildLinks).set({ playerId: mine.id }).where(eq(guildLinks.playerId, orphanMain.id));
      await db.update(guildPlayers).set({ mainGuid: mine.mainGuid ?? orphanMain.mainGuid }).where(eq(guildPlayers.id, mine.id));
      await db.delete(guildPlayers).where(eq(guildPlayers.id, orphanMain.id));
    }
    return { name: m.name };
  }
  const p = await storedPlayer(db, groupId, r, `u:${actor.id}`, actor);
  await db.insert(guildLinks).values({ groupId, guid, playerId: p.id, source: "declared", confirmed: true, byId: actor.id, byName: actor.displayName })
    .onConflictDoNothing();
  return { name: m.name };
}

/** « Est-ce ton perso ? » : oui (gardé, confirmé) ou non (le lien est retiré, le perso revient « à rattacher »). */
export async function answerQuestion(db: Db, groupId: string, guid: string, actor: Actor, yes: boolean) {
  const r = await resolved(db, groupId);
  const m = activeMember(r, guid);
  const o = r.owner(m);
  if (!o?.link || o.link.confirmed !== null || o.key !== `u:${actor.id}` || (o.source !== "officer" && o.source !== "note")) throw notFound("Pas de question pour ce perso.");
  if (yes) await db.update(guildLinks).set({ confirmed: true }).where(and(eq(guildLinks.groupId, groupId), eq(guildLinks.guid, guid)));
  else {
    await db.delete(guildLinks).where(and(eq(guildLinks.groupId, groupId), eq(guildLinks.guid, guid)));
    await dropEmptyPlayers(db, groupId);
  }
  return { name: m.name, by: o.link.byId };
}

/** Main d'un joueur : un officier, ou le joueur lui-même. */
export async function setPlayerMain(db: Db, groupId: string, key: string, guid: string, actor: Actor, officer: boolean) {
  const r = await resolved(db, groupId);
  if (!officer && key !== `u:${actor.id}`) throw forbidden("Seuls les officiers choisissent le main des autres joueurs.");
  const person = r.persons.get(key);
  if (!person) throw notFound("Joueur introuvable.");
  if (!person.chars.some(c => c.guid === guid)) throw badRequest("Ce perso n'est pas à ce joueur.");
  if (person.chars.length < 2) return { ok: true };
  const p = key.startsWith("u:") ? await storedPlayer(db, groupId, r, key, actor) : person.stored[0];
  if (!p) throw badRequest("Ce joueur n'a qu'un perso.");
  await db.update(guildPlayers).set({ mainGuid: guid }).where(eq(guildPlayers.id, p.id));
  return { ok: true };
}

/** Lier une guilde du jeu proposée (Administration) : remplie tout de suite avec le relevé gardé. */
export async function linkProposed(db: Db, groupId: string, key: string, actor: Actor) {
  const [cur] = await db.select({ name: gameGuilds.name }).from(gameGuilds).where(eq(gameGuilds.groupId, groupId));
  if (cur) throw conflict(`Cette guilde est déjà liée à la guilde du jeu ${cur.name} : délie-la d'abord.`);
  const [prop] = await db.select().from(guildLinkProposals).where(and(eq(guildLinkProposals.groupId, groupId), eq(guildLinkProposals.key, key)));
  if (!prop) throw notFound("Cette guilde du jeu n'est plus proposée : envoie un nouveau relevé.");
  await db.transaction(tx => linkGameGuild(tx, groupId, prop, actor, false));
  const block = parseGuildBlocks(prop.text).blocks.find(b => guildKeyOf(b.data) === key);
  if (block) await applyGuildExport(db, groupId, block.data, { officer: true });
  return { name: prop.name };
}

/** Guildes du jeu proposées à cette guilde du site (Administration). */
export async function proposalsOf(db: Db, groupId: string) {
  return db.select({ key: guildLinkProposals.key, name: guildLinkProposals.name, realm: guildLinkProposals.realm, faction: guildLinkProposals.faction,
    by: guildLinkProposals.proposedByName, at: guildLinkProposals.createdAt, members: guildLinkProposals.members })
    .from(guildLinkProposals).where(eq(guildLinkProposals.groupId, groupId));
}
