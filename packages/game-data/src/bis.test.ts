import { describe, expect, it } from "vitest";
import { BIS_SOURCE_SEED } from "./bis-sources";
import {
  bisProfile, itemFaction, sourceLabel, hasEffect, isObtainable, itemStats, mergeWeights, parseWeightsImport, proposeBis, rankSlot, scoreItem, talentHit, usable,
  type BisItem,
} from "./bis";

// Objets réels de Forever (stats de la base du 24/11), réduits à ce qui compte pour le classement.
const item = (o: Partial<BisItem> & Pick<BisItem, "id" | "name" | "inventoryType">): BisItem => ({
  quality: 3, itemLevel: 60, reqLevel: 55, classId: 4, subclassId: 2, details: {}, seen: true, ...o,
});
const guise = item({ id: 284086, name: "Scarlet Executioner's Guise", inventoryType: 1, details: { stats: [[4, 24], [31, 15], [6, 17]] } });
const collar = item({ id: 279253, name: "Outlaw's Collar", quality: 4, inventoryType: 1, details: { stats: [[7, 31], [3, 21], [32, 21]] } });
const mask = item({ id: 13404, name: "Mask of the Unforgiven", inventoryType: 1, details: { stats: [[7, 13], [32, 14], [31, 20], [12, 6]] } });
const devourer = item({ id: 21693, name: "Guise of the Devourer", quality: 4, inventoryType: 1, seen: false, details: { stats: [[3, 19], [4, 17], [7, 36]] } });
const plate = item({ id: 1, name: "Plate Helm", inventoryType: 1, subclassId: 4, details: { stats: [[4, 40]] } });
const julio = item({ id: 19325, name: "Don Julio's Band", inventoryType: 11, subclassId: 0, seen: false, source: { kind: "reputation", faction: "Frostwolf Clan", standing: "exalted" }, details: { stats: [[7, 10], [32, 14], [31, 10], [38, 14]] } });
const circle = item({ id: 19432, name: "Circle of Applied Force", inventoryType: 11, subclassId: 0, details: { stats: [[4, 12], [3, 22], [7, 9]] } });
const blackfury = item({ id: 19167, name: "Blackfury", quality: 4, classId: 2, subclassId: 5, inventoryType: 17, details: { stats: [[4, 35], [7, 15], [32, 14]], dmg: { min: 105, max: 158, speed: 2.1, dps: 62.6 } } });
const force = item({ id: 19323, name: "The Unstoppable Force", quality: 4, classId: 2, subclassId: 5, inventoryType: 17, details: { stats: [[4, 18], [32, 28]], dmg: { min: 152, max: 255, speed: 3.6, dps: 56.6 }, effects: [{ trigger: 2, text: "Stuns target for 1 s." }] } });
const theramore = item({ id: 271955, name: "Theramore Pauldrons", quality: 4, inventoryType: 3, faction: "Alliance", details: { stats: [[3, 20], [4, 20]] } });
const darkspear = item({ id: 272105, name: "Darkspear Pauldrons", quality: 4, inventoryType: 3, faction: "Horde", details: { stats: [[3, 20], [4, 20]] } });
const pvpLegs = item({ id: 16564, name: "General's Leather Legguards", quality: 4, inventoryType: 7, pvpRank: 12, details: { stats: [[3, 20], [31, 20]] } });
const boeLegs = item({ id: 15065, name: "Warbear Woolies", inventoryType: 7, details: { bond: 2, stats: [[4, 28], [3, 18]] } });
const idol = item({ id: 220606, name: "Idol of the Dream", inventoryType: 28, subclassId: 8, details: { effects: [{ trigger: 1, text: "Increases the duration of Rip by 2 sec." }] } });

const cat = bisProfile("Druid", "Feral Cat")!;
const w = cat.weights;
const all = [guise, collar, mask, devourer, plate, julio, circle, blackfury, force, theramore, darkspear, pvpLegs, boeLegs, idol];

describe("caractéristiques et score", () => {
  it("le toucher et le critique des objets passent en %", () => {
    expect(itemStats(mask.details)).toMatchObject({ sta: 13, crit: 1, hit: 2, def: 6 });
    expect(itemStats(blackfury.details).wdps).toBe(62.6);
  });

  it("le toucher ne compte que jusqu'au cap", () => {
    expect(scoreItem(mask, w, 4)).toMatchObject({ base: 22, hit: 2, total: 62 });
    expect(scoreItem(mask, w, 1)).toMatchObject({ total: 42 });
    expect(scoreItem(mask, w, 0).total).toBe(22);
  });

  it("classement de la tête : le toucher fait monter un objet tant qu'il en manque", () => {
    const short = rankSlot(all, "Head", cat, w, 2, { faction: "Horde" }).scored.map(r => r.item.name);
    expect(short).toEqual(["Scarlet Executioner's Guise", "Outlaw's Collar", "Mask of the Unforgiven"]);
    const capped = rankSlot(all, "Head", cat, w, 0, { faction: "Horde" }).scored.map(r => r.item.name);
    expect(capped[0]).toBe("Outlaw's Collar");
  });
});

describe("filtres", () => {
  it("plaques, objets jamais vus sans source, autre faction : écartés", () => {
    expect(usable(plate, cat)).toBe(false);
    expect(isObtainable(devourer)).toBe(false);
    expect(usable(devourer, cat)).toBe(false);
    expect(usable(devourer, cat, { includeUnobtainable: true })).toBe(true);
    expect(isObtainable(julio)).toBe(true);
    expect(usable(theramore, cat, { faction: "Horde" })).toBe(false);
    expect(usable(darkspear, cat, { faction: "Horde" })).toBe(true);
    expect(usable({ ...darkspear, unobtainable: true }, cat)).toBe(false);
  });

  it("PvP et BoE", () => {
    expect(usable(pvpLegs, cat, { pvp: "none" })).toBe(false);
    expect(usable(pvpLegs, cat, { pvp: 10 })).toBe(false);
    expect(usable(pvpLegs, cat, { pvp: 12 })).toBe(true);
    expect(usable(boeLegs, cat, { noBoe: true })).toBe(false);
    expect(usable(boeLegs, cat)).toBe(true);
  });

  it("objets à effet : classés à part, par ordre alphabétique", () => {
    expect(hasEffect(force)).toBe(true);
    expect(hasEffect(idol)).toBe(true);
    const r = rankSlot(all, "Main Hand", cat, w, 4);
    expect(r.scored.map(x => x.item.name)).toEqual(["Blackfury"]);
    expect(r.effects.map(x => x.item.name)).toEqual(["The Unstoppable Force"]);
    expect(rankSlot(all, "Ranged / Relic", cat, w, 4).effects.map(x => x.item.name)).toEqual(["Idol of the Dream"]);
  });
});

describe("proposition d'une BiS", () => {
  it("partage le toucher entre les emplacements", () => {
    const noTalent = proposeBis(all, cat, w, { hitHave: 0, filters: { faction: "Horde" } });
    expect(noTalent.slots.Head?.item.name).toBe("Scarlet Executioner's Guise");
    expect(noTalent.slots["Main Hand"]?.item.name).toBe("Blackfury");
    expect(noTalent.slots["Off Hand"]).toBeUndefined();
    expect(noTalent.slots.Shoulder?.item.name).toBe("Darkspear Pauldrons");
    const capped = proposeBis(all, cat, w, { hitHave: 8, filters: { faction: "Horde" } });
    expect(capped.slots.Head?.item.name).toBe("Outlaw's Collar");
    expect(capped.totalHit).toBe(8 + capped.gearHit);
  });

  it("le Druide ne porte pas d'arme en main gauche ; un emplacement sans objet utile reste vide", () => {
    const mace = item({ id: 2, name: "One-Hand Mace", classId: 2, subclassId: 4, inventoryType: 13, details: { dmg: { min: 50, max: 90, speed: 2, dps: 40 } } });
    const dagger = item({ id: 3, name: "Dagger", classId: 2, subclassId: 15, inventoryType: 13, details: { dmg: { min: 40, max: 70, speed: 1.8, dps: 38 } } });
    const orb = item({ id: 4, name: "Orb", subclassId: 0, inventoryType: 23, details: { stats: [[3, 10]] } });
    const healTrinket = item({ id: 5, name: "Healing Gem", subclassId: 0, inventoryType: 12, details: { stats: [[41, 30]] } });
    const p = proposeBis([mace, dagger, orb, healTrinket], cat, w, { hitHave: 4 });
    expect(p.slots["Main Hand"]?.item.id).toBe(2);
    expect(p.slots["Off Hand"]?.item.name).toBe("Orb");
    expect(p.slots["Trinket 1"]).toBeUndefined();
  });

  it("un même anneau ne va pas dans les deux doigts ; un objet imposé reste", () => {
    const p = proposeBis(all, cat, w, { hitHave: 4 });
    const rings = [p.slots["Finger 1"]?.item.id, p.slots["Finger 2"]?.item.id];
    expect(new Set(rings).size).toBe(2);
    const fixed = proposeBis(all, cat, w, { hitHave: 4, fixed: { Head: mask } });
    expect(fixed.slots.Head?.item.name).toBe("Mask of the Unforgiven");
  });
});

describe("poids", () => {
  it("défaut, puis guilde, puis joueur", () => {
    expect(mergeWeights(w, { hit: 18 }, { agi: 2.5, crit: Number.NaN })).toMatchObject({ hit: 18, agi: 2.5, crit: 22, str: 2 });
  });

  it("toucher des talents", () => {
    expect(talentHit("Druid", [{ name: "Nature's Reach", rank: 2 }, { name: "Ferocity", rank: 5 }])).toBe(4);
    expect(talentHit("Warrior", [{ name: "Nature's Reach", rank: 2 }])).toBe(0);
  });

  it("import d'une chaîne Pawn", () => {
    const r = parseWeightsImport('( Pawn: v1: "Feral sim": Class=Druid, Spec=2, Strength=2.4, Agility=2.13, HitPercent=19.5, CritPercent=21, Ap=1, Dps=13.8, Foo=3 )');
    expect(r).toEqual({ ok: true, name: "Feral sim", weights: { str: 2.4, agi: 2.13, hit: 19.5, crit: 21, ap: 1, wdps: 13.8 }, ignored: ["Foo"] });
    expect(parseWeightsImport("Agility=2,1; Strength=2").ok).toBe(true);
    expect(parseWeightsImport("bonjour").ok).toBe(false);
    expect(parseWeightsImport("").ok).toBe(false);
  });
});

describe("provenances et faction", () => {
  it("libellés courts, en français et en anglais", () => {
    expect(sourceLabel(BIS_SOURCE_SEED[13340]!)).toBe("Stratholme · Baron Rivendare");
    expect(sourceLabel(BIS_SOURCE_SEED[19049]!)).toBe("Travail du cuir 300");
    expect(sourceLabel(BIS_SOURCE_SEED[19049]!, "en")).toBe("Leatherworking 300");
    expect(sourceLabel(BIS_SOURCE_SEED[272396]!)).toBe("Stranglethorn Vale · Pix Xizzix · 100 Tarnished Undermine Real");
    expect(sourceLabel(BIS_SOURCE_SEED[19325]!)).toBe("Stormpike Guard / Frostwolf Clan (exalté)");
    expect(sourceLabel(BIS_SOURCE_SEED[16710]!)).toBe("Butin du monde");
  });

  it("faction : masque de races, puis titres JcJ et paires vues en jeu", () => {
    expect(itemFaction("Ring", 1 | 4 | 8 | 64)).toBe("Alliance");
    expect(itemFaction("Ring", 2 | 16 | 32 | 128)).toBe("Horde");
    expect(itemFaction("Ring", -1)).toBeNull();
    expect(itemFaction("General's Leather Legguards", -1)).toBe("Horde");
    expect(itemFaction("Marshal's Leather Leggings")).toBe("Alliance");
    expect(itemFaction("Premier High Warlord's Pulverizer")).toBe("Horde");
    expect(itemFaction("Premier Knight-Champion's Beasthide Boots")).toBe("Alliance");
    expect(itemFaction("Theramore Pauldrons")).toBe("Alliance");
    expect(itemFaction("Darkspear Pauldrons")).toBe("Horde");
    expect(itemFaction("Cape of the Black Baron")).toBeNull();
  });
});
