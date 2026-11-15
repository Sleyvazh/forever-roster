import { describe, expect, it } from "vitest";
import { compareItems, itemRowStats, itemSearchText, itemSubclass, mainArmorSubclass, matchesSearch, money, statAbbr, statLine, statName, statShort, subclassText } from "./items";

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

describe("liste des objets d'un emplacement", () => {
  it("type d'armure principal de chaque classe, selon le niveau", () => {
    expect(mainArmorSubclass("Druid", 50)).toBe(2);
    expect(mainArmorSubclass("Rogue", 10)).toBe(2);
    expect(mainArmorSubclass("Priest", 60)).toBe(1);
    expect(mainArmorSubclass("Hunter", 39)).toBe(2);
    expect(mainArmorSubclass("Shaman", 40)).toBe(3);
    expect(mainArmorSubclass("Warrior", 39)).toBe(3);
    expect(mainArmorSubclass("Paladin", 40)).toBe(4);
    expect(mainArmorSubclass("", 60)).toBeNull();
  });

  it("caractéristiques en très court, en français et en anglais", () => {
    expect(statAbbr(3)).toBe("Agi");
    expect(statAbbr(7)).toBe("Endu");
    expect(statAbbr(7, "en")).toBe("Sta");
    expect(statAbbr(6)).toBe("Esp");
    expect(statAbbr(38)).toBe(statName(38));
  });

  it("ligne de liste : DPS, puis les trois premières caractéristiques ; l'armure à défaut", () => {
    expect(statShort(31, 10)).toBe("+1 % Toucher");
    expect(statShort(32, 21, "en")).toBe("+1.5% Crit");
    expect(statShort(38, 20)).toBe("+20 Puissance d'attaque");
    expect(statShort(7, -5, "en")).toBe("-5 Sta");
    const helm = { armor: 608, stats: [[4, 19], [7, 26], [12, 7], [31, 10]] as [number, number][] };
    expect(itemRowStats(helm)).toEqual(["+19 For", "+26 Endu", "+7 Défense"]);
    expect(itemRowStats({ dmg: { min: 44, max: 115, speed: 1.9, dps: 41.8 }, stats: [[3, 5]] }, "fr")).toEqual(["41,8 DPS", "+5 Agi"]);
    expect(itemRowStats({ armor: 41 }, "en")).toEqual(["41 Armor"]);
    expect(itemRowStats({})).toEqual([]);
  });

  it("recherche : nom, type et caractéristiques, sans accents, chaque mot", () => {
    const text = itemSearchText({ name: "Helm of Might", kind: "Armor · Plate", details: { stats: [[4, 19], [7, 26]], set: { id: 1, name: "Battlegear of Might", items: [], bonuses: [] } } });
    expect(matchesSearch(text, "helm")).toBe(true);
    expect(matchesSearch(text, "endu")).toBe(true);
    expect(matchesSearch(text, "Stamina")).toBe(true);
    expect(matchesSearch(text, "for endu")).toBe(true);
    expect(matchesSearch(text, "plaques")).toBe(true);
    expect(matchesSearch(text, "battlegear")).toBe(true);
    expect(matchesSearch(text, "agi")).toBe(false);
    expect(matchesSearch(text, "  ")).toBe(true);
    const sword = itemSearchText({ name: "Épée longue", kind: "Weapon · One-Handed Swords", details: {} });
    expect(matchesSearch(sword, "epee")).toBe(true);
    expect(matchesSearch(sword, "sword")).toBe(true);
    // Sans libellé, la sous-classe vient des numéros du client
    expect(itemSubclass({ kind: "", classId: 4, subclassId: 2 })).toBe("Leather");
    expect(itemSubclass({ kind: "Armor · Mail", classId: 4, subclassId: 2 })).toBe("Mail");
    expect(matchesSearch(itemSearchText({ name: "Hood", kind: "", classId: 4, subclassId: 2 }), "cuir")).toBe(true);
  });
});
