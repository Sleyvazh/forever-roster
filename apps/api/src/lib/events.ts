import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { groupMembers, raids } from "../db/schema";

/**
 * Événements en direct vers les pages ouvertes (Server-Sent Events, route /api/events).
 * Un événement dit seulement « ceci a changé » : la page recharge les données par les routes
 * habituelles, qui appliquent les contrôles d'accès. Rien de sensible ne transite ici.
 * Tout est en mémoire : l'API tourne en un seul processus.
 */
export type LiveEvent =
  | { t: "raid"; g: string; r: string; by?: string | null; byName?: string | null } // un raid (compo, inscriptions, infos)
  | { t: "raids"; g: string }   // la liste des raids ou des raids récurrents d'un groupe
  | { t: "group"; g: string }   // nom, membres, invitations, salon Discord
  | { t: "chars"; g: string }   // persos, équipement, métiers ou patrons d'un membre
  | { t: "feedback"; g: string } // avis Discord suivis par le groupe (Administration → Avis)
  | { t: "membership" };        // l'utilisateur a rejoint ou quitté un groupe

interface Conn { userId: string; groups: Set<string>; send: (e: LiveEvent) => void }

class EventBus {
  private conns = new Set<Conn>();
  get size() { return this.conns.size; }

  add(conn: Conn) { this.conns.add(conn); return () => { this.conns.delete(conn); }; }

  /** À tous les membres connectés du groupe. */
  group(e: Exclude<LiveEvent, { t: "membership" }>) {
    for (const c of this.conns) if (c.groups.has(e.g)) c.send(e);
  }

  /** L'appartenance d'un utilisateur a changé : on relit ses groupes et on le prévient. */
  async membership(db: Db, userId: string) {
    const mine = [...this.conns].filter(c => c.userId === userId);
    if (!mine.length) return;
    const groups = await groupsOf(db, userId);
    for (const c of mine) { c.groups = new Set(groups); c.send({ t: "membership" }); }
  }
}

export const bus = new EventBus();

export async function groupsOf(db: Db, userId: string) {
  return (await db.select({ g: groupMembers.groupId }).from(groupMembers).where(eq(groupMembers.userId, userId))).map(r => r.g);
}

/** Événement « chars » pour chaque groupe dont le joueur fait partie. */
export async function charsChanged(db: Db, userId: string) {
  for (const g of await groupsOf(db, userId)) bus.group({ t: "chars", g });
}

/** Événement « raid » à partir du seul identifiant du raid. */
export async function raidChanged(db: Db, raidId: string, by?: { id: string; displayName: string } | null) {
  const [r] = await db.select({ g: raids.groupId }).from(raids).where(eq(raids.id, raidId));
  if (r) bus.group({ t: "raid", g: r.g, r: raidId, by: by?.id ?? null, byName: by?.displayName ?? null });
}
