import { describe, expect, it } from "vitest";
import { charactersAtLevel, dungeonByKey, dungeonOffReason, dungeonsFor, FOREVER_DUNGEONS, hasDungeonLevel, OTHER_DUNGEON, pickCharacterFor } from "./dungeons";

describe("FOREVER_DUNGEONS", () => {
  it("9 donjons de Forever (fourchettes officielles) et 19 de Classic (à confirmer), sans UBRS", () => {
    const fresh = FOREVER_DUNGEONS.filter(d => d.new);
    expect(fresh.map(d => `${d.name} ${d.min}-${d.max}`)).toEqual([
      "The Hall of Thanes 13-18", "Ruins of Lordaeron 15-20", "Excavation Site: Wetlands 24-29", "City of Dalaran 28-33", "The Drowned City 35-40",
      "Krol'dok Stronghold 40-45", "Alcaz Prison 48-53", "Blackmaw Hold 55-60", "Shaper's Terrace 58-60",
    ]);
    expect(fresh.every(d => d.confirmed)).toBe(true);
    const classic = FOREVER_DUNGEONS.filter(d => !d.new);
    expect(classic).toHaveLength(19);
    expect(classic.every(d => !d.confirmed)).toBe(true);
    expect(FOREVER_DUNGEONS.some(d => /Upper Blackrock/.test(d.name))).toBe(false);
  });

  it("clés uniques et stables, fourchettes cohérentes, aucun « ; » ni « | » (ligne X du FRG)", () => {
    expect(new Set(FOREVER_DUNGEONS.map(d => d.key)).size).toBe(FOREVER_DUNGEONS.length);
    for (const d of FOREVER_DUNGEONS) {
      expect(d.key).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(d.key).not.toBe(OTHER_DUNGEON);
      expect(d.min).toBeGreaterThanOrEqual(10);
      expect(d.max).toBeLessThanOrEqual(60);
      expect(d.min).toBeLessThanOrEqual(d.max);
      expect(`${d.name}${d.zone}`).not.toMatch(/[;|\n]/);
    }
    expect(dungeonByKey("gnomeregan")).toMatchObject({ name: "Gnomeregan", min: 29, max: 38, zone: "Dun Morogh" });
    expect(dungeonByKey("kroldok-stronghold")).toMatchObject({ min: 40, max: 45, zone: "Riverglades" });
    expect(dungeonByKey("other")).toBeNull();
  });
});

describe("tri pour un perso", () => {
  const levels = [55, 55, 57, 58, 60, 60, 60, 33, 31, 52];
  it("d'abord ceux de sa fourchette (les plus fréquentés, puis les plus hauts), puis les autres du plus proche au plus loin", () => {
    const { fit, off } = dungeonsFor(55, levels);
    expect(fit.map(c => c.dungeon.key)).toEqual([
      "blackrock-depths", "blackmaw-hold", "dire-maul", "lower-blackrock-spire", "sunken-temple", "maraudon",
    ]);
    expect(fit.map(c => c.count)).toEqual([8, 7, 7, 7, 3, 3]);
    expect(fit.every(c => c.off === null && hasDungeonLevel(c.dungeon, 55))).toBe(true);
    // Zul'Farrak (44-54) et Alcaz Prison (48-53) sont à 1 et 2 niveaux, Stratholme à 3 (dès 58)
    expect(off.slice(0, 5).map(c => `${c.dungeon.key}:${c.off}`)).toEqual([
      "zulfarrak:high", "alcaz-prison:high", "scholomance:low", "shapers-terrace:low", "stratholme:low",
    ]);
    expect(fit.length + off.length).toBe(FOREVER_DUNGEONS.length);
  });

  it("raison en clair, « N persos ont le niveau »", () => {
    const { off } = dungeonsFor(55, levels);
    expect(dungeonOffReason(off.find(c => c.dungeon.key === "stratholme")!, "Brindille")).toBe("dès le niveau 58");
    expect(dungeonOffReason(off.find(c => c.dungeon.key === "zulfarrak")!, "Brindille")).toBe("trop bas pour Brindille");
    expect(charactersAtLevel({ min: 29, max: 38 }, levels)).toBe(2);
    expect(charactersAtLevel({ min: 29, max: 38 }, [])).toBe(0);
  });

  it("perso pré-choisi : celui qui a le niveau, le main d'abord, sinon le plus haut", () => {
    const chars = [{ name: "Pikou", level: 33 }, { name: "Brindille", level: 55, isMain: true }, { name: "Kaelys", level: 31 }];
    expect(pickCharacterFor({ min: 29, max: 38 }, chars)?.name).toBe("Pikou");
    expect(pickCharacterFor({ min: 52, max: 60 }, chars)?.name).toBe("Brindille");
    expect(pickCharacterFor({ min: 17, max: 26 }, chars)).toBeNull();
    expect(pickCharacterFor(null, chars)?.name).toBe("Brindille");
    expect(pickCharacterFor(null, chars.filter(c => !c.isMain))?.name).toBe("Pikou");
  });
});
