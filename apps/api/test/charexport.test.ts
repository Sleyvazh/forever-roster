import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCharacterExport, parseCharacterExports, professionFromGame, professionsFromExport } from "@forever/game-data";

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
  it("lit les inscriptions faites en jeu (une par raid, statuts valides)", () => {
    const g = "6f1c2a10-0000-4000-8000-000000000001", r = "7a1c2a10-0000-4000-8000-000000000002";
    const text = `FRC;1;Greta;Beta;DRUID;Skyborne;20;Alliance;1;0.2.0\nS;${g};${r};late\nS;${g};${r};present\nS;${g};pas-un-uuid;present\nS;${g};${r};banni\nEND;4`;
    const res = parseCharacterExport(text);
    if (!res.ok) throw new Error(res.error);
    expect(res.data.signups).toEqual([{ groupId: g, raidId: r, status: "present" }]);
  });
  it("lit les patrons marqués recherchés en jeu", () => {
    const res = parseCharacterExport("FRC;1;Sley;Beta;ROGUE;Human;20;Alliance;1;0.3.0\nW;15090;1\nW;9999;0\nW;15090;0\nW;abc;1\nEND;4");
    if (!res.ok) throw new Error(res.error);
    expect(res.data.wanted).toEqual([{ itemId: 9999, on: false }, { itemId: 15090, on: false }]);
  });
  it("lit l'export de plusieurs persos et signale un bloc abîmé", () => {
    const two = `${SAMPLE.trim()}\nFRC;1;Greta;Beta;DRUID;Skyborne;20;Alliance;1;0.3.0\nG;1;16866\nEND;1\nFRC;1;Cassé;Beta;MAGE;Human;20;Alliance;1;0.3.0\nG;1;1\nEND;9`;
    const r = parseCharacterExports(two);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.map(d => d.name)).toEqual(["Tournicoti", "Greta"]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^Cassé : Export incomplet/);
    expect(parseCharacterExports("rien du tout")).toMatchObject({ ok: false });
  });
    it("reconnaît les Skyborne selon la faction", () => {
    const head = (faction: string) => `FRC;1;Greta;Beta;DRUID;Skyborne;20;${faction};1790960521;0.1.2\nEND;0`;
    const race = (faction: string) => { const r = parseCharacterExport(head(faction)); return r.ok ? r.data.race : "erreur"; };
    expect(race("Alliance")).toBe("Skyborne (High Order)");
    expect(race("Horde")).toBe("Skyborne (Windshaper)");
  });
});
