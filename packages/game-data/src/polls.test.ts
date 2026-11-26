import { describe, expect, it } from "vitest";
import { bestSlot, leaders, parseEnd, parseSlot, pollEndText, slotText, textBar } from "./polls";

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
