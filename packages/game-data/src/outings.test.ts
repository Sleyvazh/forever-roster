import { describe, expect, it } from "vitest";
import { groupAddonExport, outingLine, type GroupExportOuting } from "./addon";
import {
  addDays, atTime, characterRoles, classRoles, dayKeyOf, endOfDay, levelsText, outingDays, outingExpiry, outingWhen, outingWhenText, placesText, specForRole, validPlaces,
} from "./outings";
import { canonicalGroupBlock } from "./share";

const TZ = "Europe/Paris";

describe("jours et heures des sorties (heure de Paris)", () => {
  // Jeudi 19 novembre 2026, 18:40 à Paris (UTC+1)
  const now = new Date("2026-11-19T17:40:00Z");
  it("aujourd'hui, demain, fin du jour, heure d'un jour", () => {
    expect(outingDays(now, TZ)).toEqual({ today: "2026-11-19", tomorrow: "2026-11-20" });
    expect(dayKeyOf(new Date("2026-11-19T23:30:00Z"), TZ)).toBe("2026-11-20");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(endOfDay("2026-11-20", TZ).toISOString()).toBe("2026-11-20T23:00:00.000Z");
    expect(atTime("2026-11-19", "21:00", TZ)?.toISOString()).toBe("2026-11-19T20:00:00.000Z");
    expect(atTime("2026-11-19", "25:00", TZ)).toBeNull();
    // Changement d'heure (25/10/2026) : fin du jour à 23:00 UTC le 25, 22:00 UTC la veille
    expect(endOfDay("2026-10-24", TZ).toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(endOfDay("2026-10-25", TZ).toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("fin de vie : 2 h après l'heure, ou la fin de son jour (« dès que complet »)", () => {
    expect(outingExpiry(new Date("2026-11-19T20:00:00Z"), "2026-11-19", TZ).toISOString()).toBe("2026-11-19T22:00:00.000Z");
    expect(outingExpiry(null, "2026-11-20", TZ).toISOString()).toBe("2026-11-20T23:00:00.000Z");
  });

  it("libellés : ce soir, aujourd'hui, demain, dès que complet", () => {
    expect(outingWhen(new Date("2026-11-19T20:00:00Z"), "2026-11-19", now, TZ)).toEqual({ day: "Ce soir", time: "21:00" });
    expect(outingWhen(new Date("2026-11-19T13:00:00Z"), "2026-11-19", now, TZ)).toEqual({ day: "Aujourd'hui", time: "14:00" });
    expect(outingWhen(null, "2026-11-20", now, TZ)).toEqual({ day: "Demain", time: null });
    expect(outingWhenText(new Date("2026-11-19T20:00:00Z"), "2026-11-19", now, TZ)).toBe("ce soir 21:00");
    expect(outingWhenText(new Date("2026-11-20T17:00:00Z"), "2026-11-20", now, TZ)).toBe("demain 18:00");
    expect(outingWhenText(null, "2026-11-20", now, TZ)).toBe("demain, dès que complet");
    // Après minuit, la sortie de « demain » devient celle de ce soir
    expect(outingWhenText(new Date("2026-11-20T17:00:00Z"), "2026-11-20", new Date("2026-11-20T08:00:00Z"), TZ)).toBe("ce soir 18:00");
    expect(levelsText(29, 38)).toBe("29-38");
    expect(levelsText(60, 60)).toBe("60");
    expect(levelsText(null, null)).toBe("");
  });
});

describe("places et rôles", () => {
  it("5 en tout, chaque rôle de 0 à 5", () => {
    expect(validPlaces({ tank: 1, heal: 1, dps: 3 })).toBe(true);
    expect(validPlaces({ tank: 0, heal: 1, dps: 4 })).toBe(true);
    expect(validPlaces({ tank: 1, heal: 1, dps: 4 })).toBe(false);
    expect(validPlaces({ tank: -1, heal: 2, dps: 4 })).toBe(false);
    expect(placesText({ tank: 1, heal: 1, dps: 3 })).toBe("1/1/3");
  });
  it("rôles d'un perso : ceux de ses spés, sinon ceux de sa classe", () => {
    expect(classRoles("Druid")).toEqual(["Tank", "Heal", "DPS"]);
    expect(classRoles("Mage")).toEqual(["DPS"]);
    expect(characterRoles({ cls: "Druid", spec1: "Feral Bear", spec2: "Restoration" })).toEqual(["Tank", "Heal"]);
    expect(characterRoles({ cls: "Druid", spec1: "", spec2: "" })).toEqual(["Tank", "Heal", "DPS"]);
    expect(characterRoles({ cls: "Warrior", spec1: "Protection" })).toEqual(["Tank"]);
    expect(specForRole({ cls: "Druid", spec1: "Feral Bear", spec2: "Restoration" }, "Heal")).toBe("Restoration");
    expect(specForRole({ cls: "Druid", spec1: "Feral Bear" }, "DPS")).toBe("Balance");
  });
});

/** Les deux lignes d'exemple du contrat (site ↔ addon) : les tests de l'addon lisent les mêmes. */
const CONTRACT_X = [
  "X;0f6c1d2e-0000-4000-8000-000000000001;1792105200;gnomeregan;Gnomeregan;29;38;Pikou;1/1/3;Bramm;Kaelys;Pikou,Tiblou,@mirka;Heal:Brindille;Toutes les quêtes : prenez-les avant d'entrer.",
  "X;0f6c1d2e-0000-4000-8000-000000000002;0;other;Élite de la Vallée;;;Torvin;1/1/3;Torvin;;;;",
];
const GNOME: GroupExportOuting = {
  id: "0f6c1d2e-0000-4000-8000-000000000001", at: 1792105200, dungeon: "gnomeregan", title: "Gnomeregan", min: 29, max: 38, creator: "Pikou",
  places: { tank: 1, heal: 1, dps: 3 }, tanks: [{ name: "Bramm" }], heals: [{ name: "Kaelys" }],
  dps: [{ name: "Pikou" }, { name: "Tiblou" }, { name: "mirka", guest: true }], waiting: [{ role: "Heal", name: "Brindille" }],
  note: "Toutes les quêtes : prenez-les avant d'entrer.",
};
const ELITE: GroupExportOuting = {
  id: "0f6c1d2e-0000-4000-8000-000000000002", at: 0, dungeon: "other", title: "Élite de la Vallée", min: null, max: null, creator: "Torvin",
  places: { tank: 1, heal: 1, dps: 3 }, tanks: [{ name: "Torvin" }], heals: [], dps: [], waiting: [], note: "",
};

describe("ligne X du FRG (sorties)", () => {
  it("reproduit l'échantillon du contrat", () => {
    expect([outingLine(GNOME), outingLine(ELITE)]).toEqual(CONTRACT_X);
  });

  it("nettoie les champs (« ; », « | », retours à la ligne), prénom seul, pseudo Discord sans séparateurs, note à 80 caractères", () => {
    const line = outingLine({
      ...ELITE, title: "Élite ; de | la\nVallée", creator: "Greta Coulé", tanks: [{ name: "Greta Coulé" }], heals: [{ name: "vex, le: roi", guest: true }],
      waiting: [{ role: "DPS", name: "x;y", guest: true }], note: "a".repeat(120),
    });
    const f = line.split(";");
    expect(f).toHaveLength(14);
    expect(f[4]).toBe("Élite   de   la Vallée");
    expect(f[7]).toBe("Greta");
    expect(f[9]).toBe("Greta");
    expect(f[10]).toBe("@vexleroi");
    expect(f[12]).toBe("DPS:@xy");
    expect(f[13]).toHaveLength(80);
    expect(line).not.toMatch(/[|\n]/);
  });

  it("après les lignes non comptées, avant M, hors du compte de END, dans la forme canonique signée", () => {
    const text = groupAddonExport({ id: "g1", name: "Les Lanternes" }, 1, [{ id: "r1", name: "Onyxia", at: 0, status: "present", character: "Pikou", lootMode: "journal" }],
      [], [], ["Torvin"], undefined, { members: ["Pikou", "Torvin"] }, [GNOME, ELITE]);
    const lines = text.split("\n");
    expect(lines.slice(-5)).toEqual(["O;Torvin", ...CONTRACT_X, "M;Pikou,Torvin", "END;1"]);
    expect(canonicalGroupBlock(text, "FRG")).toContain(CONTRACT_X[0]);
    // Sans sortie : rien ne change
    expect(groupAddonExport({ id: "g1", name: "G" }, 1, [], []).split("\n")).toEqual(["FRG;1;g1;1;G", "M;", "END;0"]);
  });
});
