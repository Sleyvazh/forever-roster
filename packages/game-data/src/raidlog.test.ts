import { describe, expect, it } from "vitest";
import { parseCharacterExports } from "./charexport";
import { attendanceStatus, parseRaidLogs } from "./raidlog";

const ID = "4a1e43ea-54e8-4b49-888f-5e19b5754f61";
const LOG = `FRB;1;${ID};1000;8200;Thalion;Molten Core
A;Thalwen;1000;8200;121
A;Sylvaë-Forever EU;2500;8200;95
L;16828;Thalwen;3000;Lucifron
L;17063;Grumdal;5000;
END;4`;

describe("bilan de raid (FRB)", () => {
  it("lit présence et butin, sans royaume", () => {
    const r = parseRaidLogs(LOG);
    expect(r.errors).toEqual([]);
    expect(r.data[0]).toMatchObject({ raidId: ID, start: 1000, end: 8200, recorder: "Thalion", raidName: "Molten Core" });
    expect(r.data[0]!.attendees.map(a => a.name)).toEqual(["Thalwen", "Sylvaë"]);
    expect(r.data[0]!.loot).toEqual([{ itemId: 16828, name: "Thalwen", at: 3000, boss: "Lucifron" }, { itemId: 17063, name: "Grumdal", at: 5000, boss: "" }]);
  });

  it("refuse un bilan tronqué ou sans raid du site", () => {
    expect(parseRaidLogs(LOG.split("\n").slice(0, 3).join("\n")).errors[0]).toMatch(/incomplet/);
    expect(parseRaidLogs("FRB;1;pas-un-id;1;2;X;Y\nEND;0").errors[0]).toMatch(/sans raid du site/);
  });

  it("se mêle aux persos sans gêner leur lecture", () => {
    const chars = `FRC;2;Thalwen;Forever EU;DRUID;Tauren;60;Horde;1000;0.8.0\nG;1:16866\nEND;1`;
    const both = `${chars}\n${LOG}`;
    const c = parseCharacterExports(both);
    expect(c.ok && c.data.map(d => d.name)).toEqual(["Thalwen"]);
    expect(parseRaidLogs(both).data).toHaveLength(1);
  });

  it("statut de présence", () => {
    const log = { start: 1000, end: 8200 };
    expect(attendanceStatus({ first: 1000, last: 8200 }, log, 1000, "present")).toBe("present");
    expect(attendanceStatus({ first: 2500, last: 8200 }, log, 1000, null)).toBe("late");
    expect(attendanceStatus({ first: 1000, last: 5000 }, log, 1000, "present")).toBe("left");
    expect(attendanceStatus(null, log, 1000, "present")).toBe("absent");
    expect(attendanceStatus(null, log, 1000, "tentative")).toBeNull();
    expect(attendanceStatus(null, log, 1000, "bench")).toBe("bench");
    // Relevé commencé en retard (le chef s'est connecté après l'heure) : arrivée au 1er relevé = à l'heure
    expect(attendanceStatus({ first: 4000, last: 8200 }, { start: 4000, end: 8200 }, 1000, null)).toBe("present");
  });
});
