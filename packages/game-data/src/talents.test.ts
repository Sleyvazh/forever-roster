import { describe, expect, it } from "vitest";
import { linkFromRanks, parseTalentLink } from "./talents";

describe("liens de talents ForeverChanges", () => {
  it("calcule la répartition d'un lien", () => {
    expect(parseTalentLink("https://foreverchanges.pro/talents/druid?b=050022-5520002123032213051-05")).toEqual({
      ok: true, cls: "Druid", points: [9, 37, 5], blocks: ["050022", "5520002123032213051", "05"], split: "9/37/5",
    });
    expect(parseTalentLink(" https://www.foreverchanges.pro/talents/priest?b=1 ")).toMatchObject({ ok: true, cls: "Priest", split: "1/0/0" });
    expect(parseTalentLink("https://foreverchanges.pro/talents/warrior")).toMatchObject({ ok: true, split: "0/0/0" });
  });
  it("refuse les liens d'ailleurs ou illisibles", () => {
    expect(parseTalentLink("pas un lien")).toMatchObject({ ok: false });
    expect(parseTalentLink("https://exemple.com/talents/druid?b=1")).toMatchObject({ ok: false });
    expect(parseTalentLink("http://foreverchanges.pro/talents/druid?b=1")).toMatchObject({ ok: false });
    expect(parseTalentLink("https://foreverchanges.pro/class/druid")).toMatchObject({ ok: false });
    expect(parseTalentLink("https://foreverchanges.pro/talents/druid?b=12<script>")).toMatchObject({ ok: false });
  });
});

describe("lien du calculateur depuis les talents pris en jeu", () => {
  const talents = [
    { id: 10, tree: 0, linkIndex: 0, maxRank: 5 }, { id: 11, tree: 0, linkIndex: 2, maxRank: 2 },
    { id: 20, tree: 1, linkIndex: 0, maxRank: 3 }, { id: 30, tree: 2, linkIndex: 1, maxRank: 1 },
  ];
  it("range chaque rang à sa place et retire les zéros de fin", () => {
    expect(linkFromRanks("Druid", talents, new Map([[10, 5], [11, 2], [20, 3]]))).toEqual({
      link: "https://foreverchanges.pro/talents/druid?b=502-3", split: "7/3/0",
    });
    // Un rang plus haut que le maximum est ramené au maximum
    expect(linkFromRanks("Druid", talents, new Map([[30, 4]]))?.link).toBe("https://foreverchanges.pro/talents/druid?b=--01");
  });
  it("rien sans point placé ou avec une classe inconnue", () => {
    expect(linkFromRanks("Druid", talents, new Map())).toBeNull();
    expect(linkFromRanks("Bard", talents, new Map([[10, 1]]))).toBeNull();
  });
});
