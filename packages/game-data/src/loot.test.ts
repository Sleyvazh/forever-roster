import { describe, expect, it } from "vitest";
import {
  instanceKey, lootCountLabel, lootCounts, lootCountShort, lootModeHint, lootModeLabel, lootModesOf, lootSettings, lootSkipReason, retailLootHow, retailLootMode,
  srPlusBonus,
} from "./loot";

describe("butin", () => {
  it("SR+ : raids consécutifs réservés sans recevoir l'objet", () => {
    const r = (reserved: boolean, received = false) => ({ reserved, received });
    expect(srPlusBonus([], 10)).toBe(0);
    expect(srPlusBonus([r(true), r(true), r(false), r(true)], 10)).toBe(20);
    expect(srPlusBonus([r(true), r(true, true), r(true)], 5)).toBe(5);
    expect(srPlusBonus([r(false), r(true)], 10)).toBe(0);
  });
  it("réglages par défaut et clé d'instance", () => {
    expect(lootSettings({ srCount: 1 })).toMatchObject({ srCount: 1, srPlus: true, srCloseMinutes: 60 });
    expect(instanceKey("Molten Core")).toBe(instanceKey("  molten   core "));
    expect(instanceKey("Ahn'Qiraj")).toBe("ahn qiraj");
    expect(instanceKey("Cœur du Magma")).toBe("coeur du magma");
  });
  it("compte des objets reçus : spé principale seulement", () => {
    expect(lootCounts({ method: "sr" })).toBe(true);
    expect(lootCounts({ method: "roll", detail: "MS 87" })).toBe(true);
    expect(lootSkipReason({ method: "roll", detail: "OS 54" })).toBe("jet OS");
    expect(lootSkipReason({ method: "roll", detail: "jet 12" })).toBe("jet libre");
    expect(lootCounts({ method: "council", response: "bis" })).toBe(true);
    expect(lootCounts({ method: "council" })).toBe(true);
    expect(lootSkipReason({ method: "council", response: "off" })).toBe("Off-Spec");
    expect(lootSkipReason({ method: "council", response: "transmo" })).toBe("Transmo");
    expect(lootCounts({})).toBe(true); // journal : compté, les officiers peuvent l'exclure
  });
  it("libellés de la période", () => {
    const s = lootSettings({});
    expect(s).toMatchObject({ countMode: "season", seasonStart: null, countRaids: 5, countBy: "player" });
    expect(lootCountLabel(s)).toBe("depuis le début");
    expect(lootCountLabel({ ...s, seasonStart: "2026-11-05" })).toBe("depuis le 05/11/2026");
    expect(lootCountLabel({ ...s, countMode: "days" })).toBe("sur les 30 derniers jours");
    expect(lootCountShort({ ...s, countMode: "raids", countRaids: 8 })).toBe("8 raids");
  });
});

describe("butin sur Roster (lot R3b)", () => {
  it("modes : journal ou conseil, pas de soft reserve", () => {
    expect(lootModesOf("retail")).toEqual(["journal", "council"]);
    expect(lootModesOf("forever")).toEqual(["journal", "council", "softres"]);
    expect(retailLootMode("softres")).toBe("journal");
    expect(retailLootMode("council")).toBe("council");
    expect(retailLootMode(undefined)).toBe("journal");
    expect(lootModeLabel("council", "retail")).toBe("Conseil (distribution par Roster)");
    expect(lootModeLabel("council", "retail", true)).toBe("Conseil");
    expect(lootModeLabel("softres", "retail")).toBe("Journal");
    expect(lootModeLabel("council", "forever")).toBe("Loot council");
    expect(lootModeHint("journal", "retail")).toContain("addon Roster");
  });
  it("bilan : comment l'objet a été distribué, et s'il compte dans « Reçus »", () => {
    const council = { method: "council" as const, response: "bis" as const, detail: "3 votes" };
    expect(retailLootHow(council)).toBe("Conseil : BiS · 3 votes");
    expect(lootCounts(council)).toBe(true);
    expect(retailLootHow({ method: "council", response: "off", detail: "1 vote" })).toBe("Conseil : Off-Spec · 1 vote");
    expect(retailLootHow({ method: "roll", detail: "MS 87" })).toBe("Jet MS 87");
    expect(retailLootHow({ method: "roll", detail: "OS 54" })).toBe("Jet OS 54");
    expect(lootSkipReason({ method: "roll", detail: "OS 54" })).toBe("jet OS");
    expect(retailLootHow({ method: "roll", detail: "jet 54" })).toBe("Jet libre 54");
    expect(lootSkipReason({ method: "roll", detail: "jet 54" })).toBe("jet libre");
    expect(retailLootHow({ method: "ml" })).toBe("Chef de butin");
    expect(lootCounts({ method: "ml" })).toBe(true);
    // « Garder » de Roster : noté « gardé », ne compte pas
    expect(retailLootHow({ method: "ml", detail: "gardé" })).toBe("Gardé par le chef de butin");
    expect(lootSkipReason({ method: "ml", detail: "gardé" })).toBe("gardé");
    expect(lootCounts({ method: "ml", detail: "gardé" })).toBe(false);
    expect(retailLootHow({})).toBeNull();
  });
});
