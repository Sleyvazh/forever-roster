import { describe, expect, it } from "vitest";
import { parseCharacterExport } from "./charexport";
import { LAUNCH_AT } from "./core";
import { sealText } from "./seal";
import {
  afterLaunchText, announcedLevels, firstNameOf, guildKeyOf, levelAnnounceText, noteTarget, normalizeGuid, ordinalFr, parseGuildBlocks, parseGuildExports,
  guildRaceStart, ordinalEn, raceDateText, raceDay, resolveNoteTarget,
} from "./guild";

/** Lot « Guilde » : relevé FRL, en-tête FRC avec GUID et nom complet, notes de guilde, textes de la Course au 60. Noms inventés. */

const G1 = "Player-4620-0A1B2C3D", G2 = "Player-4620-0A1B2C3E", G3 = "Player-4633-00FF00AA";
const T = 1794000000;

const sample = sealText([
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
].join("\n"));

describe("relevé de la guilde (FRL v1)", () => {
  it("liste, journal, banque, XP et niveaux ; GUID normalisé", () => {
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
    expect(g.bank).toEqual({
      at: 1794000100, by: "Morwen Cendrevoile", money: 123456, ntabs: 1,
      tabs: [{ tab: 1, name: "Consommables", visible: true, read: true }], items: [], log: [], moneyLog: [],
    });
  });

  it("liste partielle, notes d'officier non lues, ancien format des lignes P et U (sans GUID), blocs abîmés", () => {
    const partial = sealText([`FRL;1;Les Lanternes;Horde;${T};Vex Ombrelame;0;Membre;40;Forever EU;1.6.1`, `M;Vex Ombrelame;ROGUE;60;Officier;1;1;0;;secret;${G1}`, "M;Sans Guid;MAGE;10;Recrue;4;0;2;;;", `P;Vex;60;0;0;${T}`, `U;Vex;12;${T - 99}`, "END;4"].join("\n"));
    const r = parseGuildExports(partial);
    expect(r.data[0]!.roster).toMatchObject({ complete: false, total: 40, skipped: 1, officerNotes: false });
    expect(r.data[0]!.roster!.members[0]!.officerNote).toBe("");
    expect(r.data[0]!.xp[0]!.guid).toBeNull();
    expect(r.data[0]!.levels[0]).toEqual({ name: "Vex", guid: null, level: 12, at: T - 99 });
    // Sans liste relevée (heure 0) : roster null ; sans banque : bank null ; END faux ; autre version
    expect(parseGuildExports(sealText(`FRL;1;Les Lanternes;Horde;0;;0;;0;Forever EU;1.6.2\nEND;0`)).data[0]!.roster).toBeNull();
    expect(r.data[0]!.bank).toBeNull();
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

/** Un bloc FRL sans liste ni journal : l'en-tête, les lignes données et END. */
const frl = (...lines: string[]) => sealText([`FRL;1;Les Lanternes;Horde;0;;0;;0;Forever EU;1.6.2`, ...lines, `END;${lines.length}`].join("\n"));
const bankOf = (...lines: string[]) => parseGuildExports(frl(...lines)).data[0]!.bank;

describe("journal de guilde : rang d'une ligne E", () => {
  it("rang borné à 20 comme celui des lignes M (la colonne est un smallint), vide ou illisible : null", () => {
    const g = parseGuildExports(sealText([
      `FRL;1;Les Lanternes;Horde;0;;0;;0;Forever EU;1.6.2`, `J;${T};Morwen`,
      "E;promote;Kaeldra;Vexelle;99999999999;1", "E;demote;Kaeldra;Vexelle;20;2", "E;promote;Kaeldra;Vexelle;3;3", "E;promote;Kaeldra;Vexelle;;4", "E;promote;Kaeldra;Vexelle;x;5",
      "END;6",
    ].join("\n"))).data[0]!;
    expect(g.journal!.events.map(e => e.rankIndex)).toEqual([20, 20, 3, null, null]);
  });
});

describe("banque de guilde (lignes B, T, I, X, O)", () => {
  it("banque complète : onglets, objets, journaux des onglets et de l'or", () => {
    const text = frl(
      `B;${T};Morwen Cendrevoile;5000123;3`,
      "T;1;Consommables;1;1", "T;2;Officiers;0;0", "T;3;Métiers;1;0",
      "I;1;1;13446;20", "I;1;15;13444;5",
      "I;1;99;1;1", // case hors de 1 à 98
      "I;4;1;1;1", // onglet au-delà du nombre d'onglets
      "I;1;1;999;1", // case déjà lue
      "I;1;2;0;1", // objet 0
      "I;3;7;2589;",
      "X;1;deposit;Pikou;13446;20;;;3", "X;1;move;Kaeldra;13444;1;1;2;30",
      "X;1;withdraw;Vex;;;;;", // sans heure
      "O;deposit;Kaeldra;500000;20", "O;repair;Gorrak;123030;50", "O;withdraw;Vex;;4",
    );
    const r = parseGuildExports(text);
    expect(r.errors).toEqual([]);
    expect(r.data[0]!.bank).toEqual({
      at: T, by: "Morwen Cendrevoile", money: 5000123, ntabs: 3,
      tabs: [
        { tab: 1, name: "Consommables", visible: true, read: true },
        { tab: 2, name: "Officiers", visible: false, read: false },
        { tab: 3, name: "Métiers", visible: true, read: false },
      ],
      items: [{ tab: 1, slot: 1, id: 13446, n: 20 }, { tab: 1, slot: 15, id: 13444, n: 5 }, { tab: 3, slot: 7, id: 2589, n: 1 }],
      log: [
        { tab: 1, type: "deposit", who: "Pikou", itemId: 13446, n: 20, tab1: null, tab2: null, hoursAgo: 3 },
        { tab: 1, type: "move", who: "Kaeldra", itemId: 13444, n: 1, tab1: 1, tab2: 2, hoursAgo: 30 },
      ],
      moneyLog: [
        { type: "deposit", who: "Kaeldra", amount: 500000, hoursAgo: 20 },
        { type: "repair", who: "Gorrak", amount: 123030, hoursAgo: 50 },
        { type: "withdraw", who: "Vex", amount: null, hoursAgo: 4 },
      ],
    });
  });

  it("quantité d'une case : au moins 1 (vide, 0 ou illisible : 1)", () => {
    const b = bankOf(`B;${T};Morwen;1;1`, "T;1;Soins;1;1", "I;1;1;13446;0", "I;1;2;13446;", "I;1;3;13446;x", "I;1;4;13446;-3", "I;1;5;13446;7")!;
    expect(b.items.map(i => i.n)).toEqual([1, 1, 1, 1, 7]);
  });

  it("sans heure de relevé : pas de banque, et ses lignes sont ignorées ; lignes avant B ignorées", () => {
    expect(bankOf(`B;0;Morwen;100;1`, "T;1;Soins;1;1", "I;1;1;13446;1", "X;1;deposit;Pikou;13446;1;;;3", "O;deposit;Pikou;100;3")).toBeNull();
    expect(bankOf(`B;;Morwen;100;1`, "T;1;Soins;1;1")).toBeNull();
    expect(bankOf("T;1;Avant;1;1", "I;1;1;13446;1", "O;deposit;Pikou;100;3", `B;${T};Morwen;100;1`, "T;1;Soins;1;1")).toEqual({
      at: T, by: "Morwen", money: 100, ntabs: 1, tabs: [{ tab: 1, name: "Soins", visible: true, read: true }], items: [], log: [], moneyLog: [],
    });
  });

  it("or inconnu : null ; onglets limités à 8 ; un seul T par onglet", () => {
    expect(bankOf(`B;${T};Morwen;;3`)).toMatchObject({ money: null, ntabs: 3 });
    expect(bankOf(`B;${T};Morwen;0;0`)).toMatchObject({ money: 0, ntabs: 0 });
    const b = bankOf(`B;${T};Morwen;1;12`, "T;8;Huitième;1;1", "T;9;Neuvième;1;1", "T;8;Doublon;0;0", "I;9;1;13446;1")!;
    expect(b.ntabs).toBe(8);
    expect(b.tabs).toEqual([{ tab: 8, name: "Huitième", visible: true, read: true }]);
    expect(b.items).toEqual([]);
  });

  it("noms nettoyés et coupés ; type de ligne de journal illisible : ignoré", () => {
    const long = "É".repeat(100);
    const b = bankOf(
      `B;${T};${long};1;1`, `T;1;${long};1;1`,
      "X;1;dépôt;Pikou;13446;1;;;3", "X;1;deposit2;Pikou;13446;1;;;3", `X;1;${"a".repeat(21)};Pikou;13446;1;;;3`, "X;1;;Pikou;13446;1;;;3",
      `X;1;deposit;${long};13446;1;;;3`, "O;dép;Pikou;100;3", "O;;Pikou;100;3",
    )!;
    expect(b.by).toBe("É".repeat(80));
    expect(b.tabs[0]!.name).toBe("É".repeat(40));
    expect(b.log).toHaveLength(1);
    expect(b.log[0]!.who).toBe("É".repeat(80));
    expect(b.moneyLog).toEqual([]);
  });

  it("journal : onglet inconnu ignoré, objet et quantité facultatifs, onglets de départ et d'arrivée valides ou null", () => {
    const b = bankOf(
      `B;${T};Morwen;1;2`,
      "X;3;deposit;Pikou;13446;1;;;3", // onglet au-delà du nombre d'onglets
      "X;2;withdraw;Vex;0;;;;5", // objet 0 : null, quantité vide : null
      "X;1;move;Vex;13444;2;9;0;6", // onglets hors de 1 à 8 : null
      "X;1;deposit;Vex;13444;-2;;;-1", // quantité négative : null ; heures négatives : ligne ignorée
    )!;
    expect(b.log).toEqual([
      { tab: 2, type: "withdraw", who: "Vex", itemId: null, n: null, tab1: null, tab2: null, hoursAgo: 5 },
      { tab: 1, type: "move", who: "Vex", itemId: 13444, n: 2, tab1: null, tab2: null, hoursAgo: 6 },
    ]);
  });

  it("50 lignes de journal par onglet, 50 lignes d'or", () => {
    const x = (tab: number, i: number) => `X;${tab};deposit;Pikou;13446;1;;;${i}`;
    const lines = [`B;${T};Morwen;1;2`];
    for (let i = 0; i < 60; i++) lines.push(x(1, i));
    for (let i = 0; i < 55; i++) lines.push(x(2, i));
    for (let i = 0; i < 70; i++) lines.push(`O;deposit;Pikou;100;${i}`);
    const b = bankOf(...lines)!;
    expect(b.log.filter(l => l.tab === 1)).toHaveLength(50);
    expect(b.log.filter(l => l.tab === 2)).toHaveLength(50);
    expect(b.log.filter(l => l.tab === 1).at(-1)!.hoursAgo).toBe(49);
    expect(b.moneyLog).toHaveLength(50);
  });
});

describe("en-tête FRC de l'addon 1.6.2", () => {
  it("GUID et nom complet en fin d'en-tête ; l'ancien en-tête reste lu", () => {
    const now = parseCharacterExport(sealText(`FRC;2;Brindille;Forever EU;DRUID;Tauren;55;Horde;1790000000;1.6.2;${G1};Brindille Mousseclaire\nEND;0`));
    expect(now.ok && now.data).toMatchObject({ name: "Brindille", guid: G1, fullName: "Brindille Mousseclaire" });
    const old = parseCharacterExport(sealText("FRC;2;Brindille;Forever EU;DRUID;Tauren;55;Horde;1790000000;1.6.1\nEND;0"));
    expect(old.ok && old.data).toMatchObject({ guid: null, fullName: null });
    // Nom complet qui ne commence pas par le prénom : ignoré ; GUID illisible : null
    const odd = parseCharacterExport(sealText("FRC;2;Brindille;Forever EU;DRUID;Tauren;55;Horde;1790000000;1.6.2;n/a;Autre Nom\nEND;0"));
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
    // Course d'une guilde liée plus tard sans aucun 60 : son premier relevé est le jour 1
    const later = LAUNCH_AT + 20 * 86400e3;
    expect(guildRaceStart(later, false)).toBe(later);
    expect(guildRaceStart(later, true)).toBe(LAUNCH_AT);
    expect(guildRaceStart(LAUNCH_AT - 86400e3, false)).toBe(LAUNCH_AT);
    expect(guildRaceStart(null, false)).toBe(LAUNCH_AT);
    expect(raceDay(later + 2.5 * 86400e3, guildRaceStart(later, false))).toBe(3);
    expect([1, 2, 10].map(ordinalFr)).toEqual(["1re", "2e", "10e"]);
    // 14/11 à 16:52 (Paris) : 9 jours après la sortie
    const at = Date.UTC(2026, 10, 14, 15, 52);
    expect(afterLaunchText(at)).toBe("9 jours après la sortie");
    expect(afterLaunchText(LAUNCH_AT + 3600e3)).toBe("le jour de la sortie");
    expect(levelAnnounceText({ name: "Kaeldra Brisevent", level: 60, rank: 1, at })).toBe("🏆 Kaeldra Brisevent atteint le niveau 60, 1re de la guilde, 9 jours après la sortie.");
    expect(levelAnnounceText({ name: "Morwen Cendrevoile", level: 50, rank: 4, at })).toBe("⬆️ Morwen Cendrevoile atteint le niveau 50 · 4e de la guilde.");
    expect(raceDateText(at, true)).toBe("samedi 14/11 à 16:52");
    expect(raceDateText(at, false)).toBe("vers le 14/11");
    // Guilde dont le bot parle anglais (lot E6)
    expect(raceDateText(at, true, undefined, "en")).toBe("Saturday 14/11 at 16:52");
    expect(raceDateText(at, false, undefined, "en")).toBe("around 14/11");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinalEn)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
  });
});
