import { describe, expect, it } from "vitest";
import { gameLogDate, matchGameLog } from "../src/lib/game-log";

/** Journaux du jeu (lib/game-log.ts) : date d'une ligne « il y a N heures » et rapprochement avec les lignes déjà gardées. Fonctions pures. */

describe("rapprochement des lignes de journal (matchGameLog)", () => {
  const MIN = 60e3;
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 31, 12) + minutes * MIN);
  const line = (key: string, minutes: number) => ({ key, at: at(minutes) });
  const row = (id: number, key: string, minutes: number) => ({ id, key, at: at(minutes) });

  it("même ligne à 2 h près : déjà connue ; au-delà, nouvelle ; autre ligne, nouvelle", () => {
    const stored = [row(1, "a", 0)];
    expect(matchGameLog([line("a", 120)], stored).fresh).toEqual([]);
    expect(matchGameLog([line("a", -120)], stored).fresh).toEqual([]);
    expect(matchGameLog([line("a", 121)], stored).fresh).toHaveLength(1);
    expect(matchGameLog([line("a", -121)], stored).fresh).toHaveLength(1);
    expect(matchGameLog([line("b", 0)], stored).fresh).toHaveLength(1);
  });

  it("chaque ligne connue ne sert qu'une fois : deux lignes identiques pour une connue, l'une est nouvelle", () => {
    expect(matchGameLog([line("a", 0), line("a", 0)], [row(1, "a", 0)]).fresh).toHaveLength(1);
    expect(matchGameLog([line("a", 0), line("a", 0)], [row(1, "a", 0), row(2, "a", 0)]).fresh).toEqual([]);
    // Trois lectures pour deux lignes connues : la plus éloignée est nouvelle
    expect(matchGameLog([line("a", 0), line("a", 6), line("a", 12)], [row(1, "a", 0), row(2, "a", 6)]).fresh).toEqual([line("a", 12)]);
  });

  it("la ligne connue la plus proche est prise", () => {
    // Lignes connues à −60 et +30 min : la lecture à 0 prend celle de +30, celle à +60 se rabat sur −60 (2 h pile)
    const r = matchGameLog([line("a", 0), line("a", 60)], [row(1, "a", -60), row(2, "a", 30)]);
    expect(r.fresh).toEqual([]);
    expect(r.earlier).toEqual([{ id: 2, at: at(0) }]);
  });

  it("la date gardée est la plus ancienne (« il y a » arrondi en dessous) : la ligne connue recule, elle n'avance jamais", () => {
    const r = matchGameLog([line("a", -60), line("b", 60)], [row(1, "a", 0), row(2, "b", 0)]);
    expect(r.fresh).toEqual([]);
    expect(r.earlier).toEqual([{ id: 1, at: at(-60) }]);
  });

  it("l'ordre des lignes reçues ne change rien", () => {
    const stored = [row(1, "a", 0), row(2, "a", 60)];
    const lines = [line("a", 72), line("a", 6), line("a", 540)];
    expect(matchGameLog(lines, stored).fresh).toEqual([line("a", 540)]);
    expect(matchGameLog([...lines].reverse(), stored).fresh).toEqual([line("a", 540)]);
  });
});

describe("date d'une ligne de journal (gameLogDate)", () => {
  const READ = Date.UTC(2026, 9, 31, 12);

  it("relevé moins « il y a » N heures", () => {
    expect(gameLogDate(READ, 0)!.toISOString()).toBe("2026-10-31T12:00:00.000Z");
    expect(gameLogDate(READ, 3)!.toISOString()).toBe("2026-10-31T09:00:00.000Z");
  });

  it("« il y a » démesuré : date impossible ou d'avant 2000, la ligne est à sauter", () => {
    expect(gameLogDate(READ, 24 * 365 * 25)).not.toBeNull(); // il y a 25 ans (2001)
    expect(gameLogDate(READ, 24 * 365 * 27)).toBeNull(); // il y a 27 ans (1999)
    expect(gameLogDate(READ, 9999999)).toBeNull();
    expect(gameLogDate(READ, 1e20)).toBeNull(); // hors de ce qu'une date peut dire (NaN)
    expect(gameLogDate(READ, 1e300)).toBeNull();
  });
});
