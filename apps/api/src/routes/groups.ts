import { and, asc, desc, eq, gt, ilike, isNull, lt, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PROFESSION_SKILL_LINES, SECONDARY_PROFESSIONS } from "@forever/game-data";
import type { Professions } from "../db/schema";

/** Lignes de compétence des métiers actuels d'un perso (deux principaux + secondaires). */
const currentLines = (p: Professions) => new Set(
  [p.prof1.name, p.prof2.name, ...Object.values(SECONDARY_PROFESSIONS).map(s => s.name)].filter(Boolean).map(n => PROFESSION_SKILL_LINES[n]),
);
import { auditEvents, characterRecipes, characters, gameItems, gameRecipes, groupInvites, groupMembers, groups, users } from "../db/schema";
import { audit } from "../lib/audit";
import { randomToken, sha256 } from "../lib/crypto";
import { randomBytes } from "node:crypto";
import { membership, outranks, requireRole } from "../lib/groups";
import { badRequest, conflict, forbidden, notFound, parse } from "../lib/http";
import { currentUser, requireAuth } from "../lib/session";
import { toApi } from "./characters";
import { likeContains } from "./gamedata";
import { dropSignupsInGroup, retireAnnouncements } from "../lib/signups";

const MAX_GROUPS_PER_USER = 20;
const gid = z.object({ id: z.uuid() });

export async function groupRoutes(app: FastifyInstance) {
  const { db, cfg } = app.ctx;
  app.addHook("preHandler", requireAuth);

  app.get("/", async (req) => {
    const u = currentUser(req);
    const rows = await db.select({
      id: groups.id, name: groups.name, role: groupMembers.role,
      members: sql<number>`(select count(*)::int from group_members gm where gm.group_id = ${groups.id})`,
    }).from(groupMembers).innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(eq(groupMembers.userId, u.id)).orderBy(asc(groups.name));
    return { groups: rows };
  });

  app.post("/", async (req, reply) => {
    const u = currentUser(req);
    const { name } = parse(z.object({ name: z.string().trim().min(2).max(48) }), req.body);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(groupMembers).where(eq(groupMembers.userId, u.id)) as [{ n: number }];
    if (n >= MAX_GROUPS_PER_USER) throw badRequest(`Limite de ${MAX_GROUPS_PER_USER} groupes atteinte.`);
    const g = await db.transaction(async tx => {
      const [g] = await tx.insert(groups).values({ name }).returning();
      await tx.insert(groupMembers).values({ groupId: g!.id, userId: u.id, role: "owner" });
      return g!;
    });
    await audit(db, req, "group_created", { userId: u.id, groupId: g.id });
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
    return { group: { id: g!.id, name: g!.name, discordLinked: !!g!.discordChannelId }, role, members };
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
    }
    return { ok: true, name };
  });

  app.delete("/:id", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "owner");
    await retireAnnouncements(db, id);
    await db.delete(groups).where(eq(groups.id, id));
    return { ok: true };
  });

  /** Tous les persos des membres, en lecture, pour composer les raids. */
  app.get("/:id/characters", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await membership(db, id, u.id);
    const rows = await db.select({ c: characters, owner: users.displayName }).from(characters)
      .innerJoin(groupMembers, and(eq(groupMembers.userId, characters.userId), eq(groupMembers.groupId, id)))
      .innerJoin(users, eq(users.id, characters.userId))
      .orderBy(asc(users.displayName), asc(characters.sortOrder));
    return { characters: rows.map(r => ({ ...toApi(r.c), owner: r.owner })) };
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
    const byRecipe = new Map<number, { spellId: number; name: string; skillLine: number; reqSkill: number; item: { id: number; name: string; quality: number } | null; enchant: string | null; known: Who[]; wanted: Who[] }>();
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
    return { recipes: recipes.slice(0, 150), total: recipes.length };
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

  app.delete("/:id/discord", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "officer");
    await db.update(groups).set({ discordGuildId: null, discordChannelId: null, discordLinkCodeHash: null, discordLinkCodeExpiresAt: null }).where(eq(groups.id, id));
    await retireAnnouncements(db, id);
    await audit(db, req, "group_discord_unlinked", { userId: u.id, groupId: id });
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
    await dropSignupsInGroup(db, p.id, p.userId);
    await audit(db, req, p.userId === u.id ? "group_left" : "group_member_removed", { userId: u.id, groupId: p.id, meta: { target: p.userId } });
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
    // Le lien n'est montré qu'une fois : seul son hash est conservé.
    return reply.code(201).send({ invite: { ...inv, url: `${cfg.APP_ORIGIN}/join#${raw}` } });
  });

  app.delete("/:id/invites/:inviteId", async (req) => {
    const u = currentUser(req);
    const p = parse(z.object({ id: z.uuid(), inviteId: z.uuid() }), req.params);
    await requireRole(db, p.id, u.id, "officer");
    const [row] = await db.update(groupInvites).set({ revokedAt: new Date() })
      .where(and(eq(groupInvites.id, p.inviteId), eq(groupInvites.groupId, p.id))).returning({ id: groupInvites.id });
    if (!row) throw notFound("Invitation introuvable.");
    await audit(db, req, "invite_revoked", { userId: u.id, groupId: p.id, meta: { inviteId: p.inviteId } });
    return { ok: true };
  });

  const inviteBody = z.object({ token: z.string().min(20).max(100) });
  const liveInvite = (raw: string) => and(
    eq(groupInvites.tokenHash, sha256(raw)), isNull(groupInvites.revokedAt),
    gt(groupInvites.expiresAt, new Date()), lt(groupInvites.uses, groupInvites.maxUses),
  );

  app.post("/invites/preview", { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } }, async (req) => {
    const { token } = parse(inviteBody, req.body);
    const [row] = await db.select({ groupId: groups.id, name: groups.name }).from(groupInvites)
      .innerJoin(groups, eq(groups.id, groupInvites.groupId)).where(liveInvite(token));
    if (!row) throw notFound("Cette invitation n'est plus valable.");
    return { group: { id: row.groupId, name: row.name } };
  });

  app.post("/invites/accept", { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } }, async (req) => {
    const u = currentUser(req);
    const { token } = parse(inviteBody, req.body);
    const [inv] = await db.select({ groupId: groupInvites.groupId }).from(groupInvites).where(liveInvite(token));
    if (!inv) throw notFound("Cette invitation n'est plus valable.");
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
