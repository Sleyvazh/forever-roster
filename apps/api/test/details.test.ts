import { compareItems, money, statLine } from "@forever/game-data";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { addDetails, buildScales, buildSpellTexts, computeDetails, evaluate, iconNames } from "../src/gamedata/details";
import { extract } from "../src/gamedata/extract";
import { readDetailTables, readTables } from "../src/gamedata/source";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/gamedata");
const raw = { bonding: 0, maxCount: 0, sellPrice: 0, delay: 0, variance: 0, itemSet: 0, stats: [] as [number, number][] };

describe("calcul des infobulles", () => {
  // Barèmes réels du client (niveau d'objet 23 et 63) : les résultats doivent coller aux infobulles du jeu
  const sc = buildScales({
    RandPropPoints: [{ ID: "23", SuperiorF_1: "9" }, { ID: "63", SuperiorF_0: "36" }],
    ItemArmorTotal: [{ ItemLevel: "23", Leather: "514.65997314453" }],
    ItemArmorQuality: [{ ID: "23", Qualitymod_3: "1.10000002384" }],
    ArmorLocation: [{ ID: "3", Leathermodifier: "0.11999999732" }],
    ItemDamageTwoHand: [{ ItemLevel: "63", Quality_3: "53.9" }],
  });

  it("Serpent's Shoulders : 68 armure, +5 Agilité (comme en jeu)", () => {
    const d = computeDetails({ ...raw, itemLevel: 23, quality: 3, inventoryType: 3, classId: 4, subclassId: 2, bonding: 1, sellPrice: 959, stats: [[3, 5555]] }, sc);
    expect(d).toEqual({ bond: 1, sell: 959, armor: 68, stats: [[3, 5]] });
  });

  it("Arcanite Reaper : 153-256, vitesse 3,80 (comme en jeu)", () => {
    const d = computeDetails({ ...raw, itemLevel: 63, quality: 3, inventoryType: 17, classId: 2, subclassId: 1, delay: 3800, variance: 0.5, stats: [[7, 3611], [38, 17222]] }, sc);
    expect(d.dmg).toEqual({ min: 153, max: 256, speed: 3.8, dps: 53.9 });
    expect(d.stats).toEqual([[7, 13], [38, 62]]);
  });

  it("textes des sorts : valeurs, expressions, durées, et rien d'inconnu qui traîne", () => {
    const sp = buildSpellTexts({
      Spell: [
        { ID: "1", Description_lang: "Deals $s1 damage over $d." },
        { ID: "2", Description_lang: "Chance to hit by ${$s1/10}.1%. Heals $/10;s2 health." },
        { ID: "3", Description_lang: "Slows by $s1% for $d, $lpoint:points; for $ghim:her;. ${$<unknown>*2} done." },
      ],
      SpellEffect: [
        { SpellID: "1", EffectIndex: "0", EffectBasePointsF: "-120", DifficultyID: "0" },
        { SpellID: "2", EffectIndex: "0", EffectBasePointsF: "15" }, { SpellID: "2", EffectIndex: "1", EffectBasePointsF: "250" },
        { SpellID: "3", EffectIndex: "0", EffectBasePointsF: "20" },
      ],
      SpellMisc: [{ SpellID: "1", DurationIndex: "9" }],
      SpellDuration: [{ ID: "9", Duration: "120000" }],
    });
    expect(sp.describe(1)).toBe("Deals 120 damage over 2 min.");
    expect(sp.describe(2)).toBe("Chance to hit by 1.5%. Heals 25 health.");
    expect(sp.describe(3)).toBe("Slows by 20%, points for him. done.");
    expect(evaluate("2*(3+4)/7")).toBe(2);
    expect(evaluate("process.exit()")).toBeNull();
  });

  it("de l'import au détail : set, effets et icône", async () => {
    const tables = await readTables(FIXTURES);
    const data = extract(tables);
    addDetails(data.items, { ...(await readDetailTables(FIXTURES)), ItemEffect: tables.ItemEffect, ItemXItemEffect: tables.ItemXItemEffect, SpellEffect: tables.SpellEffect });
    const helm = data.items.find(i => i.id === 16866)!;
    expect(helm.details).toEqual({
      bond: 1, sell: 25000, armor: 608, stats: [[4, 19], [7, 24]],
      set: { id: 209, name: "Battlegear of Might", items: ["Helm of Might", "Warbear Woolies"], bonuses: [{ n: 2, text: "Improves your chance to hit by 2%." }] },
    });
    const tf = data.items.find(i => i.id === 19019)!;
    expect(tf.details).toMatchObject({ unique: true, dmg: { min: 82, max: 153, speed: 1.9 }, effects: [{ trigger: 2, text: "Blasts your enemy with lightning, dealing 300 Nature damage for 12 s." }] });
    expect(helm.iconFileId).toBe(133073);
    async function* lines() { yield "1;interface/icons/other.blp"; yield "133073;Interface/Icons/INV_Helmet_09.blp"; yield "133074;interface/icons/x.blp"; }
    expect(await iconNames(new Set([133073]), lines())).toEqual(new Map([[133073, "inv_helmet_09"]]));
  });
});

describe("mise en forme (site)", () => {
  it("libellés, pourcentages, prix et comparaison", () => {
    expect(statLine(3, 5).text).toBe("+5 Agilité");
    expect(statLine(32, 28)).toMatchObject({ kind: "equip", text: "Augmente vos chances d'infliger un coup critique de 2 %." });
    expect(statLine(31, 15).text).toBe("Augmente vos chances de toucher de 1,5 %.");
    expect(statLine(38, 62).text).toBe("+62 à la puissance d'attaque.");
    expect(money(255355)).toBe("25 po 53 pa 55 pc");
    expect(money(0)).toBe("0 pc");
    expect(compareItems(
      { itemLevel: 60, details: { armor: 500, stats: [[4, 10], [7, 12]] } },
      { itemLevel: 66, details: { armor: 608, stats: [[4, 19], [3, 4]] } },
    )).toEqual([
      { label: "Niveau d'objet", delta: 6 }, { label: "Armure", delta: 108 },
      { label: "Force", delta: 9 }, { label: "Endurance", delta: -12 }, { label: "Agilité", delta: 4 },
    ]);
  });
});
