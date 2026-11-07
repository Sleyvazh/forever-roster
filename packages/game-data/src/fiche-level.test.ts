import { describe, expect, it } from "vitest";
import { matchFiches } from "./fiche-level";

/** Fiches du site ↔ liste de guilde du jeu, pour le niveau relevé en jeu. Noms inventés. */
const roster = [
  { guid: "G1", name: "Necko Brisefer" },
  { guid: "G2", name: "Kaeldra Brisevent" },
  { guid: "G3", name: "Pikou Patacuivre" },
  { guid: "G4", name: "Pikou Ventlourd" },
  { guid: "G5", name: "Zélie Ombrelune" },
];
const f = (id: string, name: string, guid: string | null = null, userId = "u1") => ({ id, userId, name, guid });
const none = new Map<string, string>();

describe("matchFiches", () => {
  it("par l'identifiant de l'addon d'abord, quel que soit le nom de la fiche", () => {
    const m = matchFiches([f("a", "Surnom", "G2")], roster, none);
    expect(m.get("a")).toEqual({ guid: "G2", by: "addon" });
  });

  it("par prénom + nom, sans casse ni accents", () => {
    const m = matchFiches([f("a", "necko  BRISEFER"), f("b", "Zelie Ombrelune")], roster, none);
    expect(m.get("a")).toEqual({ guid: "G1", by: "full" });
    expect(m.get("b")).toEqual({ guid: "G5", by: "full" });
  });

  it("par prénom seul, seulement s'il est unique dans la liste", () => {
    const m = matchFiches([f("a", "Necko"), f("b", "Pikou"), f("c", "zélie")], roster, none);
    expect(m.get("a")).toEqual({ guid: "G1", by: "first" });
    expect(m.has("b")).toBe(false); // deux Pikou en jeu
    expect(m.get("c")).toEqual({ guid: "G5", by: "first" });
  });

  it("un nom complet qui ne correspond à personne ne retombe pas sur le prénom", () => {
    expect(matchFiches([f("a", "Necko Autrenom")], roster, none).size).toBe(0);
  });

  it("une fiche synchronisée par l'addon mais absente de la liste n'est pas rapprochée par son nom", () => {
    expect(matchFiches([f("a", "Necko", "G-ailleurs")], roster, none).size).toBe(0);
  });

  it("jamais le perso d'un autre joueur : identifiant de l'addon sur la fiche d'un autre compte", () => {
    const claimed = new Map([["G1", "u2"]]);
    expect(matchFiches([f("a", "Necko", null, "u1")], roster, claimed).size).toBe(0);
    // Le même compte : sa propre fiche synchronisée ailleurs ne l'empêche pas
    expect(matchFiches([f("a", "Necko", null, "u2")], roster, claimed).get("a")).toEqual({ guid: "G1", by: "first" });
  });

  it("un perso pris par l'addon de la fiche d'un autre joueur n'est pas rapproché par le nom ; une autre fiche du même joueur, si", () => {
    const other = matchFiches([f("a", "Alt", "G1", "u2"), f("b", "Necko", null, "u1")], roster, none);
    expect(other.get("a")).toEqual({ guid: "G1", by: "addon" });
    expect(other.has("b")).toBe(false);
    const same = matchFiches([f("a", "Necko", "G1", "u1"), f("b", "Necko", null, "u1")], roster, none);
    expect(same.get("b")).toEqual({ guid: "G1", by: "first" });
  });

  it("deux fiches de joueurs différents qui visent le même perso par leur nom : aucune des deux", () => {
    const m = matchFiches([f("a", "Necko", null, "u1"), f("b", "Necko Brisefer", null, "u2")], roster, none);
    expect(m.size).toBe(0);
  });

  it("deux fiches du même joueur qui visent le même perso : toutes les deux suivent le jeu (pas de fiche « leurre »)", () => {
    const m = matchFiches([f("a", "Necko", null, "u1"), f("b", "Necko Brisefer", null, "u1")], roster, none);
    expect(m.get("a")).toEqual({ guid: "G1", by: "first" });
    expect(m.get("b")).toEqual({ guid: "G1", by: "full" });
  });

  it("prénom composé : le premier mot du nom en jeu, pas un morceau du prénom", () => {
    const r = [{ guid: "G9", name: "Anne-Marie Dupont" }];
    expect(matchFiches([f("a", "Anne")], r, none).size).toBe(0);
    expect(matchFiches([f("a", "anne-marie")], r, none).get("a")).toEqual({ guid: "G9", by: "first" });
  });

  it("nom vide ou fait d'espaces : rien", () => {
    expect(matchFiches([f("a", "  ")], roster, none).size).toBe(0);
  });
});
