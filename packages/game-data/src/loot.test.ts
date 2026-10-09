import { describe, expect, it } from "vitest";
import {
  instanceKey, LOOT_CATEGORIES, LOOT_CATEGORY_LABEL, lootCategory, lootCategoryText, lootCountLabel, lootCounts, lootCountShort, lootModeHint, lootModeLabel,
  lootModesOf, lootSettings, lootSkipReason, retailLootHow, retailLootMode, parseLootHistory, srPlusBonus,
} from "./loot";

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
  it("compte des objets reçus : spé principale seulement", () => {
    expect(lootCounts({ method: "sr" })).toBe(true);
    expect(lootCounts({ method: "roll", detail: "MS 87" })).toBe(true);
    expect(lootSkipReason({ method: "roll", detail: "OS 54" })).toBe("jet OS");
    expect(lootSkipReason({ method: "roll", detail: "jet 12" })).toBe("jet libre");
    expect(lootCounts({ method: "council", response: "bis" })).toBe(true);
    expect(lootCounts({ method: "council" })).toBe(true);
    expect(lootSkipReason({ method: "council", response: "off" })).toBe("Off-Spec");
    expect(lootSkipReason({ method: "council", response: "transmo" })).toBe("Transmo");
    expect(lootCounts({})).toBe(true); // journal : compté, les officiers peuvent l'exclure
  });
  it("libellés de la période", () => {
    const s = lootSettings({});
    expect(s).toMatchObject({ countMode: "season", seasonStart: null, countRaids: 5, countBy: "player" });
    expect(lootCountLabel(s)).toBe("depuis le début");
    expect(lootCountLabel({ ...s, seasonStart: "2026-11-05" })).toBe("depuis le 05/11/2026");
    expect(lootCountLabel({ ...s, countMode: "days" })).toBe("sur les 30 derniers jours");
    expect(lootCountShort({ ...s, countMode: "raids", countRaids: 8 })).toBe("8 raids");
  });
});

describe("butin sur Roster (lot R3b)", () => {
  it("modes : journal ou conseil, pas de soft reserve", () => {
    expect(lootModesOf("retail")).toEqual(["journal", "council"]);
    expect(lootModesOf("forever")).toEqual(["journal", "council", "softres"]);
    expect(retailLootMode("softres")).toBe("journal");
    expect(retailLootMode("council")).toBe("council");
    expect(retailLootMode(undefined)).toBe("journal");
    expect(lootModeLabel("council", "retail")).toBe("Conseil (distribution par Roster)");
    expect(lootModeLabel("council", "retail", true)).toBe("Conseil");
    expect(lootModeLabel("softres", "retail")).toBe("Journal");
    expect(lootModeLabel("council", "forever")).toBe("Loot council");
    expect(lootModeHint("journal", "retail")).toContain("addon Roster");
  });
  it("bilan : comment l'objet a été distribué, et s'il compte dans « Reçus »", () => {
    const council = { method: "council" as const, response: "bis" as const, detail: "3 votes" };
    expect(retailLootHow(council)).toBe("Conseil : BiS · 3 votes");
    expect(lootCounts(council)).toBe(true);
    expect(retailLootHow({ method: "council", response: "off", detail: "1 vote" })).toBe("Conseil : Off-Spec · 1 vote");
    expect(retailLootHow({ method: "roll", detail: "MS 87" })).toBe("Jet MS 87");
    expect(retailLootHow({ method: "roll", detail: "OS 54" })).toBe("Jet OS 54");
    expect(lootSkipReason({ method: "roll", detail: "OS 54" })).toBe("jet OS");
    expect(retailLootHow({ method: "roll", detail: "jet 54" })).toBe("Jet libre 54");
    expect(lootSkipReason({ method: "roll", detail: "jet 54" })).toBe("jet libre");
    expect(retailLootHow({ method: "ml" })).toBe("Chef de butin");
    expect(lootCounts({ method: "ml" })).toBe(true);
    // « Garder » de Roster : noté « gardé », ne compte pas
    expect(retailLootHow({ method: "ml", detail: "gardé" })).toBe("Gardé par le chef de butin");
    expect(lootSkipReason({ method: "ml", detail: "gardé" })).toBe("gardé");
    expect(lootCounts({ method: "ml", detail: "gardé" })).toBe(false);
    expect(retailLootHow({})).toBeNull();
  });

  it("détail des objets reçus : BiS, Upgrade, jets MS ; jamais pour un objet qui ne compte pas", () => {
    expect(lootCategory({ method: "council", response: "bis", detail: "3 votes" })).toBe("bis");
    expect(lootCategory({ method: "council", response: "upgrade" })).toBe("upgrade");
    expect(lootCategory({ method: "roll", detail: "MS 87" })).toBe("ms");
    expect(lootCategory({ method: "roll", detail: " ms 12" })).toBe("ms");
    // Comptent, mais sans catégorie (dans le total seulement)
    expect(lootCategory({ method: "council" })).toBeNull();
    expect(lootCategory({ method: "ml" })).toBeNull();
    expect(lootCategory({ method: "sr", detail: "61 +20 = 81" })).toBeNull();
    expect(lootCategory({})).toBeNull();
    expect(lootCategory({ method: "roll", detail: "87" })).toBeNull();
    expect(lootCategory({ method: "roll", detail: "MSG 87" })).toBeNull();
    // Ne comptent pas : jamais de catégorie
    for (const l of [
      { method: "council", response: "off" }, { method: "council", response: "transmo" }, { method: "roll", detail: "OS 54" },
      { method: "roll", detail: "jet 54" }, { method: "ml", detail: "gardé" },
    ] as const) {
      expect(lootSkipReason(l)).not.toBeNull();
      expect(lootCategory(l)).toBeNull();
    }
    // Un détail qui ne compte pas l'emporte sur la réponse
    expect(lootCategory({ method: "ml", response: "bis", detail: "gardé" })).toBeNull();
    expect(LOOT_CATEGORIES).toEqual(["bis", "upgrade", "ms"]);
    expect(LOOT_CATEGORY_LABEL.ms).toBe("Jet MS");
    expect(lootCategoryText({ bis: 2, upgrade: 3, ms: 1 })).toBe("2 BiS · 3 Up · 1 MS");
    expect(lootCategoryText({ bis: 0, upgrade: 0, ms: 1 })).toBe("1 MS");
    expect(lootCategoryText({ bis: 0, upgrade: 0, ms: 0 })).toBe("");
    expect(lootCategoryText({})).toBe("");
  });
});

describe("historique de butin collé (avant le site)", () => {
  const text = `Season loot count - 64 items (Season 2)

Quinlan - BiS 3, Spé 1 4 (total 7)
  - Crochet de malveillance ombreuse
  - Crispins roussis par le venin

Hellcîde - BiS 3, Spé 1 1 (total 4)
  - Couronne du crochet éternel
Slehvaz - BiS 2, Spe 1 0
Påndora : 3 objets
ligne au hasard`;
  it("lit le titre, les joueurs, leurs comptes et leurs objets", () => {
    const h = parseLootHistory(text);
    expect(h.label).toBe("Season 2");
    expect(h.entries.map(e => [e.name, e.bis, e.ms, e.total, e.items.length])).toEqual([
      ["Quinlan", 3, 4, 7, 2], ["Hellcîde", 3, 1, 4, 1], ["Slehvaz", 2, 0, 2, 0], ["Påndora", null, null, 3, 0],
    ]);
    expect(h.entries[0]!.items[1]).toBe("Crispins roussis par le venin");
    expect(h.ignored).toEqual(["ligne au hasard"]);
  });
  it("texte vide ou sans joueur", () => {
    expect(parseLootHistory("").entries).toEqual([]);
    expect(parseLootHistory("- objet sans joueur").ignored).toEqual(["- objet sans joueur"]);
  });
});
