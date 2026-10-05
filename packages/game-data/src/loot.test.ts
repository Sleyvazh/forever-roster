import { describe, expect, it } from "vitest";
import { instanceKey, lootSettings, srPlusBonus } from "./loot";

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
});
