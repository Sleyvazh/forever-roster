import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCharacterExport, professionFromGame, professionsFromExport } from "@forever/game-data";

// Écrit par le test Lua de l'addon (lua5.1 addon/tests/format_test.lua) : le site lit exactement ce que l'addon produit
const SAMPLE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../addon/tests/sample.frc"), "utf8");

describe("export d'un perso par l'addon (FRC v1)", () => {
  it("lit l'export produit par l'addon", () => {
    const r = parseCharacterExport(SAMPLE);
    if (!r.ok) throw new Error(r.error);
    expect(r.data).toMatchObject({ name: "Tournicoti", realm: "Forever EU", cls: "Druid", race: "Tauren", level: 60, faction: "Horde", addon: "0.1.0" });
    expect(r.data.gear).toEqual({ Head: 16866, Legs: 15065 });
    expect(r.data.professions.map(p => p.name)).toEqual(["Leatherworking", "Skinning", "Cooking"]);
    expect(r.data.recipes).toEqual([{ profession: "Leatherworking", spellId: 2152 }, { profession: "Leatherworking", itemId: 15065 }]);
    expect(r.data.talents[0]).toEqual({ id: 104938, rank: 5, max: 5, x: 5620, y: 2130, spell: 16934, sub: 0, tree: 1089 });
    expect(professionsFromExport(r.data.professions)).toEqual({
      prof1: { name: "Leatherworking", skill: 300 }, prof2: { name: "Skinning", skill: 295 }, cooking: 150, fishing: 0, firstAid: 0,
    });
  });
  it("reconnaît les métiers en français et refuse un export abîmé", () => {
    expect(professionFromGame("Travail du cuir")).toBe("Leatherworking");
    expect(professionFromGame("Secourisme")).toBe("First Aid");
    expect(professionFromGame("Arme d'hast")).toBeNull();
    expect(parseCharacterExport("FRR;1;x;0;Raid\nEND;0")).toMatchObject({ ok: false });
    expect(parseCharacterExport(SAMPLE.replace(/\nEND;\d+$/, ""))).toMatchObject({ ok: false });
    expect(parseCharacterExport(SAMPLE.replace("FRC;1;", "FRC;2;"))).toMatchObject({ ok: false });
  });
  it("ignore les patrons des fenêtres que le site ne gère pas (Poisons)", () => {
    const text = "FRC;1;Sley;Beta;ROGUE;Human;20;Alliance;1790960455;0.1.2\nR;Cooking;s2541\nR;Poisons;s8681\nR;First Aid;s3275\nEND;3";
    const r = parseCharacterExport(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.recipes).toEqual([{ profession: "Cooking", spellId: 2541 }, { profession: "First Aid", spellId: 3275 }]);
    expect(r.data.ignored).toEqual(["Poisons"]);
  });
  it("reconnaît les Skyborne selon la faction", () => {
    const head = (faction: string) => `FRC;1;Greta;Beta;DRUID;Skyborne;20;${faction};1790960521;0.1.2\nEND;0`;
    const race = (faction: string) => { const r = parseCharacterExport(head(faction)); return r.ok ? r.data.race : "erreur"; };
    expect(race("Alliance")).toBe("Skyborne (High Order)");
    expect(race("Horde")).toBe("Skyborne (Windshaper)");
  });
});
