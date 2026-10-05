import { describe, expect, it } from "vitest";
import { addonExport, groupAddonExport, inviteMacros, sameCharacter } from "./addon";
import { weeklyOccurrences, zonedParts, zonedTime } from "./time";

describe("fuseau du serveur de jeu", () => {
  it("heure d'été, heure d'hiver et jour de la semaine", () => {
    expect(zonedTime(2026, 11, 12, 21, 0)?.toISOString()).toBe("2026-11-12T20:00:00.000Z");
    expect(zonedTime(2026, 7, 1, 21, 0)?.toISOString()).toBe("2026-07-01T19:00:00.000Z");
    expect(zonedTime(2026, 2, 30, 21, 0)).toBeNull();
    expect(zonedParts(new Date("2026-09-30T22:30:00Z"))).toMatchObject({ day: 1, month: 10, hour: 0, weekday: 4 });
  });
  it("occurrences hebdomadaires, y compris au passage à l'heure d'hiver", () => {
    const occ = weeklyOccurrences(3, "21:00", new Date("2026-10-19T12:00:00Z"), new Date("2026-11-05T00:00:00Z"));
    expect(occ.map(d => d.toISOString())).toEqual(["2026-10-21T19:00:00.000Z", "2026-10-28T20:00:00.000Z", "2026-11-04T20:00:00.000Z"]);
    // Occurrence du jour même déjà passée : ignorée
    expect(weeklyOccurrences(3, "21:00", new Date("2026-10-21T19:30:00Z"), new Date("2026-10-27T00:00:00Z"))).toEqual([]);
    expect(weeklyOccurrences(3, "25:00", new Date(), new Date(Date.now() + 8 * 86400e3))).toEqual([]);
  });
});

describe("export addon", () => {
  it("format FRR v1 lisible ligne par ligne", () => {
    const text = addonExport({ id: "r1", name: "Molten; Core|x", scheduledAt: "2026-11-12T20:00:00.000Z" }, [
      { name: "Zed", cls: "Mage", spec: "Frost", role: "DPS", group: 0, pos: 0, status: "bench", source: "site" },
      { name: "Tournicoti", cls: "Druid", spec: "Feral Bear", role: "Tank", group: 1, pos: 1, status: "present", source: "site" },
      { name: "Bob", cls: "Priest", spec: "Holy Heal", role: "Heal", group: 0, pos: 0, status: "late", source: "discord" },
    ]);
    expect(text.split("\n")).toEqual([
      "FRR;1;r1;1794513600;Molten  Core x",
      "M;Tournicoti;DRUID;Tank;Feral Bear;1;1;present;site",
      "M;Bob;PRIEST;Heal;Holy Heal;0;0;late;discord",
      "M;Zed;MAGE;DPS;Frost;0;0;bench;site",
      "END;3",
    ]);
  });
  it("macros /inv de 255 caractères au plus", () => {
    const names = Array.from({ length: 40 }, (_, i) => `Personnage${i}`);
    const macros = inviteMacros(names);
    expect(macros.every(m => m.length <= 255)).toBe(true);
    expect(macros.join("\n").split("\n")).toHaveLength(40);
    expect(inviteMacros(["A", "A", ""])).toEqual(["/inv A"]);
  });
  it("nom de famille de Forever : le jeu n'utilise que le prénom", () => {
    expect(inviteMacros(["Greta Coulé", "Sley"])).toEqual(["/inv Greta\n/inv Sley"]);
    const text = addonExport({ id: "r1", name: "MC", scheduledAt: null }, [
      { name: "Greta Coulé", cls: "Druid", spec: "Feral Cat", role: "DPS", group: 1, pos: 1, status: "present", source: "site" },
    ]);
    expect(text).toContain("\nM;Greta;DRUID;");
    expect(sameCharacter("Greta", "Greta Coulé")).toBe(true);
    expect(sameCharacter("greta", "Gréta")).toBe(false);
    expect(sameCharacter("Sylvaë", "SYLVAË")).toBe(true);
    expect(sameCharacter("Greta", "Malveillance")).toBe(false);
  });
  it("données du groupe (FRG v1) : raids et patrons suivis", () => {
    const text = groupAddonExport({ id: "g1", name: "Les; Veilleurs" }, 1791000000,
      [{ id: "r1", name: "Molten Core", at: 1791100000, status: "present", character: "Greta Coulé" }, { id: "r2", name: "Onyxia", at: 0, status: null, character: null }],
      [{ itemId: 15090, recipe: "Warbear Woolies", wanted: ["Sley", "Greta Coulé", "Sley"], known: ["Tournicoti"] }, { itemId: 1, recipe: "Vide", wanted: [], known: [] }]);
    expect(text.split("\n")).toEqual([
      "FRG;1;g1;1791000000;Les  Veilleurs",
      "R;r1;1791100000;Molten Core;present;Greta;",
      "R;r2;0;Onyxia;;;",
      "P;15090;Warbear Woolies;Greta,Sley;Tournicoti",
      "END;3",
    ]);
  });
  it("FRG, lot C2 : mode de butin, réservations et conseil, hors du compte de END", () => {
    const text = groupAddonExport({ id: "g1", name: "G" }, 1,
      [{ id: "r1", name: "MC", at: 2, status: null, character: null, lootMode: "softres",
        reserves: [{ itemId: 18814, by: [{ name: "Greta Coulé", bonus: 10 }, { name: "Kaelys", bonus: 0 }] }, { itemId: 1, by: [] }] }],
      [], [], ["Sley", "Bérénice"]);
    expect(text.split("\n")).toEqual([
      "FRG;1;g1;1;G",
      "R;r1;2;MC;;;softres",
      "S;r1;18814;Greta:10,Kaelys:0",
      "O;Bérénice,Sley",
      "END;1",
    ]);
  });
});
