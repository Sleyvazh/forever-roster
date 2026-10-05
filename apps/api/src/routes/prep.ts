import { bossKey, CONSUMABLE_TARGETS, gameName, knownBosses, PREP_LIMITS, RAID_INSTANCES, specDef, type RaidPrep } from "@forever/game-data";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { characters, gameItems, groupCharacters, groupMembers, raidLogs, raids, raidSignups, users } from "../db/schema";
import { audit } from "../lib/audit";
import { bus } from "../lib/events";
import { membership, requireRole } from "../lib/groups";
import { notFound, parse } from "../lib/http";
import { groupNames } from "../lib/prep";
import { currentUser, requireAuth } from "../lib/session";

/**
 * Onglet « Préparation » d'un raid (lot G) : consommables demandés et qui est prêt, fiches de boss ; et le conseil
 * du butin choisi pour ce raid (onglet Butin). Lecture par tous les membres, modification par les officiers.
 */

const rid = z.object({ id: z.uuid(), raidId: z.uuid() });
const L = PREP_LIMITS;
const prepInput = z.object({
  instance: z.enum(RAID_INSTANCES.map(i => i.key) as [string, ...string[]]).nullable(),
  consumables: z.array(z.object({ itemId: z.int().positive(), n: z.int().min(1).max(200), for: z.enum(CONSUMABLE_TARGETS) })).max(L.consumables),
  bosses: z.array(z.object({
    name: z.string().trim().min(1).max(60),
    encounterId: z.int().positive().nullable(),
    npcIds: z.array(z.int().positive()).max(8),
    rows: z.array(z.object({
      label: z.string().trim().max(L.label),
      characterIds: z.array(z.uuid()).max(L.characters),
      text: z.string().trim().max(L.text),
    })).max(L.rows),
  })).max(L.bosses),
});

const COMING = ["present", "late", "tentative", "bench"] as const;

export async function prepRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  async function loadRaid(groupId: string, raidId: string) {
    const [r] = await db.select({ id: raids.id, name: raids.name, prep: raids.prep, council: raids.council }).from(raids).where(and(eq(raids.id, raidId), eq(raids.groupId, groupId)));
    if (!r) throw notFound("Raid introuvable.");
    return r;
  }

  app.get("/:id/raids/:raidId/prep", async (req) => {
    const u = currentUser(req);
    const p = parse(rid, req.params);
    const role = await membership(db, p.id, u.id);
    const r = await loadRaid(p.id, p.raidId);

    // Inscrits qui viennent (ou hésitent), avec le perso choisi et ses consommables comptés à la synchro
    const signups = await db.select({
      id: raidSignups.id, userId: raidSignups.userId, displayName: raidSignups.displayName, characterId: raidSignups.characterId,
      cls: raidSignups.cls, spec: raidSignups.spec, status: raidSignups.status,
      name: characters.name, counts: characters.consumables, countedAt: characters.consumablesAt, syncedAt: characters.addonSyncedAt,
    }).from(raidSignups).leftJoin(characters, eq(characters.id, raidSignups.characterId))
      .where(and(eq(raidSignups.raidId, r.id), inArray(raidSignups.status, [...COMING])));
    const [log] = await db.select({ call: raidLogs.consumableCall }).from(raidLogs).where(eq(raidLogs.raidId, r.id));
    const call = log?.call ?? null;
    const callOf = new Map((call?.counts ?? []).map(c => [c.name.toLowerCase(), c.items]));
    const roster = signups.map(s => {
      const name = s.name ?? s.displayName;
      const fromCall = callOf.get(gameName(name).toLowerCase());
      const callNewer = call && fromCall !== undefined && (!s.countedAt || call.at * 1000 >= s.countedAt.getTime());
      return {
        signupId: s.id, characterId: s.characterId, name, cls: s.cls, spec: s.spec, role: specDef(s.cls, s.spec)?.role ?? null, status: s.status,
        counts: callNewer ? fromCall : s.countedAt ? s.counts : null,
        source: callNewer ? (fromCall ? "call" : "noaddon") : s.countedAt ? "sync" : s.syncedAt ? "nocount" : "never",
        at: callNewer ? new Date(call.at * 1000).toISOString() : s.countedAt?.toISOString() ?? null,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const ids = r.prep.consumables.map(c => c.itemId);
    const items = ids.length ? await db.select({ id: gameItems.id, name: gameItems.name, quality: gameItems.quality }).from(gameItems).where(inArray(gameItems.id, ids)) : [];
    // Persos du groupe (pour les fiches) et membres (pour le conseil)
    const chars = await db.select({ id: characters.id, name: characters.name, cls: characters.cls }).from(groupCharacters)
      .innerJoin(characters, eq(characters.id, groupCharacters.characterId)).where(eq(groupCharacters.groupId, p.id)).orderBy(characters.name);
    const members = await db.select({ userId: groupMembers.userId, role: groupMembers.role, name: users.displayName }).from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId)).where(eq(groupMembers.groupId, p.id));
    return {
      prep: r.prep, canEdit: role !== "member",
      known: knownBosses(r.prep.instance), instances: RAID_INSTANCES.map(i => ({ key: i.key, name: i.name })),
      items: Object.fromEntries(items.map(i => [i.id, i])),
      characters: chars, roster,
      call: call ? { at: new Date(call.at * 1000).toISOString(), by: call.by } : null,
      council: r.council, members: members.map(m => ({ userId: m.userId, name: m.name, officer: m.role !== "member" })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  app.put("/:id/raids/:raidId/prep", async (req) => {
    const u = currentUser(req);
    const p = parse(rid, req.params);
    await requireRole(db, p.id, u.id, "officer");
    const r = await loadRaid(p.id, p.raidId);
    const body = parse(prepInput, req.body);
    // Noms des objets recopiés (comme les commandes) ; persos hors du groupe écartés
    const ids = [...new Set(body.consumables.map(c => c.itemId))];
    const names = ids.length ? new Map((await db.select({ id: gameItems.id, name: gameItems.name }).from(gameItems).where(inArray(gameItems.id, ids))).map(i => [i.id, i.name])) : new Map<number, string>();
    const { byId } = await groupNames(db, p.id);
    const prep: RaidPrep = {
      instance: body.instance,
      consumables: body.consumables.map(c => ({ ...c, name: names.get(c.itemId) ?? `Objet ${c.itemId}` })),
      // Les fiches vides des boss connus ne sont pas gardées (ils restent proposés) ; un boss ajouté à la main reste
      bosses: body.bosses.map(b => ({ ...b, rows: b.rows.map(row => ({ ...row, characterIds: [...new Set(row.characterIds)].filter(id => byId.has(id)) })) }))
        .filter(b => b.rows.length || !knownBosses(body.instance).some(k => bossKey(k.name) === bossKey(b.name))),
    };
    await db.update(raids).set({ prep, updatedAt: new Date() }).where(eq(raids.id, r.id));
    bus.group({ t: "raid", g: p.id, r: r.id });
    return { prep };
  });

  /** Conseil du butin de ce raid (loot council) : null = les officiers du groupe. */
  app.put("/:id/raids/:raidId/council", async (req) => {
    const u = currentUser(req);
    const p = parse(rid, req.params);
    await requireRole(db, p.id, u.id, "officer");
    const r = await loadRaid(p.id, p.raidId);
    const { userIds } = parse(z.object({ userIds: z.array(z.uuid()).max(15).nullable() }), req.body);
    let council: string[] | null = null;
    if (userIds) {
      const inGroup = new Set((await db.select({ id: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, p.id))).map(m => m.id));
      council = [...new Set(userIds)].filter(id => inGroup.has(id));
    }
    await db.update(raids).set({ council, updatedAt: new Date() }).where(eq(raids.id, r.id));
    await audit(db, req, "raid_council", { userId: u.id, groupId: p.id, meta: { raidId: r.id, members: council?.length ?? null } });
    bus.group({ t: "raid", g: p.id, r: r.id });
    return { council };
  });
}
