import { describe, expect, it } from "vitest";
import { bestSlot, byLabel, isBigPoll, leaders, parseEnd, parseSlot, pollEndText, ranking, runoffPick, slotText, textBar } from "./polls";

// Jeudi 26 novembre 2026, 19:42 à Paris
const NOW = new Date("2026-11-26T18:42:00Z");
const at = (s: string) => { const r = parseSlot(s, NOW); return r.ok ? slotText(r.at) : r.reason; };

describe("sondages : comptes", () => {
  it("meilleur créneau (Oui, puis Si besoin, puis le plus tôt), choix en tête, barres", () => {
    expect(bestSlot([{ id: 1, yes: 3, maybe: 1 }, { id: 2, yes: 3, maybe: 2 }, { id: 3, yes: 3, maybe: 2 }])).toBe(2);
    expect(bestSlot([{ id: 1, yes: 0, maybe: 4 }])).toBeNull();
    expect(leaders([{ id: 1, yes: 2, maybe: 0 }, { id: 2, yes: 2, maybe: 0 }, { id: 3, yes: 1, maybe: 0 }])).toEqual([1, 2]);
    expect(leaders([{ id: 1, yes: 0, maybe: 0 }])).toEqual([]);
    expect(textBar(6, 13)).toBe("██████░░░░░░░░");
    expect(textBar(0, 0)).toBe("░".repeat(14));
  });
});

describe("grand sondage : ordre, classement, qualifiés du 2e tour", () => {
  const opt = (label: string, yes: number, id = 0) => ({ id, label, yes });
  it("ordre alphabétique sans accents ni majuscules ; plus de 10 choix", () => {
    expect(["Zèle", "écho", "Aube", "Échine", "bastion"].map(label => ({ label })).sort(byLabel).map(o => o.label)).toEqual(["Aube", "bastion", "Échine", "écho", "Zèle"]);
    const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, label: `${i}`, at: null }));
    expect(isBigPoll({ kind: "choice", options: opts(10) })).toBe(false);
    expect(isBigPoll({ kind: "choice", options: opts(11) })).toBe(true);
    expect(isBigPoll({ kind: "dates", options: opts(11) })).toBe(false);
  });
  it("classement : voix, puis ordre alphabétique ; 5 premiers et leurs ex æquo, 10 au plus, avec au moins une voix", () => {
    const list = [opt("Dague", 2, 4), opt("Écho", 9, 5), opt("Aube", 7, 1), opt("Milk me John", 7, 12), opt("Bastion", 4, 2), opt("Cendre", 2, 3), opt("Forge", 0, 6)];
    expect(ranking(list).map(o => o.label)).toEqual(["Écho", "Aube", "Milk me John", "Bastion", "Cendre", "Dague", "Forge"]);
    expect(runoffPick(list)).toEqual([5, 1, 12, 2, 3, 4]);
    expect(runoffPick([opt("A", 1, 1), opt("B", 0, 2)])).toEqual([1]);
    expect(runoffPick([opt("A", 0, 1)])).toEqual([]);
    // 12 ex æquo : les 10 premiers par ordre alphabétique
    const tie = Array.from({ length: 12 }, (_, i) => opt(String.fromCharCode(76 - i), 3, i + 1));
    expect(runoffPick(tie).map(id => tie.find(o => o.id === id)!.label)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
  });
});

describe("sondages : créneaux et fin tapés dans le bot", () => {
  it("dates, jours, demain, ce soir, anglais ; illisible, inexistant, passé", () => {
    expect(at("01/12 21:00")).toBe("Mardi 01/12 · 21:00");
    expect(at("Mardi 01/12 · 21:00")).toBe("Mardi 01/12 · 21:00");
    expect(at("mercredi 21h")).toBe("Mercredi 02/12 · 21:00");
    expect(at("jeudi 21h")).toBe("Jeudi 26/11 · 21:00");
    expect(at("jeudi 19h")).toBe("Jeudi 03/12 · 19:00");
    expect(at("demain 20h30")).toBe("Vendredi 27/11 · 20:30");
    expect(at("ce soir 21h")).toBe("Jeudi 26/11 · 21:00");
    expect(at("le 2026-12-02 à 21:00")).toBe("Mercredi 02/12 · 21:00");
    expect(at("tuesday 9pm")).toBe("Mardi 01/12 · 21:00");
    expect(at("tomorrow 8:30am")).toBe("Vendredi 27/11 · 08:30");
    expect(at("mercredi")).toBe("unreadable");
    expect(at("merc 21h")).toBe("unreadable");
    expect(at("31/02 21h")).toBe("invalid");
    expect(at("25h")).toBe("invalid");
    expect(at("26/11/2026 18:00")).toBe("past");
    expect(slotText(new Date("2026-12-01T20:00:00Z"), "en")).toBe("Tuesday 01/12 · 21:00");
  });
  it("fin : vide, durées, heure du jour, moment", () => {
    const end = (s: string) => { const r = parseEnd(s, NOW); return r.ok ? (r.at ? pollEndText(r.at) : null) : r.reason; };
    expect(end("")).toBeNull();
    expect(end("2j")).toBe("samedi 28/11 à 19:42");
    expect(end("48h")).toBe("samedi 28/11 à 19:42");
    expect(end("dans 12 h")).toBe("vendredi 27/11 à 07:42");
    expect(end("1 semaine")).toBe("jeudi 03/12 à 19:42");
    expect(end("3 days")).toBe("dimanche 29/11 à 19:42");
    expect(end("21h")).toBe("jeudi 26/11 à 21:00");
    expect(end("dimanche 20:00")).toBe("dimanche 29/11 à 20:00");
    expect(end("0j")).toBe("invalid");
    expect(pollEndText(new Date("2026-11-26T17:00:00Z"), "en")).toBe("Thursday 26/11 at 18:00");
  });
});
