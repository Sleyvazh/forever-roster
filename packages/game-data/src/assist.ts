import type { Role } from "./core";

/**
 * Format des raids et aide à la compo (lot D1) : rôles visés selon le format (10, 20 ou 40 joueurs sur Forever,
 * sans flex), ce qui manque, et qui mettre sur le banc quand il y a trop d'inscrits.
 */

export const RAID_SIZES = [10, 20, 40] as const;
export type RaidSize = (typeof RAID_SIZES)[number];
export interface RoleTargets { tank: number; heal: number; dps: number }

/** Rôles visés par défaut, modifiables raid par raid. */
export const DEFAULT_TARGETS: Record<RaidSize, RoleTargets> = {
  10: { tank: 2, heal: 3, dps: 5 },
  20: { tank: 2, heal: 5, dps: 13 },
  40: { tank: 4, heal: 10, dps: 26 },
};

export const groupsFor = (size: number) => Math.max(1, Math.ceil(size / 5));
export const isRaidSize = (n: number): n is RaidSize => (RAID_SIZES as readonly number[]).includes(n);

const ROLE_KEY: Record<Role, keyof RoleTargets> = { Tank: "tank", Heal: "heal", DPS: "dps" };

/** Ce qui manque (positif) ou dépasse (négatif) par rôle, par rapport aux rôles visés. */
export function roleGaps(targets: RoleTargets, counts: Partial<Record<Role, number>>): Record<Role, number> {
  return {
    Tank: targets.tank - (counts.Tank ?? 0),
    Heal: targets.heal - (counts.Heal ?? 0),
    DPS: targets.dps - (counts.DPS ?? 0),
  };
}
export const targetOf = (t: RoleTargets, r: Role) => t[ROLE_KEY[r]];

export interface BenchCandidate {
  key: string; role: Role | null;
  /** Fois sur le banc dans les derniers raids du groupe. */
  benched: number;
  /** Sur le banc au raid précédent : protégé (jamais deux fois de suite). */
  lastBenched: boolean;
  /** Heure d'inscription (ISO) : à égalité, le dernier inscrit passe en premier. */
  signedAt: string;
  /** Peut passer dans un rôle qui manque (off-spec) : à garder plutôt qu'à mettre sur le banc. */
  flex?: boolean;
}

/**
 * Qui mettre sur le banc quand il y a plus d'inscrits que de places : seulement dans les rôles au-dessus de leur
 * cible, en commençant par ceux qui y sont le moins allés ; ceux du dernier banc sont protégés (en dernier recours).
 */
export function benchSuggestion(cands: BenchCandidate[], targets: RoleTargets, size: number): string[] {
  const excess = cands.length - size;
  if (excess <= 0) return [];
  const byRole = new Map<Role | null, BenchCandidate[]>();
  for (const c of cands) byRole.set(c.role, [...(byRole.get(c.role) ?? []), c]);
  // Places de trop par rôle (les persos sans rôle connu passent en premier dans le compte)
  const over = new Map<Role | null, number>();
  for (const [role, list] of byRole) over.set(role, role ? Math.max(0, list.length - targetOf(targets, role)) : list.length);
  const order = (a: BenchCandidate, b: BenchCandidate) =>
    Number(a.lastBenched) - Number(b.lastBenched) || Number(!!a.flex) - Number(!!b.flex) || a.benched - b.benched || b.signedAt.localeCompare(a.signedAt);
  const pool = cands.filter(c => (over.get(c.role) ?? 0) > 0).sort(order);
  const out: string[] = [];
  const taken = new Map<Role | null, number>();
  for (const c of pool) {
    if (out.length >= excess) break;
    if ((taken.get(c.role) ?? 0) >= (over.get(c.role) ?? 0)) continue;
    out.push(c.key);
    taken.set(c.role, (taken.get(c.role) ?? 0) + 1);
  }
  // Encore trop (rôles tous à la cible ou en dessous) : les moins souvent sur le banc, tous rôles
  if (out.length < excess) {
    for (const c of [...cands].sort(order)) {
      if (out.length >= excess) break;
      if (!out.includes(c.key)) out.push(c.key);
    }
  }
  return out;
}
