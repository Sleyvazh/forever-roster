import { CLASS_SPECS, RAID_GROUPS, roleOf, SIGNUP_STATUSES, type SpecDef } from "@forever/game-data";
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppContext } from "./app";
import { characters, discordDeletions, groupMembers, groups, raidSignups, raids, users } from "./db/schema";
import { audit } from "./lib/audit";
import { safeEqual, sha256 } from "./lib/crypto";
import { HttpError, badRequest, forbidden, notFound, parse } from "./lib/http";
import { MAX_RAIDS_PER_GROUP } from "./lib/recurring";
import { bus } from "./lib/events";
import { listSignups, retireAnnouncements, signUpDiscordGuest, signUpSiteUser, touchRaid } from "./lib/signups";

/**
 * API interne utilisée par le bot Discord.
 * - écoute sur un port à part (3001), jamais relayé par Caddy : joignable uniquement depuis le réseau Docker ;
 * - chaque requête porte le secret partagé (Authorization: Bearer …), comparé en temps constant ;
 * - le bot n'a aucun accès à la base : il passe par ces routes, qui appliquent les mêmes règles que le site.
 */

const snowflake = z.string().regex(/^\d{5,25}$/);
const raidParam = z.object({ raidId: z.uuid() });
const RANK = { member: 0, officer: 1, owner: 2 } as const;
/** Une annonce reste synchronisée jusqu'à 12 h après l'heure du raid. */
const KEEP_AFTER_MS = 12 * 3600e3;

export async function buildInternalApp(ctx: AppContext, logger: boolean | object = false) {
  const app = Fastify({ logger, bodyLimit: 64 * 1024 });
  const { db, cfg } = ctx;

  app.addHook("onRequest", async req => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!cfg.INTERNAL_API_SECRET || !token || !safeEqual(token, cfg.INTERNAL_API_SECRET)) throw new HttpError(401, "Non autorisé.");
  });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: "Requête invalide." });
    req.log.error({ err }, "Erreur interne (API du bot)");
    return reply.code(500).send({ error: "Erreur interne." });
  });

  /** Compte du site lié à ce Discord, et son rôle dans le groupe (null si non membre). */
  async function linkedMember(discordUserId: string, groupId: string) {
    const [u] = await db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.discordId, discordUserId));
    if (!u) return { user: null, role: null };
    const [m] = await db.select({ role: groupMembers.role }).from(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, u.id)));
    return { user: u, role: m?.role ?? null };
  }

  async function groupForChannel(guildId: string, channelId: string) {
    const [g] = await db.select().from(groups).where(and(eq(groups.discordGuildId, guildId), eq(groups.discordChannelId, channelId)));
    if (!g) throw notFound("Ce salon n'est lié à aucun groupe Forever Roster. Un officier peut le lier avec /forever-lier.");
    return g;
  }

  async function loadRaid(raidId: string) {
    const [r] = await db.select({ raid: raids, group: groups }).from(raids).innerJoin(groups, eq(groups.id, raids.groupId)).where(eq(raids.id, raidId));
    if (!r || !r.group.discordChannelId) throw notFound("Raid introuvable.");
    return r;
  }

  /** Persos placés dans la compo (dont le joueur est toujours membre du groupe). */
  async function placed(raid: typeof raids.$inferSelect) {
    const ids = raid.slots.flatMap(s => (s.characterId ? [s.characterId] : []));
    if (!ids.length) return new Map<string, { id: string; name: string; cls: string; spec1: string }>();
    const rows = await db.select({ id: characters.id, name: characters.name, cls: characters.cls, spec1: characters.spec1 }).from(characters)
      .innerJoin(groupMembers, and(eq(groupMembers.userId, characters.userId), eq(groupMembers.groupId, raid.groupId)))
      .where(inArray(characters.id, ids));
    return new Map(rows.map(r => [r.id, r]));
  }

  /** Tout ce qu'il faut au bot pour dessiner l'annonce, et le groupe de chaque inscrit placé. */
  async function layout(raidId: string) {
    const { raid, group } = await loadRaid(raidId);
    const signups = await listSignups(db, raid.id);
    const chars = await placed(raid);
    const bySignup = new Map(signups.map(s => [s.id, s]));
    const byChar = new Map(signups.filter(s => s.characterId).map(s => [s.characterId!, s]));
    // Place → membre affiché : perso du site, ou inscrit sans compte (classe et spé choisies sur Discord)
    const member = (slot: (typeof raid.slots)[number]) => {
      if (slot.signupId) {
        const g = bySignup.get(slot.signupId);
        return g && !g.userId ? { signupId: g.id, name: g.displayName, cls: g.cls, spec: g.spec } : null;
      }
      const c = chars.get(slot.characterId!);
      if (!c) return null;
      const su = byChar.get(c.id);
      return { signupId: su?.id ?? null, name: c.name, cls: c.cls, spec: su?.spec || c.spec1 || "" };
    };
    const live = raid.slots.flatMap(slot => { const m = member(slot); return m ? [{ slot, m }] : []; });
    const groupOfSignup = new Map(live.filter(x => x.m.signupId).map(x => [x.m.signupId!, x.slot.group]));
    // Composition validée par un officier : groupes 1 à 8, dans l'ordre des places
    const roster = raid.rosterPublishedAt ? {
      groups: Array.from({ length: RAID_GROUPS }, (_, i) => i + 1).map(g => ({
        group: g,
        members: live.filter(x => x.slot.group === g).sort((a, b) => a.slot.pos - b.slot.pos)
          .map(({ m }) => ({ name: m.name, cls: m.cls, spec: m.spec, role: m.spec ? roleOf(m.spec) : null })),
      })).filter(g => g.members.length),
    } : null;
    const view = {
      raid: {
        id: raid.id, name: raid.name, description: raid.description, scheduledAt: raid.scheduledAt,
        url: `${cfg.APP_ORIGIN}/groups/${group.id}/raids/${raid.id}`, changedAt: raid.discordChangedAt,
      },
      group: { id: group.id, name: group.name },
      channelId: group.discordChannelId!,
      // Message déjà publié dans le salon actuel du groupe (sinon : à publier)
      messageId: raid.discordChannelId === group.discordChannelId ? raid.discordMessageId : null,
      signups: signups.map(s => ({
        displayName: s.displayName, characterName: s.characterName, cls: s.cls, spec: s.spec, role: s.role,
        status: s.status, note: s.note, guest: !s.userId, group: groupOfSignup.get(s.id) ?? null,
      })),
      roster,
    };
    return { view, groupOfSignup };
  }

  const view = async (raidId: string) => (await layout(raidId)).view;


  /* ----- Liaison d'un salon à un groupe ----- */

  app.post("/internal/discord/bind", async (req: FastifyRequest) => {
    const body = parse(z.object({ code: z.string().trim().min(6).max(32), guildId: snowflake, channelId: snowflake, discordUserId: snowflake }), req.body);
    const [g] = await db.select().from(groups).where(and(eq(groups.discordLinkCodeHash, sha256(body.code.toUpperCase())), gt(groups.discordLinkCodeExpiresAt, new Date())));
    if (!g) throw badRequest("Code invalide ou expiré. Génère un nouveau code sur la page du groupe.");
    // Le code ne suffit pas : il faut aussi être officier du groupe, avec son Discord lié au site.
    const { user, role } = await linkedMember(body.discordUserId, g.id);
    if (!user) throw forbidden("Lie d'abord ton compte Discord au site (Compte & sécurité).");
    if (!role || RANK[role] < RANK.officer) throw forbidden("Réservé aux officiers du groupe.");
    await db.update(groups).set({ discordGuildId: body.guildId, discordChannelId: body.channelId, discordLinkCodeHash: null, discordLinkCodeExpiresAt: null }).where(eq(groups.id, g.id));
    // Les annonces restées dans l'ancien salon sont effacées
    await retireAnnouncements(db, g.id, body.channelId);
    // Les raids à venir seront (re)publiés dans ce salon
    await db.update(raids).set({ discordChangedAt: new Date() }).where(eq(raids.groupId, g.id));
    await audit(db, req, "group_discord_linked", { userId: user.id, groupId: g.id, meta: { guildId: body.guildId, channelId: body.channelId } });
    bus.group({ t: "group", g: g.id });
    return { group: { id: g.id, name: g.name } };
  });

  /* ----- Création d'un raid depuis Discord (/raid) ----- */

  app.post("/internal/discord/raids", async (req: FastifyRequest) => {
    const body = parse(z.object({
      guildId: snowflake, channelId: snowflake, discordUserId: snowflake,
      name: z.string().trim().min(2).max(60), scheduledAt: z.iso.datetime({ offset: true }), description: z.string().trim().max(1000).optional(),
    }), req.body);
    const g = await groupForChannel(body.guildId, body.channelId);
    const { user, role } = await linkedMember(body.discordUserId, g.id);
    if (!user) throw forbidden("Lie d'abord ton compte Discord au site (Compte & sécurité).");
    if (!role || RANK[role] < RANK.officer) throw forbidden("Seuls les officiers du groupe peuvent créer un raid.");
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(raids).where(eq(raids.groupId, g.id));
    if (n >= MAX_RAIDS_PER_GROUP) throw badRequest(`Limite de ${MAX_RAIDS_PER_GROUP} raids atteinte.`);
    const [r] = await db.insert(raids).values({
      groupId: g.id, name: body.name, scheduledAt: new Date(body.scheduledAt), description: body.description ?? "", createdBy: user.id,
    }).returning({ id: raids.id });
    await audit(db, req, "raid_created", { userId: user.id, groupId: g.id, meta: { raidId: r!.id, name: body.name, via: "discord" } });
    bus.group({ t: "raids", g: g.id });
    return view(r!.id);
  });

  /* ----- Annonces à publier / supprimer ----- */

  app.get("/internal/discord/outbox", async () => {
    const rows = await db.select({ id: raids.id }).from(raids).innerJoin(groups, eq(groups.id, raids.groupId))
      .where(and(
        isNotNull(groups.discordChannelId),
        or(isNull(raids.discordSyncedAt), lt(raids.discordSyncedAt, raids.discordChangedAt), sql`${raids.discordChannelId} IS DISTINCT FROM ${groups.discordChannelId}`),
        or(isNull(raids.scheduledAt), gt(raids.scheduledAt, new Date(Date.now() - KEEP_AFTER_MS))),
      ))
      .orderBy(asc(raids.discordChangedAt)).limit(20);
    const deletions = await db.select().from(discordDeletions).orderBy(asc(discordDeletions.id)).limit(20);
    return { raids: await Promise.all(rows.map(r => view(r.id))), deletions };
  });

  /** Le bot confirme avoir publié la version « changedAt » : si un changement est arrivé entre-temps, le raid reste à republier. */
  app.post("/internal/discord/raids/:raidId/published", async (req: FastifyRequest) => {
    const { raidId } = parse(raidParam, req.params);
    const body = parse(z.object({ channelId: snowflake, messageId: snowflake, changedAt: z.iso.datetime({ offset: true }) }), req.body);
    await db.update(raids).set({ discordChannelId: body.channelId, discordMessageId: body.messageId, discordSyncedAt: new Date(body.changedAt) })
      .where(eq(raids.id, raidId));
    return { ok: true };
  });

  app.delete("/internal/discord/deletions/:id", async (req: FastifyRequest) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    await db.delete(discordDeletions).where(eq(discordDeletions.id, id));
    return { ok: true };
  });

  /* ----- Rappels de la veille ----- */

  /**
   * Réserve les raids dont le rappel est dû (entre 24 h et 1 h avant, salon lié) et renvoie les destinataires.
   * La réservation est atomique : un rappel n'est jamais envoyé deux fois, même si deux bots tournaient.
   */
  app.post("/internal/discord/reminders/claim", async () => {
    const now = Date.now();
    const due = await db.select({ id: raids.id }).from(raids).innerJoin(groups, eq(groups.id, raids.groupId))
      .where(and(
        isNotNull(groups.discordChannelId), isNull(raids.reminderSentAt),
        gt(raids.scheduledAt, new Date(now + 3600e3)), lte(raids.scheduledAt, new Date(now + 24 * 3600e3)),
      )).limit(10);
    if (!due.length) return { reminders: [] };
    const claimed = await db.update(raids).set({ reminderSentAt: new Date() })
      .where(and(inArray(raids.id, due.map(d => d.id)), isNull(raids.reminderSentAt))).returning({ id: raids.id });
    const reminders = [];
    for (const { id } of claimed) {
      const { view: v, groupOfSignup } = await layout(id);
      // Inscrits qui viennent (ou peut-être) : compte lié avec rappels activés, ou inscription libre
      const rows = await db.select({
        id: raidSignups.id, status: raidSignups.status, displayName: raidSignups.displayName, spec: raidSignups.spec, cls: raidSignups.cls,
        characterName: characters.name, guestId: raidSignups.discordUserId, linkedId: users.discordId, wants: users.discordReminders,
      }).from(raidSignups)
        .leftJoin(users, eq(users.id, raidSignups.userId))
        .leftJoin(characters, eq(characters.id, raidSignups.characterId))
        .where(and(eq(raidSignups.raidId, id), ne(raidSignups.status, "absent")));
      const recipients = rows.flatMap(r => {
        const discordUserId = r.guestId ?? (r.wants ? r.linkedId : null);
        if (!discordUserId) return [];
        return [{
          discordUserId, status: r.status, name: r.characterName ?? r.displayName, cls: r.cls, spec: r.spec, guest: !!r.guestId,
          group: v.roster ? groupOfSignup.get(r.id) ?? null : null,
        }];
      });
      reminders.push({ view: v, recipients });
    }
    return { reminders };
  });

  /* ----- Inscription depuis un bouton ----- */

  app.get("/internal/discord/raids/:raidId/view", async (req: FastifyRequest) => view(parse(raidParam, req.params).raidId));

  /** Ce que le joueur peut choisir : ses persos (compte lié et membre) ou classe + spé (inscription libre). */
  app.get("/internal/discord/raids/:raidId/choices", async (req: FastifyRequest) => {
    const { raidId } = parse(raidParam, req.params);
    const { discordUserId } = parse(z.object({ discordUserId: snowflake }), req.query);
    const { group } = await loadRaid(raidId);
    const { user, role } = await linkedMember(discordUserId, group.id);
    const [current] = await db.select({ status: raidSignups.status, characterId: raidSignups.characterId, cls: raidSignups.cls, spec: raidSignups.spec }).from(raidSignups)
      .where(and(eq(raidSignups.raidId, raidId), user && role ? eq(raidSignups.userId, user.id) : eq(raidSignups.discordUserId, discordUserId)));
    if (!user || !role) return { mode: "guest" as const, linked: !!user, current: current ?? null };
    const chars = await db.select({ id: characters.id, name: characters.name, cls: characters.cls, spec1: characters.spec1, spec2: characters.spec2 })
      .from(characters).where(eq(characters.userId, user.id)).orderBy(asc(characters.sortOrder));
    return {
      mode: "member" as const, linked: true, current: current ?? null,
      characters: chars.filter(c => c.cls).map(c => ({
        ...c, specs: ((CLASS_SPECS as Record<string, SpecDef[]>)[c.cls] ?? []).map(d => ({ name: d.name, role: d.role })),
      })),
    };
  });

  app.post("/internal/discord/raids/:raidId/signup", async (req: FastifyRequest) => {
    const { raidId } = parse(raidParam, req.params);
    const body = parse(z.object({
      discordUserId: snowflake, discordName: z.string().trim().min(1).max(64),
      status: z.enum(SIGNUP_STATUSES), characterId: z.uuid().nullable().optional(), cls: z.string().max(20).optional(), spec: z.string().max(20).optional(),
    }), req.body);
    const { raid, group } = await loadRaid(raidId);
    if (raid.scheduledAt && raid.scheduledAt.getTime() < Date.now() - KEEP_AFTER_MS) throw badRequest("Les inscriptions de ce raid sont closes.");
    const { user, role } = await linkedMember(body.discordUserId, group.id);
    if (user && role) {
      await signUpSiteUser(db, raidId, user, { status: body.status, characterId: body.characterId ?? null, spec: body.spec });
      // Une éventuelle inscription libre faite avant la liaison du compte est remplacée
      await db.delete(raidSignups).where(and(eq(raidSignups.raidId, raidId), eq(raidSignups.discordUserId, body.discordUserId), isNull(raidSignups.userId)));
    } else {
      await signUpDiscordGuest(db, raidId, { discordUserId: body.discordUserId, displayName: body.discordName }, { status: body.status, cls: body.cls, spec: body.spec });
    }
    return view(raidId);
  });

  app.delete("/internal/discord/raids/:raidId/signup/:discordUserId", async (req: FastifyRequest) => {
    const { raidId, discordUserId } = parse(raidParam.extend({ discordUserId: snowflake }), req.params);
    const { group } = await loadRaid(raidId);
    const { user, role } = await linkedMember(discordUserId, group.id);
    await db.delete(raidSignups).where(and(eq(raidSignups.raidId, raidId),
      user && role ? eq(raidSignups.userId, user.id) : and(eq(raidSignups.discordUserId, discordUserId), isNull(raidSignups.userId))));
    await touchRaid(db, raidId);
    return view(raidId);
  });

  return app;
}

export type InternalApp = FastifyInstance;
