import { describe, expect, it } from "vitest";
import { parseTalentLink } from "./talents";

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
