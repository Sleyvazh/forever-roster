import { describe, expect, it } from "vitest";
import { parseCharacterExport } from "./charexport";
import { LAUNCH_AT } from "./core";
import {
  afterLaunchText, announcedLevels, firstNameOf, guildKeyOf, levelAnnounceText, noteTarget, normalizeGuid, ordinalFr, parseGuildBlocks, parseGuildExports,
  raceDateText, raceDay, resolveNoteTarget,
} from "./guild";

/** Lot « Guilde » : relevé FRL, en-tête FRC avec GUID et nom complet, notes de guilde, textes de la Course au 60. Noms inventés. */

const G1 = "Player-4620-0A1B2C3D", G2 = "Player-4620-0A1B2C3E", G3 = "Player-4633-00FF00AA";
const T = 1794000000;

const sample = [
  `FRL;1;Les Lanternes;Horde;${T};Morwen Cendrevoile;1;Officier;3;Forever EU;1.6.2`,
  `M;Kaeldra Brisevent;WARRIOR;60;Maître de guilde;0;1;0;GM, raid lead;Officier loot;${G1}`,
  `M;Vexelle Ombrelame;ROGUE;24;Membre;3;0;30;Alt de Vex;;Player-4620-0a1b2c3e`,
  `M;Le Grimaud;PRIEST;12;Recrue;4;0;;;;${G3}`,
  `J;${T + 60};Morwen Cendrevoile`,
  "E;join;Le Grimaud;;;5",
  "E;invite;Torvin Rochefer;Le Grimaud;;5",
  "E;promote;Kaeldra Brisevent;Vexelle Ombrelame;3;30",
  "E;inconnu;X;Y;;1",
  "B;1794000100;Morwen Cendrevoile;123456;1",
  "T;1;Consommables;1;1",
  `P;Kaeldra;60;0;0;${T};${G1}`,
  `P;Vexelle;24;1500;10000;${T - 100};${G2}`,
  `U;Kaeldra;59;${T - 7200};${G1}`,
  `U;Kaeldra;60;${T - 3600};${G1}`,
  "END;14",
].join("\n");

describe("relevé de la guilde (FRL v1)", () => {
  it("liste, journal, XP et niveaux ; GUID normalisé ; banque ignorée pour l'instant", () => {
    const { data, errors } = parseGuildExports(`FRC;2;Kaeldra;Forever EU;WARRIOR;Orc;60;Horde;1;1.6.2\nEND;0\n${sample}`);
    expect(errors).toEqual([]);
    expect(data).toHaveLength(1);
    const g = data[0]!;
    expect(guildKeyOf(g)).toBe("Les Lanternes-Forever EU-Horde");
    expect(g.roster).toMatchObject({ at: T, by: "Morwen Cendrevoile", officerNotes: true, total: 3, complete: true, skipped: 0 });
    expect(g.roster!.members[0]).toEqual({
      guid: G1, name: "Kaeldra Brisevent", cls: "Warrior", level: 60, rank: "Maître de guilde", rankIndex: 0, online: true, hoursOffline: 0,
      note: "GM, raid lead", officerNote: "Officier loot",
    });
    expect(g.roster!.members[1]).toMatchObject({ guid: G2, online: false, hoursOffline: 30, note: "Alt de Vex" });
    expect(g.roster!.members[2]).toMatchObject({ name: "Le Grimaud", hoursOffline: null, guid: G3 });
    expect(g.journal!.events).toEqual([
      { type: "join", player1: "Le Grimaud", player2: "", rankIndex: null, hoursAgo: 5 },
      { type: "invite", player1: "Torvin Rochefer", player2: "Le Grimaud", rankIndex: null, hoursAgo: 5 },
      { type: "promote", player1: "Kaeldra Brisevent", player2: "Vexelle Ombrelame", rankIndex: 3, hoursAgo: 30 },
    ]);
    expect(g.xp).toEqual([
      { name: "Kaeldra", guid: G1, level: 60, xp: 0, xpMax: 0, at: T },
      { name: "Vexelle", guid: G2, level: 24, xp: 1500, xpMax: 10000, at: T - 100 },
    ]);
    expect(g.levels.map(l => l.level)).toEqual([59, 60]);
  });

  it("liste partielle, notes d'officier non lues, ancien format des lignes P et U (sans GUID), blocs abîmés", () => {
    const partial = [`FRL;1;Les Lanternes;Horde;${T};Vex Ombrelame;0;Membre;40;Forever EU;1.6.1`, `M;Vex Ombrelame;ROGUE;60;Officier;1;1;0;;secret;${G1}`, "M;Sans Guid;MAGE;10;Recrue;4;0;2;;;", `P;Vex;60;0;0;${T}`, `U;Vex;12;${T - 99}`, "END;4"].join("\n");
    const r = parseGuildExports(partial);
    expect(r.data[0]!.roster).toMatchObject({ complete: false, total: 40, skipped: 1, officerNotes: false });
    expect(r.data[0]!.roster!.members[0]!.officerNote).toBe("");
    expect(r.data[0]!.xp[0]!.guid).toBeNull();
    expect(r.data[0]!.levels[0]).toEqual({ name: "Vex", guid: null, level: 12, at: T - 99 });
    // Sans liste relevée (heure 0) : roster null ; END faux ; autre version
    expect(parseGuildExports(`FRL;1;Les Lanternes;Horde;0;;0;;0;Forever EU;1.6.2\nEND;0`).data[0]!.roster).toBeNull();
    expect(parseGuildExports(sample.replace("END;14", "END;12")).errors).toEqual(["relevé de guilde incomplet : recopie tout le texte, jusqu'à la ligne END"]);
    expect(parseGuildExports(sample.replace("FRL;1;", "FRL;2;")).errors[0]).toMatch(/version du relevé de guilde non gérée \(2\)/);
    // Le texte de chaque bloc est gardé (guilde proposée)
    expect(parseGuildBlocks(`${sample}\nFRB;2;x\n`).blocks[0]!.text).toBe(sample);
  });

  it("GUID et prénom", () => {
    expect(normalizeGuid(" player-4620-0a1b2c3d ")).toBeNull();
    expect(normalizeGuid("Player-4620-0a1b2c3d")).toBe("Player-4620-0A1B2C3D");
    expect(normalizeGuid("Creature-0-1")).toBeNull();
    expect(firstNameOf("Greta Coulé")).toBe("Greta");
    expect(firstNameOf("Greta-Forever EU")).toBe("Greta");
  });
});

describe("en-tête FRC de l'addon 1.6.2", () => {
  it("GUID et nom complet en fin d'en-tête ; l'ancien en-tête reste lu", () => {
    const now = parseCharacterExport(`FRC;2;Brindille;Forever EU;DRUID;Tauren;55;Horde;1790000000;1.6.2;${G1};Brindille Mousseclaire\nEND;0`);
    expect(now.ok && now.data).toMatchObject({ name: "Brindille", guid: G1, fullName: "Brindille Mousseclaire" });
    const old = parseCharacterExport("FRC;2;Brindille;Forever EU;DRUID;Tauren;55;Horde;1790000000;1.6.1\nEND;0");
    expect(old.ok && old.data).toMatchObject({ guid: null, fullName: null });
    // Nom complet qui ne commence pas par le prénom : ignoré ; GUID illisible : null
    const odd = parseCharacterExport("FRC;2;Brindille;Forever EU;DRUID;Tauren;55;Horde;1790000000;1.6.2;n/a;Autre Nom\nEND;0");
    expect(odd.ok && odd.data).toMatchObject({ guid: null, fullName: null });
  });
});

describe("suggestions tirées des notes de guilde", () => {
  it("formes reconnues (français, anglais, sans casse ni accents)", () => {
    for (const [note, x] of [
      ["Alt de Vex", "Vex"], ["alt Vex", "Vex"], ["Vex alt", "Vex"], ["Alt: Vex", "Vex"], ["Alt - Vex", "Vex"], ["reroll de Morwen", "Morwen"],
      ["Reroll Morwen", "Morwen"], ["RR Morwen", "Morwen"], ["Main : Kaeldra", "Kaeldra"], ["(Kaeldra)", "Kaeldra"], ["[Kaeldra]", "Kaeldra"],
      ["<Kaeldra>", "Kaeldra"], ["Kaeldra's alt", "Kaeldra"], ["Alt d'Ysalis", "Ysalis"], ["alt of Vex Ombrelame", "Vex Ombrelame"],
    ] as const) expect(noteTarget(note), note).toBe(x);
    for (const note of ["Main", "Alt", "Altaïr", "Maintenance", "Heal lead", "", "Bear ou resto selon le soir"]) expect(noteTarget(note), note).toBeNull();
  });

  it("résolution : nom complet, prénom unique, ambigu, note qui vaut un nom", () => {
    const members = [
      { guid: "a", name: "Vex Ombrelame" }, { guid: "b", name: "Morwen Cendrevoile" }, { guid: "c", name: "Morwen Lacrouille" }, { guid: "d", name: "Kaeldra Brisevent" },
    ];
    expect(resolveNoteTarget("Alt de Vex", members)).toEqual({ target: members[0], candidates: [] });
    expect(resolveNoteTarget("alt de vex ombrelame", members)!.target).toBe(members[0]);
    expect(resolveNoteTarget("reroll Morwen", members)).toEqual({ target: null, candidates: [members[1], members[2]] });
    expect(resolveNoteTarget("Kaeldra", members)!.target).toBe(members[3]);
    expect(resolveNoteTarget("Kældra", members)).toBeNull();
    expect(resolveNoteTarget("Alt de Personne", members)).toBeNull();
    expect(resolveNoteTarget("Heal lead", members)).toBeNull();
  });
});

describe("Course au 60 : textes et paliers", () => {
  it("paliers annoncés, jour de course, rang écrit, annonces", () => {
    expect(announcedLevels("none")).toEqual([]);
    expect(announcedLevels("sixty")).toEqual([60]);
    expect(announcedLevels("tens")).toEqual([20, 30, 40, 50, 60]);
    expect(raceDay(LAUNCH_AT - 1)).toBeNull();
    expect(raceDay(LAUNCH_AT)).toBe(1);
    expect(raceDay(LAUNCH_AT + 13.5 * 86400e3)).toBe(14);
    expect([1, 2, 10].map(ordinalFr)).toEqual(["1re", "2e", "10e"]);
    // 14/11 à 16:52 (Paris) : 9 jours après la sortie
    const at = Date.UTC(2026, 10, 14, 15, 52);
    expect(afterLaunchText(at)).toBe("9 jours après la sortie");
    expect(afterLaunchText(LAUNCH_AT + 3600e3)).toBe("le jour de la sortie");
    expect(levelAnnounceText({ name: "Kaeldra Brisevent", level: 60, rank: 1, at })).toBe("🏆 Kaeldra Brisevent atteint le niveau 60, 1re de la guilde, 9 jours après la sortie.");
    expect(levelAnnounceText({ name: "Morwen Cendrevoile", level: 50, rank: 4, at })).toBe("⬆️ Morwen Cendrevoile atteint le niveau 50 · 4e de la guilde.");
    expect(raceDateText(at, true)).toBe("samedi 14/11 à 16:52");
    expect(raceDateText(at, false)).toBe("vers le 14/11");
  });
});
