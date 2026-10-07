import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { applyUserAbsences } from "../lib/absences";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { GEAR_SLOTS, gearStats, PROFESSION_SKILL_LINES, roleOf, type SignupStatus } from "@forever/game-data";
import { currentLines } from "../lib/professions";
import { auditEvents, characterRecipes, characters, gameItems, gameRecipes, groupCharacters, groupInvites, groupMembers, groups, raids, raidSignups, users } from "../db/schema";
import { assignCharacter, setMain, unassignCharacter } from "../lib/group-characters";
import { audit } from "../lib/audit";
import { randomToken, sha256 } from "../lib/crypto";
import { randomBytes } from "node:crypto";
import { membership, outranks, requireRole } from "../lib/groups";
import { badRequest, conflict, forbidden, notFound, parse } from "../lib/http";
import { currentUser, requireAuth } from "../lib/session";
import { toApi } from "./characters";
import { itemsById, likeContains, type ItemSummary } from "./gamedata";
import { dropSignupsInGroup, retireAnnouncements } from "../lib/signups";
import { retireOrderMessages } from "../lib/orders";
import { bus } from "../lib/events";
import { siteForGame, siteOf } from "../lib/site";
import { feedbackSummary } from "./group-feedback";

const MAX_GROUPS_PER_USER = 20;
const gid = z.object({ id: z.uuid() });

export async function groupRoutes(app: FastifyInstance) {
  const { db, cfg } = app.ctx;
  app.addHook("preHandler", requireAuth);

  /**
   * Mes groupes, pour leurs cartes : membres, raids à venir et le prochain (avec ma réponse),
   * roster par rôle (spé principale du main de chaque joueur), salon Discord lié ou non.
   */
  app.get("/", async (req) => {
    const u = currentUser(req);
    const rows = await db.select({
      id: groups.id, name: groups.name, role: groupMembers.role, discordLinked: sql<boolean>`${groups.discordChannelId} is not null`,
      members: sql<number>`(select count(*)::int from group_members gm where gm.group_id = ${groups.id})`,
    }).from(groupMembers).innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(and(eq(groupMembers.userId, u.id), eq(groups.game, siteOf(cfg, req).game))).orderBy(asc(groups.name));
    const ids = rows.map(r => r.id);
    if (!ids.length) return { groups: [] };

    const upcoming = await db.select({ id: raids.id, groupId: raids.groupId, name: raids.name, scheduledAt: raids.scheduledAt }).from(raids)
      .where(and(inArray(raids.groupId, ids), gt(raids.scheduledAt, new Date(Date.now() - 3 * 3600_000))))
      .orderBy(asc(raids.scheduledAt));
    const next = new Map<string, (typeof upcoming)[number]>();
    for (const r of upcoming) if (!next.has(r.groupId)) next.set(r.groupId, r);
    const nextIds = [...next.values()].map(r => r.id);
    const signups = nextIds.length ? await db.select({ raidId: raidSignups.raidId, userId: raidSignups.userId, status: raidSignups.status })
      .from(raidSignups).where(inArray(raidSignups.raidId, nextIds)) : [];
    const COMING: SignupStatus[] = ["present", "late"];

    const specs = await db.select({ groupId: groupCharacters.groupId, spec: characters.spec1 }).from(characters)
      .innerJoin(groupCharacters, and(eq(groupCharacters.characterId, characters.id), eq(groupCharacters.isMain, true)))
      .where(and(inArray(groupCharacters.groupId, ids), sql`${characters.spec1} <> ''`));

    return { groups: rows.map(g => {
      const n = next.get(g.id);
      const rs = n ? signups.filter(s => s.raidId === n.id) : [];
      const roles = { tank: 0, heal: 0, dps: 0 };
      for (const s of specs) if (s.groupId === g.id) { const r = roleOf(s.spec); if (r === "Tank") roles.tank++; else if (r === "Heal") roles.heal++; else roles.dps++; }
      return {
        ...g,
        upcoming: upcoming.filter(r => r.groupId === g.id).length,
        nextRaid: n ? { id: n.id, name: n.name, scheduledAt: n.scheduledAt, coming: rs.filter(s => COMING.includes(s.status)).length, mine: rs.find(s => s.userId === u.id)?.status ?? null } : null,
        roles,
      };
    }) };
  });

  app.post("/", async (req, reply) => {
    const u = currentUser(req);
    const { name } = parse(z.object({ name: z.string().trim().min(2).max(48) }), req.body);
    const game = siteOf(cfg, req).game;
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(groupMembers).innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(and(eq(groupMembers.userId, u.id), eq(groups.game, game))) as [{ n: number }];
    if (n >= MAX_GROUPS_PER_USER) throw badRequest(`Limite de ${MAX_GROUPS_PER_USER} groupes atteinte.`);
    const g = await db.transaction(async tx => {
      const [g] = await tx.insert(groups).values({ name, game }).returning();
      await tx.insert(groupMembers).values({ groupId: g!.id, userId: u.id, role: "owner" });
      return g!;
    });
    await audit(db, req, "group_created", { userId: u.id, groupId: g.id });
    await bus.membership(db, u.id);
    return reply.code(201).send({ group: { id: g.id, name: g.name, role: "owner" } });
  });

  app.get("/:id", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    const role = await membership(db, id, u.id);
    const [g] = await db.select().from(groups).where(eq(groups.id, id));
    const members = await db.select({
      userId: users.id, displayName: users.displayName, battletag: users.battletag, avatarId: users.avatarId, role: groupMembers.role, joinedAt: groupMembers.joinedAt,
    }).from(groupMembers).innerJoin(users, eq(users.id, groupMembers.userId))
      .where(eq(groupMembers.groupId, id)).orderBy(asc(groupMembers.joinedAt));
    // game : un groupe de l'autre jeu ouvert sur cette adresse renvoie vers son site
    const site = siteForGame(cfg, g!.game);
    // Chef et officiers : avis Discord suivis par le groupe (pastille de l'onglet Administration)
    const feedback = role === "member" ? null : await feedbackSummary(db, u.id, id);
    return { group: { id: g!.id, name: g!.name, game: g!.game, site: { name: site.name, origin: site.origin }, discordLinked: !!g!.discordChannelId, ordersLinked: !!g!.ordersChannelId }, role, members, feedback };
  });

  app.patch("/:id", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "officer");
    const { name } = parse(z.object({ name: z.string().trim().min(2).max(48) }), req.body);
    const [before] = await db.select({ name: groups.name }).from(groups).where(eq(groups.id, id));
    if (before && before.name !== name) {
      await db.update(groups).set({ name }).where(eq(groups.id, id));
      await audit(db, req, "group_renamed", { userId: u.id, groupId: id, meta: { from: before.name, to: name } });
    bus.group({ t: "group", g: id });
    }
    return { ok: true, name };
  });

  app.delete("/:id", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "owner");
    await retireAnnouncements(db, id);
    await retireOrderMessages(db, id);
    const members = await db.select({ u: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, id));
    await db.delete(groups).where(eq(groups.id, id));
    for (const m of members) await bus.membership(db, m.u);
    return { ok: true };
  });

  /** Persos que les membres font jouer dans le groupe (main de chacun marqué), en lecture, pour composer les raids. */
  app.get("/:id/characters", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await membership(db, id, u.id);
    const rows = await db.select({ c: characters, owner: users.displayName, isMain: groupCharacters.isMain }).from(characters)
      .innerJoin(groupCharacters, and(eq(groupCharacters.characterId, characters.id), eq(groupCharacters.groupId, id)))
      .innerJoin(groupMembers, and(eq(groupMembers.userId, characters.userId), eq(groupMembers.groupId, id)))
      .innerJoin(users, eq(users.id, characters.userId))
      .orderBy(asc(users.displayName), asc(characters.sortOrder));
    // Progression d'équipement (survol dans la compo) : niveaux d'objet des pièces équipées
    const ids = [...new Set(rows.flatMap(r => GEAR_SLOTS.map(s => r.c.gear[s]?.curId).filter((v): v is number => !!v)))];
    const levels = ids.length
      ? new Map((await db.select({ id: gameItems.id, lvl: gameItems.itemLevel }).from(gameItems).where(inArray(gameItems.id, ids))).map(x => [x.id, x.lvl]))
      : new Map<number, number>();
    return { characters: rows.map(r => ({ ...toApi(r.c), owner: r.owner, isMain: r.isMain, gearStats: gearStats(r.c.gear, GEAR_SLOTS, id => levels.get(id)) })) };
  });

  /**
   * Ajoute ou retire un perso du groupe, ou en fait le main de son joueur. Le joueur gère ses persos ;
   * un officier peut corriger le main ou retirer un perso d'un autre membre (noté au journal du groupe).
   */
  app.put("/:id/characters/:characterId", async (req) => {
    const u = currentUser(req);
    const p = parse(z.object({ id: z.uuid(), characterId: z.uuid() }), req.params);
    const body = parse(z.object({ assigned: z.boolean(), main: z.boolean().optional() }), req.body);
    const myRole = await membership(db, p.id, u.id);
    const [c] = await db.select({ id: characters.id, name: characters.name, userId: characters.userId }).from(characters).where(eq(characters.id, p.characterId));
    if (!c) throw notFound("Personnage introuvable.");
    const mine = c.userId === u.id;
    if (!mine) {
      // Le perso d'un autre : seulement un officier, sur un membre du groupe, et jamais pour l'ajouter
      const theirs = await membership(db, p.id, c.userId).catch(() => null);
      if (!theirs) throw notFound("Personnage introuvable.");
      if (myRole === "member") throw forbidden("Seuls les officiers modifient les persos des autres membres.");
      if (theirs === "owner" && myRole !== "owner") throw forbidden("Tu ne peux pas modifier les persos du propriétaire du groupe.");
    }
    const [current] = await db.select().from(groupCharacters)
      .where(and(eq(groupCharacters.groupId, p.id), eq(groupCharacters.characterId, c.id)));
    if (body.assigned) {
      if (!current && !mine) throw forbidden("Seul le joueur ajoute ses persos au groupe.");
      await db.transaction(async tx => {
        if (!current) await assignCharacter(tx, p.id, c.id, c.userId, body.main === true);
        else if (body.main === true && !current.isMain) await setMain(tx, p.id, c.id, c.userId);
      });
    } else if (current) {
      await db.transaction(tx => unassignCharacter(tx, p.id, c.id, c.userId));
    }
    if (!mine && (current || body.assigned)) {
      await audit(db, req, "group_character_changed", { userId: u.id, groupId: p.id, meta: { target: c.userId, character: c.name, change: body.assigned ? "main" : "removed" } });
    }
    bus.group({ t: "chars", g: p.id });
    return { ok: true };
  });

  /** « Qui crafte quoi ? » : patrons connus et recherchés par les persos du groupe. */
  app.get("/:id/crafters", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    const { q, profession } = parse(z.object({
      q: z.string().trim().max(60).optional(),
      profession: z.enum(Object.keys(PROFESSION_SKILL_LINES) as [string, ...string[]]).optional(),
    }), req.query);
    await membership(db, id, u.id);
    const filters = [
      ...(q && q.length >= 2 ? [or(ilike(gameRecipes.name, likeContains(q)), ilike(gameItems.name, likeContains(q)))] : []),
      ...(profession ? [eq(gameRecipes.skillLine, PROFESSION_SKILL_LINES[profession]!)] : []),
    ];
    const rows = await db.select({
      spellId: gameRecipes.spellId, name: gameRecipes.name, skillLine: gameRecipes.skillLine, reqSkill: gameRecipes.reqSkill,
      itemId: gameRecipes.createdItemId, itemName: gameItems.name, quality: gameItems.quality, enchant: gameRecipes.enchant,
      status: characterRecipes.status, characterId: characters.id, character: characters.name, owner: users.displayName,
      professions: characters.professions,
    }).from(characterRecipes)
      .innerJoin(characters, eq(characters.id, characterRecipes.characterId))
      .innerJoin(groupMembers, and(eq(groupMembers.userId, characters.userId), eq(groupMembers.groupId, id)))
      .innerJoin(users, eq(users.id, characters.userId))
      .innerJoin(gameRecipes, eq(gameRecipes.spellId, characterRecipes.spellId))
      .leftJoin(gameItems, eq(gameItems.id, gameRecipes.createdItemId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(gameRecipes.name), asc(characters.name))
      .limit(2000);

    type Who = { characterId: string; name: string; owner: string };
    const byRecipe = new Map<number, { spellId: number; name: string; skillLine: number; reqSkill: number; item: ItemSummary | { id: number; name: string; quality: number } | null; enchant: string | null; known: Who[]; wanted: Who[] }>();
    for (const r of rows) {
      // Seulement les métiers actuels du perso (un patron d'un métier abandonné ne compte plus)
      if (!currentLines(r.professions).has(r.skillLine)) continue;
      let e = byRecipe.get(r.spellId);
      if (!e) {
        e = { spellId: r.spellId, name: r.name, skillLine: r.skillLine, reqSkill: r.reqSkill, enchant: r.enchant, known: [], wanted: [],
          item: r.itemId && r.itemName ? { id: r.itemId, name: r.itemName, quality: r.quality ?? 1 } : null };
        byRecipe.set(r.spellId, e);
      }
      e[r.status].push({ characterId: r.characterId, name: r.character, owner: r.owner });
    }
    const recipes = [...byRecipe.values()];
    // Infobulle complète des objets fabriqués affichés
    const page = recipes.slice(0, 150);
    const full = await itemsById(db, page.flatMap(r => (r.item ? [r.item.id] : [])));
    for (const r of page) if (r.item && full[r.item.id]) r.item = full[r.item.id]!;
    return { recipes: page, total: recipes.length };
  });

  /* ----- Discord ----- */

  /** Code à usage unique (30 min) à taper avec /forever-lier dans le salon Discord choisi. */
  app.post("/:id/discord/code", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "officer");
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O ni 1/I
    const bytes = randomBytes(8);
    const code = Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
    const expiresAt = new Date(Date.now() + 30 * 60e3);
    await db.update(groups).set({ discordLinkCodeHash: sha256(code), discordLinkCodeExpiresAt: expiresAt }).where(eq(groups.id, id));
    return { code, expiresAt };
  });

  /** Salon des commandes d'artisanat (lot F) : même principe, code à taper avec /forever-lier dans le salon voulu. */
  app.post("/:id/discord/orders-code", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "officer");
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = Array.from(randomBytes(8), b => alphabet[b % alphabet.length]).join("");
    const expiresAt = new Date(Date.now() + 30 * 60e3);
    await db.update(groups).set({ ordersLinkCodeHash: sha256(code), ordersLinkCodeExpiresAt: expiresAt }).where(eq(groups.id, id));
    return { code, expiresAt };
  });

  app.delete("/:id/discord/orders", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "officer");
    await db.update(groups).set({ ordersGuildId: null, ordersChannelId: null, ordersLinkCodeHash: null, ordersLinkCodeExpiresAt: null }).where(eq(groups.id, id));
    await retireOrderMessages(db, id);
    await audit(db, req, "group_orders_unlinked", { userId: u.id, groupId: id });
    bus.group({ t: "group", g: id });
    return { ok: true };
  });

  app.delete("/:id/discord", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "officer");
    await db.update(groups).set({ discordGuildId: null, discordChannelId: null, discordLinkCodeHash: null, discordLinkCodeExpiresAt: null }).where(eq(groups.id, id));
    await retireAnnouncements(db, id);
    await audit(db, req, "group_discord_unlinked", { userId: u.id, groupId: id });
    bus.group({ t: "group", g: id });
    return { ok: true };
  });

  /* ----- Membres ----- */

  app.patch("/:id/members/:userId", async (req) => {
    const u = currentUser(req);
    const p = parse(z.object({ id: z.uuid(), userId: z.uuid() }), req.params);
    const { role } = parse(z.object({ role: z.enum(["owner", "officer", "member"]) }), req.body);
    await requireRole(db, p.id, u.id, "owner");
    if (p.userId === u.id) throw badRequest("Tu ne peux pas changer ton propre rôle.");
    const target = await membership(db, p.id, p.userId);
    await db.transaction(async tx => {
      if (role === "owner") {
        // Transfert de propriété : l'ancien propriétaire devient officier.
        await tx.update(groupMembers).set({ role: "officer" }).where(and(eq(groupMembers.groupId, p.id), eq(groupMembers.userId, u.id)));
      }
      await tx.update(groupMembers).set({ role }).where(and(eq(groupMembers.groupId, p.id), eq(groupMembers.userId, p.userId)));
    });
    await audit(db, req, "group_role_changed", { userId: u.id, groupId: p.id, meta: { target: p.userId, from: target, to: role } });
    bus.group({ t: "group", g: p.id });
    return { ok: true };
  });

  app.delete("/:id/members/:userId", async (req) => {
    const u = currentUser(req);
    const p = parse(z.object({ id: z.uuid(), userId: z.uuid() }), req.params);
    const myRole = await membership(db, p.id, u.id);
    if (p.userId === u.id) {
      if (myRole === "owner") throw conflict("Transfère la propriété du groupe ou supprime-le avant de le quitter.");
    } else {
      const target = await membership(db, p.id, p.userId);
      if (!outranks(myRole, target)) throw forbidden("Tu ne peux retirer que des membres de rang inférieur.");
    }
    await db.delete(groupMembers).where(and(eq(groupMembers.groupId, p.id), eq(groupMembers.userId, p.userId)));
    await db.delete(groupCharacters).where(and(eq(groupCharacters.groupId, p.id), eq(groupCharacters.userId, p.userId)));
    await dropSignupsInGroup(db, p.id, p.userId);
    await audit(db, req, p.userId === u.id ? "group_left" : "group_member_removed", { userId: u.id, groupId: p.id, meta: { target: p.userId } });
    bus.group({ t: "group", g: p.id });
    bus.group({ t: "chars", g: p.id });
    await bus.membership(db, p.userId);
    return { ok: true };
  });

  /* ----- Invitations ----- */

  app.get("/:id/invites", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "officer");
    const rows = await db.select({
      id: groupInvites.id, maxUses: groupInvites.maxUses, uses: groupInvites.uses, expiresAt: groupInvites.expiresAt, createdAt: groupInvites.createdAt,
    }).from(groupInvites)
      .where(and(eq(groupInvites.groupId, id), isNull(groupInvites.revokedAt), gt(groupInvites.expiresAt, new Date())))
      .orderBy(desc(groupInvites.createdAt));
    return { invites: rows };
  });

  app.post("/:id/invites", async (req, reply) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "officer");
    if (!u.emailVerifiedAt && !u.battlenetId) throw forbidden("Confirme ton adresse e-mail avant d'inviter des joueurs.");
    const body = parse(z.object({ maxUses: z.int().min(1).max(100).default(10), expiresInHours: z.int().min(1).max(24 * 30).default(72) }), req.body ?? {});
    const raw = randomToken(24);
    const [inv] = await db.insert(groupInvites).values({
      groupId: id, tokenHash: sha256(raw), createdBy: u.id, maxUses: body.maxUses,
      expiresAt: new Date(Date.now() + body.expiresInHours * 3600 * 1000),
    }).returning({ id: groupInvites.id, expiresAt: groupInvites.expiresAt });
    await audit(db, req, "invite_created", { userId: u.id, groupId: id, meta: { inviteId: inv!.id, maxUses: body.maxUses } });
    bus.group({ t: "group", g: id });
    // Le lien n'est montré qu'une fois : seul son hash est conservé. Il mène au site du jeu du groupe.
    const [grp] = await db.select({ game: groups.game }).from(groups).where(eq(groups.id, id));
    return reply.code(201).send({ invite: { ...inv, url: `${siteForGame(cfg, grp!.game).origin}/join#${raw}` } });
  });

  app.delete("/:id/invites/:inviteId", async (req) => {
    const u = currentUser(req);
    const p = parse(z.object({ id: z.uuid(), inviteId: z.uuid() }), req.params);
    await requireRole(db, p.id, u.id, "officer");
    const [row] = await db.update(groupInvites).set({ revokedAt: new Date() })
      .where(and(eq(groupInvites.id, p.inviteId), eq(groupInvites.groupId, p.id))).returning({ id: groupInvites.id });
    if (!row) throw notFound("Invitation introuvable.");
    await audit(db, req, "invite_revoked", { userId: u.id, groupId: p.id, meta: { inviteId: p.inviteId } });
    bus.group({ t: "group", g: p.id });
    return { ok: true };
  });

  const inviteBody = z.object({ token: z.string().min(20).max(100) });
  const liveInvite = (raw: string) => and(
    eq(groupInvites.tokenHash, sha256(raw)), isNull(groupInvites.revokedAt),
    gt(groupInvites.expiresAt, new Date()), lt(groupInvites.uses, groupInvites.maxUses),
  );

  app.post("/invites/preview", { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } }, async (req) => {
    const { token } = parse(inviteBody, req.body);
    const [row] = await db.select({ groupId: groups.id, name: groups.name, game: groups.game }).from(groupInvites)
      .innerJoin(groups, eq(groups.id, groupInvites.groupId)).where(liveInvite(token));
    if (!row) throw notFound("Cette invitation n'est plus valable.");
    const site = siteForGame(cfg, row.game);
    return { group: { id: row.groupId, name: row.name }, site: { game: site.game, name: site.name, origin: site.origin } };
  });

  app.post("/invites/accept", { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } }, async (req) => {
    const u = currentUser(req);
    const { token } = parse(inviteBody, req.body);
    const [inv] = await db.select({ groupId: groupInvites.groupId, game: groups.game }).from(groupInvites)
      .innerJoin(groups, eq(groups.id, groupInvites.groupId)).where(liveInvite(token));
    if (!inv) throw notFound("Cette invitation n'est plus valable.");
    const site = siteForGame(cfg, inv.game);
    if (site.game !== siteOf(cfg, req).game) throw conflict(`Cette invitation est pour ${site.name} : ouvre-la sur ${site.origin}.`);
    const [already] = await db.select({ role: groupMembers.role }).from(groupMembers)
      .where(and(eq(groupMembers.groupId, inv.groupId), eq(groupMembers.userId, u.id)));
    if (already) return { groupId: inv.groupId }; // déjà membre : l'invitation n'est pas consommée
    const groupId = await db.transaction(async tx => {
      // Incrément atomique : deux acceptations simultanées ne peuvent pas dépasser maxUses.
      const [used] = await tx.update(groupInvites).set({ uses: sql`${groupInvites.uses} + 1` }).where(liveInvite(token))
        .returning({ groupId: groupInvites.groupId });
      if (!used) throw notFound("Cette invitation n'est plus valable.");
      await tx.insert(groupMembers).values({ groupId: used.groupId, userId: u.id, role: "member" }).onConflictDoNothing();
      return used.groupId;
    });
    await audit(db, req, "group_joined", { userId: u.id, groupId });
    await bus.membership(db, u.id);
    bus.group({ t: "group", g: groupId });
    bus.group({ t: "chars", g: groupId });
    // Absences déclarées : les raids du groupe rejoint pendant la période passent en « Absent »
    await applyUserAbsences(db, u.id);
    return { groupId };
  });

  /** Journal du groupe, réservé aux officiers. */
  app.get("/:id/audit", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "officer");
    const rows = await db.select({ id: auditEvents.id, type: auditEvents.type, meta: auditEvents.meta, createdAt: auditEvents.createdAt, actor: users.displayName })
      .from(auditEvents).leftJoin(users, eq(users.id, auditEvents.userId))
      .where(eq(auditEvents.groupId, id)).orderBy(desc(auditEvents.createdAt)).limit(100);
    return { events: rows };
  });
}
