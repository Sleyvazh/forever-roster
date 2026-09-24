import { describe, expect, it } from "vitest";
import { computeCoverage, exclusiveBudget, roleCounts } from "./raid";
import { isValidCombo, isValidSpec, talentPointsAt } from "./core";

const get = (cov: ReturnType<typeof computeCoverage>, id: string) => cov.find(c => c.effect.id === id)!;

describe("computeCoverage", () => {
  it("un buff de raid est couvert dès qu'une source est présente", () => {
    const cov = computeCoverage([{ characterId: "a", cls: "Mage", spec: "Frost", group: 1 }]);
    expect(get(cov, "ai").covered).toBe(true);
    expect(get(cov, "fort").covered).toBe(false);
  });

  it("une aura de groupe doit être présente dans chaque groupe occupé", () => {
    const cov = computeCoverage([
      { characterId: "w", cls: "Warrior", spec: "Fury", group: 1 },
      { characterId: "r", cls: "Rogue", spec: "Combat", group: 2 },
    ]);
    const bs = get(cov, "bshout");
    expect(bs.covered).toBe(false);
    expect(bs.missingGroups).toEqual([2]);
  });

  it("respecte les talents requis", () => {
    const cov = computeCoverage([{ characterId: "d", cls: "Druid", spec: "Restoration", group: 1 }]);
    expect(get(cov, "lotp").covered).toBe(false);
    expect(get(cov, "motw").covered).toBe(true);
  });
});

describe("exclusiveBudget", () => {
  it("compte les paladins face aux bénédictions", () => {
    const b = exclusiveBudget([{ characterId: "p", cls: "Paladin", spec: "Holy", group: 1 }]).find(x => x.group === "blessing")!;
    expect(b).toEqual({ group: "blessing", available: 1, wanted: 5 });
  });
});

describe("règles de base", () => {
  it("valide les combinaisons race/classe de Forever", () => {
    expect(isValidCombo("Undead", "Paladin")).toBe(true);
    expect(isValidCombo("Tauren", "Mage")).toBe(false);
    expect(isValidSpec("Druid", "Feral Bear")).toBe(true);
  });
  it("calcule les points de talents", () => {
    expect(talentPointsAt(1)).toBe(0);
    expect(talentPointsAt(10)).toBe(1);
    expect(talentPointsAt(60)).toBe(51);
  });
  it("compte les rôles", () => {
    expect(roleCounts([{ spec: "Protection" }, { spec: "Holy" }, { spec: "Fire" }, { spec: null }])).toEqual({ Tank: 1, Heal: 1, DPS: 1, "?": 1 });
  });
});
