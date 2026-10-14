import { describe, expect, it } from "vitest";
import { CLASS_NAMES, classColor, classLabel, classesOf, computeCoverage, effectsOf, isValidSpecFor, resolveGameLang, roleOf, specLabel, specSlug, specsOf, type ClassName } from "./index";
import { realmSlug, retailDefaultSize, retailLinks, retailOnlyClassOfSlug, retailOnlyClassSlug, retailRaidOf, retailSizeRange, retailTargets, RETAIL_CLASS_NAMES, RETAIL_CLASSES, RETAIL_ONLY_CLASS_SLUGS } from "./retail";

describe("WoW Retail (Roster)", () => {
  it("classes propres à Retail : slugs des icônes officielles et de leurs spés", () => {
    // Exactement les classes de Retail absentes de Forever, avec la même règle de slug que les spés
    const only = RETAIL_CLASS_NAMES.filter(c => !CLASS_NAMES.includes(c as ClassName));
    expect(Object.keys(RETAIL_ONLY_CLASS_SLUGS).sort()).toEqual(only.sort());
    for (const [cls, slug] of Object.entries(RETAIL_ONLY_CLASS_SLUGS)) expect(slug).toBe(specSlug(cls));
    expect([retailOnlyClassSlug("Death Knight"), retailOnlyClassSlug("Demon Hunter"), retailOnlyClassSlug("Evoker"), retailOnlyClassSlug("Monk")])
      .toEqual(["death-knight", "demon-hunter", "evoker", "monk"]);
    expect([retailOnlyClassSlug("Druid"), retailOnlyClassSlug("Paladin"), retailOnlyClassSlug("Inconnue"), retailOnlyClassSlug("")]).toEqual([null, null, null, null]);
    expect([retailOnlyClassOfSlug("demon-hunter"), retailOnlyClassOfSlug("monk"), retailOnlyClassOfSlug("druid"), retailOnlyClassOfSlug("")]).toEqual(["Demon Hunter", "Monk", null, null]);
    const specs = Object.keys(RETAIL_ONLY_CLASS_SLUGS).flatMap(c => RETAIL_CLASSES[c]!.specs.map(s => specSlug(s.name)));
    expect(specs).toEqual(["blood", "frost", "unholy", "havoc", "vengeance", "devourer", "devastation", "preservation", "augmentation", "brewmaster", "mistweaver", "windwalker"]);
    // Noms d'émojis Discord (fr_<classe>_<spé>, lettres, chiffres et « _ ») : 32 caractères au plus
    for (const [c, slug] of Object.entries(RETAIL_ONLY_CLASS_SLUGS)) for (const s of RETAIL_CLASSES[c]!.specs) {
      expect(`fr_${slug}_${specSlug(s.name)}`.replace(/-/g, "_")).toMatch(/^[a-z0-9_]{2,32}$/);
    }
  });
  it("13 classes, 40 spés, rôles", () => {
    expect(classesOf("retail")).toHaveLength(13);
    expect(Object.values(RETAIL_CLASSES).flatMap(c => c.specs)).toHaveLength(40);
    expect(specsOf("retail", "Demon Hunter")).toEqual(["Havoc", "Vengeance", "Devourer"]);
    expect(isValidSpecFor("retail", "Monk", "Mistweaver") && !isValidSpecFor("retail", "Monk", "Holy") && !isValidSpecFor("forever", "Monk", "Mistweaver")).toBe(true);
    expect([roleOf("Brewmaster"), roleOf("Preservation"), roleOf("Devourer"), roleOf("Holy"), roleOf("Feral Bear")]).toEqual(["Tank", "Heal", "DPS", "Heal", "Tank"]);
  });
  it("noms en français ou en anglais, couleurs, langue par défaut", () => {
    expect(classLabel("retail", "Death Knight", "fr")).toBe("Chevalier de la mort");
    expect(classLabel("retail", "Death Knight", "en")).toBe("Death Knight");
    expect(specLabel("retail", "Monk", "Mistweaver", "fr")).toBe("Tisse-brume");
    expect(specLabel("forever", "Druid", "Feral Bear", "fr")).toBe("Feral Bear");
    expect([classColor("Evoker"), classColor("Priest", "retail"), classColor("Priest")]).toEqual(["#33937F", "#FFFFFF", "#B9C2D6"]);
    expect([resolveGameLang("auto", "fr-FR"), resolveGameLang("auto", "en-GB"), resolveGameLang("en", "fr-FR"), resolveGameLang(null, null)]).toEqual(["fr", "en", "en", "fr"]);
  });
  it("difficultés et tailles", () => {
    expect(retailSizeRange("heroic")).toEqual({ min: 10, max: 30 });
    expect(retailSizeRange("mythic", "Flèche du Vide")).toEqual({ min: 20, max: 20 });
    expect(retailSizeRange("mythic", "Déliement de Kith'ix")).toEqual({ min: 15, max: 25 });
    expect(retailRaidOf("The Venomous Abyss")?.fr).toBe("L'Abîme Venimeux");
    expect(retailRaidOf("abime venimeux HM")?.key).toBe("venomous-abyss");
    expect(retailDefaultSize("normal")).toBe(20);
    expect(retailTargets(30)).toEqual({ tank: 2, heal: 6, dps: 22 });
    expect(retailTargets(10)).toEqual({ tank: 2, heal: 2, dps: 6 });
  });
  it("buffs de Midnight et liens", () => {
    const cov = computeCoverage([{ characterId: "a", cls: "Monk", spec: "Mistweaver", group: 1 }, { characterId: "b", cls: "Mage", spec: "Fire", group: 2 }], effectsOf("retail"));
    const ok = cov.filter(c => c.covered).map(c => c.effect.id);
    expect(ok).toEqual(["ai", "mystic", "lust"]);
    expect(realmSlug("Kael'thas")).toBe("kaelthas");
    expect(realmSlug("Confrérie du Thorium")).toBe("confrerie-du-thorium");
    expect(retailLinks("Vaëlis", "Hyjal").raiderio).toBe("https://raider.io/characters/eu/hyjal/va%C3%ABlis");
  });
});
