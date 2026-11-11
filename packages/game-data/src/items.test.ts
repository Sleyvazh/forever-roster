import { describe, expect, it } from "vitest";
import { compareItems, money, statLine, statName, subclassText } from "./items";

describe("infobulles d'objets en français et en anglais", () => {
  it("caractéristiques : mots du jeu dans chaque langue", () => {
    expect(statLine(7, 12).text).toBe("+12 Endurance");
    expect(statLine(7, 12, "en").text).toBe("+12 Stamina");
    expect(statLine(31, 10).text).toBe("Augmente vos chances de toucher de 1 %.");
    expect(statLine(31, 15, "en").text).toBe("Improves your chance to hit by 1.5%.");
    expect(statLine(45, 23, "en").text).toBe("Increases damage and healing done by magical spells and effects by up to 23.");
    expect(statLine(99, 4, "en").text).toBe("Stat #99: +4.");
    expect(statName(38, "en")).toBe("Attack Power");
  });

  it("argent : po/pa/pc, ou g/s/c", () => {
    expect(money(12345)).toBe("1 po 23 pa 45 pc");
    expect(money(12345, "en")).toBe("1g 23s 45c");
    expect(money(0, "en")).toBe("0c");
  });

  it("type d'objet et comparaison", () => {
    expect(subclassText("One-Handed Axes")).toBe("Hache");
    expect(subclassText("One-Handed Axes", "en")).toBe("Axe");
    expect(subclassText("Staves", "en")).toBe("Staff");
    expect(subclassText("Plate", "en")).toBe("Plate");
    const a = { itemLevel: 60, details: { armor: 100, stats: [[7, 5]] as [number, number][] } };
    const b = { itemLevel: 63, details: { armor: 120, stats: [[7, 9]] as [number, number][] } };
    expect(compareItems(a, b, "en").map(x => x.label)).toEqual(["Item Level", "Armor", "Stamina"]);
  });
});
