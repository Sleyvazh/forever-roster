import { describe, expect, it } from "vitest";
import { BANK_COLS, BANK_ROWS, BANK_SLOTS, bankItemVerb, bankMoneyText, bankSlotPos, moneyParts } from "./bank";

/** Banque de guilde : disposition des cases, pièces, textes du journal. */

describe("disposition des cases", () => {
  it("7 groupes de 2 colonnes de 7 cases, remplis de haut en bas (case 1 en haut à gauche)", () => {
    expect(BANK_COLS * BANK_ROWS).toBe(BANK_SLOTS);
    expect(bankSlotPos(1)).toEqual({ col: 0, row: 0 });
    expect(bankSlotPos(7)).toEqual({ col: 0, row: 6 });
    expect(bankSlotPos(8)).toEqual({ col: 1, row: 0 });
    expect(bankSlotPos(14)).toEqual({ col: 1, row: 6 });
    expect(bankSlotPos(15)).toEqual({ col: 2, row: 0 });
    expect(bankSlotPos(98)).toEqual({ col: 13, row: 6 });
  });
  it("chaque case a sa place, sans doublon", () => {
    const places = new Set<string>();
    for (let slot = 1; slot <= BANK_SLOTS; slot++) {
      const { col, row } = bankSlotPos(slot);
      expect(col).toBeGreaterThanOrEqual(0); expect(col).toBeLessThan(BANK_COLS);
      expect(row).toBeGreaterThanOrEqual(0); expect(row).toBeLessThan(BANK_ROWS);
      places.add(`${col}:${row}`);
    }
    expect(places.size).toBe(BANK_SLOTS);
  });
});

describe("or et textes du journal", () => {
  it("pièces d'or, d'argent et de cuivre", () => {
    expect(moneyParts(12345678)).toEqual({ g: 1234, s: 56, c: 78 });
    expect(moneyParts(0)).toEqual({ g: 0, s: 0, c: 0 });
    expect(moneyParts(99)).toEqual({ g: 0, s: 0, c: 99 });
    expect(moneyParts(10000)).toEqual({ g: 1, s: 0, c: 0 });
  });
  it("verbe d'un mouvement d'objet", () => {
    expect(bankItemVerb("deposit")).toBe("a déposé");
    expect(bankItemVerb("withdraw")).toBe("a retiré");
    expect(bankItemVerb("move")).toBe("a déplacé");
    expect(bankItemVerb("weird")).toBe("(weird)");
  });
  it("un type qui porte le nom d'une propriété d'objet reste un type inconnu (le type d'une ligne est une suite de lettres, donc peut s'écrire ainsi)", () => {
    for (const type of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      expect(bankItemVerb(type)).toBe(`(${type})`);
      expect(bankMoneyText(type)).toEqual({ verb: `(${type})`, sign: -1 });
    }
  });
  it("texte et sens d'un mouvement d'or", () => {
    expect(bankMoneyText("deposit")).toEqual({ verb: "a déposé", sign: 1 });
    expect(bankMoneyText("withdraw")).toEqual({ verb: "a retiré", sign: -1 });
    expect(bankMoneyText("repair")).toEqual({ verb: "a payé des réparations", sign: -1 });
    expect(bankMoneyText("buyTab")).toEqual({ verb: "a acheté un onglet", sign: -1 });
    expect(bankMoneyText("withdrawForTab")).toEqual({ verb: "a retiré pour un onglet", sign: -1 });
    expect(bankMoneyText("depositSummary")).toEqual({ verb: "a versé sa part du butin", sign: 1 });
    expect(bankMoneyText("weird")).toEqual({ verb: "(weird)", sign: -1 });
  });
});
