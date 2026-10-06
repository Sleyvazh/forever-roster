import { describe, expect, it } from "vitest";
import { instanceKey, lootCountLabel, lootCounts, lootCountShort, lootSettings, lootSkipReason, srPlusBonus } from "./loot";

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
