import type { RaidSlot } from "../db/schema";

/**
 * Fusion à trois voies de la compo d'un raid : quand deux officiers la modifient en même temps,
 * on garde les déplacements de chacun ; s'ils ont touché le même perso, ou mis deux persos à la même place,
 * c'est un conflit et le second doit recharger.
 */
export const slotKey = (s: RaidSlot) => (s.characterId ? `c:${s.characterId}` : `s:${s.signupId}`);
const seatOf = (list: RaidSlot[]) => new Map(list.map(s => [slotKey(s), `${s.group}:${s.pos}`]));

export type MergeResult = { ok: true; slots: RaidSlot[] } | { ok: false; reason: string };

export function mergeSlots(base: RaidSlot[], mine: RaidSlot[], theirs: RaidSlot[]): MergeResult {
  const B = seatOf(base), M = seatOf(mine), T = seatOf(theirs);
  const byKey = new Map<string, RaidSlot>([...theirs, ...mine].map(s => [slotKey(s), s]));
  const result = new Map(T);
  for (const key of new Set([...B.keys(), ...M.keys()])) {
    const b = B.get(key), m = M.get(key), t = T.get(key);
    if (m === b) continue; // je n'y ai pas touché : la version des autres reste
    if (t !== b && t !== m) return { ok: false, reason: "Un autre officier a déplacé le même perso." };
    if (m === undefined) result.delete(key); else result.set(key, m);
  }
  const seats = new Set<string>();
  const slots: RaidSlot[] = [];
  for (const [key, seat] of result) {
    if (seats.has(seat)) return { ok: false, reason: "Un autre officier a occupé la même place." };
    seats.add(seat);
    const [group, pos] = seat.split(":").map(Number) as [number, number];
    const src = byKey.get(key)!;
    slots.push(src.characterId ? { group, pos, characterId: src.characterId } : { group, pos, signupId: src.signupId });
  }
  return { ok: true, slots: slots.sort((a, b) => a.group - b.group || a.pos - b.pos) };
}
