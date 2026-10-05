import { describe, expect, it } from "vitest";
import { benchSuggestion, DEFAULT_TARGETS, groupsFor, roleGaps, type BenchCandidate } from "./assist";

const c = (key: string, role: BenchCandidate["role"], benched = 0, lastBenched = false, signedAt = "2026-10-01T10:00:00Z"): BenchCandidate => ({ key, role, benched, lastBenched, signedAt });

describe("format du raid et aide à la compo", () => {
  it("groupes et rôles visés", () => {
    expect([10, 20, 40].map(groupsFor)).toEqual([2, 4, 8]);
    expect(roleGaps(DEFAULT_TARGETS[10], { Tank: 2, Heal: 1, DPS: 7 })).toEqual({ Tank: 0, Heal: 2, DPS: -2 });
  });

  it("banc : rôles en trop, le moins souvent sur le banc d'abord, dernier banc protégé", () => {
    const t = { tank: 1, heal: 1, dps: 2 };
    const cands = [
      c("tank", "Tank"), c("heal", "Heal"),
      c("d1", "DPS", 2), c("d2", "DPS", 0, false, "2026-10-01T09:00:00Z"), c("d3", "DPS", 0, false, "2026-10-01T11:00:00Z"), c("d4", "DPS", 0, true),
    ];
    // 6 inscrits pour 4 places : 2 DPS de trop ; d4 protégé, d1 déjà 2 fois → d3 (inscrit le plus tard) puis d2
    expect(benchSuggestion(cands, t, 4)).toEqual(["d3", "d2"]);
    expect(benchSuggestion(cands, t, 6)).toEqual([]);
    // Un DPS qui peut passer heal (rôle qui manque) est gardé
    expect(benchSuggestion([c("t", "Tank"), { ...c("dflex", "DPS"), flex: true }, c("d", "DPS", 1)], { tank: 1, heal: 1, dps: 1 }, 2)).toEqual(["d"]);
    // Si tout le monde est protégé, il faut quand même libérer des places
    expect(benchSuggestion([c("a", "DPS", 0, true), c("b", "DPS", 1, true)], { tank: 0, heal: 0, dps: 1 }, 1)).toEqual(["a"]);
    // Rôles à la cible : on prend quand même les moins souvent sur le banc
    expect(benchSuggestion([c("t", "Tank", 3), c("h", "Heal", 0)], { tank: 1, heal: 1, dps: 0 }, 1)).toEqual(["h"]);
  });
});
