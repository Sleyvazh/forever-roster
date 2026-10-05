import { describe, expect, it } from "vitest";
import { groupAddonExport } from "./addon";
import { parseCharacterExport } from "./charexport";
import { concerns, dpsType, instanceOf, knownBosses } from "./prep";
import { parseRaidLogs } from "./raidlog";

const RAID = "4a1e43ea-54e8-4b49-888f-5e19b5754f61";

describe("préparation du raid (lot G)", () => {
  it("reconnaît l'instance dans le nom du raid, en anglais, en français ou en abrégé", () => {
    expect(instanceOf("Molten Core")).toBe("mc");
    expect(instanceOf("MC semaine 3")).toBe("mc");
    expect(instanceOf("Cœur du Magma")).toBe("mc");
    expect(instanceOf("Repaire de l'Aile noire")).toBe("bwl");
    expect(instanceOf("AQ40 reroll")).toBe("aq40");
    expect(instanceOf("Raid à 10 · nouveau")).toBeNull();
    expect(knownBosses("mc").at(-1)).toMatchObject({ name: "Ragnaros", encounterId: 672, npcIds: [11502], rows: [] });
    expect(knownBosses(null)).toEqual([]);
  });

  it("type de DPS et lignes de consommables concernées", () => {
    expect(dpsType("Hunter", "Marksmanship")).toBe("ranged");
    expect(dpsType("Priest", "Shadow")).toBe("caster");
    expect(dpsType("Druid", "Feral Cat")).toBe("melee");
    expect(dpsType("Druid", "Feral Bear")).toBeNull();
    const rogue = { role: "DPS" as const, cls: "Rogue", spec: "Combat" }, tank = { role: "Tank" as const, cls: "Warrior", spec: "Protection" };
    expect(concerns({ for: "all" }, tank)).toBe(true);
    expect(concerns({ for: "melee" }, rogue)).toBe(true);
    expect(concerns({ for: "caster" }, rogue)).toBe(false);
    expect(concerns({ for: "tank" }, tank)).toBe(true);
    expect(concerns({ for: "heal" }, tank)).toBe(false);
  });

  it("FRG : consommables, fiches de boss et conseil, hors du compte de END", () => {
    const text = groupAddonExport({ id: "g", name: "Les Veilleurs" }, 1, [{
      id: RAID, name: "Molten Core", at: 2, status: null, character: null, lootMode: "council",
      consumables: [{ itemId: 13457, name: "Greater Fire Protection Potion", n: 5, for: "all" }],
      bosses: [{ name: "Ragnaros", encounterId: 672, npcIds: [11502], rows: [{ label: "Tank principal", names: ["Grumdal Coulé"], text: "" }, { label: "Fils; de la flamme", names: [], text: "Groupes 3 et 4" }] }],
      council: ["Thalwen", "Brunehilde"],
    }], []);
    const lines = text.split("\n");
    expect(lines).toContain(`C;${RAID};13457;5;all;Greater Fire Protection Potion`);
    expect(lines).toContain(`F;${RAID};1;672;11502;Ragnaros`);
    expect(lines).toContain(`T;${RAID};1;Tank principal;Grumdal;`);
    expect(lines).toContain(`T;${RAID};1;Fils  de la flamme;;Groupes 3 et 4`);
    expect(lines).toContain(`L;${RAID};Brunehilde,Thalwen`);
    expect(lines.at(-1)).toBe("END;1");
  });

  it("FRC : consommables comptés ; FRB : appel aux consommables", () => {
    const c = parseCharacterExport("FRC;2;Greta;Forever EU;DRUID;Tauren;60;Horde;1;1.0.0\nK;13457:6,13446:0,abc\nEND;1");
    expect(c.ok && c.data.consumables).toEqual({ 13457: 6, 13446: 0 });
    const log = parseRaidLogs(`FRB;2;${RAID};1000;2000;Thalwen;Molten Core;Molten Core\nA;Thalwen;1000;2000;10\nQ;1500;Thalwen\nK;Thalwen;13457:5\nK;Tavish;-\nEND;1`);
    expect(log.errors).toEqual([]);
    expect(log.data[0]!.consumableCall).toEqual({ at: 1500, by: "Thalwen", counts: [{ name: "Thalwen", items: { 13457: 5 } }, { name: "Tavish", items: null }] });
  });
});
