import { RAID_GROUPS, roleOf, SIGNUP_STATUSES, specLabel, specsOf } from "@forever/game-data";
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppContext } from "./app";
import { characters, craftOrders, discordDeletions, groupCharacters, groupMembers, groups, raidAsks, raidSignups, raids, reports, users } from "./db/schema";
import { feedbackRoutes } from "./internal-feedback";
import { audit } from "./lib/audit";
import { safeEqual, sha256 } from "./lib/crypto";
import { HttpError, badRequest, forbidden, notFound, parse } from "./lib/http";
import { MAX_RAIDS_PER_GROUP } from "./lib/recurring";
import { bus } from "./lib/events";
import { canDm, NUDGE_GRACE_MS, pendingMembers } from "./lib/reach";
import { applyAbsencesToRaid } from "./lib/absences";
import { inheritPrep } from "./lib/prep";
import { orderDiscordView, retireOrderMessages } from "./lib/orders";
import { bindReportsChannel, reportDiscordView, reportsChannel } from "./lib/reports";
import { listSignups, retireAnnouncements, signUpDiscordGuest, signUpSiteUser, touchRaid } from "./lib/signups";
import { siteForGame } from "./lib/site";
import { formatFor } from "./routes/raids";

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
    if (!g) throw notFound("Ce salon n'est lié à aucun groupe (Forever Roster ou Roster). Un officier peut le lier avec /forever-lier ou /roster-lier.");
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
      .innerJoin(groupCharacters, and(eq(groupCharacters.characterId, characters.id), eq(groupCharacters.groupId, raid.groupId)))
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
        url: `${siteForGame(cfg, group.game).origin}/groups/${group.id}/raids/${raid.id}`, changedAt: raid.discordChangedAt, size: raid.size,
        difficulty: raid.difficulty,
      },
      group: { id: group.id, name: group.name, game: group.game },
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
    const hash = sha256(body.code.toUpperCase());
    const [g] = await db.select().from(groups).where(and(eq(groups.discordLinkCodeHash, hash), gt(groups.discordLinkCodeExpiresAt, new Date())));
    if (!g) {
      // Code du salon des commandes d'artisanat (lot F)
      const [o] = await db.select().from(groups).where(and(eq(groups.ordersLinkCodeHash, hash), gt(groups.ordersLinkCodeExpiresAt, new Date())));
      if (!o) throw badRequest("Code invalide ou expiré. Génère un nouveau code sur la page du groupe.");
      const { user, role } = await linkedMember(body.discordUserId, o.id);
      if (!user) throw forbidden("Lie d'abord ton compte Discord au site (Compte & sécurité).");
      if (!role || RANK[role] < RANK.officer) throw forbidden("Réservé aux officiers du groupe.");
      await db.update(groups).set({ ordersGuildId: body.guildId, ordersChannelId: body.channelId, ordersLinkCodeHash: null, ordersLinkCodeExpiresAt: null }).where(eq(groups.id, o.id));
      await retireOrderMessages(db, o.id, body.channelId);
      // Les commandes en cours seront (re)publiées dans ce salon
      await db.update(craftOrders).set({ discordChangedAt: new Date() }).where(and(eq(craftOrders.groupId, o.id), ne(craftOrders.status, "done")));
      await audit(db, req, "group_orders_linked", { userId: user.id, groupId: o.id, meta: { guildId: body.guildId, channelId: body.channelId } });
      bus.group({ t: "group", g: o.id });
      return { group: { id: o.id, name: o.name }, kind: "orders" as const };
    }
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
    return { group: { id: g.id, name: g.name }, kind: "raids" as const };
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
      // Format par défaut du jeu du groupe (Roster : Normal, 20 joueurs ; Forever : 40)
      ...formatFor(g.game, body.name),
    }).returning({ id: raids.id });
    await audit(db, req, "raid_created", { userId: user.id, groupId: g.id, meta: { raidId: r!.id, name: body.name, via: "discord" } });
    await inheritPrep(db, [r!.id]);
    await applyAbsencesToRaid(db, r!.id);
    bus.group({ t: "raids", g: g.id });
    return view(r!.id);
  });

  /* ----- Annonces à publier / supprimer ----- */

  app.get("/internal/discord/outbox", async () => {
    const rows = await db.select({ id: raids.id }).from(raids).innerJoin(groups, eq(groups.id, raids.groupId))
      .where(and(
        isNotNull(groups.discordChannelId),
        // Comparaison à la milliseconde : la date confirmée par le bot passe par JavaScript (ms), la base garde les µs
        or(isNull(raids.discordSyncedAt), sql`${raids.discordSyncedAt} < date_trunc('milliseconds', ${raids.discordChangedAt})`, sql`${raids.discordChannelId} IS DISTINCT FROM ${groups.discordChannelId}`),
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

  /* ----- Relance des sans-réponse (lot D2) ----- */

  /**
   * Réserve les relances dues : automatiques (dans le délai du groupe, une fois par raid, pas pour un raid tout juste
   * créé) et demandées par un officier (« Relancer maintenant »). Renvoie qui relancer, qui n'est pas joignable, et
   * les officiers à prévenir (relance automatique seulement).
   */
  app.post("/internal/discord/nudges/claim", async () => {
    const now = Date.now();
    const linked = and(isNotNull(groups.discordChannelId), gt(raids.scheduledAt, new Date(now + 3600e3)));
    const autoDue = await db.select({ id: raids.id }).from(raids).innerJoin(groups, eq(groups.id, raids.groupId))
      .where(and(linked, isNotNull(groups.nudgeHours), isNull(raids.nudgeAutoAt), lt(raids.createdAt, new Date(now - NUDGE_GRACE_MS)),
        sql`${raids.scheduledAt} <= now() + make_interval(hours => ${groups.nudgeHours}::int)`)).limit(10);
    const manualDue = await db.select({ id: raids.id }).from(raids).innerJoin(groups, eq(groups.id, raids.groupId))
      .where(and(linked, isNotNull(raids.nudgeRequestedAt))).limit(10);
    const auto = autoDue.length ? await db.update(raids).set({ nudgeAutoAt: new Date() })
      .where(and(inArray(raids.id, autoDue.map(d => d.id)), isNull(raids.nudgeAutoAt))).returning({ id: raids.id }) : [];
    const manual = manualDue.length ? await db.update(raids).set({ nudgeRequestedAt: null })
      .where(and(inArray(raids.id, manualDue.map(d => d.id)), isNotNull(raids.nudgeRequestedAt))).returning({ id: raids.id }) : [];
    const autoIds = new Set(auto.map(a => a.id));
    const nudges = [];
    for (const id of new Set([...autoIds, ...manual.map(m => m.id)])) {
      const v = await view(id);
      const [g] = await db.select({ officers: groups.nudgeOfficers }).from(groups).where(eq(groups.id, v.group.id));
      const pending = await pendingMembers(db, v.group.id, id);
      if (!pending.length) continue;
      const label = (m: (typeof pending)[number]) => (m.main && m.main.name !== m.displayName ? `${m.displayName} (${m.main.name})` : m.displayName);
      const officers = autoIds.has(id) && g?.officers
        ? (await db.select({ discordId: users.discordId, reminders: users.discordReminders }).from(groupMembers).innerJoin(users, eq(users.id, groupMembers.userId))
          .where(and(eq(groupMembers.groupId, v.group.id), ne(groupMembers.role, "member")))).filter(canDm).map(o => o.discordId!)
        : [];
      nudges.push({
        view: v, auto: autoIds.has(id),
        recipients: pending.filter(canDm).map(m => ({ discordUserId: m.discordId!, name: label(m) })),
        unreachable: pending.filter(m => !canDm(m)).map(m => ({ name: label(m), why: m.discordId ? "dm-off" : "no-discord" })),
        officers,
      });
    }
    return { nudges };
  });

  /* ----- « Demander à X » (lot D2) ----- */

  /** Réserve les demandes à envoyer (raid à venir, salon lié) : chacune n'est envoyée qu'une fois. */
  app.post("/internal/discord/asks/claim", async () => {
    const due = await db.select({ id: raidAsks.id }).from(raidAsks)
      .innerJoin(raids, eq(raids.id, raidAsks.raidId)).innerJoin(groups, eq(groups.id, raids.groupId))
      .where(and(isNull(raidAsks.sentAt), isNotNull(groups.discordChannelId), gt(raids.scheduledAt, new Date()))).limit(20);
    if (!due.length) return { asks: [] };
    const claimed = await db.update(raidAsks).set({ sentAt: new Date() })
      .where(and(inArray(raidAsks.id, due.map(d => d.id)), isNull(raidAsks.sentAt))).returning({ id: raidAsks.id });
    const asks = [];
    for (const { id } of claimed) {
      const [a] = await db.select({
        id: raidAsks.id, raidId: raidAsks.raidId, userId: raidAsks.userId, spec: raidAsks.spec, askedByName: raidAsks.askedByName,
        discordUserId: users.discordId, reminders: users.discordReminders, name: characters.name, cls: characters.cls,
      }).from(raidAsks).innerJoin(users, eq(users.id, raidAsks.userId)).innerJoin(characters, eq(characters.id, raidAsks.characterId))
        .where(eq(raidAsks.id, id));
      if (!a) continue;
      if (!canDm({ discordId: a.discordUserId, reminders: a.reminders })) { await askFailed(id); continue; }
      const v = await view(a.raidId);
      const [cur] = await db.select({ status: raidSignups.status, characterName: characters.name }).from(raidSignups)
        .leftJoin(characters, eq(characters.id, raidSignups.characterId))
        .where(and(eq(raidSignups.raidId, a.raidId), eq(raidSignups.userId, a.userId)));
      asks.push({
        id: a.id, discordUserId: a.discordUserId!, character: { name: a.name, cls: a.cls }, spec: a.spec, role: roleOf(a.spec), askedBy: a.askedByName,
        current: cur ?? null, raid: { id: v.raid.id, name: v.raid.name, scheduledAt: v.raid.scheduledAt, url: v.raid.url }, group: v.group,
      });
    }
    return { asks };
  });

  async function askFailed(id: string) {
    const [a] = await db.update(raidAsks).set({ failed: true }).where(eq(raidAsks.id, id)).returning({ raidId: raidAsks.raidId });
    if (a) await notifyRaid(a.raidId);
  }
  /** Prévient les pages ouvertes du site (sans republier l'annonce Discord). */
  async function notifyRaid(raidId: string) {
    const [r] = await db.select({ g: raids.groupId }).from(raids).where(eq(raids.id, raidId));
    if (r) bus.group({ t: "raid", g: r.g, r: raidId });
  }

  /** Le MP n'a pas pu être envoyé (MP fermés, plus de serveur en commun) : l'officier le verra sur le site. */
  app.post("/internal/discord/asks/:id/failed", async (req: FastifyRequest) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await askFailed(id);
    return { ok: true };
  });

  /** Réponse du joueur (bouton du MP). « Oui » l'inscrit présent avec ce perso, dans cette spé. */
  app.post("/internal/discord/asks/:id/answer", async (req: FastifyRequest) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const body = parse(z.object({ discordUserId: snowflake, yes: z.boolean() }), req.body);
    const [a] = await db.select({ ask: raidAsks, discordId: users.discordId, displayName: users.displayName, name: characters.name, cls: characters.cls })
      .from(raidAsks).innerJoin(users, eq(users.id, raidAsks.userId)).innerJoin(characters, eq(characters.id, raidAsks.characterId))
      .where(eq(raidAsks.id, id));
    // Demande annulée, ou bouton cliqué par quelqu'un d'autre (custom_id forgé) : même réponse, rien n'est révélé
    if (!a || a.discordId !== body.discordUserId) throw notFound("Cette demande n'existe plus : l'officier l'a peut-être annulée.");
    const { raid, group } = await loadRaid(a.ask.raidId);
    if (a.ask.answer) return { answer: a.ask.answer, character: a.name, spec: specLabel(group.game, a.cls, a.ask.spec, "fr"), url: `${siteForGame(cfg, group.game).origin}/groups/${group.id}/raids/${raid.id}`, view: null, already: true };
    if (!raid.scheduledAt || raid.scheduledAt.getTime() < Date.now()) throw badRequest("Ce raid est déjà passé.");
    const [m] = await db.select({ role: groupMembers.role }).from(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, a.ask.userId)));
    if (!m) throw forbidden("Tu ne fais plus partie de ce groupe.");
    if (body.yes) await signUpSiteUser(db, raid.id, { id: a.ask.userId, displayName: a.displayName }, { status: "present", characterId: a.ask.characterId, spec: a.ask.spec });
    await db.update(raidAsks).set({ answer: body.yes ? "yes" : "no", answeredAt: new Date() }).where(eq(raidAsks.id, id));
    await notifyRaid(raid.id);
    return { answer: body.yes ? "yes" as const : "no" as const, character: a.name, spec: specLabel(group.game, a.cls, a.ask.spec, "fr"), url: `${siteForGame(cfg, group.game).origin}/groups/${group.id}/raids/${raid.id}`, view: body.yes ? await view(raid.id) : null, already: false };
  });

  /* ----- Signalements (bug, idée, question) dans le salon des admins ----- */

  /** /signalements-lier : un admin du site (Discord lié) choisit le salon où arrivent les signalements. */
  app.post("/internal/discord/reports/bind", async (req: FastifyRequest) => {
    const body = parse(z.object({ guildId: snowflake, channelId: snowflake, discordUserId: snowflake }), req.body);
    const [u] = await db.select({ id: users.id, siteAdmin: users.siteAdmin }).from(users).where(eq(users.discordId, body.discordUserId));
    if (!u) throw forbidden("Lie d'abord ton compte Discord au site (Compte & sécurité).");
    if (!u.siteAdmin) throw forbidden("Réservé aux admins du site.");
    await bindReportsChannel(db, { guildId: body.guildId, channelId: body.channelId });
    await audit(db, req, "reports_channel_linked", { userId: u.id, meta: { guildId: body.guildId, channelId: body.channelId } });
    return { ok: true };
  });

  /** Signalements à publier ou à mettre à jour (statut, réponse) : ceux des 30 derniers jours. */
  app.get("/internal/discord/reports/outbox", async () => {
    const ch = await reportsChannel(db);
    if (!ch) return { reports: [] };
    const rows = await db.select().from(reports).where(and(
      gt(reports.createdAt, new Date(Date.now() - 30 * 86400e3)),
      // La capture arrive juste après l'envoi : on lui laisse 30 s pour partir avec le premier message
      or(isNotNull(reports.image), lt(reports.createdAt, new Date(Date.now() - 30e3))),
      or(isNull(reports.discordSyncedAt), sql`${reports.discordSyncedAt} < date_trunc('milliseconds', ${reports.discordChangedAt})`,
        sql`${reports.discordChannelId} IS DISTINCT FROM ${ch.channelId}`),
    )).orderBy(asc(reports.discordChangedAt)).limit(20);
    return { reports: rows.map(r => reportDiscordView(r, ch.channelId, g => siteForGame(cfg, g).origin)) };
  });

  /** Capture jointe au message du salon des admins. */
  app.get("/internal/discord/reports/:id/image", async (req: FastifyRequest, reply) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const [r] = await db.select({ image: reports.image }).from(reports).where(eq(reports.id, id));
    if (!r?.image) throw notFound("Image introuvable.");
    return reply.type("image/webp").send(r.image);
  });

  app.post("/internal/discord/reports/:id/published", async (req: FastifyRequest) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const body = parse(z.object({ channelId: snowflake, messageId: snowflake, changedAt: z.iso.datetime({ offset: true }) }), req.body);
    await db.update(reports).set({ discordChannelId: body.channelId, discordMessageId: body.messageId, discordSyncedAt: new Date(body.changedAt) }).where(eq(reports.id, id));
    return { ok: true };
  });

  /* ----- Commandes d'artisanat dans leur salon (lot F) ----- */

  /** Commandes à publier ou mettre à jour (en cours, ou faites depuis moins de 2 jours). */
  app.get("/internal/discord/orders/outbox", async () => {
    const rows = await db.select({ id: craftOrders.id }).from(craftOrders).innerJoin(groups, eq(groups.id, craftOrders.groupId))
      .where(and(
        isNotNull(groups.ordersChannelId),
        or(isNull(craftOrders.discordSyncedAt), sql`${craftOrders.discordSyncedAt} < date_trunc('milliseconds', ${craftOrders.discordChangedAt})`, sql`${craftOrders.discordChannelId} IS DISTINCT FROM ${groups.ordersChannelId}`),
        or(ne(craftOrders.status, "done"), gt(craftOrders.doneAt, new Date(Date.now() - 2 * 86400e3))),
      )).orderBy(asc(craftOrders.discordChangedAt)).limit(20);
    const orders = [];
    for (const r of rows) { const v = await orderDiscordView(db, g => siteForGame(cfg, g).origin, r.id); if (v) orders.push(v); }
    return { orders };
  });

  app.post("/internal/discord/orders/:id/published", async (req: FastifyRequest) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const body = parse(z.object({ channelId: snowflake, messageId: snowflake, changedAt: z.iso.datetime({ offset: true }) }), req.body);
    await db.update(craftOrders).set({ discordChannelId: body.channelId, discordMessageId: body.messageId, discordSyncedAt: new Date(body.changedAt) }).where(eq(craftOrders.id, id));
    return { ok: true };
  });

  /** « Je m'en charge » depuis Discord : un membre du groupe avec son compte lié. */
  app.post("/internal/discord/orders/:id/take", async (req: FastifyRequest) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const body = parse(z.object({ discordUserId: snowflake }), req.body);
    const [o] = await db.select().from(craftOrders).where(eq(craftOrders.id, id));
    if (!o) throw notFound("Cette commande n'existe plus.");
    const { user, role } = await linkedMember(body.discordUserId, o.groupId);
    if (!user) throw forbidden("Lie d'abord ton compte Discord au site (Compte & sécurité) pour prendre une commande.");
    if (!role) throw forbidden("Tu n'es pas membre de ce groupe.");
    if (o.requesterId === user.id) throw badRequest("C'est ta propre commande.");
    if (o.status !== "open") throw badRequest(o.status === "taken" ? "Quelqu'un s'en charge déjà." : "Cette commande est déjà faite.");
    await db.update(craftOrders).set({ status: "taken", takerId: user.id, takenAt: new Date(), discordChangedAt: new Date() })
      .where(and(eq(craftOrders.id, id), eq(craftOrders.status, "open")));
    bus.group({ t: "group", g: o.groupId });
    return { view: await orderDiscordView(db, g => siteForGame(cfg, g).origin, id) };
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
    if (!user || !role) return { mode: "guest" as const, linked: !!user, current: current ?? null, game: group.game };
    // Persos rangés dans ce groupe (main en tête), puis ceux sans groupe (s'inscrire les y range) ; pas ceux d'un autre groupe
    // Persos du jeu du groupe seulement (un compte peut avoir des persos de Forever et de Retail)
    const all = await db.select({ id: characters.id, name: characters.name, cls: characters.cls, spec1: characters.spec1, spec2: characters.spec2, isMain: groupCharacters.isMain, groupId: groupCharacters.groupId })
      .from(characters)
      .leftJoin(groupCharacters, eq(groupCharacters.characterId, characters.id))
      .where(and(eq(characters.userId, user.id), eq(characters.game, group.game))).orderBy(asc(characters.sortOrder));
    const here = all.filter(c => c.groupId === group.id).sort((a, b) => Number(!!b.isMain) - Number(!!a.isMain));
    const chars = [...here, ...all.filter(c => !c.groupId)].map(({ isMain: _, groupId: __, ...c }) => c);
    return {
      mode: "member" as const, linked: true, current: current ?? null, game: group.game,
      characters: chars.filter(c => c.cls).map(c => ({
        ...c, specs: specsOf(group.game, c.cls).map(name => ({ name, role: roleOf(name) ?? "DPS" })),
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

  feedbackRoutes(app, db, cfg);
  return app;
}

export type InternalApp = FastifyInstance;
