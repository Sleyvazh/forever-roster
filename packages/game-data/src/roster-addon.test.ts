import { describe, expect, it } from "vitest";
import { parseCharacterExports } from "./charexport";
import { parseRaidLogs } from "./raidlog";
import { RETAIL_CLASS_NAMES } from "./retail";
import {
  buildRRG, buildRRR, encounterSummary, foreignAddonErrors, fullName, fullNameKey, normalizedRealm, parseRRB, RETAIL_CLASS_TOKENS,
  retailClassOfToken, rosterInviteMacros, sameFullName, type RosterExportMember,
} from "./roster-addon";

/**
 * Formats de l'addon Roster (WoW Retail) : RRG et RRR (site → jeu), RRB (jeu → site). Noms fictifs.
 * Les exemples RRG et RRR sont écrits dans addon/tests/ (sample.rrg, sample.rrr) pour le test Lua de l'addon ;
 * le bilan écrit par le test Lua (sample.rrb), s'il est là, est relu ici : les deux côtés vérifient le même texte.
 */

// Accès aux fichiers sans les types de Node (le paquet n'en dépend pas) : import dynamique
type Fs = { writeFileSync(p: URL, s: string): void; existsSync(p: URL): boolean; readFileSync(p: URL, e: "utf8"): string };
const fs = () => import(/* @vite-ignore */ ["node", "fs"].join(":")) as Promise<Fs>;
const sample = (name: string) => new URL(`../../../addon/tests/${name}`, import.meta.url);

const GROUP = { id: "7d3c2b1a-0f9e-4d8c-b7a6-5e4d3c2b1a09", name: "Pasta e Basta" };
const RAID = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
const GENERATED = 1_794_000_000;

const SAMPLE_RRG = () => buildRRG(GROUP, GENERATED, [
  { id: RAID, name: "Flèche du Vide", at: 1_794_513_600, difficulty: "heroic", size: 20, status: "present", character: { name: "Kaeldra", realm: "Hyjal" }, lootMode: "journal" },
  { id: "2c3d4e5f-6071-4b8c-9dae-1f2a3b4c5d6e", name: "L'Abîme Venimeux", at: 1_795_118_400, difficulty: "mythic", size: 20, status: null, character: null, lootMode: "council" },
  { id: "3d4e5f60-7182-4c9d-aebf-2a3b4c5d6e7f", name: "Déliement de Kith'ix", at: 0, difficulty: "normal", size: 25, status: "tentative", character: { name: "Vex", realm: "Kael'Thas" }, lootMode: "softres" },
]);

const MEMBERS: RosterExportMember[] = [
  { name: "Brumelune", realm: "Ysondre", cls: "Monk", spec: "Mistweaver", role: "Heal", group: 1, pos: 2, status: "present", source: "site" },
  { name: "Tharok", realm: "Conseil des Ombres", cls: "Death Knight", spec: "Blood", role: "Tank", group: 1, pos: 1, status: "late", source: "site" },
  { name: "Kaeldra", realm: "Hyjal", cls: "Demon Hunter", spec: "Devourer", role: "DPS", group: 2, pos: 1, status: null, source: "site" },
  { name: "Vex", realm: "Kael'Thas", cls: "Evoker", spec: "Augmentation", role: "DPS", group: 0, pos: 0, status: "tentative", source: "site" },
  { name: "Pseudo Discord", realm: null, cls: "Hunter", spec: "Beast Mastery", role: "DPS", group: 0, pos: 0, status: "bench", source: "discord" },
];
const SAMPLE_RRR = () => buildRRR({ id: RAID, name: "Flèche du Vide", scheduledAt: new Date(1_794_513_600_000).toISOString(), difficulty: "heroic", size: 20 }, MEMBERS);

describe("noms en jeu (Prénom-Royaume)", () => {
  it("royaume normalisé comme le jeu : sans espaces ni tirets", () => {
    expect(normalizedRealm("Conseil des Ombres")).toBe("ConseildesOmbres");
    expect(normalizedRealm("Kael'Thas")).toBe("Kael'Thas");
    expect(normalizedRealm("Arak-arahm")).toBe("Arakarahm");
    expect(normalizedRealm(" La Croisade écarlate ")).toBe("LaCroisadeécarlate");
    expect(fullName("Tharok", "Conseil des Ombres")).toBe("Tharok-ConseildesOmbres");
    expect(fullName("Greta Coulé", "Hyjal")).toBe("Greta-Hyjal");
    expect(fullName("Kaeldra", "")).toBe("Kaeldra");
    expect(fullName("Ka;el|dra", "Hy;jal")).toBe("Ka-Hyjal");
  });

  it("comparaison sans casse, accents, apostrophes, espaces ni tirets", () => {
    expect(sameFullName("Kaëldra-Kael'Thas", "kaeldra-KaelThas")).toBe(true);
    expect(sameFullName("Tharok-Conseil des Ombres", "THAROK-ConseildesOmbres")).toBe(true);
    expect(sameFullName("Tharok-Arak-arahm", "Tharok-Arakarahm")).toBe(true);
    expect(sameFullName("Tharok-Hyjal", "Tharok-Ysondre")).toBe(false);
    expect(sameFullName("Tharok", "Tharok-Hyjal")).toBe(false);
    expect(fullNameKey("Brumelune-Ysondre")).toBe("brumelune-ysondre");
  });

  it("13 classes, jetons du jeu", () => {
    expect(Object.keys(RETAIL_CLASS_TOKENS).sort()).toEqual([...RETAIL_CLASS_NAMES].sort());
    expect(RETAIL_CLASS_TOKENS["Death Knight"]).toBe("DEATHKNIGHT");
    expect(RETAIL_CLASS_TOKENS["Demon Hunter"]).toBe("DEMONHUNTER");
    expect(retailClassOfToken("evoker")).toBe("Evoker");
    expect(retailClassOfToken("ROGUE")).toBe("Rogue");
    expect(retailClassOfToken("PIRATE")).toBeNull();
  });
});

describe("RRG : données des groupes (site → jeu)", () => {
  it("un raid par ligne, mon perso en Prénom-Royaume, END compte les R", () => {
    const text = SAMPLE_RRG();
    expect(text.split("\n")).toEqual([
      `RRG;1;${GROUP.id};${GENERATED};Pasta e Basta`,
      `R;${RAID};1794513600;Flèche du Vide;heroic;20;present;Kaeldra-Hyjal;journal`,
      "R;2c3d4e5f-6071-4b8c-9dae-1f2a3b4c5d6e;1795118400;L'Abîme Venimeux;mythic;20;;;council",
      "R;3d4e5f60-7182-4c9d-aebf-2a3b4c5d6e7f;0;Déliement de Kith'ix;normal;25;tentative;Vex-Kael'Thas;softres",
      "END;3",
    ]);
    expect(buildRRG({ id: GROUP.id, name: "A;B|C" }, 1, [])).toBe(`RRG;1;${GROUP.id};1;A B C\nEND;0`);
    expect(text).not.toContain("|");
  });
});

describe("RRR : compo d'un raid (site → jeu)", () => {
  it("placés par groupe et place, puis non placés par nom ; classe en jeton", () => {
    expect(SAMPLE_RRR().split("\n")).toEqual([
      `RRR;1;${RAID};1794513600;Flèche du Vide;heroic;20`,
      "M;Tharok-ConseildesOmbres;DEATHKNIGHT;Tank;Blood;1;1;late;site",
      "M;Brumelune-Ysondre;MONK;Heal;Mistweaver;1;2;present;site",
      "M;Kaeldra-Hyjal;DEMONHUNTER;DPS;Devourer;2;1;;site",
      "M;Pseudo Discord;HUNTER;DPS;Beast Mastery;0;0;bench;discord",
      "M;Vex-Kael'Thas;EVOKER;DPS;Augmentation;0;0;tentative;site",
      "END;5",
    ]);
  });

  it("raid sans date ni difficulté", () => {
    expect(buildRRR({ id: RAID, name: "Raid", scheduledAt: null, difficulty: null, size: 20 }, [])).toBe(`RRR;1;${RAID};0;Raid;;20\nEND;0`);
  });

  it("macros /inv Prénom-Royaume de 255 caractères au plus, sans doublon", () => {
    const names = Array.from({ length: 30 }, (_, i) => `Joueur${String.fromCharCode(97 + (i % 26))}${i}-ConseildesOmbres`);
    const macros = rosterInviteMacros([...names, "joueura0-Conseil des Ombres"]);
    expect(macros.length).toBeGreaterThan(1);
    expect(macros.every(m => m.length <= 255)).toBe(true);
    expect(macros.join("\n").split("\n")).toHaveLength(30);
    expect(macros[0]!.split("\n")[0]).toBe("/inv Joueura0-ConseildesOmbres");
    expect(rosterInviteMacros(["Kaeldra-Hyjal", "Tharok-ConseildesOmbres"])).toEqual(["/inv Kaeldra-Hyjal\n/inv Tharok-ConseildesOmbres"]);
  });
});

const RRB = `RRB;1;${RAID};1794513000;1794527400;Kaeldra-Hyjal;Flèche du Vide;The Voidspire;1;heroic
A;Kaeldra-Hyjal;1794513000;1794527400;240
A;Tharok-ConseildesOmbres;1794514500;1794527400;215
A;Brumelune-Ysondre;1794513000;1794520000;117
L;249321;Tharok-ConseildesOmbres;1794516000;Imperator Averzian;;;
L;249322;Kaeldra-Hyjal;1794520500;Vorasius;;;;Lame du Vide
E;3176;Imperator Averzian;1794515000;0
E;3176;Imperator Averzian;1794515900;1
E;3177;Vorasius;1794520400;1
END;8`;

describe("RRB : bilan d'un raid (jeu → site)", () => {
  it("présence, butin et rencontres, noms complets", () => {
    const r = parseRRB(RRB);
    expect(r.errors).toEqual([]);
    expect(r.data).toHaveLength(1);
    const log = r.data[0]!;
    expect(log).toMatchObject({ raidId: RAID, start: 1794513000, end: 1794527400, recorder: "Kaeldra-Hyjal", raidName: "Flèche du Vide", instance: "The Voidspire", lead: true, difficulty: "heroic" });
    expect(log.attendees.map(a => a.name)).toEqual(["Kaeldra-Hyjal", "Tharok-ConseildesOmbres", "Brumelune-Ysondre"]);
    expect(log.loot).toEqual([
      { itemId: 249321, name: "Tharok-ConseildesOmbres", at: 1794516000, boss: "Imperator Averzian" },
      { itemId: 249322, name: "Kaeldra-Hyjal", at: 1794520500, boss: "Vorasius", itemName: "Lame du Vide" },
    ]);
    expect(log.encounters).toEqual([
      { encounterId: 3176, boss: "Imperator Averzian", at: 1794515000, killed: false },
      { encounterId: 3176, boss: "Imperator Averzian", at: 1794515900, killed: true },
      { encounterId: 3177, boss: "Vorasius", at: 1794520400, killed: true },
    ]);
    expect(encounterSummary(log.encounters)).toEqual([
      { encounterId: 3176, boss: "Imperator Averzian", tries: 2, killedAt: 1794515900, lastAt: 1794515900 },
      { encounterId: 3177, boss: "Vorasius", tries: 1, killedAt: 1794520400, lastAt: 1794520400 },
    ]);
  });

  it("chef 0, difficulté inconnue : pas de lead, pas de difficulté", () => {
    const r = parseRRB(RRB.replace(";1;heroic", ";0;"));
    expect(r.data[0]!.lead).toBeUndefined();
    expect(r.data[0]!.difficulty).toBeUndefined();
  });

  it("blocs abîmés signalés sans bloquer les autres", () => {
    const other = "4d5e6f70-8192-4dae-bfc0-3b4c5d6e7f80";
    const text = [
      RRB,
      RRB.replace("END;8", "END;7"),
      `RRB;2;${other};1;2;X-Y;Raid;;0;`, "END;0",
      `RRB;1;pas-un-raid;1;2;X-Y;Raid;;0;`, "END;0",
      `RRB;1;${other};1;2;X-Y;Raid;;0;`, "E;12;Boss;5;2", "END;1",
    ].join("\n");
    const r = parseRRB(text);
    expect(r.data).toHaveLength(1);
    expect(r.errors).toEqual([
      "bilan incomplet (nombre de lignes)",
      "version de bilan non gérée (2) : mets le site à jour",
      "bilan sans raid du site (copie les données du site dans l'addon avant le raid)",
      "ligne de rencontre illisible : E;12;Boss;5;2",
    ]);
    expect(parseRRB(RRB.replace("\nEND;8", "")).errors).toEqual(["bilan incomplet : recopie tout le texte, jusqu'à la ligne END"]);
  });

  it("un texte de Forever Roster est signalé, jamais lu", () => {
    const frc = "FRC;2;Tournicoti;Forever EU;DRUID;Tauren;60;Horde;1790000000;1.5.4\nEND;0";
    expect(parseRRB(frc)).toEqual({ data: [], errors: [expect.stringContaining("Ce texte vient de l'addon Forever Roster : colle-le sur forever-roster.sleyvazh.fr. Sur Roster, les persos viennent de Battle.net")] });
    const frb = `FRB;2;${RAID};1;2;Thalion;Molten Core;Molten Core;1\nEND;0`;
    expect(parseRRB(frb, { otherHost: "localhost:4173" }).errors).toEqual(["Ce texte vient de l'addon Forever Roster : colle-le sur localhost:4173."]);
    // Et l'inverse : sur Forever Roster, un texte de Roster
    expect(foreignAddonErrors(RRB, "forever")).toEqual(["Ce texte vient de l'addon Roster (WoW Retail) : colle-le sur roster.sleyvazh.fr."]);
    expect(foreignAddonErrors(frb, "forever")).toEqual([]);
    // Un bilan de Roster après un bilan ou un perso de Forever ne s'y mélange pas
    const mixed = parseRaidLogs(`FRB;1;${RAID};1000;8200;Thalion;Molten Core\nA;Thalwen;1000;8200;121\nEND;1\n${RRB}`);
    expect(mixed.data[0]!.attendees.map(a => a.name)).toEqual(["Thalwen"]);
    const chars = parseCharacterExports(`${frc}\n${RRB}`);
    expect(chars.ok && chars.errors).toEqual([]);
  });
});

describe("exemples partagés avec le test Lua de l'addon", () => {
  it("écrit addon/tests/sample.rrg et sample.rrr (déterministes)", async () => {
    const { writeFileSync } = await fs();
    writeFileSync(sample("sample.rrg"), `${SAMPLE_RRG()}\n`);
    writeFileSync(sample("sample.rrr"), `${SAMPLE_RRR()}\n`);
  });

  it("relit le bilan écrit par l'addon (addon/tests/sample.rrb), s'il est là", async () => {
    const { existsSync, readFileSync } = await fs();
    if (!existsSync(sample("sample.rrb"))) return;
    const text = readFileSync(sample("sample.rrb"), "utf8");
    expect(text.startsWith("RRB;1;")).toBe(true);
    const r = parseRRB(text);
    expect(r.errors).toEqual([]);
    expect(r.data.length).toBeGreaterThan(0);
    for (const log of r.data) {
      expect(log.attendees.length).toBeGreaterThan(0);
      expect(log.attendees.every(a => /^[^-\s]+-[^-\s]+$/.test(a.name))).toBe(true);
    }
  });
});
